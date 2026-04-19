# Screener redesign — handoff spec

Purpose: rewire the scanner page around IBKR-validated filter codes, make filter discovery easy for a casual user, split presets into *popular* vs *niche*, and re-point Ollama at the same canonical catalogue. Audit done against the raw `/iserver/scanner/params` dump — see "Canonical filter list" and "Canonical preset list" sections below.

This doc is written to be handed to another LLM. The implementing LLM should read CLAUDE.md, `.claude/skills/parallax-frontend`, and `.claude/skills/parallax-backend` **before starting**. Key rules that matter here: (a) Polars only, (b) tests for every feature, (c) typed errors only, (d) all IBKR access through the FastAPI sidecar, (e) `conid` is the universal key, (f) new branch per feature.

---

## 1. Decisions Ben needs to lock before handoff

Each of these has a default. Ben can accept the default or change it — note the choice inline before passing this file to the next LLM.

- **D1 — Filter catalogue source of truth.** Default: move `FILTER_CATALOGUE` to `backend/constants/ibkr_filters.py`, exposed over `GET /screener/filter-catalogue`. Frontend fetches once per session via TanStack Query, hydrates the filter bar. Ollama reads the same Python dict. **→ Alternative:** keep two catalogues (UI + AI) but import from a shared JSON file in `/shared`. Pick one.
- **D2 — "Volume ≤ X" filter.** IBKR has no `volumeBelow`. Default: drop the Below direction entirely on Volume. **→ Alternative:** remap the filter label to "Avg Volume" and use `avgVolumeAbove` / `avgVolumeBelow` (these exist).
- **D3 — "Earnings within N days" filter.** IBKR uses `nextEarningsDateTimeAbove/Below` with a full datetime, not "days". Default: drop the filter for now (marked TODO); add back once we have a date-picker component. **→ Alternative:** keep it, next LLM converts `N days` to an ISO datetime `now + Nd` on submit.
- **D4 — Range inputs.** Default: keep current model (two pills — "Market Cap ≥ 1000" + "Market Cap ≤ 5000"). **→ Alternative:** collapse both directions into one "range" pill with two inputs (`min — max`). Nicer UX but more work (store shape, AI output shape, and test churn).
- **D5 — Primary-filter quick buttons.** Default: render 5 "one-click" filters (Market Cap, Price, Volume, Change %, P/E) as always-visible chips on the filter bar, clicking them opens the value popover instantly. Everything else behind "More filters ▾". **→ Alternative:** keep the current category dropdown for everything, no quick buttons.
- **D6 — Preset grouping.** Default (Ben's suggestion): two sections in the preset dropdown — "Popular" (always expanded) and "More screens" (collapsed). **→ Alternative:** single flat list with a "★ popular" marker next to names.
- **D7 — Drop or keep Ownership filters.** IBKR codes exist (`ihInsiderOfFloatPercAbove`, `iiInstitutionalOfFloatPercAbove`) but the data is stale/sparse on many mid-caps. Default: keep them, label "may be unavailable on some instruments". **→ Alternative:** drop the entire "Short Interest & Ownership" category until we verify coverage.
- **D8 — IV Rank period.** IBKR has `ivRank13w / 26w / 52w`. Default: surface `ivRank52wAbove/Below` only (matches what the label already says). **→ Alternative:** surface all three as separate filters.

---

## 2. Canonical filter list (post-audit)

Every code below has been grep-verified against the raw `scanner/params` dump Ben pasted. Drop everything not in this table.

### Fundamental

| Label | Above code | Below code | Unit | Notes |
|---|---|---|---|---|
| Market Cap | `marketCapAbove1e6` | `marketCapBelow1e6` | $M | — |
| P/E Ratio | `minPeRatio` | `maxPeRatio` | — | — |
| ROE | `minRetnOnEq` | `maxRetnOnEq` | % | was `minROE`/`maxROE` — wrong |
| Operating Margin TTM | `operatingMarginTTMAbove` | `operatingMarginTTMBelow` | % | was `minOperatingMargin` |
| Net Margin TTM | `netProfitMarginTTMAbove` | `netProfitMarginTTMBelow` | % | was `minNetMargin` |
| Revenue Chg TTM | `revChangeAbove` | `revChangeBelow` | % | was `minRevenueChangePercentTTM` |
| Revenue Growth 5Y | `revGrowthRate5YAbove` | `revGrowthRate5YBelow` | % | was `minRevenuePctChange5Y` |
| EPS Chg TTM | `epsChangeTTMAbove` | `epsChangeTTMBelow` | % | was `minEpsChangePercent` |
| Price/Book | `minPrice2Bk` | `maxPrice2Bk` | — | was `minPriceBook` |
| Quick Ratio | `minQuickRatio` | `maxQuickRatio` | — | — |

### Technical

| Label | Above code | Below code | Unit | Notes |
|---|---|---|---|---|
| Price | `priceAbove` | `priceBelow` | $ | — |
| Day Change % | `changePercAbove` | `changePercBelow` | % | — |
| Volume | `volumeAbove` | *(none)* | — | see D2 |
| Price vs EMA(20) | `lastVsEMAChangeRatio20Above` | `lastVsEMAChangeRatio20Below` | % | was `priceVsEMA20Above` |
| Price vs EMA(50) | `lastVsEMAChangeRatio50Above` | `lastVsEMAChangeRatio50Below` | % | was `priceVsEMA50Above` |
| Price vs EMA(100) | `lastVsEMAChangeRatio100Above` | `lastVsEMAChangeRatio100Below` | % | *new — worth adding* |
| Price vs EMA(200) | `lastVsEMAChangeRatio200Above` | `lastVsEMAChangeRatio200Below` | % | was `priceVsEMA200Above` |
| MACD Histogram | `curMACDDistAbove` | `curMACDDistBelow` | — | was `macdHistAbove` |
| IV Rank 52W | `ivRank52wAbove` | `ivRank52wBelow` | % | was `ivRankAbove` |

### Analyst

| Label | Above code | Below code | Unit | Notes |
|---|---|---|---|---|
| Avg Rating | `avgRatingAbove` | `avgRatingBelow` | — | 1=Strong Buy, 5=Strong Sell |
| # Analyst Ratings | `numRatingsAbove` | `numRatingsBelow` | — | — |
| Avg Price Target | `avgPriceTargetAbove` | `avgPriceTargetBelow` | $ | was `avgTargetPriceAbove` |
| Target / Price Ratio | `avgAnalystTarget2PriceRatioAbove` | `avgAnalystTarget2PriceRatioBelow` | — | was `targetPriceRatioAbove` |

### Short Interest & Ownership *(see D7)*

| Label | Above code | Below code | Unit | Notes |
|---|---|---|---|---|
| Short Utilization | `utilizationAbove` | `utilizationBelow` | % | was `shortableSharesAbove` |
| Borrow Fee Rate | `feeRateAbove` | `feeRateBelow` | % | was `rebateRateAbove` |
| Insider % of Float | `ihInsiderOfFloatPercAbove` | `ihInsiderOfFloatPercBelow` | % | was `insiderOwnershipAbove` |
| Institutional % of Float | `iiInstitutionalOfFloatPercAbove` | `iiInstitutionalOfFloatPercBelow` | % | was `institutionalOwnershipAbove` |

### Remove entirely

- **`wshEarningsDate`** — wrong code + wrong input type. See D3.
- **`volumeBelow`** — does not exist. See D2.

---

## 3. Canonical preset list

All existing 8 presets use valid scan types. Proposed grouping (D6):

### Popular (always visible)

1. Most Active — US Stocks (`MOST_ACTIVE` / `STK.US.MAJOR`) *(keep)*
2. Top % Gainers — US Stocks (`TOP_PERC_GAIN` / `STK.US.MAJOR`) *(keep)*
3. Top % Losers — US Stocks (`TOP_PERC_LOSE` / `STK.US.MAJOR`) *(keep)*
4. Hot by Volume — US Stocks (`HOT_BY_VOLUME` / `STK.US.MAJOR`) *(keep)*
5. 52-Week Highs — US Stocks (`HIGH_VS_52W_HL` / `STK.US.MAJOR`) *(keep)*
6. 52-Week Lows — US Stocks (`LOW_VS_52W_HL` / `STK.US.MAJOR`) *(keep)*

### More screens (collapsed by default)

7. Top % Gainers — US Small Cap (`TOP_PERC_GAIN` / `STK.US.MINOR`) *(keep)*
8. Most Active — US Equity ETFs (`MOST_ACTIVE` / `ETF.EQ.US.MAJOR`) *(keep)*
9. Pre-Market Gainers (`TOP_OPEN_PERC_GAIN` / `STK.US.MAJOR`) *(new)*
10. Pre-Market Losers (`TOP_OPEN_PERC_LOSE` / `STK.US.MAJOR`) *(new)*
11. 13-Week Highs (`HIGH_VS_13W_HL` / `STK.US.MAJOR`) *(new)*
12. 13-Week Lows (`LOW_VS_13W_HL` / `STK.US.MAJOR`) *(new)*
13. High Dividend Yield (`HIGH_DIVIDEND_YIELD_IB` / `STK.US.MAJOR`) *(new)*
14. High Implied Vol (`HIGH_OPT_IMP_VOLAT` / `STK.US.MAJOR`) *(new, IV-focused)*
15. Top Options Volume (`OPT_VOLUME_MOST_ACTIVE` / `STK.US.MAJOR`) *(new, options flow)*
16. High Growth Rate (`HIGH_GROWTH_RATE` / `STK.US.MAJOR`) *(new, fundamentals screen)*

**Shape change:** add `category: "popular" | "niche"` to `ScannerPreset` and to the dropdown group renderer.

---

## 4. UX redesign

Goals, in priority order: (1) a first-time user should be able to run a useful screen in under 10 seconds; (2) adding a filter should be a two-click operation; (3) the user should never be able to add a filter that IBKR will reject.

### 4a. Filter bar layout (D5 default)

```
[Preset ▾]  |  ⚡ Market Cap  $ Price  # Volume  % Change  P/E   + More filters ▾  |  [filter pills]  Clear  ...  ✦ AI  [Scan]
```

- **Quick-pick chips** (the 5 always-visible): clicking opens a tiny popover `(≥ | ≤)  [input]  Add`. Two clicks → pill added.
- **More filters ▾** opens the current category > filter > value flow (unchanged), but populated from the canonical list.
- **Pill editing:** clicking an existing pill body re-opens the popover pre-filled so the user can tweak the value without remove+re-add.
- **Tooltips on every filter** in the "More filters" menu — short natural-language description, e.g. "P/E Ratio — price divided by earnings. Value stocks < 15."
- The amber-pulse "dirty" indicator on Scan stays.

### 4b. Preset dropdown (D6 default)

Replace the plain `<select>` with a grouped combobox (shadcn `Command` or a lightweight custom dropdown):

```
┌───────────────────────────────┐
│ Search…                       │
├─ Popular ─────────────────────┤
│ Most Active — US Stocks       │
│ Top % Gainers                 │
│ …                             │
├─ More screens ────────────────┤
│ Pre-Market Gainers            │
│ High Dividend Yield           │
│ …                             │
└───────────────────────────────┘
```

- "More screens" section collapsed by default; click to expand.
- Searchable (typing filters both sections).
- Keyboard-navigable.

### 4c. Help-surface for the casual user

- In the empty state of the results table, show 3–4 cards: "Try: Top Gainers + Market Cap ≥ $10B", "Try: 52-Week Highs + Volume ≥ 1M", etc. Click → auto-applies preset + filters.
- The AI panel (`✦ AI` button) stays where it is; after this rewire, it actually works. Put 4–5 sample prompts inside the panel as clickable chips: *"oversold large caps"*, *"high momentum small caps"*, *"value stocks with improving margins"*, *"stocks with earnings this week"* (only if D3 is kept), *"short squeeze candidates"*.

---

## 5. Ollama rewire

### 5a. Single source of truth

Delete the duplicated `FILTER_CATALOGUE` from `backend/services/screener_ai.py`. Import from `backend/constants/ibkr_filters.py` instead. Both the AI prompt and the UI (via the new endpoint) read the same list.

### 5b. Catalogue schema (Python)

```python
# backend/constants/ibkr_filters.py

class FilterEntry(TypedDict):
    code: str              # IBKR filter code (verified valid)
    label: str             # human label
    direction: Literal["above", "below"]
    unit: str | None       # "$M", "%", "$", None
    example: str           # sample value for Ollama prompts
    category: Literal["fundamental", "technical", "analyst", "short_ownership"]
    popular: bool          # surface as quick-pick chip in UI (D5)
    notes: str | None      # sent to Ollama only
    paired_code: str       # the opposite-direction code for this filter (or "" if none)

FILTER_CATALOGUE: list[FilterEntry] = [...]   # populated from section 2 above
```

Notes:
- `paired_code` lets the UI render one row per filter with both directions.
- `popular: True` for the 5 quick-pick chips in D5.
- All codes here MUST be copy-pasted from the IBKR params dump, not guessed.

### 5c. AI prompt updates

- Rewrite `_build_catalogue_text()` to pull from the imported `FILTER_CATALOGUE`.
- Rewrite the "sensible trading defaults" block in `SYSTEM_PROMPT` to use **only** valid codes (none of the old broken ones). Suggested defaults:
  - large cap → `marketCapAbove1e6` ≥ 10000
  - mid cap → `marketCapAbove1e6` ≥ 2000 + `marketCapBelow1e6` ≤ 10000
  - small cap → `marketCapAbove1e6` ≥ 300 + `marketCapBelow1e6` ≤ 2000
  - oversold → `lastVsEMAChangeRatio20Below` ≤ -5
  - overbought → `lastVsEMAChangeRatio20Above` ≥ 5
  - momentum → `changePercAbove` ≥ 2 + `volumeAbove` ≥ 1000000
  - value → `maxPeRatio` ≤ 15 + `maxPrice2Bk` ≤ 2
  - growth → `revChangeAbove` ≥ 15 + `epsChangeTTMAbove` ≥ 15
  - high volume → `volumeAbove` ≥ 2000000
  - high IV → `ivRank52wAbove` ≥ 70
  - short squeeze candidate → `utilizationAbove` ≥ 90 + `feeRateAbove` ≥ 10
- Keep the existing validator that drops any code not in `{f["code"] for f in FILTER_CATALOGUE}` — critical now that we're tightening codes.
- Add a log line counting: `total suggested`, `accepted`, `dropped with unknown code` (already exists) + **log each dropped code so we catch prompt drift**.

### 5d. AI panel prompt chips

In `ScreenerAiPanel.tsx`, seed the prompt input with 4–5 example chips (listed in 4c above). Clicking fills the input.

---

## 6. Files to touch

### Backend

- **NEW `backend/constants/ibkr_filters.py`** — canonical `FILTER_CATALOGUE`. Section 2 of this doc is the content.
- **`backend/services/screener_ai.py`**
  - Delete local `FILTER_CATALOGUE` constant.
  - `from constants.ibkr_filters import FILTER_CATALOGUE`.
  - Rewrite `_build_catalogue_text()` — keep format but drop `notes` from lines where it's None.
  - Rewrite the `SYSTEM_PROMPT` rules block (see 5c).
  - Extend the "dropped code" warning log with the actual code strings.
- **`backend/services/screener.py`**
  - Replace `DEFAULT_PRESETS` with section 3's 16 entries including `category` field.
- **`backend/models.py`**
  - Add `category: Literal["popular", "niche"]` to `ScannerPreset`.
  - Add a response model `FilterCatalogueResponse` mirroring `FilterEntry`.
- **`backend/routers/screener.py`** (or wherever screener routes live; grep for `screener_presets`)
  - New endpoint `GET /screener/filter-catalogue` → returns the catalogue (strip `notes`, keep only what the UI needs).
- **`backend/tests/test_screener.py`**
  - Update fixture presets to include `category`.
  - Add test: every code in `FILTER_CATALOGUE` is unique.
  - Add test: `GET /screener/filter-catalogue` returns the expected shape.
- **`backend/tests/test_screener_ai.py`** (may exist; check)
  - Update any hard-coded old codes in fixtures (`minROE`, `macdHistAbove`, etc.) to the new codes.
  - Add test: AI response with an unknown code is dropped with a warning log.

### Frontend

- **`src/lib/api.ts`**
  - Add `screenerFilterCatalogue(): Promise<FilterCatalogueEntry[]>` hitting the new endpoint.
  - Extend `ScannerPreset` type with `category: "popular" | "niche"`.
- **`src/components/screener/ScreenerFilterBar.tsx`**
  - Delete the local `FILTER_CATEGORIES` constant.
  - `useQuery(["screener-filter-catalogue"], api.screenerFilterCatalogue, { staleTime: 60*60*1000 })`.
  - Rebuild `FILTER_CATEGORIES` from the fetched catalogue, grouping by `category` field.
  - Add Quick-pick chip row (D5) for entries with `popular: true`.
  - Replace the `<select>` preset dropdown with a grouped combobox (D6) — two sections driven by `preset.category`.
  - Click-to-edit on existing pills.
  - Tooltips on every filter in the "More filters" menu (use shadcn `Tooltip`).
- **`src/components/screener/ScreenerAiPanel.tsx`** (confirm filename, grep for it)
  - Seed prompt chips listed in 4c.
- **`src/pages/ScreenerPage.tsx`**
  - Add an empty-state block with 3–4 "Try these" cards that apply preset + filters on click.
- **`src/store/screener.ts`**
  - Add `applyPreset(preset, filters)` helper that sets `selectedPreset` + replaces `filters` in one go, used by the empty-state cards and the AI panel. Mark `isDirty = true`.

### Tests (frontend)

- **`src/store/screener.test.ts`** — cover the new `applyPreset` helper.
- **NEW `src/components/screener/ScreenerFilterBar.test.tsx`**
  - Mounts with a fake catalogue, renders the popular chips, confirms clicking opens the popover.
  - Confirms adding a filter with an invalid code is impossible from the UI (all codes come from the fetched catalogue).
- **NEW `src/components/screener/ScreenerAiPanel.test.tsx`**
  - Clicking a prompt chip fills the input.
  - AI response with only valid codes renders all pills; invalid codes drop silently.

---

## 7. Test plan summary

- Backend: `pytest backend/tests/` — all currently-passing tests must stay green. New tests described above.
- Frontend: `npm run test` — all currently-passing tests must stay green. New tests described above.
- Manual: run each of the 16 presets against a live connected IBKR session, confirm rows render. For 2 of them, add each Fundamental filter one at a time and confirm IBKR accepts (non-zero results or "no matches" — *not* a 4xx). This is the gating manual test before merge.

---

## 8. Context the implementing LLM must have

Paste everything in this section into the next LLM's system/context, in addition to the project's `CLAUDE.md`.

### 8a. Hard constraints

- Never invent an IBKR filter code. Every `code` string in `backend/constants/ibkr_filters.py` must appear verbatim in the canonical filter list in section 2 of this doc. If a code isn't there, it doesn't exist.
- Never invent a scan type. Every preset's `scan_type` must appear in section 3.
- Polars only for any dataframe work. Pandas is banned except through the pandas-ta bridge (unused here).
- Typed errors only. Do not use bare `except Exception`. Use/extend `IBKRError`, `ScannerUnavailableError`, `AIError` as appropriate — see `backend/exceptions.py`.
- All IBKR access goes through `services/ibkr.py`. The frontend never calls IBKR directly.
- `conid` is the universal key — this redesign already respects it, don't regress.
- New branch for this work: `feat/screener-filter-rewire`. Separate commits for: (1) canonical catalogue + endpoint, (2) AI service rewire, (3) preset grouping, (4) UI rewire, (5) tests. PR against the same base as current `fix/scanner`.

### 8b. Traps and prior mistakes

- The old `FILTER_CATALOGUE` in `screener_ai.py` used made-up codes (e.g. `minROE`, `macdHistAbove`, `priceVsEMA20Above`). These looked plausible but IBKR rejected them silently in production — the scanner would ignore the filter and return an unfiltered set. That's why filters appeared to "not work." Do not trust any code in the existing codebase without checking it against the dump.
- `volumeBelow` does not exist in IBKR. Do not add it back.
- `wshEarningsDate` is not a valid IBKR filter code either. Drop it (D3 default) or replace with `nextEarningsDateTimeAbove` using a real datetime.
- IBKR's `/iserver/scanner/run` returns ~50 rows per call and does not document an offset. We are **not** implementing "Search next 50" in this change — that's a separate task. See TODO block in `backend/services/screener.py`.
- Sorting is client-side only. Do not reintroduce a server sort dropdown. The `sort_field` / `sort_direction` params on `ScanRequest` stay for backward-compat but the frontend does not send them.
- Frontend uses Zustand via `@/store/screener`. The `isDirty` flag is cleared only by `replaceResults` / `appendResults`. Any new store action that *changes filter intent* must set `isDirty = true`. Any action that *returns fresh results* must clear it.
- `--clr-yellow` does not exist in the design system. Amber/warning states use `--clr-orange`.
- The `pnpm` / `npm` lockfile in this repo is npm — use `npm`.

### 8c. Verification after implementation

The implementing LLM should:

1. Grep every `code:` string value in `backend/constants/ibkr_filters.py` and confirm it appears in the raw `scanner/params` dump (Ben has it).
2. Grep every `scan_type:` in `DEFAULT_PRESETS` and confirm likewise.
3. Run the full test suite (`pytest backend/tests/` + `npm run test`) and report pass/fail counts in the PR description.
4. Run the UI, hit Scan on each of the 16 presets, and add at least one filter of each category to confirm IBKR accepts them. Attach the scan log output (once logging is added in the follow-up task).
5. If any code in section 2 turns out to be invalid in practice, **stop and ask Ben** before replacing — don't guess a substitute.

### 8d. What is explicitly NOT in scope

- Adding scan logging (Ben wants to do this as a separate, smaller change right after this one lands).
- "Search next 50" / cumulative paging.
- Date-picker component for the earnings filter.
- Any change to indicator computation, chart wiring, or watchlist code.
- Any change to the AI chat mode in the dashboard — this spec only covers the Screener AI panel's natural-language → filter flow.

---

## 9. Open questions for Ben (answer before handoff)

- D1–D8 in section 1.
- Should the 3–4 "Try this" empty-state cards in section 4c be curated by Ben, or should the next LLM propose an initial set?
- For the AI panel prompt chips in section 4c: same question — Ben's chips or proposed?
- Branch name `feat/screener-filter-rewire` — OK, or different?
