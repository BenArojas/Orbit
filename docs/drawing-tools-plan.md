# Chart Drawing Tools — Implementation Plan

**Date:** 2026-06-08
**Status:** All decisions locked. Ready to implement.
**Scope:** Add TradingView-style drawing tools to the Analysis chart (item 5 from the fibonacci-improvements-plan, deferred branch). Built on top of `deepentropy/lightweight-charts-drawing` (vendored), not from scratch.

---

## Table of Contents

1. [Library Assessment](#library-assessment)
2. [Locked Decisions](#locked-decisions)
3. [Tool Scope](#tool-scope)
4. [Vendor Strategy](#vendor-strategy)
5. [Branch Strategy & Sequencing](#branch-strategy--sequencing)
6. [Technical Plan (LLM-optimized)](#technical-plan-llm-optimized)
7. [Plain English Plan (human-readable)](#plain-english-plan-human-readable)
8. [Cross-Cutting Concerns](#cross-cutting-concerns)
9. [Git Command Reference](#git-command-reference)
10. [Document History](#document-history)

---

## Library Assessment

### What we evaluated

`deepentropy/lightweight-charts-drawing` — 68 drawing tools built on Lightweight Charts v5's official `SeriesPrimitive` API. MIT license. TypeScript. Single 0.1.1 release tag (Feb 2026), 7 commits, 2 stars.

### Author credibility

The 2-star drawing repo undersells the author. `deepentropy` has 87 followers and ships serious quant tooling: `tvscreener` (1k stars, TradingView screener API), `ibx` (122 stars, direct IBKR engine in Rust+Python), `lightweight-charts-indicators` (134 stars, 446 indicators), `oakscriptJS` (37 stars, PineScript-in-JS). The drawing library is a young offshoot of a proven body of work. Risk profile is "new library, proven author" rather than "random unknown."

### Architecture

Each tool is a pair:

- A `Drawing` subclass — holds the anchors (each `{ time, price }`), exposes hit-testing + geometry.
- An `IPrimitivePaneView` — implements LW Charts' official primitive interface, renders to canvas.

A `DrawingManager` orchestrates lifecycle: `attach(chart, series, container)` wires up the chart, then `addDrawing/removeDrawing/selectDrawing/deselectAll` plus an event emitter (`drawing:selected`, etc.). Built-in `exportDrawings()` → JSON and `importDrawings(json, factory)` — maps directly onto our SQLite persistence pattern.

### Demo test (Ben, 2026-06-08)

- Clicking a drawing shows resize handles. ✅
- Delete key removes the selected drawing. ✅
- Tested only on the hosted demo, not yet in code.
- Cross-timeframe anchor behavior NOT verified. ⚠ Must verify during Branch 2.

### Verdict

Use it, vendored. The plugin handles the hard parts (canvas rendering, hit-testing, drag-to-edit, 68 pre-built tools). We build the integration layer (persistence, store, conid-scoping, toolbar UI, cross-TF plumbing). Vendoring (copying MIT-licensed source into our repo) is our insurance against the upstream stagnating — a 100% local trading app cannot afford a fragile external dep.

---

## Locked Decisions

| ID  | Decision |
|-----|----------|
| 5A  | Use `deepentropy/lightweight-charts-drawing` v0.1.1, vendored into `vendor/lightweight-charts-drawing/`. Not installed from npm. |
| 5B  | Drawings are per-conid, visible across all timeframes. Anchors stored as `{ time: unix_seconds, price }` so LW Charts can map them to any TF's x-axis. |
| 5C  | Drawing tools shipped now (not deferred). |
| 5D  | v1 tool set: horizontal line, trendline, ray, rectangle, vertical line, text annotation, long position, short position, forecast, bars pattern. (10 tools out of 68 available.) |
| 5E  | Selection UX: click-to-select shows resize handles, Delete key removes, right-click opens a context menu (delete / change color). NO drag-to-move-anchor in v1 — defer to v1.1. |
| 5F  | Snapping: hybrid. Free placement by default; hold Shift to snap to nearest OHLC value on the candle under the cursor. |
| 5G  | Z-order: drawings render on top of all other chart layers (candles, indicators, fibs). They're the user's own marks. |
| 5H  | Toolbar placement: vertical left rail on the Analysis chart. Always visible. |
| 5I  | Hard cap: none. Soft warning toast at 50 drawings per conid. "Hide all drawings" toggle in the toolbar header. |
| 5J  | Persistence: SQLite table `chart_drawings`, endpoints follow the locked-fib CRUD pattern. |
| 5K  | conid is the universal key (project rule 6). No ticker strings in storage. |
| 5L  | Vendor strategy: copy the upstream `src/` into `vendor/lightweight-charts-drawing/`, retain the MIT license file, document version + date copied in a README. Update path is a manual diff-and-merge when needed. |
| 5M  | Open issue to verify in Branch 2 (does not block planning): cross-TF anchor behavior in our embedded chart. If LW Charts maps `{ time }` correctly across TFs (expected), no extra work. If anchors drift, we need a snapping post-processor — design noted in Branch 2 risks. |

---

## Tool Scope

### v1 tools (10)

Five general-purpose shapes + one text tool + four trade-idea tools.

| Tool | Upstream class | Anchors | Notes |
|------|----------------|---------|-------|
| Horizontal line | `HorizontalLine` | 1 | Most-used; mark S/R levels. |
| Trendline | `TrendLine` | 2 | Connects two pivots. |
| Ray | `Ray` | 2 | Extends to infinity in one direction. |
| Rectangle | `Rectangle` | 2 | Two opposite corners. Zones / ranges. |
| Vertical line | `VerticalLine` | 1 | Mark a timestamp (earnings, news). |
| Text annotation | `TextAnnotation` | 1 | Free-form note pinned to a point. |
| Long position | `LongPosition` | 3 | Entry / stop / target. Renders R:R box. |
| Short position | `ShortPosition` | 3 | Same, inverted. |
| Forecast | `Forecast` | 2 | Projected future price path. |
| Bars pattern | `BarsPattern` | 3 | Copy a price pattern, overlay elsewhere. |

### Deferred (available in the library; not in v1 toolbar)

The remaining 58 tools (Gann, pitchforks, Fib variants beyond what we have, channels, arcs, spirals, etc.) stay in the vendored codebase but are NOT exposed in our toolbar. Easy to add later — just register them in `DRAWING_TOOLS_REGISTRY` (Branch 3).

### Why these 10

- **Horizontal, trendline, ray, rectangle** — cover ~80% of trader needs. Hard to imagine using the chart without them.
- **Vertical line + text** — pin events (earnings, news, decisions).
- **Long/short position + forecast + bars pattern** — these aren't generic shapes; they encode trade ideas. Long position drawn on a chart visually communicates entry/stop/target with R:R math built in. This is the kind of structured trade-idea capture that fits a decision-support app, not just an annotation tool. Worth exposing in v1 since the plugin already implements them.

---

## Vendor Strategy

### Why vendor instead of `npm install`

- The upstream npm package may or may not be published — the README's `npm install lightweight-charts-drawing` instruction is not corroborated by a GitHub Packages link or a published version we've verified.
- The library is 0.1.x. Pre-1.0 + small audience = breaking changes are likely.
- Parallax is a 100% local app (project rule 3). Pulling pre-1.0 deps over the network at build time is a fragility we can avoid.
- MIT license explicitly permits this.

### How

- Create `vendor/lightweight-charts-drawing/`.
- Copy the upstream `src/` directory verbatim. Pin to git tag `v0.1.1` — record the commit SHA in `vendor/lightweight-charts-drawing/README.md`.
- Copy the upstream `LICENSE` file into the vendor directory.
- Re-export through `src/lib/drawings.ts` so the rest of the app imports from `@/lib/drawings`, never directly from `vendor/`. This isolates the dependency: a future replacement or fork is a single-file change.
- `vendor/` is included in TypeScript compilation but excluded from our test coverage gates (we trust the upstream tests; we test our integration layer).

### Update strategy

When (if) we want a newer upstream version:

1. Diff the upstream `src/` against `vendor/lightweight-charts-drawing/`.
2. Manually merge non-breaking changes.
3. Re-run our integration tests.
4. Bump the version + commit SHA in the vendor README.

No automated dependency-bump bot. Manual review every time. Slow but safe.

---

## Branch Strategy & Sequencing

Four branches. Per Ben's rule: similar tasks or tasks touching the same files share a branch.

| # | Branch | Item(s) | Reason for grouping |
|---|--------|---------|---------------------|
| 1 | `feat/drawings-backend-and-vendor` | Vendor the plugin + backend persistence | Foundation — nothing else can be tested without storage + the library being available. |
| 2 | `feat/drawings-chart-integration` | Store slice + hooks + DrawingManager wiring | All the plumbing that makes drawings "visible" on the chart. Verify cross-TF here. |
| 3 | `feat/drawings-toolbar-and-tools` | Left rail toolbar + 6 core line/shape tools + selection/delete/styling | The user-facing UI for the bulk of v1. |
| 4 | `feat/drawings-projection-tools` | Long position / short position / forecast / bars pattern | Conceptually distinct trade-idea tools. Land last so the core flow is stable first. |

**Dependencies:**

- Branch 1 → Branches 2, 3, 4 (vendor + backend must exist).
- Branch 2 → Branches 3, 4 (toolbar wires into the store + hooks built here).
- Branch 3 → Branch 4 (projection tools reuse the toolbar registration pattern from Branch 3).

---

## Technical Plan (LLM-optimized)

> Each section is structured so a coding agent can execute it without needing follow-up. File paths are absolute relative to repo root.

### Branch 1: `feat/drawings-backend-and-vendor`

**Goal:** Vendor the plugin source, create the SQLite table + CRUD endpoints, run upstream + our tests.

**Vendor step (do this first — without the library, nothing else compiles):**

- Clone `https://github.com/deepentropy/lightweight-charts-drawing` at tag `v0.1.1`.
- Copy `src/` → `vendor/lightweight-charts-drawing/src/`.
- Copy `LICENSE` → `vendor/lightweight-charts-drawing/LICENSE`.
- Create `vendor/lightweight-charts-drawing/README.md` with:
  - Upstream URL.
  - Tag: `v0.1.1`.
  - Commit SHA at time of vendor.
  - Vendor date (`2026-06-08` or current date).
  - Notes about local modifications (none expected; record any if made).
- Update `tsconfig.json` paths to include `vendor/lightweight-charts-drawing/src/index.ts`.
- Create `src/lib/drawings.ts` as a re-export shim:
  ```ts
  export {
    DrawingManager,
    HorizontalLine,
    TrendLine,
    Ray,
    Rectangle,
    VerticalLine,
    TextAnnotation,
    LongPosition,
    ShortPosition,
    Forecast,
    BarsPattern,
    getToolRegistry,
  } from "@vendor/lightweight-charts-drawing";
  ```
  (Path alias `@vendor/*` → `vendor/*/src/index.ts` defined in tsconfig + vite config.)
- Verify the demo's "Quick Start" example compiles in our codebase by writing a one-off smoke test (NOT shipped — just a build check).

**Backend — `backend/exceptions.py`:**

- New `DrawingError(DataError)` base class.
- `InvalidDrawingError(DrawingError)` for malformed anchor / style payloads.

**Backend — `backend/models/__init__.py`:**

```python
class DrawingAnchor(BaseModel):
    time: int       # Unix seconds
    price: float

class DrawingStyle(BaseModel):
    line_color: Optional[str] = None     # e.g., "#2962FF"
    line_width: Optional[int] = None     # 1..4
    line_style: Optional[Literal["solid", "dashed", "dotted"]] = None
    fill_color: Optional[str] = None     # rectangles, position tools
    text: Optional[str] = None           # text annotations + labels

class CreateDrawingRequest(BaseModel):
    conid: int
    kind: str                            # "horizontal_line", "trend_line", ...
    anchors: list[DrawingAnchor]
    style: Optional[DrawingStyle] = None

class UpdateDrawingRequest(BaseModel):
    anchors: Optional[list[DrawingAnchor]] = None
    style: Optional[DrawingStyle] = None

class DrawingResponse(BaseModel):
    id: int
    conid: int
    kind: str
    anchors: list[DrawingAnchor]
    style: Optional[DrawingStyle] = None
    created_at: str
    updated_at: Optional[str] = None
```

**Backend — `backend/services/db.py`:**

- New table in `_init_schema`:
  ```sql
  CREATE TABLE IF NOT EXISTS chart_drawings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      conid       INTEGER NOT NULL,
      kind        TEXT NOT NULL,
      anchors_json TEXT NOT NULL,        -- JSON list of {time, price}
      style_json  TEXT,                  -- JSON dict, nullable
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_chart_drawings_conid ON chart_drawings(conid);
  ```
- New methods:
  - `async def save_drawing(...) -> int` — insert, return new id.
  - `async def update_drawing(drawing_id: int, anchors, style) -> bool`.
  - `async def delete_drawing(drawing_id: int) -> bool`.
  - `async def get_drawing(drawing_id: int) -> dict | None`.
  - `async def list_drawings(conid: int) -> list[dict]`.

**Backend — `backend/routers/drawings.py` (new):**

- `POST   /drawings` → `DrawingResponse`. Validates anchors non-empty + style fields if present.
- `PUT    /drawings/{id}` → `DrawingResponse`. Partial update.
- `DELETE /drawings/{id}` → `{ deleted, id }`. Returns 404 if missing.
- `GET    /drawings/{conid}` → `list[DrawingResponse]`.

**Backend — `backend/main.py`:**

- Register the new router: `app.include_router(drawings_router)`.

**Backend tests — `backend/tests/test_drawings.py` (new):**

- `TestDrawingsCRUD`:
  - `test_post_drawing_persists` — POST + GET round-trip.
  - `test_put_drawing_partial_update` — anchors-only vs style-only updates leave the other field intact.
  - `test_delete_drawing_returns_404_when_missing`.
  - `test_list_drawings_scoped_to_conid` — drawings for one conid are NOT returned for another.
  - `test_post_drawing_rejects_empty_anchors`.
  - `test_post_drawing_rejects_invalid_line_width` (outside 1..4).

**Frontend — `src/lib/api.ts`:**

- Add types `DrawingAnchor`, `DrawingStyle`, `Drawing`, `CreateDrawingRequest`, `UpdateDrawingRequest`.
- Add methods `api.createDrawing(req)`, `api.updateDrawing(id, req)`, `api.deleteDrawing(id)`, `api.getDrawings(conid)`.

---

### Branch 2: `feat/drawings-chart-integration`

**Goal:** Plug the vendored `DrawingManager` into our chart. Reactive store. CRUD hooks. Verify cross-TF anchor behavior in our embedded environment.

**Store — `src/store/drawings.ts` (new slice; do NOT merge into chart.ts):**

```ts
import { create } from "zustand";

export type DrawingToolId =
  | null                          // no tool active (default)
  | "horizontal_line"
  | "trend_line"
  | "ray"
  | "rectangle"
  | "vertical_line"
  | "text"
  | "long_position"
  | "short_position"
  | "forecast"
  | "bars_pattern";

interface DrawingsState {
  /** Which drawing tool the user is currently using. null = no tool active. */
  activeTool: DrawingToolId;
  /** Selected drawing id from the chart (the one with handles). */
  selectedDrawingId: number | null;
  /** True hides ALL drawings from the chart without deleting them. */
  drawingsHidden: boolean;
  setActiveTool: (tool: DrawingToolId) => void;
  setSelectedDrawingId: (id: number | null) => void;
  toggleDrawingsHidden: () => void;
  resetDrawingsForConidChange: () => void;
}
```

**Store — `src/store/chart.ts`:**

- Wire `resetDrawingsForConidChange` into `setActiveConid` so a ticker change also clears the active tool + selection. (Drawings themselves are conid-scoped on the server; the GET query for the new conid will repopulate.)

**Hooks — `src/hooks/useDrawings.ts` (new):**

- `useDrawings(conid: number | null)` — TanStack Query.
  - Query key: `["drawings", conid]`.
  - Enabled when `conid != null`.
  - `staleTime: 60_000`, `gcTime: 5 * 60_000`. Same shape as `useLockedFibs`.
- `useCreateDrawing()` — mutation. On success, invalidate `["drawings", conid]`.
- `useUpdateDrawing()` — mutation. Optimistic update on the cache.
- `useDeleteDrawing()` — mutation. Optimistic remove; on failure, refetch.

**Chart integration — `src/components/charts/DrawingsLayer.tsx` (new):**

- Self-contained component mounted inside `ChartContainer`. Props: `chart`, `series`, `containerRef`, `conid`.
- On mount: `const manager = new DrawingManager(); manager.attach(chart, series, container)`.
- Effects:
  - When `useDrawings(conid).data` changes → diff against the manager's current set, add new ones, remove vanished ones. Identity by server-issued `id`.
  - When `useChartStore.activeTool` is non-null → enter the matching tool's draw mode in the manager. Capture clicks via the manager's API. On commit → fire `useCreateDrawing` mutation with the captured anchors + selected style. On success → exit tool mode (`setActiveTool(null)`).
  - When `useDrawingsStore.selectedDrawingId` changes externally → call `manager.selectDrawing(id)` or `manager.deselectAll()`.
  - Listen for manager events:
    - `drawing:selected` → `setSelectedDrawingId(id)`.
    - `drawing:deleted` (if available) or via the user pressing Delete → fire `useDeleteDrawing` mutation.
- Cross-TF behavior: do nothing special. The plugin uses `{ time, price }` anchors; LW Charts maps `time` → x-coordinate per the active timeframe automatically. Verify in dev.

**Chart wiring — `src/components/charts/ChartContainer.tsx`:**

- Mount `<DrawingsLayer chart={chartRef.current} series={candleSeriesRef.current} containerRef={containerRef} conid={conid} />` after the existing FibDrawMode mount.
- Plumb `useDrawingsStore.drawingsHidden` into the manager via a `manager.setVisible(!drawingsHidden)` call (or remove/add all drawings on toggle, depending on what the plugin supports).

**Tests:**

- `src/store/__tests__/drawings.test.ts` (new) — slice transitions: setActiveTool, setSelectedDrawingId, toggleDrawingsHidden, conid-change reset.
- `src/hooks/__tests__/useDrawings.test.tsx` (new) — query refetch on conid change, mutation invalidates query, optimistic delete rolls back on failure. Mock `api.*Drawing` methods.
- `src/components/charts/__tests__/DrawingsLayer.test.tsx` (new) — stub `DrawingManager` (the vendored class). Assert: attach called on mount, drawings added when query data arrives, removed when missing from new payload, manager.selectDrawing called when store changes, `useCreateDrawing.mutate` called when manager emits commit. Cross-TF behavior verified by switching the chart's timeframe and asserting `manager.addDrawing` is NOT called again (drawings persist; manager handles re-render).

**Risk verification (must do during this branch, before committing the integration as "done"):**

- Manually test in dev:
  - Draw a trendline on the 1D chart.
  - Switch to 4H → trendline still anchored to the same start/end timestamps. Slope visually changes due to time-axis density but endpoints stay correct.
  - Switch to 5m → trendline either still visible (if the 5m window covers the original date range) or correctly off-screen (if it doesn't).
  - Switch to 1W → trendline endpoints snap to the same week's candle.
- If anchors drift or disappear unexpectedly: design a snapping post-processor that maps `{ time }` to the nearest candle on the active TF before passing to the manager. Add as a fix-up commit; do NOT block Branch 2 merging.

---

### Branch 3: `feat/drawings-toolbar-and-tools`

**Goal:** Left vertical rail with the 6 core tools. Selection + delete UX. Right-click menu. Basic styling controls.

**New component — `src/components/charts/DrawingToolbar.tsx`:**

- Vertical rail, ~32 px wide, mounted on the left edge of the chart area in `AnalysisPage`. Above all other chart chrome.
- Top section (drawing tools):
  - One button per tool in `CORE_TOOLS` (6 entries — see below).
  - Each button shows a tool icon (lucide-react: `Minus`, `TrendingUp`, `MoveUpRight`, `Square`, `MoreVertical`, `Type`).
  - Active tool button highlighted with `var(--clr-cyan)` border + glow.
  - Click toggles the tool — second click on the same tool exits draw mode.
  - Tooltip on hover: tool name + keyboard shortcut.
- Middle section (state controls):
  - "Deselect" button — calls `setSelectedDrawingId(null)`.
  - "Hide all" toggle — flips `drawingsHidden`. Icon swaps `Eye` ↔ `EyeOff`.
- Bottom section:
  - "Delete selected" button — disabled when no selection. Click → `useDeleteDrawing.mutate(selectedId)`. Same outcome as Delete key.

**New constant — `src/components/charts/drawingsRegistry.ts`:**

```ts
import type { LucideIcon } from "lucide-react";
import { Minus, MoveUpRight, Square, TrendingUp, Type } from "lucide-react";
import type { DrawingToolId } from "@/store/drawings";

export interface DrawingToolEntry {
  id: NonNullable<DrawingToolId>;
  label: string;
  Icon: LucideIcon;
  shortcut?: string;
  /** Upstream class name in vendored library. */
  upstreamClass: string;
  /** Number of click anchors before commit. */
  anchorCount: number;
}

export const CORE_TOOLS: DrawingToolEntry[] = [
  { id: "horizontal_line", label: "Horizontal", Icon: Minus, shortcut: "H", upstreamClass: "HorizontalLine", anchorCount: 1 },
  { id: "trend_line",      label: "Trendline",  Icon: TrendingUp, shortcut: "T", upstreamClass: "TrendLine", anchorCount: 2 },
  { id: "ray",             label: "Ray",        Icon: MoveUpRight, shortcut: "R", upstreamClass: "Ray", anchorCount: 2 },
  { id: "rectangle",       label: "Rectangle",  Icon: Square, shortcut: "S", upstreamClass: "Rectangle", anchorCount: 2 },
  { id: "vertical_line",   label: "Vertical",   Icon: /* TODO */ Minus, shortcut: "V", upstreamClass: "VerticalLine", anchorCount: 1 },
  { id: "text",            label: "Text",       Icon: Type, shortcut: "X", upstreamClass: "TextAnnotation", anchorCount: 1 },
];
```

**Selection + delete UX in `DrawingsLayer.tsx`:**

- Keyboard handler at the chart container level: when `selectedDrawingId != null` and user presses `Delete` or `Backspace`, fire `useDeleteDrawing.mutate`. Stop event propagation so the global app shortcut doesn't fire.
- Right-click handler on a selected drawing: pop a small floating menu (Radix DropdownMenu) with:
  - "Delete" — same as keyboard shortcut.
  - "Change color" — opens a color swatch picker (6-8 preset colors). Calls `useUpdateDrawing.mutate({ id, style: { line_color } })`.
  - "Change width" — submenu 1/2/3/4 px.
  - "Change style" — submenu solid/dashed/dotted.

**Snapping (Shift-to-snap):**

- During draw mode, when the user is moving the cursor:
  - Default: pass cursor pixel coords directly to the manager as `{ time, price }`.
  - When `Shift` is held: compute the candle under the cursor, snap `price` to the closest of `{ open, high, low, close }`. `time` snaps to the candle's timestamp.
- Implemented inside `DrawingsLayer` using the manager's draw-mode-preview hook. Toggle visible by a small "SNAP" pill below the cursor when Shift is down.

**AnalysisPage wiring — `src/pages/AnalysisPage.tsx`:**

- Mount `<DrawingToolbar />` as the leftmost column of the chart area (grid: `[32px_1fr_340px]`).
- Add keyboard shortcuts (H/T/R/S/V/X) — toggle the tool. ESC exits any tool.

**Soft-cap warning:**

- In `useCreateDrawing.onSuccess`, when the count for the current conid crosses `DRAWING_SOFT_CAP = 50`, show a toast: "50+ drawings on this chart — readability may suffer. Consider hiding old ones."
- No hard cap; user can keep adding.

**Tests:**

- `src/components/charts/__tests__/DrawingToolbar.test.tsx` (new):
  - Renders one button per `CORE_TOOLS` entry.
  - Clicking a tool sets `useDrawingsStore.activeTool`.
  - Second click on the active tool unsets it.
  - Keyboard shortcuts trigger the corresponding tool.
  - ESC exits the active tool.
  - "Hide all" toggles `drawingsHidden`.
- `src/components/charts/__tests__/DrawingsLayer.test.tsx` (extend Branch 2 file):
  - Delete key fires `useDeleteDrawing` when selection exists.
  - Right-click menu items call the correct mutations.
  - Shift-held during draw produces snapped anchors.

---

### Branch 4: `feat/drawings-projection-tools`

**Goal:** Long position, short position, forecast, bars pattern. These are trade-idea tools — more than just shapes.

**Registry — extend `drawingsRegistry.ts`:**

```ts
export const PROJECTION_TOOLS: DrawingToolEntry[] = [
  { id: "long_position",  label: "Long Position",  Icon: ArrowUpRight, shortcut: "L", upstreamClass: "LongPosition",  anchorCount: 3 },
  { id: "short_position", label: "Short Position", Icon: ArrowDownRight, shortcut: "Shift+L", upstreamClass: "ShortPosition", anchorCount: 3 },
  { id: "forecast",       label: "Forecast",       Icon: LineChart, upstreamClass: "Forecast",      anchorCount: 2 },
  { id: "bars_pattern",   label: "Bars Pattern",   Icon: Copy, upstreamClass: "BarsPattern",   anchorCount: 3 },
];
```

**Toolbar — `DrawingToolbar.tsx`:**

- New section below the core tools: "Projection" with the 4 entries.
- Separator line + section label.

**Long/short position draw flow:**

- 3-click sequence: click 1 = entry, click 2 = stop, click 3 = target.
- During preview (between clicks), render a labeled box showing live R:R math as the user moves the cursor.
- On commit, the drawing's metadata stores `entry`, `stop`, `target` as the 3 anchors. The plugin's renderer already shows R:R; we don't need extra code.
- No special persistence — the existing 3-anchor model works.

**Forecast draw flow:**

- 2 clicks: anchor + future target. Plugin renders a projected price line.

**Bars pattern draw flow:**

- 3 clicks: start of source pattern, end of source pattern, paste location. Plugin handles the overlay rendering.

**AI integration (deferred — flag for v2):**

- Long position drawings encode entry/stop/target. The AI analyze flow (Branch 5 of fib plan) already sends fib snapshots; in a future PR we could also send long/short position drawings so the AI sees the trader's planned trades. NOT in scope for this branch. Note it as a v2 task in `parallax-v2-roadmap`.

**Tests:**

- `src/components/charts/__tests__/DrawingToolbar.test.tsx` — extend:
  - Projection section renders the 4 entries.
  - Clicking "Long Position" sets `activeTool` to `"long_position"`.
- `src/components/charts/__tests__/DrawingsLayer.test.tsx` — extend:
  - 3-click sequence for long position fires `useCreateDrawing` with 3 anchors after the third click.
  - 2-click sequence for forecast fires after the second click.

---

## Plain English Plan (human-readable)

> What we're building and what you'll see when it's done.

### Why we're using a library instead of building from scratch

`deepentropy/lightweight-charts-drawing` already implements 68 drawing tools for the exact charting library we use. The author also wrote `ibx` (122 stars — direct IBKR engine), `tvscreener` (1k stars), and `lightweight-charts-indicators` (134 stars). It's a young repo from a proven domain expert, not a random unknown library. You tested the demo and the basics work (resize handles, delete key).

Rather than spend three weeks building canvas-rendering, hit-testing, and drag-edit code from scratch — and getting it 50% as good — we use the library for the canvas math and build only the parts that matter for Parallax (persistence to SQLite, conid-scoping, toolbar UI, integration with our store).

### Vendoring — what it means and why we do it

We copy the library's source code into our own repo at `vendor/lightweight-charts-drawing/`. We do NOT install it via npm. Reasons:

- 100% local app — we don't want network installs at build time for a pre-1.0 library.
- We pin to a specific version forever; the library can't break us by releasing something new.
- If the author abandons the project, we still have a working copy.
- It's MIT-licensed, so this is explicitly permitted.

When we want a newer version, we manually diff the upstream against our copy, merge what we like, and bump the recorded version in our vendor README.

### What you'll see when it's done

- A new left-edge toolbar on the Analysis chart with icons for each drawing tool. Click an icon → cursor enters drawing mode → click anchors on the chart → drawing committed and saved to SQLite.
- Drawings persist per-instrument. Switch tickers and you see that ticker's drawings (or none if you haven't drawn any). Switch back, they're still there.
- Drawings show on every timeframe. Draw a daily trendline → switch to 4H → it's still there at the same anchor points (slope changes because the time axis is denser, but the line connects the same two moments in history).
- Click a drawing → resize handles appear at its anchors. Press Delete → it's gone (and gone from SQLite). Right-click → menu with delete + change color + change width + change style.
- Hold Shift while drawing → anchor snaps to the nearest OHLC value (clean prices like $175.43 instead of $175.4327).
- "Hide all" button in the toolbar → temporarily hides every drawing without deleting them. Click again to bring them back.
- After 50 drawings on one chart, a toast warns about clutter. No hard limit — go higher if you want.

### The v1 toolset (10 tools, 4 sections)

**Lines & shapes (6):**

- Horizontal line — mark a support or resistance level.
- Trendline — connect two pivots.
- Ray — like a trendline but extends to infinity in one direction.
- Rectangle — mark a zone (supply, demand, range).
- Vertical line — mark a moment in time (earnings, news).
- Text — pin a free-form note to a point on the chart.

**Trade-idea tools (4):**

- Long position — click entry, stop, target. Renders a colored box with live R:R math built in.
- Short position — same but inverted.
- Forecast — projected future price path from two anchor points.
- Bars pattern — copy a price pattern and overlay it somewhere else (handy for "if it plays out like Q3 last year…").

The other 58 tools the library ships with (Gann, pitchforks, Fibonacci variants beyond what we already have, channels, arcs, spirals) stay in the vendored code but aren't exposed in the toolbar. Adding any of them later is a one-line registry entry plus an icon.

### What's NOT in v1

- **Drag-to-move anchors after creation.** Right now: select a drawing, delete it, redraw it. v1.1 will let you grab a handle and drag.
- **Templates / saved sets** ("AMD earnings setup" with multiple drawings).
- **AI sees long position drawings.** The AI analyze flow doesn't include drawings yet; that's a v2 task in the v2 roadmap.
- **The other 58 drawing tools.** Available in code, not in the toolbar.

### The 4 branches you'll review

1. **Backend + vendor** — copy the library in, create the SQLite table, add the four CRUD endpoints, frontend types. No visible chart change yet.
2. **Chart integration** — store slice for tool state, hooks for the CRUD, the layer that mounts the library's DrawingManager and bridges its events to our store. After this branch lands, drawings work programmatically but there's no UI to trigger them yet. Cross-TF behavior gets verified here.
3. **Toolbar + 6 core tools + selection/delete/styling** — the chunk that makes drawings usable. Left rail UI, keyboard shortcuts, right-click menu, Shift-to-snap, hide-all toggle, soft-cap toast.
4. **Projection tools** — long/short position, forecast, bars pattern. Same registry pattern as Branch 3; lands last so the core flow is stable first.

Each branch ships its own tests.

---

## Cross-Cutting Concerns

### Vendoring maintenance

- One person responsible for periodic upstream diff (every 3 months, or when a critical bug surfaces). Document procedure in `vendor/lightweight-charts-drawing/README.md`.
- Never edit the vendored source directly to fix bugs — always file an upstream issue first. If we MUST patch locally, document the patch in the vendor README and flag it in a `LOCAL_PATCHES.md`.

### TypeScript types

- The upstream is TS native. We re-export types from `src/lib/drawings.ts` so the rest of the app never imports from `vendor/`.
- `tsconfig.json` `paths` adds `@vendor/*` → `vendor/*/src/index.ts`.

### Test coverage (project rule 1)

- Every new feature/service/endpoint gets tests (rule 1). Branch-by-branch test files listed in the technical plan.
- We do NOT test the vendored library itself — that's upstream's responsibility. We test the integration: that anchors round-trip correctly, that the manager emits events we react to, that the store + UI flow correctly.

### conid universal key (project rule 6)

- All drawings are conid-scoped. The `chart_drawings` table has `conid` as a column and an index on it. No ticker strings anywhere.

### Polars vs Pandas (project rule 2)

- N/A. No DataFrame operations in this feature. Drawing math runs on canvas inside the vendored library.

### Typed errors (project rule 4)

- New `DrawingError` + `InvalidDrawingError` in `backend/exceptions.py`. All validation paths raise typed.

### No cloud dependencies (project rule 3)

- Vendoring strategy explicitly preserves rule 3. No runtime network calls to the library.

### Visibility toggle and AI

- `drawingsHidden` is a UI-only flag. Drawings remain in SQLite. The AI analyze flow does NOT currently see drawings. When (if) we wire that in v2, it should respect `drawingsHidden` — hidden drawings probably shouldn't be sent to the LLM.

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

Per Ben's preference, commits are multi-line with structured bodies.

```bash
git status
git diff
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

Refs: <plan item ID from this doc, e.g. "Branch 1 of drawing-tools-plan.md">
```

### Per branch — push & PR

```bash
git push -u origin <branch-name>
# Open PR via web UI; reference the branch's item from this plan
```

### Branch order — recommended merge sequence

1. `feat/drawings-backend-and-vendor`
2. `feat/drawings-chart-integration`
3. `feat/drawings-toolbar-and-tools`
4. `feat/drawings-projection-tools`

### Cleanup after merge

```bash
git checkout main
git pull origin main
git branch -d <merged-branch-name>
git push origin --delete <merged-branch-name>   # optional, if remote should be cleaned
```

---

## Document History

- 2026-06-08 — Initial plan written after evaluating `deepentropy/lightweight-charts-drawing` v0.1.1. Decisions locked. Ready to start Branch 1.

Sources consulted while writing this plan:

- `deepentropy/lightweight-charts-drawing` — [GitHub repo](https://github.com/deepentropy/lightweight-charts-drawing)
- Live demo — [deepentropy.github.io/lightweight-charts-drawing/](https://deepentropy.github.io/lightweight-charts-drawing/)
- Author profile — [github.com/deepentropy](https://github.com/deepentropy)
