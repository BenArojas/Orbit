# Parallax redesign

Date: 2026-10-03. Owner: Parallax. Status: Market implemented with live verification pending; RS/watchlist product decisions approved, implementation not started.
Next action: implement the [RS/watchlist brief](../plans/2026-10-03-parallax-rs-watchlist-handoff.md), preserving the uncommitted Market work. The orchestrator plans and reviews; the separate coder implements.

## What we are changing

Parallax will help the user answer three questions in order: What is the market doing? Which stocks are showing strength? Which entry method fits the situation?
Buying pullbacks is one method, not the entire product. Breakouts and breakout retests remain available. Market conditions change their priority.
The approved interactive mockup establishes the layout and Cool Mineral palette. Its prices, charts and signals are examples, not final calculation rules.

## Market first

- Opening Parallax shows market status before individual stocks or tactics.
- Explain the posture in a short sentence: broad strength, selective strength, or defensive conditions. Use the approved rules below, without a numerical market score.
- Use index performance and participation to explain the posture. An index near its high does not, by itself, prove a broad rally.
- Strong participation can favor breakout opportunities. Weak participation calls for patience, tighter selection and support-based entries; sometimes there is no suitable entry.
- Show which evidence informed the status and when it was updated. Missing or stale data must be visible. Available charts and prices remain usable when evidence is incomplete.
- Prices and current chart bars update automatically through the existing FastAPI WebSocket stream. No recurring manual refresh is required. Historical loading and recovery may use existing backend requests automatically.
- Keep the approved daily posture separate from live prices: recalculate when a completed daily session is available, not on each intraday tick. Reconnection must restore subscriptions and reconcile missed data; show live, delayed or disconnected state according to actual feed evidence.
- Sector ETF participation may be used as a clearly labelled proxy. It must not be presented as the number of individual stocks participating.
- Stock breadth, including proximity to 52-week highs and lows, requires an agreed stock universe and adequate history before it can be claimed.

Approved initial rules:
- Follow SPY, QQQ and IWM. Assess each using completed daily closes, EMA21 and SMA50: above both is constructive; below both is weak; otherwise mixed.
- Measure participation using the 11 sector ETFs above SMA50: 8–11 is broad, 4–7 selective, and 0–3 weak. This is a sector proxy, not individual-stock breadth.
- Broad strength requires all three indices constructive and broad sector participation. Emphasize breakouts and retests.
- Defensive requires at least two indices weak and weak sector participation. Emphasize capital preservation; waiting is a valid outcome.
- All other complete, current combinations are selective strength. Emphasize strong names near support and carefully selected retests.
- Keep every tactic available. An unfinished daily candle must not change the posture. With missing/stale evidence, publish a current posture only if every possible completion gives that same posture; otherwise show “Current assessment incomplete” and retain any previous dated assessment as history.
- Regular-session daily closes drive calculations. Load one year of history; require the latest 100 completed sessions for EMA21/SMA50, use the existing SMA-seeded EMA method over those 100 closes, and average the latest 50 closes for SMA50. Equality is mixed for indices and does not count a sector as above SMA50.
- Show SMA200 for the three indices as long-term context, requiring 200 completed sessions. It does not affect posture or block the EMA21/SMA50 assessment when unavailable.
- Use local exchange_calendars with the XNYS session schedule for this US-market view, accounting for holidays, early closes and daylight saving. No guessed weekday/calendar fallback; unavailable schedule means session-dependent evidence cannot be certified current.
- Reconcile automatically on entry/reconnect and five minutes after regular-session close; retry incomplete evidence every five minutes while Market is open. Extended-hours quotes remain separate. The delay is a buffer, not proof of provider finalization.
- Add read-only GET /market/assessment for daily evidence and posture; retain existing EMA50 sector feeds. Prices use the existing WebSocket, with automatic backend requests for history/reconciliation. No database changes are approved.
- These are approved initial heuristics to validate, not proven trading signals. Missing-sector participation must show a range or “at least” count, never an invented complete count.

## Strong stocks and the watchlist

- The next view shows stocks, their sectors when available, relative strength, the chosen setup and what is being monitored.
- The user can add stocks manually or review scanner suggestions. Suggestions join the watchlist only when the user chooses them.
- Automatic Leaders uses Fred6725's published broad stock-ranking dataset. User-run Custom scan uses the existing IBKR scanner; its limited candidate batch is not a guaranteed scan of every stock.
- Keep candidate discovery separate from the user's monitored watchlist. Monitoring follows the selected setup locally; setup progress must not automatically move broker watchlist entries.
- Use Fred's published weighted RS method and broad-universe ratings, replacing the previously proposed single-period SPY outperformance default. Do not recompute percentiles within a watchlist or scanner batch. Verify the distinction between published percentiles and TradingView's displayed rating; do not claim exact agreement without evidence.
- IBKR remains the source of truth for watchlist membership. Users select their list and explicitly add/remove stocks. Setup states remain separate from broker membership.
- Entering Discover automatically loads Leaders. Show the latest saved results immediately, then check for newer source data when the saved snapshot is from an earlier trading session. Source publication time, fetch time and underlying price session are different facts; unknown evidence dates remain unknown.
- Keep Leaders and Custom scan separate. Scan again is available; custom scans do not overwrite Leaders. Live prices use the shared WebSocket independently of daily ratings.
- Automatic Leaders requires a finite price of at least $10 and 50-session average volume of at least 500,000 shares/day. Missing eligibility fields do not qualify. Show up to 30 names ordered by Fred's raw strength score; never pad the list. These limits do not restrict watchlists or custom scans.
- Watchlists retain weaker names; sorting or filtering never changes membership. Missing ratings remain unavailable. Source failure retains the last valid snapshot with a visible freshness limitation rather than inventing current leaders.
- Sector metadata can be unavailable. Display that honestly; stock logos are not required.
- Prefer leaders close to meaningful levels. Consider how much resistance sits overhead and whether price is approaching or exceeding prior highs.
- “ATH leads to ATH” is a selection idea, not a promise. A stock at a high can still fall; limited history cannot establish a lifetime high.

## Tactics and risk

All three methods remain visible. Market posture changes emphasis rather than removing methods.
Selecting a stock opens a focused chart and a small amount of setup evidence. Show the level, confirmation state and invalidation clearly.

Pullback / shakeout:
- Look for relative strength and a pullback into meaningful support within a broader constructive chart.
- A sequence of declining 30-minute candles can include small green candles. Every candle does not need to be red.
- The pivot confirms when a completed 30-minute candle closes above the previous candle's high. An unfinished candle is not confirmation.
- The default stop is structural: the lowest low of the monitored pullback is the invalidation reference. Any buffer below it still needs a defined rule and approval.
- Define exactly when a monitored pullback begins, resets or expires before coding the detector. This determines which low is used.
- Distinguish entry invalidation from failure of the broader stock setup. Never imply that a tight stop guarantees a fill at that price.

Breakout and breakout retest:
- Support both as first-class tactics, including periods when broad strength favors them.
- Their confirmation, invalidation and expiry rules still need approval. Do not reuse the pullback pivot rule automatically or display unapproved signals as confirmed.

## Keep Compare and meaningful chart controls

- Preserve the existing Compare feature for longer-term strength and live intraday comparison, including breakout observation.
- Keep up to three panes, independent reference symbols and timeframes, overlay / stock-only / reference-only views, synchronized crosshairs, and adjustable line colors.
- Keep existing supported live updates and clearly show connection or freshness limitations. Live comparison is observation, not an entry signal by itself.
- The mockup's simple rebased comparison does not replace the existing dual-price-scale chart. Independent price scales are not a numerical measure of outperformance.
- Keep Compare easy to reach from stock review without crowding the default screen. Preserve current saved preferences and resolve instrument identity through existing boundaries.
- Chart access to lines, indicators and Fibonacci belongs in the design. Detailed tool interaction and any additions or improvements will be designed later.
- Existing drawings, indicators and Fibonacci functionality are not approved for deletion. Their placement must fit the simpler interface without losing saved work.
- Research into ATR extension, RS ratings, moving averages and ATH-anchored VWAP informs later indicator definitions. Those studies are not yet approved signal formulas or defaults.

## Visual direction and cleanup

- Use Cool Mineral: background #F1F4F5, surface #FCFDFD, text #25313A, accent #436782. Preserve readable contrast and distinguish chart lines clearly.
- Keep the order market → RS names → tactics. Use short labels, restrained color, clear charts and progressive disclosure.
- Remove numbered roadmap components, decorative icons, logo dependencies and dense default screens. Detailed evidence belongs behind an intentional action.
- Rework existing screen and alert organization around the new flow. Do not delete working alerts, drawings, watchlists or Compare simply because they were absent from the mockup.
- Produce an explicit keep / replace / retire mapping of affected screens and old setup rules before any destructive removal.

## Boundaries and open decisions

The first redesign keeps TWS Assistant independent. Parallax uses the existing Client Portal path; it does not gain a seamless Gateway handoff or broker execution action through this spec.
Follow the canonical [module and safety rules](../../architecture/modules.md) and [frontend architecture](../../architecture/frontend.md). No new broker, cloud or autonomous trading behavior is approved here.
Market and RS/watchlist product decisions are locked. Validate Fred's source freshness and rating semantics during the RS slice. Before tactic slices, settle: pullback boundaries and stop buffer; breakout / retest rules; overhead resistance measurement; setup-monitoring cadence and alert behavior.
Data availability and IBKR pacing must be checked against the real implementation. Unavailable metrics should be omitted or marked unavailable, never filled with invented values.

## How we proceed and verify

1. Spec and initial market rules approved. Resolve the remaining open rules only before their affected slice; do not treat them as approved by the mockup.
2. Give the approved first-slice brief directly to the coder. Keep PROJECT_PLAN.md aligned with actual implementation progress; no issue-board or removed-skill workflow is required.
3. Start with one end-to-end slice: market-first navigation and a real, clearly labelled market evidence view. Approve its specific calculations and scope first.
4. Add watchlist / candidate discovery, then stock review and tactic monitoring in separately approved slices. Preserve Compare throughout; design new chart tools later.
5. Use focused, meaningful verification for honest missing-data states, user-controlled additions, completed-candle confirmation, correct structural low and Compare's historical/live behavior where affected.
6. Review the implemented interface on a small laptop, verify existing saved chart work survives, and complete real-provider checks before claiming live behavior. Human approval remains required for merging.
