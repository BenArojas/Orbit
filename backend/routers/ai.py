"""
AI analysis routes — run analysis, chat, manage models, check status.

Philosophy: We detect, suggest, and guide — we never download or install for the user.
The user installs Ollama, pulls models, and chooses which model to use.
We make this as smooth as possible with clear guidance and smart defaults.

Endpoints:
  POST /ai/analyze         — Run full technical analysis, returns signal + text
  POST /ai/analyze/stream  — Stream the analysis narrative + final signal via SSE
  POST /ai/chat            — Send a follow-up question in an existing session
  POST /ai/chat/stream     — Streaming follow-up via Server-Sent Events
  GET  /ai/status          — Ollama lifecycle state (installed? running? model selected?)
  GET  /ai/models          — List all locally available models with metadata
  POST /ai/models/select   — Choose which model to use for analysis
  GET  /ai/setup-guide     — Get install instructions + recommended models
  POST /ai/refresh         — Re-detect Ollama and re-list models (after user installs/pulls)

Flow:
  1. Frontend polls GET /ai/status on mount
  2. If not_installed → show setup guide (GET /ai/setup-guide) with install link
  3. If no_models → show setup guide with model recommendations and pull commands
  4. If running (models available, none selected) → show model picker (GET /ai/models)
  5. If ready → AI panel fully functional, "Run Analysis" enabled
  6. User clicks "Run Analysis" → POST /ai/analyze
  7. User asks follow-up → POST /ai/chat or /ai/chat/stream
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from deps import get_ibkr, get_db, get_ai, get_ai_keystore, get_ai_settings, get_ollama
from models import (
    AIProviderKeySaveRequest,
    AIProviderMetadata,
    AIProviderName,
    AIProviderStatus,
    AIProvidersResponse,
    AIRoutingPolicyResponse,
    AIRoutingPolicyUpdate,
    AiStatusResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    ChatRequest,
    ChatResponse,
    CandleData,
    FibonacciSnapshot,
    ModelSelectRequest,
    OllamaModelResponse,
    RecommendedModel,
    SetupGuideResponse,
    SignalData,
    SignalLevel,
    SignalCheck,
    SignalMeta,
)
from exceptions import AIAnalysisTimeoutError
from services.ai import AiService, _coerce_confidence
from services.ai_keystore import AIKeyStore, AIKeyStoreUnavailableError
from services.ai_settings import AISettingsService
from services.db import DatabaseService
from services.ibkr import IBKRService
from services.indicators import IndicatorService, get_active_fib_weights
from services.ollama import OllamaLifecycle

log = logging.getLogger("parallax.routers.ai")

router = APIRouter(prefix="/ai", tags=["ai"])

# Indicator service is stateless — reuse the same instance
_indicator_service = IndicatorService()


def _local_provider_status(ollama: OllamaLifecycle) -> AIProviderStatus:
    status = ollama.status()
    return AIProviderStatus(
        provider_name="ollama",
        display_name="Ollama",
        kind="local",
        enabled=True,
        ready=bool(status.get("ready")),
        selected_model=status.get("selected_model"),
        has_key=False,
        error=status.get("error"),
    )


def _provider_status_from_config(
    config: dict,
    ollama: OllamaLifecycle,
) -> AIProviderStatus:
    if config["provider_name"] == "ollama":
        status = _local_provider_status(ollama)
        return status.model_copy(update={
            "display_name": config["display_name"],
            "enabled": True,
        })

    return AIProviderStatus(
        provider_name=config["provider_name"],
        display_name=config["display_name"],
        kind=config["kind"],
        enabled=bool(config["enabled"] and config.get("api_key_ref")),
        ready=False,
        selected_model=config.get("selected_model"),
        has_key=bool(config.get("api_key_ref")),
        error=None,
    )


def _local_provider_metadata(model: str | None) -> AIProviderMetadata:
    return AIProviderMetadata(
        provider_name="ollama",
        kind="local",
        model=model,
        estimated_cost=None,
        actual_cost=None,
        fallback_used=False,
    )


def _keychain_unavailable_http_error() -> HTTPException:
    return HTTPException(
        status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": "ai_keychain_unavailable",
            "message": "OS keychain is unavailable. Cloud AI providers remain disabled.",
        },
    )


def _cloud_blocked_http_error() -> HTTPException:
    return HTTPException(
        status_code=http_status.HTTP_400_BAD_REQUEST,
        detail={
            "error": "ai_cloud_blocked_for_task",
            "message": "Cloud AI is blocked for execution-sensitive tasks.",
        },
    )


def _cloud_provider_unavailable_http_error(provider_name: str) -> HTTPException:
    return HTTPException(
        status_code=http_status.HTTP_400_BAD_REQUEST,
        detail={
            "error": "ai_cloud_provider_unavailable",
            "message": f"{provider_name} is not enabled for cloud AI.",
        },
    )


async def _resolve_analysis_routing(
    request: AnalyzeRequest,
    ollama: OllamaLifecycle,
    ai_settings: AISettingsService,
) -> tuple[str, str, str | None, bool]:
    """Return provider name, model, local fallback model, and fallback flag."""
    local_model = ollama.selected_model
    if request.provider_name == "ollama":
        if not local_model:
            raise _cloud_provider_unavailable_http_error("ollama")
        return "ollama", request.model or local_model, None, False

    if request.task_type == "execution_sensitive":
        raise _cloud_blocked_http_error()

    provider_configs = await ai_settings.list_provider_configs()
    selected = next(
        (
            config for config in provider_configs
            if config["provider_name"] == request.provider_name
        ),
        None,
    )
    if selected is None or not selected["enabled"] or not selected.get("api_key_ref"):
        raise _cloud_provider_unavailable_http_error(request.provider_name)

    policy = await ai_settings.get_routing_policy()
    model = request.model or selected.get("selected_model") or "openrouter/auto"
    return (
        request.provider_name,
        model,
        local_model,
        bool(policy["local_fallback_enabled"] and local_model),
    )


# ── Timeframe → IBKR period mapping for AI analysis ────────

AI_TIMEFRAME_MAP: dict[str, tuple[str, str]] = {
    "1H": ("1d", "1min"),       # 1 day of 1-min bars → hourly context
    "4H": ("5d", "5min"),       # 5 days of 5-min bars → 4H context
    "D": ("3m", "1d"),          # 3 months of daily bars
    "W": ("1y", "1w"),          # 1 year of weekly bars
}

# ── Frontend indicator name → backend indicator name(s) ────
#
# The AI config panel uses user-friendly display names that don't
# always map 1:1 to the backend indicator names.

AI_INDICATOR_MAP: dict[str, list[str]] = {
    "EMA Stack": ["ema_9", "ema_21", "ema_50", "ema_200"],
    "RSI":       ["rsi"],
    "MACD":      ["macd"],
    "Fibonacci": ["fibonacci"],
    "Volume":    ["volume"],
    "BB":        ["bbands"],
    "ADX":       ["adx"],
    "Stochastic": ["stoch"],
    "VWAP":      ["vwap"],
    "OBV":       ["obv"],
    "ATR":       ["atr"],
}


def _resolve_indicators(display_names: list[str]) -> list[str]:
    """
    Convert frontend display names to backend indicator names.

    Frontend sends: ["EMA Stack", "RSI", "Fibonacci"]
    Backend needs:  ["ema_9", "ema_21", "ema_50", "ema_200", "rsi", "fibonacci"]
    """
    resolved: list[str] = []
    seen: set[str] = set()
    for name in display_names:
        backend_names = AI_INDICATOR_MAP.get(name, [name.lower().replace(" ", "_")])
        for bn in backend_names:
            if bn not in seen:
                resolved.append(bn)
                seen.add(bn)
    return resolved


# ── Helper: fetch indicator data for one timeframe ──────────

async def _fetch_timeframe_data(
    conid: int,
    timeframe: str,
    indicators: list[str],
    ibkr: IBKRService,
    fib_weights: dict[str, float] | None = None,
    fib_snapshots: list[FibonacciSnapshot] | None = None,
) -> dict:
    """
    Fetch candle data from IBKR and compute indicators for one timeframe.
    Returns {"candles": [...], "indicators": [...], "fibonacci": ...}

    `fib_weights` is preloaded once per analyze request (Branch 3) so
    every per-TF compute uses the same user-edited weights without
    re-hitting the DB.

    When frontend-provided fib snapshots are relevant for this timeframe,
    they override backend auto-detection for prompt construction. We
    still compute the other indicators from candles so the analysis keeps
    full chart context.
    """
    ibkr_period, ibkr_bar = AI_TIMEFRAME_MAP.get(timeframe, ("3m", "1d"))

    raw = await ibkr.history(conid, period=ibkr_period, bar=ibkr_bar)
    bars = raw.get("data", [])

    candles: list[CandleData] = []
    for bar in bars:
        if "t" not in bar:
            continue
        candles.append(CandleData(
            time=bar["t"] // 1000,
            open=bar["o"],
            high=bar["h"],
            low=bar["l"],
            close=bar["c"],
            volume=bar.get("v", 0),
        ))

    if not candles:
        return {"candles": [], "indicators": [], "fibonacci": None, "fibs": []}

    tf_snapshots = [
        snap for snap in (fib_snapshots or [])
        if snap.timeframe is None or snap.timeframe == timeframe
    ]
    compute_indicators = indicators
    if tf_snapshots:
        compute_indicators = [name for name in indicators if name != "fibonacci"]

    indicator_results, fibonacci = _indicator_service.compute(
        candles=candles,
        indicators=compute_indicators,
        weights=fib_weights,
    )

    return {
        "candles": candles,
        "indicators": indicator_results,
        "fibonacci": None if tf_snapshots else fibonacci,
        "fibs": tf_snapshots,
    }


# ── Helper: convert raw signal dict → Pydantic model ───────

def _parse_signal(raw: dict) -> SignalData | None:
    """Safely convert parsed signal dict to Pydantic model."""
    try:
        return SignalData(
            direction=raw["direction"],
            description=raw["description"],
            confidence=_coerce_confidence(raw.get("confidence")),
            levels=[SignalLevel(**l) for l in raw["levels"]],
            meta=[SignalMeta(**m) for m in raw["meta"]],
            checks=[SignalCheck(**c) for c in raw["checks"]],
        )
    except (KeyError, TypeError, ValidationError) as e:
        log.warning("Failed to parse signal into model: %s", e)
        return None


# ═══════════════════════════════════════════════════════════════
#  POST /ai/warmup
# ═══════════════════════════════════════════════════════════════


@router.post("/warmup", status_code=204)
async def warmup(
    ai: AiService = Depends(get_ai),
    ollama: OllamaLifecycle = Depends(get_ollama),
):
    """
    Pre-load the selected model into memory.

    The frontend calls this on Analysis/Screener page mount so the first
    real analysis request doesn't pay the cold-start penalty.  If Ollama
    isn't ready or no model is selected we return 204 silently (non-fatal).
    """
    s = ollama.status()
    model = s.get("selected_model")
    if not model or not s.get("ready"):
        return  # Nothing to warm up — silently succeed

    await ai.warmup(model)


# ═══════════════════════════════════════════════════════════════
#  GET /ai/providers
# ═══════════════════════════════════════════════════════════════


@router.get("/providers", response_model=AIProvidersResponse)
async def providers(
    ollama: OllamaLifecycle = Depends(get_ollama),
    ai_settings: AISettingsService = Depends(get_ai_settings),
):
    """Return AI provider status for the settings shell.

    Slice 3 is still no-secrets/no-cloud: cloud providers are listed so the UI
    can render cards, but they remain disabled until OS-keychain enablement.
    """
    policy = await ai_settings.get_routing_policy()
    provider_configs = await ai_settings.list_provider_configs()
    provider_statuses = [
        _provider_status_from_config(config, ollama)
        for config in provider_configs
    ]
    return AIProvidersResponse(
        providers=provider_statuses,
        active_provider="ollama",
        routing_mode=policy["routing_mode"],
        cloud_enabled=False,
    )


@router.get("/routing-policy", response_model=AIRoutingPolicyResponse)
async def routing_policy(
    ai_settings: AISettingsService = Depends(get_ai_settings),
):
    """Return non-secret AI routing and cost-cap settings."""
    return AIRoutingPolicyResponse(**await ai_settings.get_routing_policy())


@router.put("/routing-policy", response_model=AIRoutingPolicyResponse)
async def update_routing_policy(
    request: AIRoutingPolicyUpdate,
    ai_settings: AISettingsService = Depends(get_ai_settings),
):
    """Persist non-secret AI routing and cost-cap settings."""
    return AIRoutingPolicyResponse(
        **await ai_settings.update_routing_policy(
            routing_mode=request.routing_mode,
            local_fallback_enabled=request.local_fallback_enabled,
            per_call_cost_cap_usd=request.per_call_cost_cap_usd,
            monthly_cost_cap_usd=request.monthly_cost_cap_usd,
        )
    )


@router.post("/providers/{provider_name}/key", response_model=AIProviderStatus)
async def save_provider_key(
    provider_name: AIProviderName,
    request: AIProviderKeySaveRequest,
    ollama: OllamaLifecycle = Depends(get_ollama),
    ai_settings: AISettingsService = Depends(get_ai_settings),
    key_store: AIKeyStore = Depends(get_ai_keystore),
):
    """Save a cloud provider key to OS keychain and persist only its opaque ref."""
    if provider_name == "ollama":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "local_provider_key_not_supported",
                "message": "Ollama does not use cloud API key storage.",
            },
        )

    try:
        key_ref = await key_store.save_provider_key(provider_name, request.api_key)
    except AIKeyStoreUnavailableError as exc:
        raise _keychain_unavailable_http_error() from exc

    config = await ai_settings.set_provider_key_ref(
        provider_name=provider_name,
        api_key_ref=key_ref,
    )
    return _provider_status_from_config(config, ollama)


@router.delete("/providers/{provider_name}/key", response_model=AIProviderStatus)
async def delete_provider_key(
    provider_name: AIProviderName,
    ollama: OllamaLifecycle = Depends(get_ollama),
    ai_settings: AISettingsService = Depends(get_ai_settings),
    key_store: AIKeyStore = Depends(get_ai_keystore),
):
    """Remove a cloud provider key from OS keychain and clear its opaque ref."""
    if provider_name == "ollama":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "local_provider_key_not_supported",
                "message": "Ollama does not use cloud API key storage.",
            },
        )

    try:
        await key_store.delete_provider_key(provider_name)
    except AIKeyStoreUnavailableError as exc:
        raise _keychain_unavailable_http_error() from exc

    config = await ai_settings.clear_provider_key_ref(provider_name=provider_name)
    return _provider_status_from_config(config, ollama)


# ═══════════════════════════════════════════════════════════════
#  GET /ai/status
# ═══════════════════════════════════════════════════════════════


@router.get("/status", response_model=AiStatusResponse)
async def status(
    ollama: OllamaLifecycle = Depends(get_ollama),
):
    """
    Check the current state of the AI system.

    The frontend polls this to decide which UI to show:
      - not_installed → install guide
      - no_models → model guide
      - running → model picker
      - ready → full AI panel
    """
    s = ollama.status()
    return AiStatusResponse(
        state=s["state"],
        selected_model=s.get("selected_model"),
        ready=s["ready"],
        error=s.get("error"),
        platform=s.get("platform", ""),
    )


# ═══════════════════════════════════════════════════════════════
#  GET /ai/models
# ═══════════════════════════════════════════════════════════════


@router.get("/models", response_model=list[OllamaModelResponse])
async def list_models(
    ollama: OllamaLifecycle = Depends(get_ollama),
):
    """
    List all models the user has locally.
    Returns name, size, family, quantization for each.
    The frontend shows these in a model picker dropdown.
    """
    models = await ollama.list_models()
    return [
        OllamaModelResponse(
            name=m.name,
            size_bytes=m.size_bytes,
            size_gb=m.size_gb,
            family=m.family,
            parameter_size=m.parameter_size,
            quantization=m.quantization,
            modified_at=m.modified_at,
        )
        for m in models
    ]


# ═══════════════════════════════════════════════════════════════
#  POST /ai/models/select
# ═══════════════════════════════════════════════════════════════


@router.post("/models/select", response_model=AiStatusResponse)
async def select_model(
    request: ModelSelectRequest,
    ollama: OllamaLifecycle = Depends(get_ollama),
    db: DatabaseService = Depends(get_db),
):
    """
    Select which model to use for AI analysis.

    Validates the model exists locally, saves the choice to SQLite
    so it persists across restarts, and updates the lifecycle state.
    """
    # Verify model is actually available
    if not await ollama.is_model_available(request.model):
        return AiStatusResponse(
            state="error",
            selected_model=None,
            ready=False,
            error=f"Model '{request.model}' is not available locally. "
                  f"Pull it first: ollama pull {request.model}",
            platform=ollama.status().get("platform", ""),
        )

    # Save to settings and update lifecycle
    ollama.select_model(request.model)
    await db.set_setting("ai_model", request.model)
    log.info("User selected model: %s (saved to settings)", request.model)

    s = ollama.status()
    return AiStatusResponse(
        state=s["state"],
        selected_model=s.get("selected_model"),
        ready=s["ready"],
        error=s.get("error"),
        platform=s.get("platform", ""),
    )


# ═══════════════════════════════════════════════════════════════
#  GET /ai/setup-guide
# ═══════════════════════════════════════════════════════════════


@router.get("/setup-guide", response_model=SetupGuideResponse)
async def setup_guide():
    """
    Get install instructions and recommended models.

    The frontend shows this when Ollama isn't installed or when
    the user has no models. Provides platform-specific install link,
    a table of recommended models with size and RAM requirements,
    and copy-paste pull commands.
    """
    guide = OllamaLifecycle.get_setup_guide()
    return SetupGuideResponse(
        install_url=guide["install_url"],
        install_note=guide["install_note"],
        models_url=guide["models_url"],
        recommended_models=[RecommendedModel(**m) for m in guide["recommended_models"]],
        pull_example=guide["pull_example"],
    )


# ═══════════════════════════════════════════════════════════════
#  POST /ai/refresh
# ═══════════════════════════════════════════════════════════════


@router.post("/refresh", response_model=AiStatusResponse)
async def refresh(
    ollama: OllamaLifecycle = Depends(get_ollama),
    db: DatabaseService = Depends(get_db),
):
    """
    Re-detect Ollama and re-list models.

    Called after the user installs Ollama or pulls a new model.
    Re-runs the startup detection sequence.
    """
    log.info("Refreshing Ollama detection...")
    saved_model = await db.get_setting("ai_model")
    await ollama.startup(saved_model=saved_model)

    s = ollama.status()
    return AiStatusResponse(
        state=s["state"],
        selected_model=s.get("selected_model"),
        ready=s["ready"],
        error=s.get("error"),
        platform=s.get("platform", ""),
    )


# ═══════════════════════════════════════════════════════════════
#  POST /ai/analyze
# ═══════════════════════════════════════════════════════════════


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    request: AnalyzeRequest,
    ibkr: IBKRService = Depends(get_ibkr),
    ai: AiService = Depends(get_ai),
    ollama: OllamaLifecycle = Depends(get_ollama),
    db: DatabaseService = Depends(get_db),
    ai_settings: AISettingsService = Depends(get_ai_settings),
):
    """
    Run a full AI technical analysis on a stock.

    Requires Ollama to be ready (installed + running + model selected).
    Fetches indicator data for each timeframe, builds structured context,
    sends to the user's selected model, and returns signal + analysis text.
    """
    status = ollama.status()
    if not status["ready"]:
        return AnalyzeResponse(
            session_id="",
            signal=None,
            message=f"AI is not ready. Current state: {status['state']}. "
                    f"Please complete the AI setup first.",
        )

    local_model = ollama.selected_model
    if not local_model:
        return AnalyzeResponse(
            session_id="",
            signal=None,
            message="No model selected. Please choose a model in the AI panel.",
        )

    provider_name, model, fallback_model, allow_fallback = await _resolve_analysis_routing(
        request,
        ollama,
        ai_settings,
    )

    # Resolve frontend display names → backend indicator names
    resolved_indicators = _resolve_indicators(request.indicators)

    # Branch 3: preload user-edited fib scoring weights once per
    # analyze request so every TF compute uses the same values.
    fib_weights = await get_active_fib_weights(db)

    # Fetch indicator data for each timeframe
    timeframe_data: dict[str, dict] = {}
    for tf in request.timeframes:
        log.info("Fetching %s data for conid %d...", tf, request.conid)
        tf_data = await _fetch_timeframe_data(
            conid=request.conid,
            timeframe=tf,
            indicators=resolved_indicators,
            ibkr=ibkr,
            fib_weights=fib_weights,
            fib_snapshots=request.fibs,
        )
        timeframe_data[tf] = tf_data

    log.info(
        "Running AI analysis for %s (%d) with model %s — timeframes: %s, indicators: %s → %s",
        request.symbol, request.conid, model,
        request.timeframes, request.indicators, resolved_indicators,
    )

    try:
        result = await ai.analyze(
            symbol=request.symbol,
            timeframe_data=timeframe_data,
            indicators_display=request.indicators,
            indicator_names=resolved_indicators,
            model=model,
            session_id=request.session_id,
            watchlist=request.watchlist,
            indicator_priority=request.indicator_priority or [],
            provider_name=provider_name,
            fallback_model=fallback_model,
            allow_fallback=allow_fallback,
        )
    except AIAnalysisTimeoutError as exc:
        log.warning(
            "Analysis timed out for %s at stage '%s' (%.0fs) — returning graceful error",
            request.symbol, exc.stage, exc.timeout_s,
        )
        return AnalyzeResponse(
            session_id=request.session_id or "",
            signal=None,
            message=(
                f"Analysis timed out while {exc.stage.replace('_', ' ')} for {request.symbol} "
                f"(>{exc.timeout_s:.0f}s). Try a faster model or a shorter timeframe selection."
            ),
        )

    signal = _parse_signal(result["signal"]) if result.get("signal") else None

    return AnalyzeResponse(
        session_id=result["session_id"],
        signal=signal,
        message=result["message"],
        provider=result.get("provider"),
    )


# ═══════════════════════════════════════════════════════════════
#  POST /ai/analyze/stream
# ═══════════════════════════════════════════════════════════════


@router.post("/analyze/stream")
async def analyze_stream(
    request: AnalyzeRequest,
    ibkr: IBKRService = Depends(get_ibkr),
    ai: AiService = Depends(get_ai),
    ollama: OllamaLifecycle = Depends(get_ollama),
    db: DatabaseService = Depends(get_db),
    ai_settings: AISettingsService = Depends(get_ai_settings),
):
    """
    Stream a full AI technical analysis as Server-Sent Events.

    Wire format — each chunk is a `data: <json>\\n\\n` SSE frame, where
    the inner JSON is one of:

      {"type": "token",  "content": "..."}        # streamed model token
      {"type": "done",   "session_id": "...",
                         "signal": {...} | null,  # frontend-formatted signal
                         "message": "<full narrative>"}

    The frontend renders `token` events live and treats `done` as the
    terminal frame containing the parsed signal.

    On readiness/model errors, a single `done` event with signal=null and
    a human-readable `message` is emitted so the UI has something to show.
    """
    status = ollama.status()
    model = ollama.selected_model
    if not status["ready"] or not model:
        async def err_stream():
            payload = {
                "type": "done",
                "session_id": request.session_id or "",
                "signal": None,
                "message": (
                    "AI is not ready. Please complete the AI setup and select "
                    "a model first."
                ),
                "provider": _local_provider_metadata(model).model_dump(),
            }
            yield f"data: {json.dumps(payload)}\n\n"
        return StreamingResponse(err_stream(), media_type="text/event-stream")

    provider_name, selected_model, fallback_model, allow_fallback = await _resolve_analysis_routing(
        request,
        ollama,
        ai_settings,
    )

    resolved_indicators = _resolve_indicators(request.indicators)

    # Branch 3: preload user-edited fib scoring weights once per stream.
    fib_weights = await get_active_fib_weights(db)

    # Indicator data is fetched eagerly, BEFORE the SSE stream opens, because:
    #   - IBKR errors should fail fast (client gets a 4xx/5xx, not a stream)
    #   - SSE is for streaming the model output, not the data prep
    timeframe_data: dict[str, dict] = {}
    for tf in request.timeframes:
        log.info("[stream] Fetching %s data for conid %d...", tf, request.conid)
        timeframe_data[tf] = await _fetch_timeframe_data(
            conid=request.conid,
            timeframe=tf,
            indicators=resolved_indicators,
            ibkr=ibkr,
            fib_weights=fib_weights,
            fib_snapshots=request.fibs,
        )

    log.info(
        "[stream] Running AI analysis for %s (%d) with %s/%s — tfs=%s",
        request.symbol, request.conid, provider_name, selected_model, request.timeframes,
    )

    async def event_stream():
        try:
            async for event in ai.analyze_stream(
                symbol=request.symbol,
                timeframe_data=timeframe_data,
                indicators_display=request.indicators,
                indicator_names=resolved_indicators,
                model=selected_model,
                session_id=request.session_id,
                watchlist=request.watchlist,
                indicator_priority=request.indicator_priority or [],
                provider_name=provider_name,
                fallback_model=fallback_model,
                allow_fallback=allow_fallback,
            ):
                if event.get("type") == "done":
                    event = {
                        **event,
                        "provider": event.get("provider")
                        or _local_provider_metadata(selected_model).model_dump(),
                    }
                yield f"data: {json.dumps(event)}\n\n"
        except AIAnalysisTimeoutError as exc:
            timeout_event = {
                "type": "done",
                "session_id": request.session_id or "",
                "signal": None,
                "message": (
                    f"Analysis timed out while {exc.stage.replace('_', ' ')} "
                    f"for {request.symbol} (>{exc.timeout_s:.0f}s). Try a "
                    f"faster model or a shorter timeframe selection."
                ),
                "provider": _local_provider_metadata(model).model_dump(),
            }
            yield f"data: {json.dumps(timeout_event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ═══════════════════════════════════════════════════════════════
#  POST /ai/chat
# ═══════════════════════════════════════════════════════════════


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    ai: AiService = Depends(get_ai),
    ollama: OllamaLifecycle = Depends(get_ollama),
):
    """Send a follow-up question in an existing analysis session."""
    if not ollama.status()["ready"] or not ollama.selected_model:
        return ChatResponse(
            session_id=request.session_id,
            signal=None,
            message="AI is not ready. Please complete setup and select a model.",
        )

    try:
        result = await ai.follow_up(
            session_id=request.session_id,
            message=request.message,
            model=ollama.selected_model,
        )
    except ValueError as e:
        return ChatResponse(
            session_id=request.session_id,
            signal=None,
            message=str(e),
        )

    signal = _parse_signal(result["signal"]) if result.get("signal") else None

    return ChatResponse(
        session_id=result["session_id"],
        signal=signal,
        message=result["message"],
    )


# ═══════════════════════════════════════════════════════════════
#  POST /ai/chat/stream
# ═══════════════════════════════════════════════════════════════


@router.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    ai: AiService = Depends(get_ai),
    ollama: OllamaLifecycle = Depends(get_ollama),
):
    """Streaming follow-up via Server-Sent Events."""
    if not ollama.status()["ready"] or not ollama.selected_model:
        async def error_stream():
            yield "data: AI is not ready. Please complete setup first.\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    async def token_stream():
        try:
            async for token in ai.follow_up_stream(
                session_id=request.session_id,
                message=request.message,
                model=ollama.selected_model,
            ):
                yield f"data: {token}\n\n"
            yield "data: [DONE]\n\n"
        except ValueError as e:
            yield f"data: Error: {e}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(token_stream(), media_type="text/event-stream")
