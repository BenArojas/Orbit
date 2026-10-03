# Sidecar client contracts — current decision

`src/lib/sidecarClient.ts` owns shared FastAPI transport and typed API errors. `src/lib/api.ts` owns Orbit shell, gateway and authentication contracts.
Active product contracts live in the Parallax, MoonMarket and TWS Assistant owners. Inflect and AI-analysis contracts are retired.
Product APIs use the shared transport; components do not call IBKR or persistence directly. Domain computations belong in the sidecar, not transport facades.
See [frontend architecture](../../architecture/frontend.md) and [backend architecture](../../architecture/backend.md). Module extraction and migration checklists are completed history.

## Parallax Market assessment

`GET /market/assessment` is the read-only completed-session assessment. Its Pydantic response includes `status`, `posture`, expected and evidence session dates, calculation time, index and sector evidence, participation counts and possible range, issues, a previous dated assessment, and server-calculated reconciliation timing. Unknown evidence remains `null`; a partial posture is returned only when every possible completion produces the same classification. Index SMA200 is context only.

Assessment calculations use regular-session history and the local XNYS exchange calendar. Live prices and market-data availability use the shared WebSocket. The existing `GET /sectors/breadth` EMA50 contract remains unchanged.

## Parallax published RS and watchlist names

`GET /rs/leaders` returns the last valid public Fred snapshot immediately. `POST /rs/leaders/refresh` checks the published revision and resolves its eligible stock identities through IBKR; callers share a bounded in-flight refresh. An unchanged CSV revision reuses its validated records while retrying unresolved IBKR identities with fresh search/contract evidence. `POST /rs/ratings` accepts up to 250 conids and returns Fred's published values only after contract details confirm the same conid and exact symbol, `STK`, USD currency and a recognized US listing exchange. These routes are read-only with respect to broker watchlist membership.

Leader eligibility is based on the pinned source row: finite price at least $10, finite 50-day average volume at least 500,000 and a finite published raw Relative Strength. Rows sort by raw strength descending with source rank and symbol as stable tie-breaks. At most 30 uniquely resolved stocks are returned; missing values are not filled or inferred. The source snapshot is persisted as versioned public data with atomic replacement. A failed check keeps the last valid snapshot and exposes its status and issue.

`published_percentile` is Fred's unmodified 0–99 field and is labeled as Fred's published RS percentile in the client. Rating rows distinguish rated, not published, unverified identity and unavailable source states; request failures remain query errors. `source_published_at` is the source commit time, not proof of a stock-price session; `evidence_session` remains null until the provider publishes that evidence. Source freshness and IBKR quote availability are independent. The existing watchlist endpoints remain the only source of membership, and the existing shared WebSocket supplies live prices.

The Names watchlist view invalidates its local list, shared watchlist instrument/quote, and conid membership queries after an explicit membership mutation, keyed by the list/conid captured when that mutation began. Discover's Custom scan enriches only visible IBKR rows from the same published ratings endpoint; scanner filters, result order and membership stay independent of Leader eligibility.
