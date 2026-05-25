# Orbit Launcher Polish — Design (Plan #2)

> Date: 2026-05-26
> Status: Approved design — ready for implementation plan.
> Builds on the foundation (Plan #1, merged to `dev`). Implements the "combined auth + launcher" polish deferred there.
> Parent spec: `docs/superpowers/specs/2026-05-25-orbit-v1-design.md`.

---

## Purpose

Replace the launcher **skeleton** (`OrbitLauncher` currently embeds Parallax's full-screen `ConnectionPage` above a gray icon row) with the real combined auth + launcher screen: a slim top bar carrying the Orbit brand and an IBKR status pill (with a connect popover), and three hero app tiles that gray→colorize on authentication.

Design decisions were validated visually during brainstorming: **layout C** (hero icons + slim top bar), **popover (i)** for the connect flow, **tiles with one-line descriptions (A)**.

---

## Scope

**In scope:**
- Rewrite `OrbitLauncher` to the top-bar + hero-grid layout.
- New `GatewayStatusPill` component (status pill + connect popover reusing existing `GatewaySetup`).
- Extend `AppIcon` with an optional one-line `description`.
- Tests for all three.

**Out of scope (YAGNI for Plan #2):**
- Account selector on the launcher.
- Quick stats (portfolio P&L, alert counts) on the launcher.
- Keeping modules "warm" across launcher↔module switches (remount is fine).
- Any MoonMarket/Parallax page work.

**Explicitly unchanged:**
- `ConnectionPage` and `GatewaySetup` keep their current behavior. `ConnectionPage` is **no longer embedded by the launcher**, but remains in use by Parallax's `AuthGuard` for mid-session re-auth inside `/parallax`. Do not modify `ConnectionPage` or `GatewaySetup` internals.
- The IBKR gateway/auth machinery (`GatewayContext`, provisioning, polling) is reused as-is.

---

## Layout & states

```
┌──────────────────────────────────────────────────────────┐
│ ORBIT                                  ● IBKR · <state> ▾  │   ← slim top bar (always)
├──────────────────────────────────────────────────────────┤
│                                                            │
│        ┌────────┐   ┌────────┐   ┌────────┐                │
│        │  [P]   │   │  [M]   │   │  [I]   │ Soon            │   ← hero tiles (always, centered)
│        │Parallax│   │MoonMkt │   │Inflect │                │
│        │Tech an.│   │Portfo… │   │Journal │                │
│        └────────┘   └────────┘   └────────┘                │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

- **Top bar (always visible):** `ORBIT` wordmark (left, `text-gradient-brand`); `GatewayStatusPill` (right).
- **Hero grid (always visible, centered):** three `AppIcon` tiles with descriptions:
  - Parallax — "Technical analysis" → navigates to `/parallax`
  - MoonMarket — "Portfolio & trading" → navigates to `/moonmarket`
  - Inflect — "Trading journal" — always disabled, `badge="Soon"`
- **Pre-auth state:** Parallax + MoonMarket tiles grayed/disabled (`enabled={isAuthenticated}`); pill shows a red/amber dot + state label; **popover auto-opens** so the connect flow is immediately visible.
- **Post-auth state:** tiles colorize and become clickable; pill turns green ("IBKR connected"); popover auto-closes. Clicking the pill reopens the popover (which then shows `GatewaySetup`'s running state: Logout / Restart Gateway).

---

## Components

### `GatewayStatusPill.tsx` (new) — `src/orbit/GatewayStatusPill.tsx`
- Reads `useGatewayContext()` (`status`, `isAuthenticated`, `needsLogin`).
- Renders a pill button: a status dot + short label + chevron.
  - Dot/label derivation:
    - `status.state === "running" && isAuthenticated` → green, "IBKR connected"
    - `status.state === "running" && needsLogin` → amber, "login required"
    - `status.state === "error"` → red, "error"
    - otherwise → red/neutral, "set up IBKR" (covers `not_provisioned`, `provisioned`, `downloading_*`, `starting`, `stopping`, missing status)
- Owns popover open/close state:
  - Default **open when `!isAuthenticated`**; an effect sets it closed when `isAuthenticated` becomes `true`.
  - Clicking the pill toggles open/closed.
  - Click-outside (and `Escape`) closes it.
- Popover body renders the existing **`<GatewaySetup />`** verbatim (all provision/download/start/login/recovery states come for free). The popover is a positioned panel anchored to the pill (right-aligned under the top bar).

### `AppIcon.tsx` (extend) — `src/orbit/AppIcon.tsx`
- Add optional prop `description?: string`.
- When provided, render it as a small muted line beneath the label.
- Backward compatible: omitting `description` renders exactly as today (foundation tests stay green).
- Disabled tiles get `title="Connect IBKR to open"`.

### `OrbitLauncher.tsx` (rewrite) — `src/orbit/OrbitLauncher.tsx`
- Compose: a top bar (`ORBIT` wordmark + `<GatewayStatusPill />`) and a centered hero grid of three `<AppIcon />`s with descriptions.
- Remove the `import ConnectionPage` and its embed.
- Keep using `useNavigate()` for the enabled tiles and `useGatewayContext().isAuthenticated` for gating.

---

## Behavior details

- **Auto-open popover:** open by default while unauthenticated; close automatically on the `isAuthenticated` false→true transition. Manual pill click toggles thereafter.
- **Dismissal:** click-outside and `Escape` close the popover.
- **Gating:** Parallax/MoonMarket `enabled={isAuthenticated}`; Inflect always `enabled={false}` with `badge="Soon"`.
- **No new gateway logic:** all connect/auth actions flow through the existing `GatewaySetup` + `GatewayContext`. The pill is a presentational shell + popover host.

---

## Testing

- **`GatewayStatusPill`** (`src/orbit/__tests__/GatewayStatusPill.test.tsx`): mock `useGatewayContext` and stub `GatewaySetup`.
  - Renders the correct label/dot for: authenticated (green "IBKR connected"), running+needsLogin (amber "login required"), not-set-up (red "set up IBKR"), error (red "error").
  - Popover is open by default when unauthenticated; closed when authenticated.
  - Clicking the pill toggles the popover.
- **`AppIcon`** (`src/orbit/__tests__/AppIcon.test.tsx`): keep existing 3 tests; add one asserting `description` text renders when provided and is absent when omitted.
- **`OrbitLauncher`** (`src/orbit/__tests__/OrbitLauncher.test.tsx`): update — tiles disabled when unauthenticated, enabled + navigate to `/parallax` / `/moonmarket` when authenticated, Inflect always disabled; assert the launcher no longer renders `ConnectionPage` (it renders the pill instead).

---

## Success criteria

- One cohesive launcher screen: top bar (brand + status pill) + three hero tiles with descriptions; no nested full-screen `ConnectionPage`, no double branding.
- Pre-auth: connect popover is immediately visible; tiles gray. Post-auth: tiles colorize + navigate; pill green; popover closed (reopens on click for Logout/Restart).
- Full provisioning/login/recovery flow works unchanged (reused `GatewaySetup`).
- `npm run typecheck` adds no new errors; `npm run test` stays green (existing + new tests).
