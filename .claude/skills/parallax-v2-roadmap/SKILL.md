---
name: parallax-v2-roadmap
description: Parallax v2 backlog. Use whenever discussing future features, deferred work, the Fibonacci learning algorithm, user-feedback scoring, watchlist-driven analysis enhancements, Inflect integration, or any work explicitly pushed out of v1 scope. Trigger when planning roadmap, answering "is X in v1 or v2", or when a v1 task uncovers work that belongs in v2.
---

# Parallax v2 Roadmap

This skill catalogs everything that has been scoped, discussed, and intentionally pushed out of v1. It exists so v1 stays shippable and so v2 work is grounded in decisions already made rather than re-litigated later.

Trigger: any conversation about future features, deferred scope, or "when are we going to build X". Do NOT pull this into CLAUDE.md — it is reference-only, loaded on demand.

---

## 1. Fibonacci Learning Algorithm

**Status:** v2. Task 4.4 (v1) ships fixed default weights for the fib scoring algorithm. The learning system is built later as its own v2 task once v1 is stable.

**Ofek's requirements (locked 2026-04-05):**
1. **Fully automatic price-based tracking.** Every fib setup the system surfaces (auto-drawn or locked) is silently rated by the algorithm based on what price actually did after. Ofek does NOT have to rate setups manually for the learning loop to function.
2. **No trade-journal linkage.** The algorithm must NOT try to learn from which setups Ofek actually traded. Ofek won't take every setup the system surfaces — portfolio management and capital allocation mean he passes on valid setups all the time. Linking learning to trades would bias the model against setups he skipped for reasons unrelated to setup quality. Explicitly rules out the "Option C hybrid with Inflect journal" approach discussed earlier.
3. **Optional user feedback on analyses.** A thumbs-up / thumbs-down or brief comment button on each AI analysis, so Ofek can flag cases where the score felt wrong. This is supplementary signal for the learning system, never a replacement for the automatic tracking.

### How the automatic tracking works

When the fib service computes a fib analysis (whether auto-drawn on chart load, shown in an AI analysis, or locked by the user), it logs a snapshot to a new SQLite table: the conid, timeframe, swing high/low, the computed levels, the confidence score at analysis time, and the weighted factors that produced that score.

A background job runs periodically (candidate: hourly, or on candle-close per timeframe) and grades each logged analysis against subsequent price action. For each level in the fib, the job checks: did price touch it, did it hold or break, how strong was the reaction (number of candles reversed, max retrace %, time held), and how does that outcome compare to what the confidence score implied.

Over time the system builds a dataset like "golden pocket held 73% of the time when swing clarity score > 0.8 and TF confluence included W+M, vs 41% otherwise." The scoring weights are adjusted incrementally based on which factors correlate with actual held-vs-broken outcomes.

### DB schema additions (v2 only, not in v1)

All additive — no changes to existing v1 tables.

- **`fib_analyses`** — one row per fib the system surfaced. Columns: id, conid, timeframe, swing_high, swing_low, direction, levels_json, score_at_analysis, factors_json (the weighted factor values at analysis time), source (auto/locked/manual), timestamp.
- **`fib_outcomes`** — populated by the background grader. Columns: id, fib_analysis_id (FK), level_label (e.g. "0.618"), outcome_window_candles, touched (bool), held (bool), reaction_strength_score, max_retrace_pct, graded_at.
- **`analysis_feedback`** — populated when the user clicks thumbs up/down on an analysis. Columns: id, analysis_id, rating (-1/+1), comment_text (nullable), timestamp. This is the optional feedback channel.
- **`fib_scoring_weights`** — evolving weight vector. Columns: id, factor_name, weight, updated_at. The fib service reads from here at scoring time instead of using hardcoded constants. On day zero, this table is seeded with the v1 defaults.

### Open questions for v2 implementation time

- Grading window per timeframe: how many candles forward do we grade a daily fib vs a weekly fib? Proposal: 20 daily candles / 10 weekly / 5 monthly, tunable.
- Weight update algorithm: simple moving average, exponential decay, or gradient-style update? Proposal: start with exponential decay (recent outcomes matter more) and revisit after 3 months of data.
- Cold-start: how much data before we trust the learned weights over defaults? Proposal: keep defaults until at least 100 graded outcomes across the factor space.
- How does the feedback button's signal combine with automatic grading when they disagree?
- Does the grader run only for the stocks the user actually opened, or for the whole IBKR watchlist universe?

---

## 2. Cross-Indicator Confluence as Prompt-Layer Logic

v1 task 4.4 keeps the fib service self-contained. Cross-indicator confluence (fib 0.65 on 21 EMA, cross-TF EMA stacking, watchlist-aware framing) is handled in the AI service's prompt builder when multiple indicators are enabled together. v2 work in this area:

- **Explicit confluence detection** — a lightweight layer between the indicator services and the prompt builder that detects specific confluence patterns (fib level within X bps of an EMA, fib level within a Bollinger band edge, etc.) and surfaces them as structured hints in the prompt rather than relying on the LLM to spot them every time.
- **Watchlist-aware prompts** — a prompt modifier per watchlist type (RS / short-dated / swing / long-term) that changes system prompt emphasis based on which watchlist the ticker was opened from. Plumbing: watchlist membership is already in SQLite, needs to be passed through `/ai/analyze`.
- **Multi-instrument comparative analysis** — "how does this name compare to the rest of its RS peer group" — requires fetching peers and their indicator states at analyze time.

---

## 3. News-Candle Detection

Ofek's methodology treats earnings/news candles as high-quality swing anchors (see AMD, AAOI examples). v1 uses generic swing extrema. v2 adds a dedicated news-candle detector that the fib swing-selection algorithm consults.

**Criteria (proposal, still OPEN):** body > 2x ATR AND volume > 2x 20-day average AND (optional) gap from previous close. Detected candles become preferred swing anchors when their timing aligns with the current fib candidate.

Related open question Q5 in PROJECT_PLAN.md.

---

## 4. Inflect Integration (trading journal)

Inflect is Phase 4 of the IBKR Hub roadmap (built after Parallax + MoonMarket). When it ships, v2 work:

- Read-only link from Parallax analyses to Inflect journal entries, so the user can jump "this fib setup → my trade notes for AMD earnings play."
- Tag each Inflect trade with the originating Parallax analysis ID (if any), so trades can be retrospectively analyzed by which fib/indicator setup they came from.

**Explicitly out of scope:** Inflect data feeding back into the fib learning algorithm. Ofek's requirement (2026-04-05) is that learning is price-driven only, never trade-driven.

---

## 5. Nesting Expansion

v1 (task 4.4) implements basic parent/nested detection: a small swing entirely within a larger active fib on the same TF is tagged as nested. v2 extensions:

- Multi-level nesting trees (nested inside nested inside parent).
- Nested fibs across timeframes (a daily nested inside a weekly parent).
- Automatic "zone" rendering: when a parent has multiple nested children, render the parent's golden pocket as a softer background zone behind the nested children.

---

## 6. Other Deferred Items

These came up in earlier discussions and belong in v2 rather than v1:

- **Strict JSON output enforcement** — the current AI service uses a retry-once fallback when the LLM doesn't emit valid JSON. v2: adopt Ollama's structured-output mode (or equivalent per-model mechanism) for hard schema enforcement.
- **Dynamic system prompt** — v1 sends a static system prompt regardless of which indicators are enabled. v2: the system prompt is assembled per analysis based on the enabled indicator set and the watchlist context.
- **Prompt length budget** — when a user enables 10+ indicators across 4 timeframes the prompt may exceed the model's effective context window. v2: compute a per-model token budget and truncate/summarize accordingly.
- **Candidate swings UI** — v1 returns candidate swings via API; v2 adds an expandable panel in the AI analysis card to view them.

---

## Why this skill exists

Everything above was discussed, analyzed, and deliberately pushed out of v1 scope. When a v1 task brushes up against any of these topics, the answer is "defer to v2, see parallax-v2-roadmap." This keeps v1 shippable and prevents scope creep from eating the core feature set.

How to apply: read this skill when planning v2 work, when a v1 task surfaces something that clearly belongs later, or when someone asks "why didn't we build X in v1". Do NOT add any of this content to CLAUDE.md.
