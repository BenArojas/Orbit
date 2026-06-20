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
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from deps import (
    get_ibkr,
    get_db,
    get_ai,
    get_ai_analysis_preparation,
    get_ai_keystore,
    get_ai_settings,
    get_ai_usage_ledger,
    get_ollama,
)
from models import (
    AIModelOption,
    AIAnalysisPreviewResponse,
    AIAnalysisSnapshotRunRequest,
    AIComparisonResponse,
    AIComparisonSide,
    AIQualityChecks,
    AIProviderKeySaveRequest,
    AIProviderModelUpdateRequest,
    AIProviderModelsResponse,
    AIProviderMetadata,
    AIProviderName,
    AIProviderStatus,
    AIProvidersResponse,
    AIRunAttempt,
    AIRunReceipt,
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
from services.ai_analysis_preparation import (
    AIAnalysisPreparationService,
    AIAnalysisContextLimitError,
    AIAnalysisSnapshotExpiredError,
    AIAnalysisSnapshotNotFoundError,
)
from services.ai_cloud_adapters import (
    AIProviderAuthError,
    AIProviderModelUnavailableError,
    AIProviderNetworkError,
    AIProviderRequestError,
    AIProviderRateLimitError,
    AIProviderTimeoutError,
    AnthropicProvider,
    GeminiProvider,
    GrokProvider,
    OpenAIProvider,
    OpenRouterProvider,
)
from services.ai_keystore import AIKeyStore, AIKeyStoreUnavailableError
from services.ai_settings import AISettingsService
from services.ai_usage import AIUsageLedger
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


def _cloud_local_only_http_error() -> HTTPException:
    return HTTPException(
        status_code=http_status.HTTP_400_BAD_REQUEST,
        detail={
            "error": "ai_cloud_routing_local_only",
            "message": "Cloud AI is disabled by the local-only routing policy.",
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


def _cloud_provider_model_required_http_error(provider_name: str) -> HTTPException:
    return HTTPException(
        status_code=http_status.HTTP_409_CONFLICT,
        detail={
            "error": "ai_provider_model_required",
            "message": "Select a validated cloud model before running analysis.",
            "provider_name": provider_name,
        },
    )


def _provider_error_detail(exc: Exception, provider_name: str) -> tuple[int, dict]:
    if isinstance(exc, AIProviderAuthError):
        return http_status.HTTP_401_UNAUTHORIZED, {
            "error": "ai_provider_auth_error",
            "message": "Cloud AI provider authentication failed.",
            "provider_name": provider_name,
        }
    if isinstance(exc, AIProviderRateLimitError):
        return http_status.HTTP_429_TOO_MANY_REQUESTS, {
            "error": "ai_provider_rate_limit_error",
            "message": "Cloud AI provider rate limit was reached.",
            "provider_name": provider_name,
        }
    if isinstance(exc, AIProviderModelUnavailableError):
        return http_status.HTTP_400_BAD_REQUEST, {
            "error": "ai_provider_model_unavailable",
            "message": "Cloud AI provider model is unavailable.",
            "provider_name": provider_name,
        }
    if isinstance(exc, AIProviderRequestError):
        return http_status.HTTP_400_BAD_REQUEST, {
            "error": "ai_provider_request_error",
            "message": "Cloud AI provider rejected the request.",
            "provider_name": provider_name,
        }
    if isinstance(exc, AIProviderTimeoutError):
        return http_status.HTTP_504_GATEWAY_TIMEOUT, {
            "error": "ai_provider_timeout_error",
            "message": "Cloud AI provider request timed out.",
            "provider_name": provider_name,
        }
    return http_status.HTTP_503_SERVICE_UNAVAILABLE, {
        "error": "ai_provider_network_error",
        "message": "Cloud AI provider network request failed.",
        "provider_name": provider_name,
    }


def _quality_checks(message: str, signal: SignalData | None) -> AIQualityChecks:
    present_levels = {
        level.label.lower()
        for level in signal.levels
        if level.value not in {"N/A", "$0.00", "0"}
    } if signal else set()
    checks = [bool(message), signal is not None]
    checks.extend(label in present_levels for label in ("entry", "stop", "target"))
    return AIQualityChecks(
        response_completed=checks[0],
        signal_parsed=checks[1],
        entry_present=checks[2],
        stop_present=checks[3],
        target_present=checks[4],
        checks_count=sum(checks),
        narrative_characters=len(message),
    )


async def _record_failed_cloud_usage(
    *,
    usage_ledger: AIUsageLedger,
    provider_name: AIProviderName,
    model: str,
    task_type: str,
    routing_mode: str,
    estimated_cost: float | None,
    error_code: str,
    run_id: str | None = None,
    requested_provider: AIProviderName | None = None,
    requested_model: str | None = None,
    duration_ms: int = 0,
) -> AIRunReceipt:
    run_id = run_id or str(uuid4())
    requested_provider = requested_provider or provider_name
    requested_model = requested_model or model
    await usage_ledger.record_usage(
        provider_name=provider_name,
        model=model,
        task_type=task_type,
        routing_mode=routing_mode,
        input_tokens=None,
        output_tokens=None,
        estimated_cost=estimated_cost,
        actual_cost=None,
        status="failed",
        provider_request_id=None,
        error_code=error_code,
        run_id=run_id,
        requested_provider_name=requested_provider,
        requested_model=requested_model,
        resolved_model=None,
        fallback_reason=None,
        duration_ms=duration_ms,
    )
    return AIRunReceipt(
        run_id=run_id,
        requested_provider=requested_provider,
        requested_model=requested_model,
        executed_provider=None,
        resolved_model=None,
        fallback_used=False,
        fallback_reason=None,
        status="failed",
        attempts=[AIRunAttempt(
            provider_name=provider_name,
            requested_model=requested_model,
            resolved_model=None,
            status="failed",
            estimated_cost_usd=estimated_cost,
            duration_ms=duration_ms,
            error_code=error_code,
        )],
        created_at=datetime.now(UTC),
    )


async def _create_cloud_provider_for_request(
    *,
    provider_config: dict | None,
    key_store: AIKeyStore,
) -> object | None:
    if provider_config is None or provider_config["provider_name"] == "ollama":
        return None

    provider_name = provider_config["provider_name"]
    api_key_ref = provider_config.get("api_key_ref")
    if not api_key_ref:
        raise _cloud_provider_unavailable_http_error(provider_name)

    api_key = await key_store.get_provider_key(provider_name, api_key_ref)

    provider_cls_by_name = {
        "openrouter": OpenRouterProvider,
        "openai": OpenAIProvider,
        "anthropic": AnthropicProvider,
        "gemini": GeminiProvider,
        "grok": GrokProvider,
    }
    provider_cls = provider_cls_by_name.get(provider_name)
    if provider_cls is None:
        raise _cloud_provider_unavailable_http_error(provider_name)
    return provider_cls(api_key=api_key)


async def _close_request_provider(provider: object | None) -> None:
    if provider is None:
        return
    close = getattr(provider, "aclose", None)
    if close is not None:
        await close()


async def _create_session_provider(
    *,
    ai: AiService,
    session_id: str,
    ai_settings: AISettingsService,
    key_store: AIKeyStore,
) -> tuple[object, dict] | tuple[None, dict]:
    session = ai.sessions.get(session_id)
    if session is None or session.provider_name == "ollama":
        return None, await _get_routing_policy(ai_settings)
    configs = await ai_settings.list_provider_configs()
    config = next(
        (item for item in configs if item["provider_name"] == session.provider_name),
        None,
    )
    provider = await _create_cloud_provider_for_request(
        provider_config=config,
        key_store=key_store,
    )
    return provider, await _get_routing_policy(ai_settings)


async def _record_completed_usage(
    *,
    usage_ledger: AIUsageLedger,
    requested_provider: AIProviderName,
    requested_model: str,
    provider_metadata: dict,
    task_type: str,
    routing_mode: str,
    estimated_cost: float | None,
    fallback_error_code: str = "ai_provider_fallback",
    run_id: str | None = None,
) -> AIRunReceipt:
    run_id = run_id or str(uuid4())
    if provider_metadata.get("fallback_used"):
        await _record_failed_cloud_usage(
            usage_ledger=usage_ledger,
            provider_name=requested_provider,
            model=requested_model,
            task_type=task_type,
            routing_mode=routing_mode,
            estimated_cost=estimated_cost,
            error_code=fallback_error_code,
            run_id=run_id,
            requested_provider=requested_provider,
            requested_model=requested_model,
        )
        await usage_ledger.record_usage(
            provider_name="ollama",
            model=provider_metadata.get("model"),
            task_type=task_type,
            routing_mode=routing_mode,
            input_tokens=None,
            output_tokens=None,
            estimated_cost=None,
            actual_cost=None,
            status="fallback_success",
            provider_request_id=None,
            error_code=None,
            run_id=run_id,
            requested_provider_name=requested_provider,
            requested_model=requested_model,
            resolved_model=provider_metadata.get("resolved_model") or provider_metadata.get("model"),
            fallback_reason=fallback_error_code,
            duration_ms=provider_metadata.get("duration_ms"),
        )
        local_model = provider_metadata.get("resolved_model") or provider_metadata.get("model")
        return AIRunReceipt(
            run_id=run_id,
            requested_provider=requested_provider,
            requested_model=requested_model,
            executed_provider="ollama",
            resolved_model=local_model,
            fallback_used=True,
            fallback_reason=fallback_error_code,
            status="fallback_success",
            attempts=[
                AIRunAttempt(
                    provider_name=requested_provider,
                    requested_model=requested_model,
                    status="failed",
                    estimated_cost_usd=estimated_cost,
                    error_code=fallback_error_code,
                ),
                AIRunAttempt(
                    provider_name="ollama",
                    requested_model=requested_model,
                    resolved_model=local_model,
                    status="fallback_success",
                    duration_ms=provider_metadata.get("duration_ms") or 0,
                ),
            ],
            created_at=datetime.now(UTC),
        )
    provider_metadata["estimated_cost"] = (
        provider_metadata.get("estimated_cost") or estimated_cost
    )
    await usage_ledger.record_usage(
        provider_name=provider_metadata["provider_name"],
        model=provider_metadata.get("model"),
        task_type=task_type,
        routing_mode=routing_mode,
        input_tokens=provider_metadata.get("input_tokens"),
        output_tokens=provider_metadata.get("output_tokens"),
        estimated_cost=provider_metadata.get("estimated_cost"),
        actual_cost=provider_metadata.get("actual_cost"),
        status="success",
        provider_request_id=provider_metadata.get("provider_request_id"),
        error_code=None,
        run_id=run_id,
        requested_provider_name=requested_provider,
        requested_model=requested_model,
        resolved_model=provider_metadata.get("resolved_model") or provider_metadata.get("model"),
        fallback_reason=None,
        duration_ms=provider_metadata.get("duration_ms"),
        reasoning_tokens=provider_metadata.get("reasoning_tokens"),
        cached_tokens=provider_metadata.get("cached_tokens"),
    )
    resolved_model = provider_metadata.get("resolved_model") or provider_metadata.get("model")
    return AIRunReceipt(
        run_id=run_id,
        requested_provider=requested_provider,
        requested_model=requested_model,
        executed_provider=provider_metadata["provider_name"],
        resolved_model=resolved_model,
        fallback_used=False,
        fallback_reason=None,
        status="success",
        attempts=[AIRunAttempt(
            provider_name=provider_metadata["provider_name"],
            requested_model=requested_model,
            resolved_model=resolved_model,
            status="success",
            provider_request_id=provider_metadata.get("provider_request_id"),
            input_tokens=provider_metadata.get("input_tokens"),
            output_tokens=provider_metadata.get("output_tokens"),
            reasoning_tokens=provider_metadata.get("reasoning_tokens"),
            cached_tokens=provider_metadata.get("cached_tokens"),
            estimated_cost_usd=provider_metadata.get("estimated_cost"),
            actual_cost_usd=provider_metadata.get("actual_cost"),
            duration_ms=provider_metadata.get("duration_ms") or 0,
        )],
        created_at=datetime.now(UTC),
    )


def _estimate_cloud_analysis_cost(provider_name: AIProviderName, model: str) -> float | None:
    if provider_name == "ollama":
        return None
    return 0.02


async def _resolve_analysis_routing(
    request: AnalyzeRequest,
    ollama: OllamaLifecycle,
    ai_settings: AISettingsService,
) -> tuple[str, str, str | None, bool, dict | None]:
    """Return provider name, model, local fallback model, and fallback flag."""
    policy = await _get_routing_policy(ai_settings)
    local_model = ollama.selected_model
    if request.provider_name == "ollama":
        return "ollama", request.model or local_model or "", None, False, None

    if policy["routing_mode"] == "local_only":
        raise _cloud_local_only_http_error()

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

    model = request.model or selected.get("selected_model")
    if not model:
        raise _cloud_provider_model_required_http_error(request.provider_name)
    return (
        request.provider_name,
        model,
        local_model if ollama.status().get("ready") else None,
        bool(policy["local_fallback_enabled"] and local_model and ollama.status().get("ready")),
        selected,
    )


async def _get_routing_policy(ai_settings: AISettingsService) -> dict:
    get_policy = getattr(ai_settings, "get_routing_policy", None)
    if get_policy is None:
        return {
            "active_provider": "ollama",
            "routing_mode": "local_only",
            "local_fallback_enabled": True,
        }
    return await get_policy()


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
        active_provider=policy["active_provider"],
        routing_mode=policy["routing_mode"],
        cloud_enabled=any(
            provider.kind == "cloud" and provider.enabled and provider.has_key
            for provider in provider_statuses
        ),
    )


@router.get(
    "/providers/openrouter/models",
    response_model=AIProviderModelsResponse,
)
async def openrouter_models(
    ai_settings: AISettingsService = Depends(get_ai_settings),
    key_store: AIKeyStore = Depends(get_ai_keystore),
):
    """Return the authenticated user's validated fixed OpenRouter models."""
    configs = await ai_settings.list_provider_configs()
    config = next(
        (item for item in configs if item["provider_name"] == "openrouter"),
        None,
    )
    if config is None or not config.get("api_key_ref"):
        raise _cloud_provider_unavailable_http_error("openrouter")

    provider = None
    try:
        provider = await _create_cloud_provider_for_request(
            provider_config=config,
            key_store=key_store,
        )
        models = await provider.list_models()
    except AIKeyStoreUnavailableError as exc:
        raise _keychain_unavailable_http_error() from exc
    except (
        AIProviderAuthError,
        AIProviderRateLimitError,
        AIProviderModelUnavailableError,
        AIProviderTimeoutError,
        AIProviderNetworkError,
        AIProviderRequestError,
    ) as exc:
        status_code, detail = _provider_error_detail(exc, "openrouter")
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _close_request_provider(provider)

    return AIProviderModelsResponse(
        provider_name="openrouter",
        models=[AIModelOption(**model.__dict__) for model in models],
        selected_model=config.get("selected_model"),
        fetched_at=datetime.now(UTC),
    )


@router.put(
    "/providers/openrouter/model",
    response_model=AIProviderModelsResponse,
)
async def select_openrouter_model(
    request: AIProviderModelUpdateRequest,
    ai_settings: AISettingsService = Depends(get_ai_settings),
    key_store: AIKeyStore = Depends(get_ai_keystore),
):
    """Validate an OpenRouter model against the user catalog before persistence."""
    configs = await ai_settings.list_provider_configs()
    config = next(
        (item for item in configs if item["provider_name"] == "openrouter"),
        None,
    )
    if config is None or not config.get("api_key_ref"):
        raise _cloud_provider_unavailable_http_error("openrouter")

    provider = None
    try:
        provider = await _create_cloud_provider_for_request(
            provider_config=config,
            key_store=key_store,
        )
        models = await provider.list_models()
    except AIKeyStoreUnavailableError as exc:
        raise _keychain_unavailable_http_error() from exc
    except (
        AIProviderAuthError,
        AIProviderRateLimitError,
        AIProviderModelUnavailableError,
        AIProviderTimeoutError,
        AIProviderNetworkError,
        AIProviderRequestError,
    ) as exc:
        status_code, detail = _provider_error_detail(exc, "openrouter")
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _close_request_provider(provider)

    if request.model not in {model.id for model in models}:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "ai_provider_model_unavailable",
                "message": "The selected OpenRouter model is not available for this account.",
                "provider_name": "openrouter",
            },
        )

    await ai_settings.set_provider_model(
        provider_name="openrouter",
        model=request.model,
    )
    return AIProviderModelsResponse(
        provider_name="openrouter",
        models=[AIModelOption(**model.__dict__) for model in models],
        selected_model=request.model,
        fetched_at=datetime.now(UTC),
    )


@router.post("/analysis/preview", response_model=AIAnalysisPreviewResponse)
async def preview_analysis(
    request: AnalyzeRequest,
    ibkr: IBKRService = Depends(get_ibkr),
    ai: AiService = Depends(get_ai),
    preparation: AIAnalysisPreparationService = Depends(get_ai_analysis_preparation),
    ollama: OllamaLifecycle = Depends(get_ollama),
    db: DatabaseService = Depends(get_db),
    ai_settings: AISettingsService = Depends(get_ai_settings),
    key_store: AIKeyStore = Depends(get_ai_keystore),
):
    provider_name, model_id, fallback_model, allow_fallback, provider_config = (
        await _resolve_analysis_routing(request, ollama, ai_settings)
    )
    if provider_name != "openrouter":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "ai_analysis_preview_requires_openrouter",
                "message": "Cloud analysis preview currently supports OpenRouter only.",
            },
        )

    provider = None
    try:
        provider = await _create_cloud_provider_for_request(
            provider_config=provider_config,
            key_store=key_store,
        )
        catalog = await provider.list_models()
    except AIKeyStoreUnavailableError as exc:
        raise _keychain_unavailable_http_error() from exc
    except (
        AIProviderAuthError,
        AIProviderRateLimitError,
        AIProviderModelUnavailableError,
        AIProviderTimeoutError,
        AIProviderNetworkError,
        AIProviderRequestError,
    ) as exc:
        status_code, detail = _provider_error_detail(exc, "openrouter")
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _close_request_provider(provider)

    selected_model = next((model for model in catalog if model.id == model_id), None)
    if selected_model is None:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "ai_provider_model_unavailable",
                "message": "The selected OpenRouter model is not available for this account.",
                "provider_name": "openrouter",
            },
        )

    resolved_indicators = _resolve_indicators(request.indicators)
    fib_weights = await get_active_fib_weights(db)
    timeframe_data = {
        timeframe: await _fetch_timeframe_data(
            conid=request.conid,
            timeframe=timeframe,
            indicators=resolved_indicators,
            ibkr=ibkr,
            fib_weights=fib_weights,
            fib_snapshots=request.fibs,
        )
        for timeframe in request.timeframes
    }
    messages, grounding_map = await ai._prepare_analysis_payload(
        symbol=request.symbol,
        timeframe_data=timeframe_data,
        indicators_display=request.indicators,
        indicator_names=resolved_indicators,
        model=model_id,
        watchlist=request.watchlist,
        indicator_priority=request.indicator_priority or [],
    )
    try:
        snapshot = await preparation.prepare(
            request,
            provider_name="openrouter",
            model=AIModelOption(**selected_model.__dict__),
            messages=messages,
            fallback_enabled=allow_fallback,
            local_model=fallback_model,
            grounding_map=grounding_map,
        )
    except AIAnalysisContextLimitError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "ai_analysis_context_limit_exceeded",
                "message": str(exc),
            },
        ) from exc
    return AIAnalysisPreviewResponse(**snapshot.__dict__)


@router.post("/analysis/compare", response_model=AIComparisonResponse)
async def compare_analysis(
    request: AIAnalysisSnapshotRunRequest,
    ai: AiService = Depends(get_ai),
    preparation: AIAnalysisPreparationService = Depends(get_ai_analysis_preparation),
    ollama: OllamaLifecycle = Depends(get_ollama),
    ai_settings: AISettingsService = Depends(get_ai_settings),
    usage_ledger: AIUsageLedger = Depends(get_ai_usage_ledger),
    key_store: AIKeyStore = Depends(get_ai_keystore),
):
    try:
        snapshot = preparation.get_snapshot(request.snapshot_id)
    except AIAnalysisSnapshotExpiredError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_410_GONE,
            detail={
                "error": "ai_analysis_snapshot_expired",
                "message": "The reviewed cloud analysis snapshot has expired.",
            },
        ) from exc
    except AIAnalysisSnapshotNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={
                "error": "ai_analysis_snapshot_not_found",
                "message": "The reviewed cloud analysis snapshot was not found.",
            },
        ) from exc

    local_status = ollama.status()
    local_model = local_status.get("selected_model")
    if not local_status.get("ready") or not local_model:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={
                "error": "ai_comparison_local_unavailable",
                "message": "A ready local Ollama model is required for comparison.",
            },
        )

    policy = await _get_routing_policy(ai_settings)
    if policy["routing_mode"] == "local_only":
        raise _cloud_local_only_http_error()
    configs = await ai_settings.list_provider_configs()
    provider_config = next(
        (config for config in configs if config["provider_name"] == snapshot.provider_name),
        None,
    )
    if (
        provider_config is None
        or not provider_config.get("enabled")
        or not provider_config.get("api_key_ref")
    ):
        raise _cloud_provider_unavailable_http_error(snapshot.provider_name)
    if provider_config.get("selected_model") != snapshot.model.id:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={
                "error": "ai_analysis_snapshot_model_changed",
                "message": "The selected OpenRouter model changed after preview.",
            },
        )
    local_provider = ai.provider_registry.require("ollama")
    grounding_map = preparation.get_grounding_map(snapshot.snapshot_id)
    cloud_provider = None
    try:
        local_result = await ai.execute_prepared_analysis(
            messages=snapshot.messages,
            model=local_model,
            provider=local_provider,
            grounding_map=grounding_map,
        )
        local_receipt = await _record_completed_usage(
            usage_ledger=usage_ledger,
            requested_provider="ollama",
            requested_model=local_model,
            provider_metadata=local_result["provider"],
            task_type=snapshot.request.task_type,
            routing_mode=policy["routing_mode"],
            estimated_cost=None,
        )
        cloud_provider = await _create_cloud_provider_for_request(
            provider_config=provider_config,
            key_store=key_store,
        )
        cloud_result = await ai.execute_prepared_analysis(
            messages=snapshot.messages,
            model=snapshot.model.id,
            provider=cloud_provider,
            max_tokens=snapshot.cost.max_output_tokens,
            grounding_map=grounding_map,
        )
        cloud_receipt = await _record_completed_usage(
            usage_ledger=usage_ledger,
            requested_provider="openrouter",
            requested_model=snapshot.model.id,
            provider_metadata=cloud_result["provider"],
            task_type=snapshot.request.task_type,
            routing_mode=policy["routing_mode"],
            estimated_cost=float(snapshot.cost.estimated_cost_usd),
        )
    except AIKeyStoreUnavailableError as exc:
        raise _keychain_unavailable_http_error() from exc
    except (
        AIProviderAuthError,
        AIProviderModelUnavailableError,
        AIProviderNetworkError,
        AIProviderRequestError,
        AIProviderRateLimitError,
        AIProviderTimeoutError,
    ) as exc:
        status_code, detail = _provider_error_detail(exc, "openrouter")
        await _record_failed_cloud_usage(
            usage_ledger=usage_ledger,
            provider_name="openrouter",
            model=snapshot.model.id,
            task_type=snapshot.request.task_type,
            routing_mode=policy["routing_mode"],
            estimated_cost=float(snapshot.cost.estimated_cost_usd),
            error_code=detail["error"],
        )
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _close_request_provider(cloud_provider)

    local_signal = _parse_signal(local_result["signal"])
    cloud_signal = _parse_signal(cloud_result["signal"])
    return AIComparisonResponse(
        snapshot_id=snapshot.snapshot_id,
        local=AIComparisonSide(
            receipt=local_receipt,
            message=local_result["message"],
            signal=local_signal,
            quality=_quality_checks(local_result["message"], local_signal),
        ),
        cloud=AIComparisonSide(
            receipt=cloud_receipt,
            message=cloud_result["message"],
            signal=cloud_signal,
            quality=_quality_checks(cloud_result["message"], cloud_signal),
        ),
    )


@router.get("/routing-policy", response_model=AIRoutingPolicyResponse)
async def routing_policy(
    ai_settings: AISettingsService = Depends(get_ai_settings),
):
    """Return non-secret AI routing settings."""
    return AIRoutingPolicyResponse(**await ai_settings.get_routing_policy())


@router.put("/routing-policy", response_model=AIRoutingPolicyResponse)
async def update_routing_policy(
    request: AIRoutingPolicyUpdate,
    ai_settings: AISettingsService = Depends(get_ai_settings),
):
    """Persist non-secret AI routing settings."""
    return AIRoutingPolicyResponse(
        **await ai_settings.update_routing_policy(
            active_provider=request.active_provider,
            routing_mode=request.routing_mode,
            local_fallback_enabled=request.local_fallback_enabled,
        )
    )


@router.get("/runs", response_model=list[AIRunReceipt])
async def recent_ai_runs(
    limit: int = Query(default=50, ge=1, le=50),
    usage_ledger: AIUsageLedger = Depends(get_ai_usage_ledger),
):
    """Return recent metadata-only AI run receipts."""
    return await usage_ledger.list_run_receipts(limit=limit)


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
    usage_ledger: AIUsageLedger = Depends(get_ai_usage_ledger),
    key_store: AIKeyStore = Depends(get_ai_keystore),
):
    """
    Run a full AI technical analysis on a stock.

    Requires Ollama to be ready (installed + running + model selected).
    Fetches indicator data for each timeframe, builds structured context,
    sends to the user's selected model, and returns signal + analysis text.
    """
    (
        provider_name,
        model,
        fallback_model,
        allow_fallback,
        provider_config,
    ) = await _resolve_analysis_routing(
        request,
        ollama,
        ai_settings,
    )
    status = ollama.status()
    if provider_name == "ollama" and not status["ready"]:
        return AnalyzeResponse(
            session_id="",
            signal=None,
            message=f"AI is not ready. Current state: {status['state']}. "
                    f"Please complete the AI setup first.",
        )

    if provider_name == "ollama" and not model:
        return AnalyzeResponse(
            session_id="",
            signal=None,
            message="No model selected. Please choose a model in the AI panel.",
        )
    policy = {"routing_mode": "local_only"}
    estimated_cost = None
    cloud_provider = None
    requested_provider_name = provider_name
    requested_model = model
    fallback_error_code = "ai_provider_fallback"
    if provider_name != "ollama":
        policy = await _get_routing_policy(ai_settings)
        estimated_cost = _estimate_cloud_analysis_cost(provider_name, model)
        try:
            cloud_provider = await _create_cloud_provider_for_request(
                provider_config=provider_config,
                key_store=key_store,
            )
        except AIKeyStoreUnavailableError as exc:
            if not allow_fallback or not fallback_model:
                raise _keychain_unavailable_http_error() from exc
            provider_name = "ollama"
            model = fallback_model
            fallback_error_code = "ai_keychain_unavailable"

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

    async def run_analysis() -> dict:
        return await ai.analyze(
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
            provider=cloud_provider,
        )

    try:
        result = await run_analysis()
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
    except (
        AIProviderAuthError,
        AIProviderModelUnavailableError,
        AIProviderNetworkError,
        AIProviderRequestError,
        AIProviderRateLimitError,
        AIProviderTimeoutError,
    ) as exc:
        status_code, detail = _provider_error_detail(exc, provider_name)
        await _record_failed_cloud_usage(
            usage_ledger=usage_ledger,
            provider_name=provider_name,
            model=model,
            task_type=request.task_type,
            routing_mode=policy["routing_mode"],
            estimated_cost=estimated_cost,
            error_code=detail["error"],
        )
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _close_request_provider(cloud_provider)

    signal = _parse_signal(result["signal"]) if result.get("signal") else None
    provider_metadata = result.get("provider")
    if provider_metadata is not None and estimated_cost is not None:
        provider_metadata = dict(provider_metadata)
        if provider_name == "ollama" and requested_provider_name != "ollama":
            provider_metadata["fallback_used"] = True
        await _record_completed_usage(
            usage_ledger=usage_ledger,
            requested_provider=requested_provider_name,
            requested_model=requested_model,
            provider_metadata=provider_metadata,
            task_type=request.task_type,
            routing_mode=policy["routing_mode"],
            estimated_cost=estimated_cost,
            fallback_error_code=fallback_error_code,
        )

    return AnalyzeResponse(
        session_id=result["session_id"],
        signal=signal,
        message=result["message"],
        provider=provider_metadata,
    )


# ═══════════════════════════════════════════════════════════════
#  POST /ai/analyze/stream
# ═══════════════════════════════════════════════════════════════


@router.post("/analyze/stream")
async def analyze_stream(
    request: AnalyzeRequest | AIAnalysisSnapshotRunRequest,
    ibkr: IBKRService = Depends(get_ibkr),
    ai: AiService = Depends(get_ai),
    ollama: OllamaLifecycle = Depends(get_ollama),
    db: DatabaseService = Depends(get_db),
    ai_settings: AISettingsService = Depends(get_ai_settings),
    usage_ledger: AIUsageLedger = Depends(get_ai_usage_ledger),
    key_store: AIKeyStore = Depends(get_ai_keystore),
    preparation: AIAnalysisPreparationService = Depends(get_ai_analysis_preparation),
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
    if isinstance(request, AIAnalysisSnapshotRunRequest):
        try:
            snapshot = preparation.get_snapshot(request.snapshot_id)
        except AIAnalysisSnapshotExpiredError as exc:
            raise HTTPException(
                status_code=http_status.HTTP_410_GONE,
                detail={
                    "error": "ai_analysis_snapshot_expired",
                    "message": "The reviewed cloud analysis snapshot has expired.",
                },
            ) from exc
        except AIAnalysisSnapshotNotFoundError as exc:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail={
                    "error": "ai_analysis_snapshot_not_found",
                    "message": "The reviewed cloud analysis snapshot was not found.",
                },
            ) from exc
        policy = await _get_routing_policy(ai_settings)
        if policy["routing_mode"] == "local_only":
            raise _cloud_local_only_http_error()
        configs = await ai_settings.list_provider_configs()
        provider_config = next(
            (
                config for config in configs
                if config["provider_name"] == snapshot.provider_name
            ),
            None,
        )
        if (
            provider_config is None
            or not provider_config.get("enabled")
            or not provider_config.get("api_key_ref")
        ):
            raise _cloud_provider_unavailable_http_error(snapshot.provider_name)
        if provider_config.get("selected_model") != snapshot.model.id:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail={
                    "error": "ai_analysis_snapshot_model_changed",
                    "message": "The selected OpenRouter model changed after preview.",
                },
            )
        registry = getattr(ai, "provider_registry", None)
        fallback_provider = (
            registry.require("ollama")
            if snapshot.fallback_enabled and snapshot.local_model and registry is not None
            else None
        )
        fallback_error_code = "ai_provider_fallback"
        try:
            cloud_provider = await _create_cloud_provider_for_request(
                provider_config=provider_config,
                key_store=key_store,
            )
        except AIKeyStoreUnavailableError as exc:
            if fallback_provider is None:
                raise _keychain_unavailable_http_error() from exc
            cloud_provider = None
            fallback_error_code = "ai_keychain_unavailable"

        run_id = str(uuid4())

        async def prepared_event_stream():
            try:
                async for event in ai.analyze_prepared_stream(
                    snapshot=snapshot,
                    provider=cloud_provider,
                    fallback_provider=fallback_provider,
                    grounding_map=preparation.get_grounding_map(snapshot.snapshot_id),
                ):
                    if event.get("type") == "done":
                        provider_metadata = event.get("provider") or {}
                        receipt = await _record_completed_usage(
                            usage_ledger=usage_ledger,
                            requested_provider="openrouter",
                            requested_model=snapshot.model.id,
                            provider_metadata=provider_metadata,
                            task_type=snapshot.request.task_type,
                            routing_mode=policy["routing_mode"],
                            estimated_cost=float(snapshot.cost.estimated_cost_usd),
                            fallback_error_code=fallback_error_code,
                            run_id=run_id,
                        )
                        event = {
                            **event,
                            "receipt": receipt.model_dump(mode="json"),
                        }
                    yield f"data: {json.dumps(event)}\n\n"
            except (
                AIProviderAuthError,
                AIProviderModelUnavailableError,
                AIProviderNetworkError,
                AIProviderRequestError,
                AIProviderRateLimitError,
                AIProviderTimeoutError,
            ) as exc:
                _, detail = _provider_error_detail(exc, "openrouter")
                receipt = await _record_failed_cloud_usage(
                    usage_ledger=usage_ledger,
                    provider_name="openrouter",
                    model=snapshot.model.id,
                    task_type=snapshot.request.task_type,
                    routing_mode=policy["routing_mode"],
                    estimated_cost=float(snapshot.cost.estimated_cost_usd),
                    error_code=detail["error"],
                    run_id=run_id,
                )
                yield f"data: {json.dumps({'type': 'error', **detail, 'receipt': receipt.model_dump(mode='json')})}\n\n"
            finally:
                await _close_request_provider(cloud_provider)

        return StreamingResponse(
            prepared_event_stream(),
            media_type="text/event-stream",
            headers={"X-Orbit-AI-Run-ID": run_id},
        )

    (
        provider_name,
        selected_model,
        fallback_model,
        allow_fallback,
        provider_config,
    ) = await _resolve_analysis_routing(
        request,
        ollama,
        ai_settings,
    )
    status = ollama.status()
    if provider_name == "ollama" and (not status["ready"] or not selected_model):
        async def err_stream():
            payload = {
                "type": "done",
                "session_id": request.session_id or "",
                "signal": None,
                "message": (
                    "AI is not ready. Please complete the AI setup and select "
                    "a model first."
                ),
                "provider": _local_provider_metadata(selected_model).model_dump(),
            }
            yield f"data: {json.dumps(payload)}\n\n"
        return StreamingResponse(err_stream(), media_type="text/event-stream")
    policy = {"routing_mode": "local_only"}
    estimated_cost = None
    cloud_provider = None
    requested_provider_name = provider_name
    requested_model = selected_model
    fallback_error_code = "ai_provider_fallback"
    if provider_name != "ollama":
        policy = await _get_routing_policy(ai_settings)
        estimated_cost = _estimate_cloud_analysis_cost(provider_name, selected_model)
        try:
            cloud_provider = await _create_cloud_provider_for_request(
                provider_config=provider_config,
                key_store=key_store,
            )
        except AIKeyStoreUnavailableError as exc:
            if not allow_fallback or not fallback_model:
                raise _keychain_unavailable_http_error() from exc
            provider_name = "ollama"
            selected_model = fallback_model
            fallback_error_code = "ai_keychain_unavailable"

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

    run_id = str(uuid4())

    async def event_stream():
        async def analysis_events():
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
                provider=cloud_provider,
            ):
                yield event

        async def serialize_analysis_event(event: dict) -> str:
            if event.get("type") == "done":
                provider_metadata = event.get("provider")
                receipt = None
                if provider_metadata is not None and estimated_cost is not None:
                    provider_metadata = dict(provider_metadata)
                    if provider_name == "ollama" and requested_provider_name != "ollama":
                        provider_metadata["fallback_used"] = True
                    receipt = await _record_completed_usage(
                        usage_ledger=usage_ledger,
                        requested_provider=requested_provider_name,
                        requested_model=requested_model,
                        provider_metadata=provider_metadata,
                        task_type=request.task_type,
                        routing_mode=policy["routing_mode"],
                        estimated_cost=estimated_cost,
                        fallback_error_code=fallback_error_code,
                        run_id=run_id,
                    )
                event = {
                    **event,
                    "provider": provider_metadata
                    or _local_provider_metadata(selected_model).model_dump(),
                    **({"receipt": receipt.model_dump(mode="json")} if receipt else {}),
                }
            return f"data: {json.dumps(event)}\n\n"

        try:
            async for event in analysis_events():
                yield await serialize_analysis_event(event)
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
                "provider": _local_provider_metadata(selected_model).model_dump(),
            }
            yield f"data: {json.dumps(timeout_event)}\n\n"
        except (
            AIProviderAuthError,
            AIProviderModelUnavailableError,
            AIProviderNetworkError,
            AIProviderRequestError,
            AIProviderRateLimitError,
            AIProviderTimeoutError,
        ) as exc:
            _, detail = _provider_error_detail(exc, provider_name)
            receipt = await _record_failed_cloud_usage(
                usage_ledger=usage_ledger,
                provider_name=provider_name,
                model=selected_model,
                task_type=request.task_type,
                routing_mode=policy["routing_mode"],
                estimated_cost=estimated_cost,
                error_code=detail["error"],
                run_id=run_id,
            )
            yield f"data: {json.dumps({'type': 'error', **detail, 'receipt': receipt.model_dump(mode='json')})}\n\n"
        finally:
            await _close_request_provider(cloud_provider)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ═══════════════════════════════════════════════════════════════
#  POST /ai/chat
# ═══════════════════════════════════════════════════════════════


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    ai: AiService = Depends(get_ai),
    ollama: OllamaLifecycle = Depends(get_ollama),
    ai_settings: AISettingsService = Depends(get_ai_settings),
    usage_ledger: AIUsageLedger = Depends(get_ai_usage_ledger),
    key_store: AIKeyStore = Depends(get_ai_keystore),
):
    """Send a follow-up question in an existing analysis session."""
    session = ai.sessions.get(request.session_id)
    if session is not None and session.provider_name == "ollama" and (
        not ollama.status()["ready"] or not session.model
    ):
        return ChatResponse(
            session_id=request.session_id,
            signal=None,
            message="AI is not ready. Please complete setup and select a model.",
        )

    request_provider = None
    policy = await _get_routing_policy(ai_settings)
    try:
        request_provider, policy = await _create_session_provider(
            ai=ai,
            session_id=request.session_id,
            ai_settings=ai_settings,
            key_store=key_store,
        )
        result = await ai.follow_up(
            session_id=request.session_id,
            message=request.message,
            provider=request_provider,
        )
    except AIKeyStoreUnavailableError as exc:
        if session and session.fallback_model and ollama.status().get("ready"):
            session.provider_name = "ollama"
            session.model = session.fallback_model
            result = await ai.follow_up(
                session_id=request.session_id,
                message=request.message,
            )
        else:
            raise _keychain_unavailable_http_error() from exc
    except (
        AIProviderAuthError,
        AIProviderModelUnavailableError,
        AIProviderNetworkError,
        AIProviderRequestError,
        AIProviderRateLimitError,
        AIProviderTimeoutError,
    ) as exc:
        provider_name = session.provider_name if session else "ollama"
        status_code, detail = _provider_error_detail(exc, provider_name)
        await _record_failed_cloud_usage(
            usage_ledger=usage_ledger,
            provider_name=provider_name,
            model=session.model if session else "",
            task_type="chat",
            routing_mode=policy["routing_mode"],
            estimated_cost=_estimate_cloud_analysis_cost(provider_name, session.model if session else ""),
            error_code=detail["error"],
        )
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except ValueError as e:
        return ChatResponse(
            session_id=request.session_id,
            signal=None,
            message=str(e),
        )
    finally:
        await _close_request_provider(request_provider)

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
    ai_settings: AISettingsService = Depends(get_ai_settings),
    usage_ledger: AIUsageLedger = Depends(get_ai_usage_ledger),
    key_store: AIKeyStore = Depends(get_ai_keystore),
):
    """Streaming follow-up via Server-Sent Events."""
    session = ai.sessions.get(request.session_id)
    if session is not None and session.provider_name == "ollama" and (
        not ollama.status()["ready"] or not session.model
    ):
        async def error_stream():
            yield "data: AI is not ready. Please complete setup first.\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    try:
        request_provider, policy = await _create_session_provider(
            ai=ai, session_id=request.session_id,
            ai_settings=ai_settings, key_store=key_store,
        )
    except AIKeyStoreUnavailableError as exc:
        if session and session.fallback_model and ollama.status().get("ready"):
            session.provider_name = "ollama"
            session.model = session.fallback_model
            request_provider = None
            policy = await _get_routing_policy(ai_settings)
        else:
            raise _keychain_unavailable_http_error() from exc

    async def token_stream():
        try:
            async for token in ai.follow_up_stream(
                session_id=request.session_id,
                message=request.message,
                provider=request_provider,
            ):
                yield f"data: {token}\n\n"
            yield "data: [DONE]\n\n"
        except ValueError as e:
            yield f"data: Error: {e}\n\n"
            yield "data: [DONE]\n\n"
        except (
            AIProviderAuthError,
            AIProviderModelUnavailableError,
            AIProviderNetworkError,
            AIProviderRequestError,
            AIProviderRateLimitError,
            AIProviderTimeoutError,
        ) as exc:
            provider_name = session.provider_name if session else "ollama"
            _, detail = _provider_error_detail(exc, provider_name)
            await _record_failed_cloud_usage(
                usage_ledger=usage_ledger,
                provider_name=provider_name,
                model=session.model if session else "",
                task_type="chat",
                routing_mode=policy["routing_mode"],
                estimated_cost=_estimate_cloud_analysis_cost(provider_name, session.model if session else ""),
                error_code=detail["error"],
            )
            yield f"data: {json.dumps({'type': 'error', **detail})}\n\n"
        finally:
            await _close_request_provider(request_provider)

    return StreamingResponse(token_stream(), media_type="text/event-stream")
