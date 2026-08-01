# Watchlists & Triggers — Parked Recommendations

> Source: brainstorm session 2026-05-20. These items came up during scoping but are intentionally out of v1 of the Today/Watchlists/Triggers overhaul. They're catalogued here so they don't get re-litigated and so future work has a starting point. Each is sized roughly so you can prioritise against future capacity.

The companion design doc is [`2026-05-20-watchlists-triggers-design.md`](./2026-05-20-watchlists-triggers-design.md).

---

## 2. Analysis page "Create rule from current view"

**What:** Right-click a chart level (price line, fib level, EMA touch) and get a prefilled rule modal with the threshold seeded from where you clicked, the indicator inferred from the line, and the symbol from the current chart.

**Motivation:** Encodes Ofek's discretionary trading method into the rule definition flow. The trader sees a setup forming visually and converts it to a watcher without leaving the chart.

**Why parked:** Lightweight-Charts click-position math has been fragile in past attempts (see Phase 10 marker tool revert). Risky to build until the rest of the trigger UX is settled.

**Rough sizing:** ~3 days. Chart integration is the hard part; the rule-creation flow already exists by the time this lands.

---

## 3. Cmd+K palette

**What:** A fuzzy-search command palette opened with `cmd+K` from anywhere in the app. Searches: symbols in your watchlists, rule names, page navigation, recent hits.

**Motivation:** Replaces the need for a persistent watchlist on Market/Screener pages. Pro-tool standard pattern. Keyboard-driven users can navigate at speed.

**Why parked:** Genuinely additive. Doesn't unblock anything in v1. Better built once we have stable schema for everything it searches over.

**Rough sizing:** ~3 days. shadcn already ships a `<Command>` primitive. Indexing strategy: in-memory, hydrated from existing queries.

---

## 4. Cross-rule confluence detection

**What:** When two or more *different* rules fire on the same conid within the same scan interval, surface it as a "high-confluence event" in the Today timeline with a distinct badge.

**Motivation:** Multi-condition rules give you in-rule confluence. Cross-rule confluence (e.g., "Golden Pocket Bounce" AND "Mean Reversion" both fire on AAPL same morning) is a stronger signal. Currently a user would have to mentally correlate the timeline.

**Why parked:** Implementation is straightforward (group hits by `conid + scan_window`), but the UX of presenting a "meta-hit" cleanly alongside the regular cards needs design work and isn't critical for v1.

**Rough sizing:** ~2 days. Backend group-by + a new `confluence_events` materialised view (or computed on read). Frontend: a third card variant.

---

## 5. Setup-archetype starter watchlists

**What:** First-run experience offers to create starter watchlists named for common archetypes ("Momentum", "Mean Reversion", "Swing Setups", "Earnings Plays") and seeds them with their archetype's default rule set.

**Motivation:** New users (or new accounts) get a working configuration immediately. Demonstrates the per-watchlist rule scoping model without making them build it from scratch.

**Why parked:** Onboarding flow work. Better tackled once the underlying primitives have settled. Also overlaps with template seeding — could be deferred indefinitely if templates are discoverable enough.

**Rough sizing:** ~1 day. Mostly content + a small onboarding modal.

---

## 6. Real inline mini-charts on Today hit cards

**What:** Replace the SVG-sparkline placeholders on hit cards with actual Lightweight-Charts mini-charts showing the last 30 bars + an indicator overlay relevant to the rule that fired.

**Motivation:** Lets you scan setups visually without opening Analysis. Higher information density per card.

**Why parked:** Performance cost — N small chart instances on the Today page, each fetching/holding candle data. Better to ship the page with cheap SVG, measure, and decide if upgrading is worth it.

**Rough sizing:** ~2 days. Reuses the chart wrapper from Analysis. Candle data probably comes from a new bundled endpoint that returns 30 bars per conid.

---

## 7. Per-rule health stats

**What:** A small stats card per rule showing fire rate (hits/week), recent dismissal rate (signal-to-noise proxy), and — eventually — a win-rate proxy if a price-followup grader is built (mirrors the `fib_outcomes` idea from `parallax-v2-roadmap`).

**Motivation:** Rules drift. A rule that fired great last quarter may be noise now. Surface that without making the user dig.

**Why parked:** Win-rate requires a grader (price-followup job, similar to fib outcomes). Worth doing alongside the fib learning algorithm in v2.

**Rough sizing:** ~3 days for fire-rate + dismissal-rate. The win-rate piece needs the grader infrastructure from the fib v2 work.

---

## 8. Snooze presets

**What:** Quick-snooze buttons on hit cards: "1h", "Until close", "Until tomorrow open", "1 week". Backed by the same `snoozed_until` field.

**Motivation:** Faster than typing a duration. Matches calendar-style snooze UX.

**Why parked:** Trivial to add later; not blocking v1.

**Rough sizing:** Half a day.

---

## 9. Watchlist-config expiry overrides UI

**What:** The current `<WatchlistConfigSection>` (per-watchlist auto-expire-days override) becomes much less prominent under the new tag-in-place model. v1 hides it; if a user still wants per-watchlist expiry on rules that opt into `ibkr_mirror_target`, expose this as an advanced field inside the rule modal rather than a sidebar panel.

**Motivation:** Cleanup. The feature stays in the data model (already shipped in Phase 6.8) but the surface area shrinks because the use case shrinks.

**Why parked:** Implementation choice that follows directly from v1 once it ships. Document here so we don't forget the surface area.

**Rough sizing:** Half a day. Mostly deletion + a small modal field addition.
