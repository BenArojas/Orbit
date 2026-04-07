/**
 * Centralized transport configuration.
 *
 * Every HTTP and WebSocket URL in the app derives from these two constants.
 * In dev mode the sidecar runs on localhost:8000. In production Tauri
 * launches the sidecar and the same URL applies.
 *
 * If the port or host ever needs to change (e.g., Hub consolidation,
 * dynamic port assignment), this is the only file to touch.
 */

const SIDECAR_HOST = "localhost";
const SIDECAR_PORT = 8000;

/** HTTP base URL for the Python FastAPI sidecar */
export const API_BASE = `http://${SIDECAR_HOST}:${SIDECAR_PORT}`;

/** WebSocket URL for live market data streaming */
export const WS_URL = `ws://${SIDECAR_HOST}:${SIDECAR_PORT}/ws`;
