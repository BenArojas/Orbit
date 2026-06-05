"""
Typed exceptions for the entire backend.
Every service raises one of these — never bare Exception.
"""


class ParallaxError(Exception):
    """Base for all Parallax errors."""

    def __init__(self, message: str = "An error occurred"):
        self.message = message
        super().__init__(self.message)


# ── IBKR Errors ──────────────────────────────────────────────


class IBKRError(ParallaxError):
    """Base for all IBKR-related errors."""


class IBKRAuthError(IBKRError):
    """IBKR session is not authenticated or has expired."""

    def __init__(self, message: str = "IBKR session not authenticated"):
        super().__init__(message)


class IBKRConnectionError(IBKRError):
    """Cannot reach the IBKR Client Portal Gateway."""

    def __init__(self, message: str = "Cannot connect to IBKR Gateway"):
        super().__init__(message)


class IBKRRequestError(IBKRError):
    """IBKR returned an unexpected HTTP error."""

    def __init__(self, status_code: int, detail: str = ""):
        self.status_code = status_code
        message = f"IBKR request failed ({status_code})"
        if detail:
            message += f": {detail}"
        super().__init__(message)


class IBKRBarLimitExceededError(IBKRError):
    """
    Raised when a (period, bar) request returns more bars than the
    est_max_bars ceiling defined in TIMEFRAME_SPEC.

    This protects against silent data truncation caused by invalid
    period/bar combinations or unexpected IBKR API behaviour changes.
    Callers should log and surface an error to the user rather than
    rendering a partial chart silently.
    """

    def __init__(self, timeframe: str, received: int, limit: int):
        self.timeframe = timeframe
        self.received = received
        self.limit = limit
        super().__init__(
            f"Bar limit exceeded for timeframe {timeframe!r}: "
            f"received {received} bars, limit is {limit}"
        )


class IBKRRateLimitError(IBKRError):
    """Hit IBKR rate limit — caller should back off."""

    def __init__(self, endpoint: str, retry_after: int | None = None):
        self.endpoint = endpoint
        self.retry_after = retry_after
        message = f"Rate limit exceeded for {endpoint}"
        if retry_after:
            message += f" (retry after {retry_after}s)"
        super().__init__(message)


# ── Data Errors ──────────────────────────────────────────────


class DataError(ParallaxError):
    """Bad or missing data from any source."""


class SymbolNotFoundError(DataError):
    """Requested ticker/conid doesn't exist."""

    def __init__(self, symbol: str):
        self.symbol = symbol
        super().__init__(f"Symbol not found: {symbol}")


class InvalidFibWeightsError(DataError):
    """
    Raised when a Fibonacci scoring-weights payload fails validation.

    Validation rules (see services.indicators):
      - Every weight must satisfy 0 ≤ w ≤ 1.
      - The sum of weights must be within [0.95, 1.05] (auto-normalized
        to exactly 1.0 on save when inside this band; rejected otherwise).
      - Factor names must match the canonical set produced by the
        scorer (swing_clarity, multi_touch, rejection_intensity,
        stretched_penalty, recency). Unknown names are rejected.
    """

    def __init__(self, message: str = "Invalid Fibonacci scoring weights"):
        super().__init__(message)


# ── AI Errors ────────────────────────────────────────────────


class AIError(ParallaxError):
    """Base for Ollama / AI service errors."""


class OllamaConnectionError(AIError):
    """Cannot reach the Ollama server."""

    def __init__(self, message: str = "Cannot connect to Ollama"):
        super().__init__(message)


class OllamaModelError(AIError):
    """Requested model is not available in Ollama."""

    def __init__(self, model: str):
        self.model = model
        super().__init__(f"Model not available: {model}")


class AIAnalysisError(AIError):
    """AI analysis failed — could not generate a valid signal."""

    def __init__(self, message: str = "Analysis failed"):
        super().__init__(message)


class AIAnalysisTimeoutError(AIError):
    """
    An Ollama call in the analysis pipeline exceeded its per-stage timeout.

    stage: which step timed out — "narrative", "signal_extraction", or "reformat"
    timeout_s: the timeout ceiling that was breached (seconds)
    """

    def __init__(self, stage: str, timeout_s: float):
        self.stage = stage
        self.timeout_s = timeout_s
        super().__init__(
            f"AI analysis timed out at '{stage}' stage after {timeout_s:.0f}s. "
            f"Try a faster model or increase the timeout."
        )


# ── Gateway Errors ──────────────────────────────────────────


class GatewayError(ParallaxError):
    """Base for IBKR Gateway provisioning / lifecycle errors."""


class GatewayProvisionError(GatewayError):
    """Failed to download or extract JRE / Gateway files."""

    def __init__(self, message: str = "Gateway provisioning failed"):
        super().__init__(message)


class GatewayStartError(GatewayError):
    """Gateway process failed to start or become healthy."""

    def __init__(self, message: str = "Gateway failed to start"):
        super().__init__(message)


class GatewayNotProvisionedError(GatewayError):
    """Attempted to start Gateway before provisioning."""

    def __init__(self, message: str = "Gateway not provisioned — run provisioning first"):
        super().__init__(message)


# ── Screener Errors ─────────────────────────────────────────


class ScreenerError(ParallaxError):
    """Base for screener-related errors."""


class ScannerUnavailableError(ScreenerError):
    """IBKR scanner API returned no results or is unavailable."""

    def __init__(self, message: str = "Scanner returned no results"):
        super().__init__(message)


class ScannerFilterError(ScreenerError):
    """Invalid filter configuration in a scan request."""

    def __init__(self, message: str = "Invalid screener filter"):
        super().__init__(message)


# ── Drawing Errors ──────────────────────────────────────────


class DrawingError(DataError):
    """Base for chart drawing persistence errors."""


class InvalidDrawingError(DrawingError):
    """
    Raised when a drawing payload fails validation.

    Validation rules:
      - anchors must be non-empty.
      - Each anchor's time must be a positive integer (Unix seconds).
      - Each anchor's price must be a finite positive float.
      - line_width, if present, must be in [1, 4].
      - line_style, if present, must be "solid", "dashed", or "dotted".
      - line_color / fill_color, if present, must be a valid hex color.
    """

    def __init__(self, message: str = "Invalid drawing payload"):
        super().__init__(message)
