# Fibonacci Swing Selection — Design

**Date:** 2026-06-20
**Scope:** `backend/services/indicators.py` (`IndicatorService._score_swing`,
`_compute_fibonacci`). Public contracts `FibonacciResult` / `FibonacciCandidate`
unchanged.

## Problem

The auto-detected primary fib selects stale and contextually-wrong swings:

1. **Stale swings stay eligible.** `INSIDE_TOLERANCE = 0.15` widens the active
   band and status is decided on closes, so a months-old swing price drifts
   inside never leaves `"active"` and keeps winning.
2. **Historical touches beat recency.** `multi_touch` (0.25) > `recency` (0.15),
   so the largest historically-validated swing outranks the currently-relevant
   one.
3. **`stretched_penalty` only rewards the golden pocket.** It measures distance
   to the GP center only, so a swing price is actively trading inside at 0.382 /
   0.5 scores low and loses to a wrong swing whose GP aligns with price.

## Solution

All changes inside `_score_swing` / `_compute_fibonacci`; no contract change.

### 1. Strict wick-based status (remove `INSIDE_TOLERANCE`)

Delete the constant. Classify on post-swing **wicks**, no buffer, no closes.
`played_out` takes precedence over `broken`.

- Up swing: any post `high > swing_high` → `played_out`; any post `low <
  swing_low` → `broken`.
- Down swing: any post `low < swing_low` → `played_out`; any post `high >
  swing_high` → `broken`.
- Current-bar fallback (empty/short `post`): use `df["high"].iloc[-1]` /
  `df["low"].iloc[-1]`, same rules. Never use closes.

Swing anchors are already wick extremes (`high.iloc[hi_idx]` /
`low.iloc[lo_idx]`) — confirmed, not overridden.

### 2. `stretched_penalty` rewards any active internal level

`stretched_penalty = max over internal levels of (proximity_decay × importance)`.

```
LEVEL_IMPORTANCE = {0.382: 0.50, 0.5: 0.85, 0.618: 1.0, 0.65: 1.0, 0.716: 1.0}
LEVEL_TOLERANCE = 0.02   # within 2% of range → full proximity
LEVEL_DECAY     = 0.18   # ~0 at midpoint of the widest internal gap
```

For each internal level price `lp`, `rel_dist = |current_price - lp| / range`;
`prox = 1.0` if `rel_dist <= LEVEL_TOLERANCE` else
`max(0, 1 - (rel_dist - LEVEL_TOLERANCE)/LEVEL_DECAY)`. The 0.0 / 1.0 anchors are
excluded — proximity to a swing edge is not an entry signal (status handles
invalidation). GP → 1.0, 0.5 → 0.85, 0.382 → 0.50.

### 3. Rebalance weights

| factor | old | new |
|---|---|---|
| swing_clarity | 0.25 | 0.25 |
| recency | 0.15 | **0.35** |
| multi_touch | 0.25 | **0.10** |
| rejection_intensity | 0.20 | **0.15** |
| stretched_penalty | 0.15 | 0.15 |

Sum 1.00 (passes `_validate_and_normalize_weights`). A swing in the last 20% of
history (`recency ≥ 0.8`) beats an old swing (`recency ≈ 0.3`) with maxed touches:
recency edge `+17.5` vs touch edge `+10` → recent wins by ~7.5 pts worst case.

## Out of scope

- No change to `FibonacciResult` / `FibonacciCandidate` fields.
- No new dependencies; stdlib + pandas only. `MAX_CANDIDATES = 6` stays.
- No autonomous trading logic.
- Cross-TF convergence, nesting, extension levels untouched.

## Verification

Per `docs/testing.md`. Existing tolerance-band tests
(`test_tolerance_band_keeps_swing_active_on_wick_poke`,
`test_tolerance_band_excludes_swing_on_decisive_break`) and the
`INSIDE_TOLERANCE` import in `test_fibonacci.py` encode the removed promise —
delete them and add **one** test for the new critical promise: a swing whose
post-swing wick crosses a boundary is `played_out`/`broken`, not `active`.

## Policy impact

None. Pure scoring-heuristic change behind the existing FastAPI boundary;
no module ownership, trading-safety, contract, or local/cloud shift. Reword
`FibonacciCandidate` / `no_active_fib` docstrings in `backend/models/__init__.py`
that reference the removed tolerance band.
