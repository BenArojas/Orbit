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


# ── AI Errors ────────────────────────────────────────────────


class AIError(ParallaxError):
    """Base for Ollama / AI service errors."""


class OllamaConnectionError(AIError):
    """Cannot reach the Ollama server."""

    def __init__(self, message: str = "Cannot connect to Ollama"):
        super().__init__(message)
