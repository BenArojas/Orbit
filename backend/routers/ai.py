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

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from deps import get_ibkr, get_db, get_ai, get_ollama
from models import (
    AiStatusResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    ChatRequest,
    ChatResponse,
    CandleData,
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
from services.db import DatabaseService
from services.ibkr import IBKRService
from services.indicators import IndicatorService
from services.ollama import OllamaLifecycle

log = logging.getLogger("parallax.routers.ai")

router = APIRouter(prefix="/ai", tags=["ai"])

# Indicator service is stateless — reuse the same instance
_indicator_service = IndicatorService()


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
) -> dict:
    """
    Fetch candle data from IBKR and compute indicators for one timeframe.
    Returns {"candles": [...], "indicators": [...], "fibonacci": ...}
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
        return {"candles": [], "indicators": [], "fibonacci": None}

    indicator_results, fibonacci = _indicator_service.compute(
        candles=candles,
        indicators=indicators,
    )

    return {
        "candles": candles,
        "indicators": indicator_results,
        "fibonacci": fibonacci,
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

    model = ollama.selected_model
    if not model:
        return AnalyzeResponse(
            session_id="",
            signal=None,
            message="No model selected. Please choose a model in the AI panel.",
        )

    # Resolve frontend display names → backend indicator names
    resolved_indicators = _resolve_indicators(request.indicators)

    # Fetch indicator data for each timeframe
    timeframe_data: dict[str, dict] = {}
    for tf in request.timeframes:
        log.info("Fetching %s data for conid %d...", tf, request.conid)
        tf_data = await _fetch_timeframe_data(
            conid=request.conid,
            timeframe=tf,
            indicators=resolved_indicators,
            ibkr=ibkr,
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
            indicators_requested=request.indicators,
            model=model,
            session_id=request.session_id,
            watchlist=request.watchlist,
            indicator_priority=request.indicator_priority,
            context_mode=request.context_mode,
            context_bars=request.context_bars,
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
            }
            yield f"data: {json.dumps(payload)}\n\n"
        return StreamingResponse(err_stream(), media_type="text/event-stream")

    resolved_indicators = _resolve_indicators(request.indicators)

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
        )

    log.info(
        "[stream] Running AI analysis for %s (%d) with %s — tfs=%s",
        request.symbol, request.conid, model, request.timeframes,
    )

    async def event_stream():
        try:
            async for event in ai.analyze_stream(
                symbol=request.symbol,
                timeframe_data=timeframe_data,
                indicators_requested=request.indicators,
                model=model,
                session_id=request.session_id,
                watchlist=request.watchlist,
                indicator_priority=request.indicator_priority,
                context_mode=request.context_mode,
                context_bars=request.context_bars,
            ):
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
