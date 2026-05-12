# Fibonacci Tool Improvements — Implementation Plan

**Date:** 2026-05-11
**Status:** All decisions locked. Ready to implement.
**Scope:** 10 fixes/features for the Fibonacci tool and surrounding Analysis page UX.

---

## Table of Contents

1. [Locked Decisions](#locked-decisions)
2. [Branch Strategy & Sequencing](#branch-strategy--sequencing)
3. [Technical Plan (LLM-optimized)](#technical-plan-llm-optimized)
4. [Plain English Plan (human-readable)](#plain-english-plan-human-readable)
5. [Cross-Cutting Concerns](#cross-cutting-concerns)
6. [Git Command Reference](#git-command-reference)

---

## Locked Decisions

| ID | Decision |
|----|----------|
| 1A | "Currently inside swing" uses a tolerance band of 0.15× swing range. Wicks past `0` or `1.0` do not invalidate. |
| 1B | When no alive candidate exists, return `null` for the primary fib + an explicit "no entry-quality fib" message. Candidates panel still populates from scored historical swings. |
| 1C | Keep current scoring weights for this PR. Re-tune later after observing real behavior. |
| 2A | Boundary lines (`0` and `1.0`) render in magenta: `rgba(255, 60, 220, 0.85)`. |
| 3A | New `GET /fibonacci/config` endpoint returns the canonical ratio array + weights. Frontend caches once per session. New `PUT /fibonacci/config` allows the user to edit weights. Persisted in SQLite. |
| 3B | Formula explainer shows live numbers plugged in for the current top candidate. |
| 4A | Frontend computes override fib levels via `buildLevelsFromCandidate(candidate)`. Single source of truth for ratios is `GET /fibonacci/config`. |
| 4B | "Clear chart fib" button removes the rendered fib but leaves the Candidates panel open. |
| 5A | Use a community Lightweight Charts drawing-tools plugin (research first; fall back to in-house only if no acceptable plugin exists). |
| 5B | Drawings (and locked fibs) are per-conid and visible across ALL timeframes. No TF scoping. |
| 5C | Drawing tools (Item 5) deferred until Items 1, 7, 3+4, 8, 9 land. |
| 7A | When a run is in flight, Run Analysis button is disabled. Cancel button remains in the loading row only (not duplicated beside Run). |
| 8A | Auto-detected primary fib is lockable. "Lock this fib" button on the primary card calls `POST /fibonacci/lock`. |
| 8B | Soft warning at 5 simultaneous fibs on chart. Hard cap at 8. |
| 8C | Locked fibs render as full-width horizontal lines on every TF. No time-anchor snapping. |
| 9A | AI prompt sees only the active fibs (those rendered on the chart). Candidates panel data is NOT sent to the LLM. |
| 9B | Each fib snapshot in the AI request carries an optional `timeframe` field. `null` = inject into every TF section. Set = inject only into that TF's section. |
| 10A | New conid resets timeframe to default (`1D`). |
| 10B | Full wipe on conid change: indicators off, fibs cleared, AI chat cleared, draw mode exited. `useLockedFibs` query repopulates locked fibs asynchronously. |

---

## Branch Strategy & Sequencing

| Order | Branch Name | Item(s) | Reason for grouping |
|-------|-------------|---------|---------------------|
| 1 | `fix/fib-primary-range-selection` | Item 1 | Changes data shape — must land first. |
| 2 | `fix/right-panel-order-and-runbutton` | Item 7 | UX cleanup before adding more panel content. |
| 3 | `feat/fib-score-card-overhaul` | Items 3 + 4 | Both heavily rewrite `FibScoreCard.tsx`. Merging avoids merge churn. |
| 4 | `feat/active-fib-state-and-lock` | Item 8 | Active fib state model + lock UI + multi-fib rendering. |
| 5 | `feat/ai-uses-active-fib-state` | Item 9 | Depends on Item 8 being merged. |
| 6 | `fix/fib-line-styling` | Item 2 | Isolated visual fix. Land late so styling is final after all behavior changes. |
| 7 | `fix/reset-on-ticker-change` | Item 10 | Touches every store that prior items modified. Land last among store changes. |
| 8 | `feat/ai-analysis-copy` | Item 6 | Isolated, can land anytime after Item 7. |
| 9 | `feat/chart-drawing-tools` | Item 5 | Deferred. Treat as multi-PR feature when scheduled. |

**Dependencies:**
- Item 1 → Items 3, 4, 5, 6 (changes `FibonacciCandidate` shape).
- Item 3 → Item 4 (shared ratio constant lives in config endpoint).
- Item 8 → Item 9 (AI consumes active fib state from store).
- Item 8 → Item 10 (reset behavior must include `activeFibs`).
- Item 10 → Item 5 (drawings store must also reset on conid change).

---

## Technical Plan (LLM-optimized)

> Each section is structured so a coding agent can execute it without needing to ask the human follow-up questions. File paths are absolute relative to repo root.

### Branch 1: `fix/fib-primary-range-selection`

**Goal:** Auto-detected primary fib must be a swing the price is currently inside (with 0.15× tolerance). Played-out and broken swings are demoted to the Candidates panel.

**Backend changes:**

- `backend/models/__init__.py`
  - Add field to `FibonacciCandidate`:
    ```python
    status: Literal["active", "played_out", "broken"] = "active"
    ```
  - Add field to `FibonacciResult`:
    ```python
    no_active_fib: bool = False
    no_active_fib_reason: Optional[str] = None
    ```
  - When `no_active_fib=True`, `swing_high/swing_low/levels/extensions` may carry placeholder values; frontend must check `no_active_fib` before rendering levels on the chart.

- `backend/services/indicators.py`
  - Add module constant:
    ```python
    INSIDE_TOLERANCE = 0.15  # 15% of swing range
    ```
  - Modify `_score_swing` to compute and set `status` on each `FibonacciCandidate`:
    - Define expanded bounds: `expanded_low = swing_low - price_range * INSIDE_TOLERANCE`, `expanded_high = swing_high + price_range * INSIDE_TOLERANCE`.
    - If `current_price` between `expanded_low` and `expanded_high` AND no post-swing close past `expanded_high` (for up) / `expanded_low` (for down) → `status = "active"`.
    - If post-swing closes broke past `1.0` boundary (price reached extension target zone) → `status = "played_out"`.
    - If post-swing closes broke past `0` boundary (swing invalidated) → `status = "broken"`.
  - Modify `_compute_fibonacci`:
    - After scoring all candidates, partition: `active = [c for c in scored if c.status == "active"]`.
    - If `active` is non-empty: top = `max(active, key=score)`. Build `FibonacciResult` from top as today.
    - If `active` is empty: return `FibonacciResult(no_active_fib=True, no_active_fib_reason="No alive swing — current price is outside all detected swings", candidates=scored, ...)` with placeholder swing values from highest-scored historical (so the Candidates panel still has rich data).
  - Update `_build_reasoning` to include `status` when relevant.

- `backend/tests/test_fibonacci.py`
  - Add `TestPrimaryRangeSelection`:
    - `test_picks_alive_swing_over_higher_scoring_played_out`
    - `test_returns_no_active_fib_when_all_broken`
    - `test_tolerance_band_keeps_swing_active_on_wick_poke` (price 0.10× outside bounds → still active)
    - `test_tolerance_band_excludes_swing_on_decisive_break` (price 0.25× outside → not active)
    - `test_candidates_panel_still_populated_when_no_active_fib`

**Frontend changes:**

- `src/lib/api.ts`
  - Mirror new fields on `FibonacciCandidate` (`status`) and `FibonacciResult` (`no_active_fib`, `no_active_fib_reason`).

- `src/components/ai/FibScoreCard.tsx`
  - Handle `fibonacci.no_active_fib === true`: show a yellow info card "No entry-quality fib on this timeframe — see candidates below for historical swings", skip the score badge + swing line, still render the Candidates section.
  - In `CandidateRow`, add a colored status chip: `active` (green), `played_out` (gray), `broken` (red).

- `src/components/charts/ChartContainer.tsx`
  - In the fib overlay effect: if `fibonacci?.no_active_fib === true`, skip `addFibonacciOverlay` entirely. Locked fibs still render (after Item 8 lands).

- `src/components/charts/FibonacciOverlay.ts`
  - No change in this branch.

- Tests:
  - `src/components/ai/__tests__/FibScoreCard.test.tsx` — `no_active_fib` state renders info card; candidate status chips render correctly.

---

### Branch 2: `fix/right-panel-order-and-runbutton`

**Goal:** Reorder the AI panel so each topic plays out start-to-finish. Disable Run Analysis while a run is in flight.

**Frontend changes:**

- `src/components/ai/AiChatPanel.tsx`
  - Current scroll-container child order: `AiConfigPanel → ActionSignalCard → FibScoreCard → messages`.
  - New order: `AiConfigPanel → ActionSignalCard → messages → (streaming bubble) → FibScoreCard`.
  - `FibScoreCard` block is moved out of the top group and placed after the streaming bubble, still inside the scroll container so users can scroll down to see it.
  - Pass `isAnalyzing` to `AiConfigPanel`.

- `src/components/ai/AiConfigPanel.tsx`
  - Add prop: `isAnalyzing: boolean`.
  - Run Analysis button: when `isAnalyzing === true` → `disabled`, opacity-40, `cursor-not-allowed`, tooltip "Analysis in progress — cancel below".
  - Do NOT add a Cancel button next to Run (per decision 7A). The existing Cancel in the loading row stays the only cancel control.

- Tests:
  - `src/components/ai/__tests__/AiConfigPanel.test.tsx` — `isAnalyzing=true` disables button; click does not fire `onRunAnalysis`.
  - `src/components/ai/__tests__/AiChatPanel.test.tsx` — `FibScoreCard` renders after messages, not before.

---

### Branch 3: `feat/fib-score-card-overhaul`

**Goal (combined Items 3 + 4):** Add per-criterion glossary, user-editable weights, click-to-load-candidate, clear-fib button. Heavy rewrite of `FibScoreCard.tsx`.

**Backend changes:**

- `backend/models/__init__.py`
  - New model `FibConfig`:
    ```python
    class FibConfig(BaseModel):
        ratios: list[float]              # Retracement ratios [0, 0.382, ..., 1.0]
        extension_ratios: list[float]    # Extension ratios [1.272, ..., 4.618]
        weights: dict[str, float]        # Factor name → weight, must sum to 1.0
    ```

- `backend/services/db.py`
  - New table `fib_settings` (single-row settings table):
    ```sql
    CREATE TABLE IF NOT EXISTS fib_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        weights_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    ```
  - Methods: `get_fib_weights() -> dict[str, float]`, `set_fib_weights(weights: dict[str, float]) -> None`.
  - Seed default row on first read if table is empty.

- `backend/routers/fibonacci.py`
  - New endpoint:
    ```python
    @router.get("/config", response_model=FibConfig)
    async def get_fib_config(db: DatabaseService = Depends(get_db)) -> FibConfig: ...
    ```
    Returns `ratios=FIB_RETRACEMENT_LEVELS`, `extension_ratios=FIB_EXTENSION_LEVELS`, `weights=await db.get_fib_weights()`.
  - New endpoint:
    ```python
    @router.put("/config", response_model=FibConfig)
    async def update_fib_config(req: UpdateFibConfigRequest, db: ...) -> FibConfig: ...
    ```
    Validates: weights are all `0 ≤ w ≤ 1`; sum is within `[0.95, 1.05]` (auto-normalize to sum=1.0); factor names match the canonical 5.
  - New error type in `backend/errors.py`: `InvalidFibWeightsError(ValidationError)` for malformed weight payloads.

- `backend/services/indicators.py`
  - Replace module-level `_WEIGHTS` constant usage in `_score_swing` with a DB read.
  - `IndicatorService.__init__` accepts an optional `db: DatabaseService` reference. When present, `_score_swing` reads weights from DB (with in-memory cache, TTL 60s or invalidate-on-update).
  - Fallback to constant defaults if DB is unreachable.

- `backend/tests/test_fibonacci.py`
  - `TestFibConfig`:
    - `test_get_config_returns_defaults_on_fresh_db`
    - `test_put_config_persists_weights`
    - `test_put_config_rejects_weights_outside_0_to_1`
    - `test_put_config_auto_normalizes_close_to_one`
    - `test_put_config_rejects_unknown_factor_names`
    - `test_scoring_uses_db_weights`

**Frontend changes:**

- `src/lib/api.ts`
  - Add types `FibConfig`, `UpdateFibConfigRequest`.
  - Add methods `api.getFibConfig()`, `api.updateFibConfig(req)`.

- `src/lib/fib.ts` (new)
  - Export `buildLevelsFromCandidate(candidate: FibonacciCandidate, ratios: number[], extensionRatios: number[]): { levels: FibonacciLevel[]; extensions: FibonacciLevel[] }`.
  - Reads ratios from caller (which gets them from `useFibConfig` hook), NOT a hardcoded constant.
  - Identical math to backend `_build_levels`.

- `src/hooks/useFibConfig.ts` (new)
  - TanStack Query hook. `queryKey: ["fib-config"]`, `staleTime: Infinity` (config doesn't change without explicit user action).
  - Returns `{ config: FibConfig | undefined, updateConfig: mutation, isLoading }`.
  - On `updateConfig.onSuccess`, invalidate the query and invalidate `["indicators"]` queries (so the chart re-fetches with new weights).

- `src/store/chart.ts`
  - Add state:
    ```ts
    displayedFibOverride: FibonacciCandidate | null
    ```
  - Actions:
    ```ts
    setDisplayedFib: (candidate: FibonacciCandidate) => void
    clearDisplayedFib: () => void
    ```
  - `clearChart` also resets `displayedFibOverride`.

- `src/hooks/useChartData.ts`
  - When `displayedFibOverride` is set AND config is loaded, synthesize a `FibonacciResult` using `buildLevelsFromCandidate` and substitute it for the auto `fibonacci` field returned to the caller.
  - Add a `fibSource: "auto" | "override"` field to the returned object so the UI can label what's on the chart.

- `src/components/ai/FibScoreCard.tsx` (rewrite)
  - Import `useFibConfig`.
  - New child components in `src/components/ai/fib/`:
    - `FibCriterionRow.tsx` — props: `label`, `factorName`, `value` (0..1), `weight`, `glossary`, `editable`, `onWeightChange?`. Renders the factor row with a `?` tooltip (Radix Tooltip from shadcn) and, when `editable`, an inline number input + Save/Reset buttons.
    - `FibScoreBreakdown.tsx` — collapsible accordion "How is this score calculated?". Shows the formula with the current top candidate's actual values plugged in: e.g. `Score = 0.30 × clarity(0.82) + 0.20 × multi_touch(0.67) + … = 78.4`.
    - `FibCandidatesList.tsx` — replaces the inline `CandidateRow` map. Each candidate is a clickable button row. Active candidate highlighted. Click → `setDisplayedFib(candidate)`. Each row shows the `status` chip from Item 1.
  - New file `src/components/ai/fib/glossary.ts` — exports the 5 factor names with display labels + tooltip strings:
    ```ts
    export const FIB_GLOSSARY = {
      swing_clarity: { label: "Swing clarity", tooltip: "How clean the V-shape is..." },
      multi_touch: { label: "Multi-touch", tooltip: "Number of times price returned to the golden pocket..." },
      rejection_intensity: { label: "Rejection intensity", tooltip: "Strength of bounces off the golden pocket..." },
      stretched_penalty: { label: "Stretched penalty", tooltip: "How close current price is to the golden pocket..." },
      recency: { label: "Recency", tooltip: "Newer swings score higher than older ones..." },
    } as const;
    ```
  - New "Clear chart fib" button at top of FibScoreCard. Visible whenever `displayedFibOverride` is set OR `fibSource === "auto"`. Calls `clearDisplayedFib()` and removes the displayed fib from the chart while keeping the indicator pill toggled on and the panel visible. (When auto is showing, clearing also dismisses the auto fib for this session — handled by adding a `fibCleared: boolean` flag to the store.)

- `src/store/chart.ts` (additional)
  - Add `fibCleared: boolean` field. When `true`, the chart overlay does not render even if `fibonacci` indicator is toggled and an auto result exists. Reset to `false` on conid change, timeframe change, or when user clicks a candidate.

- `src/components/charts/ChartContainer.tsx`
  - In fib overlay effect: skip rendering when `fibCleared === true` OR `fibonacci?.no_active_fib === true`.

- Tests:
  - `src/components/ai/__tests__/FibScoreCard.test.tsx`:
    - Glossary tooltips render
    - Weight editing → calls `updateFibConfig` mutation
    - Click candidate → calls `setDisplayedFib`
    - "Clear chart fib" button → calls `clearDisplayedFib` and sets `fibCleared`
    - Formula breakdown shows live numbers
  - `src/lib/__tests__/fib.test.ts` — `buildLevelsFromCandidate` produces correct level prices for both up and down swings, matching backend output for the same input.
  - `src/store/__tests__/chart.test.ts` — `setDisplayedFib`, `clearDisplayedFib`, `fibCleared` reset on conid/timeframe change.

---

### Branch 4: `feat/active-fib-state-and-lock`

**Goal:** Multi-fib rendering. The chart can show the primary fib + multiple locked fibs simultaneously, each individually deletable, with visual differentiation. Lock the auto fib. Count badge.

**Frontend changes:**

- `src/store/chart.ts`
  - New types:
    ```ts
    export interface ActiveFib {
      id: string;                    // UUID for primary, "lock-{id}" for locked
      source: "auto" | "manual" | "locked";
      lockId: number | null;          // DB id when source === "locked"
      result: FibonacciResult;
      colorIndex: number;             // Stable color assignment
    }
    ```
  - New state:
    ```ts
    activeFibs: ActiveFib[]        // Ordered: index 0 = primary, rest = locked in lock order
    ```
  - Actions:
    ```ts
    setPrimaryFib: (result: FibonacciResult | null) => void   // sets/replaces activeFibs[0]
    addLockedFib: (lockedFib: LockedFibonacciResponse) => void
    removeActiveFib: (id: string) => void
    clearAllActiveFibs: () => void
    ```
  - Color palette constant:
    ```ts
    export const FIB_COLOR_PALETTE = [
      { primary: "gold", secondary: "cyan", extension: "purple" },   // index 0 = primary, current colors
      { primary: "teal", secondary: "teal-dim", extension: "teal-dark" },
      { primary: "salmon", secondary: "salmon-dim", extension: "salmon-dark" },
      { primary: "lavender", secondary: "lavender-dim", extension: "lavender-dark" },
      { primary: "sage", secondary: "sage-dim", extension: "sage-dark" },
      { primary: "amber", secondary: "amber-dim", extension: "amber-dark" },
      { primary: "rose", secondary: "rose-dim", extension: "rose-dark" },
      { primary: "sky", secondary: "sky-dim", extension: "sky-dark" },
    ];
    ```
  - Soft warning when `activeFibs.length >= 5` — UI shows a yellow notice.
  - Hard cap: `addLockedFib` is a no-op when `activeFibs.length >= 8`, with toast "Max 8 fibs on chart".

- `src/hooks/useChartData.ts`
  - When backend returns a `FibonacciResult` (and not `no_active_fib`), call `setPrimaryFib(result)`. When `no_active_fib === true` or fib indicator is off, call `setPrimaryFib(null)`.

- `src/hooks/useLockedFibs.ts`
  - In `useLockedFibs(conid)`, on `onSuccess` callback (or via `useEffect` watching the query data): merge locked fibs into `activeFibs` via `addLockedFib`. Dedupe by `lockId`.
  - In `useUnlockFib` mutation, on `onSuccess`: call `removeActiveFib("lock-" + id)`.

- `src/components/charts/FibonacciOverlay.ts`
  - Refactor signature:
    ```ts
    export function addFibonacciOverlays(
      chart: IChartApi,
      fibs: ActiveFib[],
      candles: { time: number }[],
    ): FibOverlayState
    ```
  - For each `ActiveFib`, render its levels using a color palette indexed by `fib.colorIndex`. Primary (index 0) renders at full opacity; locked fibs at 0.45× opacity to keep the primary salient.
  - Each level label now includes the fib's position in the stack: e.g. `"0.618 (P)"` for primary, `"0.618 (L2)"` for the 2nd locked fib.

- `src/components/charts/ChartContainer.tsx`
  - Replace single-fib effect with: `addFibonacciOverlays(chart, activeFibs, candles)` watching `activeFibs` (from store) instead of the prop.
  - Remove the `fibonacci` prop from `ChartContainer` (now sourced from store).

- `src/components/ai/FibScoreCard.tsx` → rename to `src/components/ai/fib/FibStackPanel.tsx`
  - Top: count badge `Fibs on chart: {n}` with soft-warning state at n >= 5.
  - List, one card per `ActiveFib`:
    - Color swatch matching the chart palette.
    - Source label: "Auto", "Manual", or "Locked".
    - Swing range `$low → $high`.
    - Status chip (from Item 1).
    - Delete button (× icon). For `source === "auto"`: dismisses (sets `fibCleared`). For `source === "locked"`: calls `useUnlockFib`. For `source === "manual"`: removes from store (no DB call needed since manual fibs that weren't locked aren't persisted).
  - Primary card (index 0) expanded by default: shows the full FibScoreBreakdown, glossary, Candidates list.
  - Other cards collapsed by default: click to expand.
  - "Lock this fib" button on the primary card (decision 8A) — calls `useLockFib` with the current primary's swing data. After lock, the auto fib becomes locked fib #1 in the stack; auto detection runs again on next data refresh.

- `src/components/charts/FibDrawMode.tsx`
  - On successful lock from manual draw, no change needed — `useLockedFibs` query invalidation propagates through `addLockedFib` automatically.

- Tests:
  - `src/store/__tests__/chart.test.ts` — active fib actions, color index assignment, soft/hard cap behavior.
  - `src/components/ai/fib/__tests__/FibStackPanel.test.tsx` — count badge, delete buttons per source type, primary expand/collapse.
  - `src/components/charts/__tests__/FibonacciOverlay.test.tsx` — multiple fibs render with distinct colors and label suffixes.

**Backend changes:** None for this branch. Existing lock endpoints already support the workflow.

---

### Branch 5: `feat/ai-uses-active-fib-state`

**Goal:** AI analysis sees the exact fibs the user has on the chart, not the backend's default auto-detection.

**Backend changes:**

- `backend/models/__init__.py`
  - New model:
    ```python
    class FibonacciSnapshot(BaseModel):
        source: Literal["auto", "manual", "locked"]
        swing_high: float
        swing_low: float
        swing_high_time: int
        swing_low_time: int
        direction: Literal["up", "down"]
        score: Optional[float] = None
        is_primary: bool = False
        timeframe: Optional[str] = None   # None = universal, set = TF-scoped
        note: Optional[str] = None
    ```
  - Modify `AnalyzeRequest`:
    ```python
    fibs: list[FibonacciSnapshot] = Field(default_factory=list,
        description="User's active fibs on the chart. When non-empty, these override server-side auto-detection for AI prompting.")
    ```

- `backend/services/prompt_builder.py`
  - Rename `_format_fibonacci(fib)` → `_format_fibs(snapshots: list[FibonacciSnapshot], current_price: float)`.
  - Renders: primary first ("Primary fib"), then locked ("Locked fib #2", "Locked fib #3", …).
  - Each snapshot block: source, swing range, direction, score (if provided), key levels (computed via `_build_levels`).
  - When `snapshots` is empty, fall back to existing single-fib formatter for backwards compatibility.

- `backend/routers/ai.py`
  - In `_fetch_timeframe_data`:
    - Filter `snapshots` to those where `tf is None or tf == timeframe`.
    - If any TF-relevant snapshots exist → use them, skip `_compute_fibonacci` for this TF.
    - If none → existing behavior (compute auto-fib).
  - In the analyze handler, pass the filtered snapshots into `prompt_builder.build_prompt(..., fibs=tf_snapshots, ...)`.

- `backend/tests/test_chart_context.py` and/or new `backend/tests/test_ai_with_fibs.py`:
  - `test_analyze_request_accepts_fibs_field`
  - `test_prompt_includes_primary_and_locked_fibs_in_order`
  - `test_fib_with_timeframe_only_injected_into_matching_tf`
  - `test_empty_fibs_falls_back_to_auto_compute`

**Frontend changes:**

- `src/lib/api.ts`
  - Add `FibonacciSnapshot` type. Add `fibs?: FibonacciSnapshot[]` to `AnalyzeRequest`.

- `src/hooks/useAiAnalyzeStream.ts`
  - In `startAnalyze`, before POSTing, read `activeFibs` from `useChartStore`. Serialize each to `FibonacciSnapshot`. `is_primary: source === "auto" || source === "manual" && index === 0`. `timeframe: null` (universal — locked fibs always universal per decision 8C; primary tied to currently-viewed TF but we don't restrict).
  - Add `fibs` field to the POST body.

- Tests:
  - `src/hooks/__tests__/useAiAnalyzeStream.test.ts` — when activeFibs is non-empty, the POST body carries them; each snapshot has the correct `source`, `is_primary`, etc.

---

### Branch 6: `fix/fib-line-styling`

**Goal:** All retracement levels match GP weight/font. Boundary lines (0 and 1.0) get a distinct magenta color.

**Frontend changes:**

- `src/components/charts/FibonacciOverlay.ts`
  - Update `FIB_COLORS`:
    ```ts
    const FIB_COLORS = {
      retracement: "rgba(0, 212, 255, 0.85)",          // cyan, bumped opacity for visibility
      goldenPocket: "rgba(255, 200, 0, 0.85)",
      extension: "rgba(136, 68, 255, 0.55)",            // unchanged
      swingBound: "rgba(255, 60, 220, 0.85)",          // magenta — new (decision 2A)
    } as const;
    ```
  - Update `addLevelLine`:
    - Remove the "boundary uses dim white + dotted" branch.
    - `isBoundary` (level === 0 || level === 1.0): `color = swingBound`, `lineWidth = 2`, `lineStyle = 0` (solid).
    - Other retracement levels (including GP): `lineWidth = 2`, `lineStyle = 0` (solid) — uniform with GP weight. Color stays per-type (GP gold vs non-GP cyan).
    - Extensions: unchanged (`lineWidth = 1`, `lineStyle = 2` dashed, purple).
  - For locked fibs (Item 8 already shipped at this point), multiply opacity by 0.55 in the color string for non-primary fibs.

- `src/components/charts/FibDrawMode.tsx`
  - Ghost preview should mirror the new styling: solid lines, weight 2, GP gold for 0.618/0.65/0.716, magenta for 0 and 1.0, cyan for others.

- Tests:
  - `src/components/charts/__tests__/FibonacciOverlay.test.tsx` — extend existing tests to assert the new color values, line widths, and styles. Snapshot the rendered series options for each ratio.

---

### Branch 7: `fix/reset-on-ticker-change`

**Goal:** Changing the active conid resets all chart state: indicators off, fibs cleared, AI chat cleared, draw mode exited, timeframe to default.

**Frontend changes:**

- `src/store/chart.ts`
  - Modify `setActiveConid`:
    ```ts
    setActiveConid: (conid) => set((state) => {
      // Idempotency: same conid → no-op
      if (state.activeConid === conid) return {};
      return {
        activeConid: conid,
        activeSymbol: "",                          // resolved separately by setActiveSymbol
        timeframe: "1D",                           // decision 10A
        activeIndicators: new Set<IndicatorId>(),
        fibDrawMode: null,
        fibDrawPointA: null,
        displayedFibOverride: null,
        fibCleared: false,
        activeFibs: [],                            // decision 10B
      };
    }),
    ```

- `src/store/index.ts` (AI store)
  - Already has `clearChat`. No change needed.

- `src/pages/AnalysisPage.tsx`
  - Existing `prevConidRef` effect calls `clearAiChat()` on conid change. Verify it still fires after the store change. Keep this logic OR move it into the chart store's `setActiveConid` action via cross-store coordination.
  - Cleaner option: in `setActiveConid`, dispatch an event listened to by both stores. But for v1, keep the existing pattern (effect in `AnalysisPage.tsx`).

- `src/store/__tests__/chart.test.ts` — new tests:
  - `setActiveConid(NEW)` resets all relevant fields.
  - `setActiveConid(SAME)` is idempotent (no-op).
  - `activeFibs` cleared on conid change.

- `src/pages/__tests__/AnalysisPage.test.tsx` — assert AI chat clears on conid change.

---

### Branch 8: `feat/ai-analysis-copy`

**Goal:** One-click copy icon on AI assistant messages.

**Frontend changes:**

- `src/components/ai/AiChatPanel.tsx`
  - `ChatBubble` component:
    - Add hover-revealed copy button in top-right corner for assistant bubbles.
    - State: `const [copied, setCopied] = useState(false);`
    - On click: `navigator.clipboard.writeText(msg.content)`, `setCopied(true)`, `setTimeout(() => setCopied(false), 1500)`.
    - Icon: `Copy` from `lucide-react` (already a project dependency). When `copied`, show `Check` icon.

  - Optional: "Copy full analysis" button at the top of the assistant's first message in a session that copies the signal card (formatted) + the narrative.

- Tests:
  - `src/components/ai/__tests__/AiChatPanel.test.tsx` — mock `navigator.clipboard`, simulate copy click, assert clipboard was called with the message content; icon swaps to checkmark.

---

### Branch 9: `feat/chart-drawing-tools` (DEFERRED — multi-PR feature)

**Goal:** TradingView-style drawing tools. Lines, trendlines, rectangles, triangles, etc. Individually selectable and deletable. Visible across all timeframes for the conid (decision 5B).

**Approach:** Prefer a community Lightweight Charts plugin (decision 5A). Research first:

- Candidates to evaluate:
  - `@trading-vue-js/lightweight-charts` style plugins.
  - `lightweight-charts-drawing-tools` (search npm + GitHub).
  - Lightweight Charts v5 has official drawing-tools docs and plugin examples — review first: https://tradingview.github.io/lightweight-charts/plugin-examples.
- Evaluation criteria:
  - Active maintenance (recent commits within 6 months).
  - Compatible with Lightweight Charts v5 (the version we use).
  - License compatible with our app (MIT or similar permissive).
  - Customizable styling to match our design system (CSS variables).
  - Programmatic API for save/load (we need to persist drawings to SQLite).
- Decision point: if no acceptable plugin → fall back to in-house build (trendline, horizontal line, rectangle only).

**Sketched phases (to be detailed when scheduled):**

- Phase A — Backend: `chart_drawings` table, CRUD endpoints.
- Phase B — Frontend: drawing modes in store, toolbar, click-capture, rendering layer.
- Phase C — Selection + delete UI.

Detailed plan to be written when this branch is scheduled.

---

## Plain English Plan (human-readable)

> No file paths. No code. What we're fixing and what you'll see when it's done.

### 1. Fix the auto-fib so it picks ranges you can actually trade

**What's wrong now.** The system often draws fibs on swings that have already played out — price has already moved past the 1.0 line. It feels like the algorithm is searching for take-profit zones rather than entry zones.

**What we're changing.** The primary fib will only ever be drawn on a swing that price is currently inside. We allow a small tolerance (15% of the swing range) so a wick poking out doesn't kick the fib out. Swings price has already exited will still appear in the Candidates panel on the right — they're useful context, just not the primary choice.

**Edge case.** Sometimes there is no swing price is currently inside. When that happens, instead of forcing a stale fib onto the chart, the system will say so explicitly ("no entry-quality fib on this timeframe") and you can pick a historical candidate from the panel if you want to study one.

**What you'll see.** The auto fib on the chart will reflect where price actually is, not where it was. Candidates panel gets a status chip per row: active (green), played out (gray), broken (red).

---

### 2. Reorder the right panel and disable Run Analysis while it's running

**What's wrong now.** When you run an AI analysis with fib enabled, the panel shows: Run button → analysis signal → Fib score → AI narrative. The Fib block interrupts the AI topic.

**What we're changing.** The Fib section moves to the bottom of the panel. Order becomes: Run button → signal → AI narrative → Fib stack. Each topic plays out start-to-finish before the next begins. Also: the Run Analysis button is disabled while a run is in flight; you can still cancel via the existing button in the loading row.

**What you'll see.** Calmer reading flow. The Run button visibly greys out while waiting so you don't accidentally trigger another run.

---

### 3 & 4. Fib score card overhaul — glossary, editable weights, click-to-load candidates

**What's wrong now.** The Fib score is a single number with a short reasoning line. You can't see what each factor contributed. You can't change how the algorithm weights them. You can't click a candidate to render it on the chart.

**What we're changing.**

- Every factor in the score gets a labelled row with a `?` tooltip explaining what it measures. The score breakdown becomes a collapsible "How is this calculated?" block that plugs in the actual numbers from your current fib.
- Each factor's weight is editable. Type a new number, hit save, and the system recalculates scores with your weights. There's a "Reset to defaults" button if you want to go back.
- Clicking a candidate in the panel renders it on the chart instead of the auto-detected primary. You can flip through candidates the way you'd flip through pages.
- A "Clear chart fib" button removes whatever's on the chart while keeping the fib indicator on and the panel open, so you can pick a different one.

**What you'll see.** A much richer Fib panel. You'll understand exactly why the algorithm chose what it chose, and you can override it without leaving the panel.

**Note on editable weights.** The v2 roadmap has the system *learning* its own weights from how price actually behaves over time. When that lands, you'll need to choose whether to use your manual weights or the learned ones. We're flagging this now so the design has room for that mode toggle later.

---

### 5. Lock-fib feature — multiple fibs at once

**What's wrong now.** The code already has the bones of a locking feature but it was never wired up. You can draw a fib, but it disappears immediately because nothing renders the saved version. Locking is supposed to let you keep multiple fibs visible simultaneously (e.g., a weekly fib and a daily fib at the same time).

**What we're changing.**

- The chart can show up to 8 fibs at once, with a yellow warning once you cross 5.
- Each fib gets its own color from a palette so you can tell them apart. The primary (currently active) fib is at full brightness; locked fibs are slightly dimmer so the primary stays salient.
- Each level on the chart is labelled with which fib it belongs to (P for primary, L1/L2/L3 for locked).
- The Fib panel on the right shows a stack: primary on top with its full score breakdown, locked fibs below in compact cards. Each card has a delete button.
- A "Lock this fib" button on the primary card lets you pin the auto-detected fib as a permanent reference. After locking, the algorithm finds the next-best primary candidate.
- Locked fibs persist across app restarts (already stored in the database) and show on every timeframe for the same instrument.

**What you'll see.** When you draw a fib manually it stays on the chart. You can stack multiple fibs from different timeframes and compare. A count in the panel header tells you how many are active.

---

### 6. AI uses what's actually on the chart

**What's wrong now.** When you click Run Analysis, the AI receives the backend's auto-detected fib — regardless of which fib you actually have on the chart. If you've clicked a different candidate, drawn your own, or locked several fibs, the AI doesn't know.

**What we're changing.** The Run Analysis request now includes a snapshot of every fib currently on the chart (primary + all locked). The AI's prompt is built from those snapshots. If you've cleared the fib, no fib is sent (and the prompt just doesn't mention fibs).

**What you'll see.** The AI's reasoning will reference the specific levels you're looking at, not a system default. If you flipped to a different candidate before running analysis, the analysis is about that candidate.

---

### 7. Fib line styling — make extension mode readable

**What's wrong now.** When the fib is extended, the lines for the golden pocket and extension targets all look different from each other and from the boundary lines. The 0 and 1.0 boundary lines are dim white dotted — easy to lose.

**What we're changing.**

- All retracement levels (0.382, 0.5, 0.618, 0.65, 0.716) use the same line weight and solid style as the golden pocket. Color still distinguishes GP from non-GP.
- The 0 and 1.0 boundary lines become magenta — bright and impossible to confuse with the candle colors (green/red).
- Extension lines keep their current dashed purple styling.

**What you'll see.** A more readable fib drawing. Boundaries pop. Retracement levels are visually unified. No more dim dotted lines.

---

### 8. Reset everything on ticker change

**What's wrong now.** Switching to a new ticker keeps your indicator toggles, your fib state, your AI chat, your timeframe — all from the previous name. That's surprising and the carried-over state often makes no sense for the new instrument.

**What we're changing.** Any new instrument resets the chart to a clean state: all indicators off, fibs cleared, AI chat cleared, draw mode exited, timeframe set back to 1D. Locked fibs for the new instrument get loaded fresh (they live in the database per instrument anyway).

**What you'll see.** Switching tickers feels like starting fresh. You opt back into the indicators you want for that specific stock.

---

### 9. Copy AI analysis

**What's wrong now.** There's no copy button on the AI's output. You have to manually select and copy text.

**What we're changing.** Hovering on any AI assistant message reveals a copy icon in the top-right corner. One click copies the message text to clipboard. The icon briefly turns into a checkmark to confirm.

**What you'll see.** One-click copy of any AI message.

---

### 10. Drawing tools (deferred)

**What we're planning.** A toolbox for drawing horizontal lines, trendlines, rectangles, and triangles on the chart. Each drawing is selectable and individually deletable. Drawings are saved per instrument and show on every timeframe (so a weekly trendline is also visible on the daily chart).

**Why we're deferring.** This is the biggest item by far and unrelated to the fib correctness fixes. We'll learn what we actually want from drawing tools after the other improvements change your workflow. We'll also research community Lightweight Charts plugins first — building from scratch is the fallback.

**No timeline for this branch yet.** We'll scope it as a separate planning session when the other branches are merged.

---

## Cross-Cutting Concerns

### Pandas vs Polars

`backend/services/indicators.py` currently uses `pandas`. Project rule 2 says all dataframe operations should use Polars (pandas-ta is the only exception, bridged). This is a pre-existing rule violation, not introduced by these changes.

**Recommendation:** Out of scope for these branches. File a separate refactor PR (`refactor/indicators-pandas-to-polars`) that converts `IndicatorService` to Polars. Should land before v2 learning algorithm work begins.

### Typed errors

Per project rule 4, all new error paths in this plan must use typed exceptions:

- `backend/routers/fibonacci.py` → use `InvalidFibWeightsError` (new, defined in Branch 3) for malformed config payloads.
- AI analyze errors → use existing typed errors from `backend/errors.py`.

### conid universal key

Every new endpoint, table, and API contract in this plan uses `conid` as the instrument key. No ticker strings in storage. (Already followed by `fibonacci_locks` and `fib_settings`.)

### Test coverage

Per project rule 1, every branch above lists the test files and cases that must be added or extended. No branch may be merged without its tests.

---

## Git Command Reference

> Ben runs all git commands. Claude lists them and writes the code.

### Per branch — at the start

```bash
git checkout main
git pull origin main
git checkout -b <branch-name>
```

### Per branch — at the end (commit suggestion)

Per Ben's preference (memory: detailed multi-line commit messages), commits should be structured:

```bash
git status                                 # review changed files
git diff                                   # review the diff
git add <files>
git commit                                 # opens editor for multi-line message
```

Commit message template:

```
<type>(<scope>): <short summary>

<paragraph explaining what changed and why>

Files changed:
- <file 1> — <one-line reason>
- <file 2> — <one-line reason>

Tests:
- <test file 1> — <what's covered>
- <test file 2> — <what's covered>

Refs: <plan item ID from this doc, e.g. "Item 1, Branch 1">
```

### Per branch — push & PR

```bash
git push -u origin <branch-name>
# Open PR via web UI; reference the branch's item from this plan in the PR description
```

### Branch order — recommended merge sequence

1. `fix/fib-primary-range-selection`
2. `fix/right-panel-order-and-runbutton`
3. `feat/fib-score-card-overhaul`
4. `feat/active-fib-state-and-lock`
5. `feat/ai-uses-active-fib-state`
6. `fix/fib-line-styling`
7. `fix/reset-on-ticker-change`
8. `feat/ai-analysis-copy`
9. `feat/chart-drawing-tools` (separate planning session)

### Cleanup after merge

```bash
git checkout main
git pull origin main
git branch -d <merged-branch-name>
git push origin --delete <merged-branch-name>   # optional, if remote branch should be removed
```

---

## Document History

- 2026-05-11 — Initial plan written after a planning session with Ben. All 20+ open decisions resolved before drafting.
