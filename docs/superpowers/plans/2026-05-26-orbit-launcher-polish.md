# Orbit Launcher Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Orbit launcher skeleton with the real combined auth + launcher screen — a slim top bar (`ORBIT` wordmark + IBKR status pill with a connect popover) over three hero app tiles that gray→colorize on authentication.

**Architecture:** Add a `GatewayStatusPill` that derives a status dot/label from the existing `useGatewayContext()` and hosts a popover rendering the existing `GatewaySetup` verbatim (no gateway logic reimplemented). Extend `AppIcon` with an optional one-line `description`. Rewrite `OrbitLauncher` to compose the top bar + hero grid and stop embedding `ConnectionPage` (which stays for Parallax's in-module re-auth).

**Tech Stack:** Vite + React 19 + TypeScript, react-router-dom v7, Tailwind v4, lucide-react, Vitest + @testing-library/react.

---

## Conventions

- **Repo:** `/Users/benarojasmac/Desktop/Projects/Orbit` (the renamed Parallax repo). Path alias `@/` → `src/`.
- **Branch:** work on `feature/orbit-launcher-polish` (already created from `dev`). Stay on it.
- **Run one test file:** `npm run test -- <path>`. Full suite: `npm run test`. Typecheck: `npm run typecheck`.
- **Baseline:** full suite is **528 passing**. `npm run typecheck` has ~20 KNOWN PRE-EXISTING errors in unrelated test files (`DrawingsLayer.test.tsx`, `screener.test.ts`, `MarketPulse.test.tsx`, `useGateway.test.ts`) — do not fix those; just introduce no NEW errors.
- **Context — `useGatewayContext()`** (from `@/context/GatewayContext`) returns, among others: `status` (nullable; `status.state` is a `GatewayState` string like `not_provisioned` / `provisioned` / `downloading_jre` / `starting` / `running` / `error`), `isAuthenticated: boolean`, `needsLogin: boolean`. `GatewaySetup` (from `@/components/gateway/GatewaySetup`) is a self-contained card that renders every gateway state; it accepts `{ hideLogout?: boolean }`.

## File Structure

- **Modify** `src/orbit/AppIcon.tsx` — add optional `description?: string`.
- **Modify** `src/orbit/__tests__/AppIcon.test.tsx` — add one test (keep existing three).
- **Create** `src/orbit/GatewayStatusPill.tsx` — status pill + connect popover hosting `GatewaySetup`.
- **Create** `src/orbit/__tests__/GatewayStatusPill.test.tsx`.
- **Modify** `src/orbit/OrbitLauncher.tsx` — rewrite to top bar + hero grid; drop `ConnectionPage`.
- **Modify** `src/orbit/__tests__/OrbitLauncher.test.tsx` — rewrite (remove ConnectionPage assertion, stub the pill, badge "Soon").

---

### Task 1: Extend `AppIcon` with an optional description

**Files:**
- Modify: `src/orbit/AppIcon.tsx`
- Test: `src/orbit/__tests__/AppIcon.test.tsx`

- [ ] **Step 1: Add the failing test**

Append this test inside the existing `describe("AppIcon", ...)` block in `src/orbit/__tests__/AppIcon.test.tsx` (keep all three current tests unchanged):
```tsx
  it("renders a description when provided", () => {
    render(<AppIcon label="Parallax" icon={Activity} enabled description="Technical analysis" />);
    expect(screen.getByText(/technical analysis/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/orbit/__tests__/AppIcon.test.tsx`
Expected: the new test FAILS (no "technical analysis" text rendered); the other three still pass.

- [ ] **Step 3: Implement the `description` prop**

Replace the entire contents of `src/orbit/AppIcon.tsx` with:
```tsx
/**
 * AppIcon — one launcher tile. Enabled tiles colorize and are clickable;
 * disabled tiles render gray with reduced opacity and are non-interactive
 * (used while IBKR is unauthenticated, or for not-yet-built modules).
 */
import { type LucideIcon } from "lucide-react";

interface AppIconProps {
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  onOpen?: () => void;
  badge?: string;
  description?: string;
}

export function AppIcon({ label, icon: Icon, enabled, onOpen, badge, description }: AppIconProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!enabled}
      onClick={enabled ? onOpen : undefined}
      title={enabled ? undefined : "Connect IBKR to open"}
      className={[
        "relative flex h-44 w-44 flex-col items-center justify-center gap-2",
        "rounded-2xl border transition-all",
        enabled
          ? "border-border bg-[var(--bg-2)] text-foreground hover:shadow-[0_0_18px_var(--glow-cyan)] hover:border-[var(--clr-cyan)] cursor-pointer"
          : "border-border/40 bg-[var(--bg-2)]/40 text-[var(--text-3)] opacity-40 cursor-not-allowed grayscale",
      ].join(" ")}
    >
      <Icon className="h-12 w-12" strokeWidth={1.5} />
      <span className="text-[13px] font-semibold tracking-wide">{label}</span>
      {description && (
        <span className="text-[10px] text-[var(--text-3)]">{description}</span>
      )}
      {badge && (
        <span className="absolute right-2 top-2 rounded-full border border-border bg-[var(--bg-1)] px-2 py-0.5 text-[9px] font-medium text-[var(--text-3)]">
          {badge}
        </span>
      )}
    </button>
  );
}
```
(Changes vs. current: added `description?` to the interface and destructure, render it as a muted line under the label, added a `title` on disabled tiles, and bumped the tile to `h-44 w-44` with `gap-2` to fit three lines.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/orbit/__tests__/AppIcon.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orbit/AppIcon.tsx src/orbit/__tests__/AppIcon.test.tsx
git commit -m "feat: add optional description to AppIcon tile"
```

---

### Task 2: `GatewayStatusPill` — status pill + connect popover

**Files:**
- Create: `src/orbit/GatewayStatusPill.tsx`
- Test: `src/orbit/__tests__/GatewayStatusPill.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/orbit/__tests__/GatewayStatusPill.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mutable mock context so each test can set the gateway state.
let ctx: { status: { state: string } | null; isAuthenticated: boolean; needsLogin: boolean };
vi.mock("@/context/GatewayContext", () => ({
  useGatewayContext: () => ctx,
}));

// Stub the heavy gateway card so the test focuses on the pill + popover.
vi.mock("@/components/gateway/GatewaySetup", () => ({
  GatewaySetup: () => <div data-testid="gateway-setup" />,
}));

import { GatewayStatusPill } from "@/orbit/GatewayStatusPill";

describe("GatewayStatusPill", () => {
  beforeEach(() => {
    ctx = { status: null, isAuthenticated: false, needsLogin: false };
  });

  it("shows green 'connected' and starts closed when authenticated", () => {
    ctx = { status: { state: "running" }, isAuthenticated: true, needsLogin: false };
    render(<GatewayStatusPill />);
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.queryByTestId("gateway-setup")).not.toBeInTheDocument();
  });

  it("auto-opens the popover (GatewaySetup) when unauthenticated", () => {
    ctx = { status: { state: "not_provisioned" }, isAuthenticated: false, needsLogin: false };
    render(<GatewayStatusPill />);
    expect(screen.getByText(/set up/i)).toBeInTheDocument();
    expect(screen.getByTestId("gateway-setup")).toBeInTheDocument();
  });

  it("shows amber 'login required' when running but not authenticated", () => {
    ctx = { status: { state: "running" }, isAuthenticated: false, needsLogin: true };
    render(<GatewayStatusPill />);
    expect(screen.getByText(/login required/i)).toBeInTheDocument();
  });

  it("toggles the popover when the pill is clicked", () => {
    ctx = { status: { state: "running" }, isAuthenticated: true, needsLogin: false };
    render(<GatewayStatusPill />);
    expect(screen.queryByTestId("gateway-setup")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ibkr/i }));
    expect(screen.getByTestId("gateway-setup")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/orbit/__tests__/GatewayStatusPill.test.tsx`
Expected: FAIL — `Cannot find module '@/orbit/GatewayStatusPill'`.

- [ ] **Step 3: Implement the pill**

Create `src/orbit/GatewayStatusPill.tsx`:
```tsx
/**
 * GatewayStatusPill — top-bar IBKR status pill + connect popover.
 *
 * Derives a status dot + label from the gateway context. Clicking the pill
 * toggles a popover that renders the existing GatewaySetup verbatim (all
 * provision / download / start / login / recovery states reused). The popover
 * auto-opens while unauthenticated so the connect flow is immediately visible,
 * and closes once authenticated.
 */
import { useEffect, useRef, useState } from "react";
import { useGatewayContext } from "@/context/GatewayContext";
import { GatewaySetup } from "@/components/gateway/GatewaySetup";

type Tone = "green" | "amber" | "red";

function toneColor(tone: Tone): string {
  return tone === "green"
    ? "var(--clr-green)"
    : tone === "amber"
      ? "var(--clr-orange)"
      : "var(--clr-red)";
}

export function GatewayStatusPill() {
  const { status, isAuthenticated, needsLogin } = useGatewayContext();
  const [open, setOpen] = useState(!isAuthenticated);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close automatically once authenticated — the connect flow is done.
  useEffect(() => {
    if (isAuthenticated) setOpen(false);
  }, [isAuthenticated]);

  // Click-outside + Escape close the popover.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const { tone, label }: { tone: Tone; label: string } = (() => {
    const state = status?.state;
    if (state === "running" && isAuthenticated) return { tone: "green", label: "connected" };
    if (state === "running" && needsLogin) return { tone: "amber", label: "login required" };
    if (state === "error") return { tone: "red", label: "error" };
    return { tone: "red", label: "set up" };
  })();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border bg-[var(--bg-2)] px-3 py-1 text-[11px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--clr-cyan)]"
      >
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: toneColor(tone), boxShadow: `0 0 6px ${toneColor(tone)}` }}
        />
        IBKR · {label}
        <span className="text-[var(--text-3)]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[300px] rounded-xl border border-border bg-[var(--bg-2)] p-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
          <GatewaySetup hideLogout={false} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/orbit/__tests__/GatewayStatusPill.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orbit/GatewayStatusPill.tsx src/orbit/__tests__/GatewayStatusPill.test.tsx
git commit -m "feat: add GatewayStatusPill with connect popover"
```

---

### Task 3: Rewrite `OrbitLauncher` to the top bar + hero grid

**Files:**
- Modify: `src/orbit/OrbitLauncher.tsx`
- Test: `src/orbit/__tests__/OrbitLauncher.test.tsx`

- [ ] **Step 1: Rewrite the test to the new layout**

Replace the entire contents of `src/orbit/__tests__/OrbitLauncher.test.tsx` with:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

let authed = false;
vi.mock("@/context/GatewayContext", () => ({
  useGatewayContext: () => ({ isAuthenticated: authed }),
}));

// The pill is tested separately; stub it here so this test stays focused on
// the launcher's gating + navigation.
vi.mock("@/orbit/GatewayStatusPill", () => ({
  GatewayStatusPill: () => <div data-testid="gateway-status-pill" />,
}));

import { OrbitLauncher } from "@/orbit/OrbitLauncher";

describe("OrbitLauncher", () => {
  beforeEach(() => {
    navigate.mockClear();
    authed = false;
  });

  it("renders the status pill and disables app tiles when unauthenticated", () => {
    render(<OrbitLauncher />);
    expect(screen.getByTestId("gateway-status-pill")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /parallax/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /moonmarket/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /inflect/i })).toBeDisabled();
  });

  it("enables Parallax/MoonMarket and navigates on click when authenticated", () => {
    authed = true;
    render(<OrbitLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /parallax/i }));
    expect(navigate).toHaveBeenCalledWith("/parallax");
    fireEvent.click(screen.getByRole("button", { name: /moonmarket/i }));
    expect(navigate).toHaveBeenCalledWith("/moonmarket");
  });

  it("keeps Inflect disabled with a Soon badge even when authenticated", () => {
    authed = true;
    render(<OrbitLauncher />);
    expect(screen.getByRole("button", { name: /inflect/i })).toBeDisabled();
    expect(screen.getByText(/soon/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/orbit/__tests__/OrbitLauncher.test.tsx`
Expected: FAIL — the current `OrbitLauncher` renders `ConnectionPage` and has no `gateway-status-pill`, and its Inflect badge is "Coming soon" not "Soon". (The "renders the status pill" assertion fails first.)

- [ ] **Step 3: Rewrite `OrbitLauncher`**

Replace the entire contents of `src/orbit/OrbitLauncher.tsx` with:
```tsx
/**
 * OrbitLauncher — route "/". Combined auth + launcher.
 *
 * Slim top bar (ORBIT wordmark + GatewayStatusPill) over three hero app tiles.
 * Tiles gray/disabled until IBKR is authenticated, then colorize and navigate
 * into their modules. Inflect is always disabled ("Soon"). The IBKR connect
 * flow lives in the pill's popover (auto-opens until authenticated).
 */
import { useNavigate } from "react-router-dom";
import { Activity, Briefcase, NotebookPen } from "lucide-react";
import { useGatewayContext } from "@/context/GatewayContext";
import { AppIcon } from "./AppIcon";
import { GatewayStatusPill } from "./GatewayStatusPill";

export function OrbitLauncher() {
  const navigate = useNavigate();
  const { isAuthenticated } = useGatewayContext();

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-1)]">
      {/* Top bar */}
      <nav className="relative z-10 flex min-h-12 items-center justify-between border-b border-border px-5 py-2">
        <span className="text-[16px] font-extrabold tracking-[4px] text-gradient-brand">
          ORBIT
        </span>
        <GatewayStatusPill />
      </nav>

      {/* Hero tiles */}
      <main className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex flex-wrap items-center justify-center gap-6">
          <AppIcon
            label="Parallax"
            icon={Activity}
            description="Technical analysis"
            enabled={isAuthenticated}
            onOpen={() => navigate("/parallax")}
          />
          <AppIcon
            label="MoonMarket"
            icon={Briefcase}
            description="Portfolio & trading"
            enabled={isAuthenticated}
            onOpen={() => navigate("/moonmarket")}
          />
          <AppIcon
            label="Inflect"
            icon={NotebookPen}
            description="Trading journal"
            enabled={false}
            badge="Soon"
          />
        </div>
        {!isAuthenticated && (
          <p className="text-[11px] text-[var(--text-3)]">
            Connect IBKR to open your apps.
          </p>
        )}
      </main>
    </div>
  );
}
```
(The `ConnectionPage` import and embed are removed entirely.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/orbit/__tests__/OrbitLauncher.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orbit/OrbitLauncher.tsx src/orbit/__tests__/OrbitLauncher.test.tsx
git commit -m "feat: rewrite OrbitLauncher to top bar + hero tiles with connect popover"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck — no new errors**

Run: `npm run typecheck`
Expected: only the ~20 KNOWN PRE-EXISTING errors (in `DrawingsLayer.test.tsx`, `screener.test.ts`, `MarketPulse.test.tsx`, `useGateway.test.ts`). Confirm there are NO errors in `src/orbit/AppIcon.tsx`, `src/orbit/GatewayStatusPill.tsx`, `src/orbit/OrbitLauncher.tsx`, or any `src/orbit/__tests__/*`. If a new error appears in those files, fix it before proceeding.

- [ ] **Step 2: Full test suite — green**

Run: `npm run test`
Expected: all pass. Count = previous 528 baseline + 1 (AppIcon) + 4 (GatewayStatusPill) = **533**, with `OrbitLauncher` still at 3. Report the exact total.

- [ ] **Step 3: Manual smoke (human, with the dev app running)**

With `npm run tauri dev` (or `npm run dev` + backend) running, verify at `/`:
1. Pre-auth: `ORBIT` top bar with a red "IBKR · set up" pill; the connect popover is **auto-open** showing the gateway setup; the three tiles are gray/disabled.
2. Complete the gateway connect + IBKR login.
3. Post-auth: pill turns green "IBKR · connected" and the popover closes; Parallax + MoonMarket tiles colorize and open their modules; clicking the green pill reopens the popover (Logout / Restart Gateway visible); Inflect stays disabled with a "Soon" badge.

This step is manual; it does not block committing the code tasks above.

---

## Self-Review

**Spec coverage (against `2026-05-26-orbit-launcher-polish-design.md`):**
- Top bar (brand + pill) + hero grid layout → Task 3.
- `GatewayStatusPill` (dot/label derivation, popover hosting `GatewaySetup`, auto-open pre-auth, close on auth, toggle, click-outside/Escape) → Task 2.
- `AppIcon` `description` (backward compatible) → Task 1.
- Launcher stops embedding `ConnectionPage` → Task 3 (import + embed removed; test no longer asserts it).
- Tiles gated on auth, Inflect always disabled "Soon" → Task 3.
- Tests for all three components → Tasks 1–3; verification → Task 4.
- `ConnectionPage`/`GatewaySetup` internals unchanged → no task modifies them (pill imports `GatewaySetup` as-is).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete file contents or an exact append. Step 3 of Task 4 is explicitly flagged manual.

**Type/name consistency:** `GatewayStatusPill` (default-less named export), `AppIcon` prop `description?: string`, `OrbitLauncher` imports `./GatewayStatusPill` and `./AppIcon`, navigation targets `/parallax` and `/moonmarket`, Inflect `badge="Soon"` matched by test `/soon/i`, pill labels `connected` / `login required` / `error` / `set up` matched by the pill tests. The pill reads `status?.state`, `isAuthenticated`, `needsLogin` — consistent with `useGatewayContext()` as used by `GatewaySetup`.
