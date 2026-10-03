# Parallax RS/watchlist — coder brief

Owner: Parallax. Status: implemented on `feature/parallax-redesign-spec`; awaiting orchestrator review. Preserve the existing uncommitted Market implementation and AI/Inflect-removal baseline. Do not commit, merge, push or restore removed features.

Controlling decisions: [approved redesign](../specs/2026-10-03-parallax-redesign-design.md), [module boundaries](../../architecture/modules.md), [frontend](../../architecture/frontend.md), [backend](../../architecture/backend.md), [testing policy](../../testing.md).

## Plain English

After checking Market, users review their watchlists or open Discover to see up to 30 qualifying leaders automatically. Fred's published rankings supply strength data; IBKR supplies custom scans, watchlist membership, live prices and charts. Users inspect a name in Analysis/Compare and explicitly choose whether to add it to an IBKR watchlist.

User story: As a trader, I want strong names ready when I open Discover, while keeping my own watchlists and custom searches independent, so I can choose what deserves closer review.

## Smallest scope

- Add the compact RS names surface after Market, with Watchlist and Discover; Discover contains Leaders and Custom scan.
- Fetch, validate and save Fred's broad ranking snapshot through the sidecar; automatically load Leaders and support Scan again.
- Reuse IBKR list selection, manual stock search/add/remove and custom scanner capabilities; enrich names with published ratings without changing membership automatically.
- Connect resolved names to shared live quotes and existing Analysis/Compare; preserve chart tools and saved preferences.
- Verify the main workflow and source-failure behavior, report live-provider evidence separately, then stop for review.

## Locked behavior

- Cool Mineral, restrained typography, no logos, decorative icons, numbered flow or dense default metrics. Default columns: symbol, sector, price and published RS rating. Put provenance/details behind a deliberate action.
- Keep Market as authenticated landing. Add a clear path to names and back to Market; retain existing Analysis and Compare navigation and capabilities.
- Watchlist membership remains in IBKR. Keep all names, including weak ones; default strongest first, missing ratings last. Filters change the view only. Do not retain account-specific membership across account/session boundaries as if current.
- Entering Discover loads automatically without requiring Scan. Show a valid saved snapshot immediately; revalidate an earlier-session snapshot automatically. On first use show loading, then real results or a visible failure/empty state.
- Leaders and Custom scan retain separate results. Reuse existing custom scanner options and manual execution; do not silently apply Leader limits to custom scans. Scan again rechecks the published source; it cannot force Fred to generate a newer daily ranking.
- Leaders: finite source price >= $10 and finite AvgVol50 >= 500,000 shares/day; rank by published raw Relative Strength descending, stable tie-break by source rank then symbol. Take up to 30 eligible, uniquely resolved stocks; continue through candidates when earlier names cannot be resolved. Never substitute zero for missing fields or fill to 30 with weaker/ineligible data. Show fewer if necessary.
- Eligibility uses the daily source snapshot, not changing intraday ticks. Stream the displayed live price separately; show its feed state. Neither intraday movement nor market posture silently changes daily rankings or broker membership.
- Sector fallback may use IBKR when available; otherwise show Unknown. Missing published ratings show Unavailable, not a fabricated score or local percentile. No unapproved setup badges/signals.

## Source and provider validation

- Approved source: [Fred's project](https://github.com/Fred6725/relative-strength). Outputs are in [rs-log/output](https://github.com/Fred6725/rs-log/tree/main/output): `rs_stocks.csv`, with upper/lower-half CSVs available. Prefer one complete snapshot; never mix halves from different revisions.
- Use a pinned output commit for each fetch and record source revision, publication timestamp when verified, fetched_at and nullable evidence_session. HTTP success or a new fetch does not prove fresh prices. The current CSV lacks a per-row evidence session; never derive it silently from publication time.
- Fred's [calculation](https://github.com/Fred6725/relative-strength/blob/main/rs_ranking.py) weights cumulative performance 40/20/20/20, normalizes against SPY and calculates broad-universe percentiles. Import its published fields; do not add pandas/scipy/yfinance or recreate a market-wide history pipeline.
- Published Percentile is 0–99; TradingView advertises 1–99 and uses threshold data/Pine conversion. Initially label the field explicitly as Fred's published RS percentile, preserve its value, and document verified differences. Do not claim exact TradingView parity unless the Pine conversion and aligned samples establish it. No unexplained +1 conversion.
- Validate actual reachable files, headers, finite numbers, duplicate symbols, source revision/metadata and genuine provider samples before claiming integration works. Confirm freshness metadata can be obtained; if only publication time is known, disclose that underlying price-session freshness is unconfirmed.
- Preserve the last valid snapshot on timeout, rate limit, malformed/empty unexpected publication or failed metadata validation. Expose source unavailable/stale/unknown freshness; distinguish this from IBKR quote availability. Repeated checks must be bounded and coalesced, not one download per row or tick.
- The source is an external dependency, not a guaranteed complete stock universe or guaranteed daily publication. No fallback that disguises a 50-name IBKR scan as broad Leaders. IBKR [Web API scans](https://www.interactivebrokers.com/docs/web-api/v1/endpoints/scanner/iserver-market-scanner) return at most 50 contracts/request.

## Technical scope

- Keep ingestion, validation, filtering and rating lookup in a small Parallax-owned backend service; routers and module APIs remain facades. Existing anchors: `backend/services/screener.py`, `backend/routers/screener.py`, `backend/routers/watchlist.py`, `src/pages/ScreenerPage.tsx`, `src/components/analysis/WatchlistTab.tsx`, `src/hooks/useWatchlistMutations.ts`.
- Add typed read-only sidecar contracts for Leader snapshots and batch rating lookup. Suggested endpoints: GET `/rs/leaders` and POST `/rs/ratings` with conids; the POST is read-only. Final names may follow existing conventions. Snapshot JSON includes status, source_revision, source_published_at, fetched_at, evidence_session, freshness, eligible_count, items and issues; each item includes nullable conid, symbol, sector, raw_strength, published_percentile, source_price and avg_volume_50. Unknown fields are null. Quote evidence stays in existing live contracts.
- Use a small versioned last-valid file cache in the local sidecar data location, with atomic replacement and schema validation on load. It contains only public ranking data, not credentials or broker watchlist membership. No SQLite migration or duplicate local membership store. Keep an in-memory symbol lookup over this same snapshot for enrichment.
- External symbol text is source metadata, not instrument identity. Resolve through existing IBKR identity boundaries, checking listing/security type/share class. Ambiguous/unresolved instruments cannot be added, subscribed or opened as a guessed conid. Do not merge class shares by stripping punctuation or rank conids by ticker alone.
- Resolve only needed candidates and visible/watchlist/custom results, within existing pacing. Coalesce downloads and resolution work; isolate shared work from individual request cancellation and clean it up when no callers remain. Pause broker work without authentication; use existing account invalidation behavior.
- All frontend data goes through `src/modules/parallax/api.ts` and `sidecarClient`. TanStack Query owns server state, existing Zustand navigation owns screens. Reuse the single shared WebSocket and subscription reference counts; recover quotes on reconnect, release subscriptions on exit and preserve Compare's streams.
- Keep new responsibilities out of the already-large scanner service/page. Use a small owned service/hook/component as necessary; no general-purpose provider framework, routing rewrite or unrelated refactor.
- Update canonical public-contract docs for additive endpoints and the project-plan status with actual results. Do not reintroduce removed skills/issue-board workflows.

## Verification and delivery

- Exercise automatic Discover entry, persistence across restart, separate custom results, watchlist selection/manual additions and row-to-Analysis/Compare navigation. Verify a weak name remains in its list after sorting/filtering.
- Verify exact price/volume boundaries, invalid/missing eligibility data, descending raw-score order and fewer-than-30 results through meaningful public workflow coverage. Verify source failure preserves the previous snapshot and exposes uncertain freshness; do not duplicate service/router/hook/UI tests of the same promise. Follow the repository test budget.
- Use focused affected tests while iterating, then frontend typecheck, production build and `git diff --check`. Test Market/Compare regressions only where touched. No full-suite loop or watch mode.
- Manually review compact layout on a small laptop. Separately report real-source ingestion/metadata, IBKR resolution, streaming prices, custom scans, explicit watchlist additions and reconnect recovery. Fixtures do not establish these live integrations.
- Deliver changed files, checks, provider evidence and limitations. Stop for orchestrator review before commit/merge. Defer tactic detection, stop rules, alerts redesign, ATH/overhead indicators, chart-tool improvements and TWS handoff.

## Follow-up findings and verification — 2026-10-03

All six requested review findings are fixed in the uncommitted slice:

1. Same-revision refresh reuses validated Fred CSV records and retries only previously unresolved identities through fresh IBKR search/contract requests. Per-ticker warnings remain while resolution is unresolved and clear after recovery.
2. Leader and rating joins require the exact conid and symbol, stock type, USD currency and a recognized US listing exchange. Punctuation is preserved; unverifiable, ambiguous, foreign-listing and mismatched share-class candidates stay unresolved or unrated.
3. Watchlist ratings retain publication date, snapshot freshness and lookup status. Lookup failure is distinct from an absent published row; successful source refresh invalidates rating queries.
4. Custom scan enriches its visible results with Fred's published percentile, freshness and unavailable states. It retains scanner ordering/results and does not apply Leader eligibility or calculate batch percentiles.
5. Add/remove actions capture their watchlist ID and conid. Success invalidates the captured Names/shared watchlist caches; pending actions are disabled and failures are visible.
6. Names/Discover applies the approved Cool Mineral palette within its root scope; MoonMarket, TWS Assistant and chart surfaces are not globally recolored.

Automated verification on this branch: backend fixture tests `test_rs_leaders.py`, `test_screener.py` and `test_ibkr_secdef_prewarm.py` passed (20); Names and Market component tests passed (5); `npm run typecheck`, `npm run build` and `git diff --check` passed. The backend run emitted the installed `pandas_ta` Copy-on-Write deprecation warning. The build emitted existing mixed chart import and large-chunk warnings.

No small-laptop visual check was performed: the available desktop had no Orbit browser tab, and no development server was started. These automated checks use fixtures; this pass did not validate a live Fred refresh or an authenticated IBKR session. Publication timestamp/freshness does not establish the underlying price-session date (`evidence_session` remains unknown). The last source review recorded in `PROJECT_PLAN.md` was stale; check the current published file and metadata before making any current-source claim. Live contract-field/exchange coverage, leader resolution, streamed quotes, custom scans, explicit watchlist mutations and reconnect behavior remain provider verification gaps.

## Astra review follow-up — 2026-10-04

All seven requested findings and the small approved polish are fixed in the uncommitted slice:

1. Names return context is stored in the existing navigation store: Watchlist/Discover, Leaders/Custom scan, selected list, filter and scroll position survive the Analysis/Compare unmount. Existing screener Zustand state retains custom scan controls/results. Authentication loss clears the selected broker list/filter and increments a session epoch.
2. Watchlist loading, empty, no-filter-match and request-failure states are distinct. Stock search has pending, no-results, failure and Retry feedback; aborts and a request generation guard prevent older results replacing newer ones.
3. Leader rows expose “Add to IBKR watchlist”. The user must choose a current destination and confirm; the action shows pending/success/failure and uses the shared membership mutation and cache invalidation path.
4. Broker-owned Names query keys include the session epoch; Gateway auth loss cancels and removes watchlist/list-membership queries. Pending membership requests are aborted and stale-session responses cannot become visible under a matching list ID. Public Fred snapshots/ratings remain separately cached. Mutations require authentication and current list data.
5. Names decodes the first IBKR quote-availability character, matching Market; `RB` is shown as real-time, and delayed/frozen/unavailable/unconfirmed states remain distinct.
6. Automatic/manual Leaders refreshes use abort signals and cleanup on unmount/session invalidation. The `/rs/ratings` disconnect guard wraps both identity lookup and contract/rating work. A fixture route regression confirms disconnect returns 499 and cancels identity work; existing shared-refresh coverage confirms one caller's cancellation does not cancel work still used by another.
7. Market muted text is `#59666E`, measured at 5.35:1 on `#F1F4F5` and 5.80:1 on `#FCFDFD`.

Polish: Leaders/Custom scan have a visible selected state; the heading reads “Fred published RS percentile” with compact numeric cells and no TradingView-parity claim; Market includes “Explore strong names” near posture and routes to the existing scanner.

Automated verification: 14 focused frontend tests passed across NamesPage, MarketPage and GatewayContext; 6 focused backend tests passed across RS leaders and request-disconnect cancellation; `npm run typecheck`, `npm run build` and `git diff --check` passed. The production build retains its existing mixed chart-import and large-chunk warnings. Contrast ratios were calculated for the two actual Market backgrounds. Fixture tests do not validate a live Fred publication, live IBKR session/list mutations, broker-side in-flight cancellation, live price entitlement or reconnect recovery. Current Fred source freshness and price-session evidence were not rechecked here. The small-laptop visual/keyboard walkthrough remains unverified; no development server was started. Stop for orchestrator review; do not commit or merge.
