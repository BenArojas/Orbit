# Orbit Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Orbit as one Tauri binary / one React app: a top-level router with a launcher screen whose app icons are grayed until IBKR is authenticated, the existing Parallax app mounted under `/parallax`, a MoonMarket stub under `/moonmarket`, and a consolidated FastAPI sidecar that already answers a `/moonmarket/*` route prefix.

**Architecture:** Promote the existing **Parallax repo** into the `orbit` monorepo (it is already on the target stack and already owns the IBKR gateway/auth primitives). Keep Parallax's `src/` as the app skeleton; layer an Orbit routing shell (`src/orbit/`) on top using React Router. Providers (`QueryClientProvider`, `GatewayProvider`, `TooltipProvider`, `Toaster`) hoist to an Orbit root so the launcher can read IBKR auth state. The current Parallax `AppShell` becomes the `/parallax/*` module; MoonMarket is a stub module now and gets ported in later plans. The backend gains a `/moonmarket`-prefixed router to prove the single-sidecar pattern.

**Tech Stack:** Vite + React 19 + TypeScript, Zustand (Parallax internal nav), **react-router-dom v7 (new)**, TanStack Query v5, Tauri v2, FastAPI + uv (Python 3.12), Vitest + Testing Library (frontend), pytest (backend).

---

## Conventions for this plan

- **Repo:** all paths are relative to the promoted Orbit repo root (`/Users/benarojasmac/Desktop/Projects/Orbit`).
- **Branch/commit policy** (Orbit git policy): branch from `dev`, one `feature/*` branch, commits `type: description`, squash-merge to `dev` via PR. This plan uses a single branch `feature/orbit-foundation`.
- **Frontend tests:** `npm run test` (Vitest). **Backend tests:** `cd backend && uv run pytest`.
- The Orbit launcher in this plan is a **functional skeleton**, not the final polished combined auth+launcher screen — that polish is Plan #2. Here it must: read IBKR auth, gray/disable icons when unauthenticated, colorize/enable + navigate when authenticated, and reuse Parallax's existing `ConnectionPage` for the actual login flow.

---

## File Structure

**Create:**
- `src/orbit/OrbitProviders.tsx` — hoisted app-wide providers (Query, Gateway, Tooltip) + Toaster.
- `src/orbit/OrbitShell.tsx` — React Router definition: `/` launcher, `/parallax/*`, `/moonmarket/*`.
- `src/orbit/OrbitLauncher.tsx` — combined screen skeleton: gateway/auth block + gated icon grid.
- `src/orbit/AppIcon.tsx` — a single launcher icon (enabled/colored vs disabled/gray).
- `src/orbit/__tests__/AppIcon.test.tsx`
- `src/orbit/__tests__/OrbitLauncher.test.tsx`
- `src/orbit/__tests__/OrbitShell.test.tsx`
- `src/modules/parallax/ParallaxModule.tsx` — the existing Parallax `AppShell` body (providers removed), plus a "back to Orbit" affordance.
- `src/modules/moonmarket/MoonMarketModule.tsx` — stub "coming soon" screen + back-to-Orbit.
- `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`
- `backend/routers/moonmarket.py` — `APIRouter(prefix="/moonmarket")` with a health route.
- `backend/tests/test_moonmarket_router.py`

**Modify:**
- `src/App.tsx` — strip providers (they move to `OrbitProviders`); export the shell body as the Parallax module.
- `src/main.tsx` — render `OrbitProviders` + `RouterProvider`.
- `backend/main.py:364-368` — include the moonmarket router.
- `src-tauri/tauri.conf.json` — product name/title → "Orbit".
- `package.json` — add `react-router-dom`.

---

### Task 1: Repo promotion + dependency + product rename

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json:3`, `:14`
- Manual: GitHub repo rename

- [ ] **Step 1: Create the working branch**

Run from the Orbit repo root:
```bash
git checkout dev && git pull origin dev
git checkout -b feature/orbit-foundation
```

- [ ] **Step 2: Install React Router**

Run:
```bash
npm install react-router-dom@^7
```
Expected: `package.json` `dependencies` gains `"react-router-dom": "^7.x"`, install completes with no peer-dep errors against React 19.

- [ ] **Step 3: Rename the Tauri product to "Orbit"**

In `src-tauri/tauri.conf.json`, change:
```json
  "productName": "Orbit",
```
and inside `app.windows[0]`:
```json
        "title": "Orbit",
```
Leave `identifier` (`com.parallax.trading`) and `externalBin` (`binaries/parallax-backend`) unchanged in this plan — renaming the bundle identifier and sidecar binary is a release-packaging concern handled later, and changing them now would break the existing sidecar wiring.

- [ ] **Step 4: Verify the app still builds and boots**

Run:
```bash
npm run typecheck
npm run test
```
Expected: typecheck passes; existing Vitest suite passes (no behavior changed yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src-tauri/tauri.conf.json
git commit -m "chore: add react-router-dom, rename product to Orbit"
```

- [ ] **Step 6 (MANUAL — human, not agent): Rename the GitHub repo**

On GitHub, rename `BenArojas/Parallax` → `BenArojas/orbit` (Settings → Repository name). GitHub auto-redirects the old URL, so existing remotes keep working. Optionally update the local remote:
```bash
git remote set-url origin https://github.com/BenArojas/orbit.git
```
This step is informational; it does not block the rest of the plan.

---

### Task 2: Hoist providers out of `App.tsx` into `OrbitProviders`

The launcher must read IBKR auth state via `useGatewayContext()`, so `GatewayProvider` (and the other app-wide providers) must wrap the router, not live inside the Parallax shell.

**Files:**
- Create: `src/orbit/OrbitProviders.tsx`
- Modify: `src/App.tsx:270-285` (the `App` default export)

- [ ] **Step 1: Create `OrbitProviders`**

Create `src/orbit/OrbitProviders.tsx`:
```tsx
/**
 * OrbitProviders — app-wide context providers, hoisted above the router so
 * every module (and the launcher itself) shares one QueryClient, one IBKR
 * gateway/session context, and one toast layer.
 */
import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { GatewayProvider } from "@/context/GatewayContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/Toaster";

export function OrbitProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <GatewayProvider>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </GatewayProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Strip providers from `App.tsx`**

In `src/App.tsx`, replace the `App` default export (currently lines ~270-285) with a thin wrapper that renders only the shell (providers now come from `OrbitProviders`):
```tsx
export default function App() {
  return <AppShell />;
}
```
Leave `AppShell`, `useGlobalEffects`, and everything above it unchanged. Remove the now-unused imports `QueryClientProvider`, `queryClient`, `GatewayProvider`, `TooltipProvider`, `Toaster` from `App.tsx` only if TypeScript flags them as unused (it will — delete those specific import lines).

- [ ] **Step 3: Run typecheck and tests**

Run:
```bash
npm run typecheck && npm run test
```
Expected: passes. `App` is not yet mounted anywhere new — `main.tsx` still imports it (next task replaces that). No runtime change yet because `main.tsx` is updated in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/orbit/OrbitProviders.tsx src/App.tsx
git commit -m "refactor: hoist app providers into OrbitProviders"
```

---

### Task 3: `AppIcon` component (enabled vs disabled)

**Files:**
- Create: `src/orbit/AppIcon.tsx`
- Test: `src/orbit/__tests__/AppIcon.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/orbit/__tests__/AppIcon.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppIcon } from "@/orbit/AppIcon";
import { Activity } from "lucide-react";

describe("AppIcon", () => {
  it("is clickable and calls onOpen when enabled", () => {
    const onOpen = vi.fn();
    render(<AppIcon label="Parallax" icon={Activity} enabled onOpen={onOpen} />);
    const btn = screen.getByRole("button", { name: /parallax/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("is disabled and does not call onOpen when not enabled", () => {
    const onOpen = vi.fn();
    render(<AppIcon label="MoonMarket" icon={Activity} enabled={false} onOpen={onOpen} />);
    const btn = screen.getByRole("button", { name: /moonmarket/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows a badge when provided", () => {
    render(<AppIcon label="Inflect" icon={Activity} enabled={false} badge="Coming soon" />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npm run test -- src/orbit/__tests__/AppIcon.test.tsx
```
Expected: FAIL — `Cannot find module '@/orbit/AppIcon'`.

- [ ] **Step 3: Implement `AppIcon`**

Create `src/orbit/AppIcon.tsx`:
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
}

export function AppIcon({ label, icon: Icon, enabled, onOpen, badge }: AppIconProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!enabled}
      onClick={enabled ? onOpen : undefined}
      className={[
        "relative flex h-40 w-40 flex-col items-center justify-center gap-3",
        "rounded-2xl border transition-all",
        enabled
          ? "border-border bg-[var(--bg-2)] text-foreground hover:shadow-[0_0_18px_var(--glow-cyan)] hover:border-[var(--clr-cyan)] cursor-pointer"
          : "border-border/40 bg-[var(--bg-2)]/40 text-[var(--text-3)] opacity-40 cursor-not-allowed grayscale",
      ].join(" ")}
    >
      <Icon className="h-12 w-12" strokeWidth={1.5} />
      <span className="text-[13px] font-semibold tracking-wide">{label}</span>
      {badge && (
        <span className="absolute right-2 top-2 rounded-full border border-border bg-[var(--bg-1)] px-2 py-0.5 text-[9px] font-medium text-[var(--text-3)]">
          {badge}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npm run test -- src/orbit/__tests__/AppIcon.test.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orbit/AppIcon.tsx src/orbit/__tests__/AppIcon.test.tsx
git commit -m "feat: add AppIcon launcher tile component"
```

---

### Task 4: `OrbitLauncher` — gated icon grid + auth block

**Files:**
- Create: `src/orbit/OrbitLauncher.tsx`
- Test: `src/orbit/__tests__/OrbitLauncher.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/orbit/__tests__/OrbitLauncher.test.tsx`. The launcher's icon gating is driven by `useGatewayContext().isAuthenticated`; we mock that context and the routing `useNavigate`, and stub `ConnectionPage` so the test focuses on gating.
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

let authed = false;
vi.mock("@/context/GatewayContext", () => ({
  useGatewayContext: () => ({ isAuthenticated: authed }),
}));

vi.mock("@/pages/ConnectionPage", () => ({
  default: () => <div data-testid="connection-page" />,
}));

import { OrbitLauncher } from "@/orbit/OrbitLauncher";

describe("OrbitLauncher", () => {
  beforeEach(() => {
    navigate.mockClear();
    authed = false;
  });

  it("disables Parallax and MoonMarket icons when unauthenticated", () => {
    render(<OrbitLauncher />);
    expect(screen.getByRole("button", { name: /parallax/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /moonmarket/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /inflect/i })).toBeDisabled();
    // Auth flow is reachable while unauthenticated.
    expect(screen.getByTestId("connection-page")).toBeInTheDocument();
  });

  it("enables Parallax/MoonMarket and navigates on click when authenticated", () => {
    authed = true;
    render(<OrbitLauncher />);
    const parallax = screen.getByRole("button", { name: /parallax/i });
    expect(parallax).not.toBeDisabled();
    fireEvent.click(parallax);
    expect(navigate).toHaveBeenCalledWith("/parallax");

    fireEvent.click(screen.getByRole("button", { name: /moonmarket/i }));
    expect(navigate).toHaveBeenCalledWith("/moonmarket");
  });

  it("keeps Inflect disabled even when authenticated (coming soon)", () => {
    authed = true;
    render(<OrbitLauncher />);
    expect(screen.getByRole("button", { name: /inflect/i })).toBeDisabled();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npm run test -- src/orbit/__tests__/OrbitLauncher.test.tsx
```
Expected: FAIL — `Cannot find module '@/orbit/OrbitLauncher'`.

- [ ] **Step 3: Implement `OrbitLauncher`**

Create `src/orbit/OrbitLauncher.tsx`:
```tsx
/**
 * OrbitLauncher — route "/". Combined auth + launcher (skeleton).
 *
 * Reads IBKR auth from the shared gateway context. While unauthenticated it
 * renders Parallax's existing ConnectionPage (the proven login flow) and shows
 * the app icons grayed/disabled. Once authenticated the Parallax and MoonMarket
 * icons colorize and navigate into their modules. Inflect stays "Coming soon".
 *
 * Plan #2 polishes this into the final single-screen layout; here it is a
 * functional skeleton that correctly gates on auth.
 */
import { useNavigate } from "react-router-dom";
import { Activity, Briefcase, NotebookPen } from "lucide-react";
import { useGatewayContext } from "@/context/GatewayContext";
import ConnectionPage from "@/pages/ConnectionPage";
import { AppIcon } from "./AppIcon";

export function OrbitLauncher() {
  const navigate = useNavigate();
  const { isAuthenticated } = useGatewayContext();

  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-[var(--bg-1)]">
      <header className="px-6 pt-8 text-center">
        <h1 className="text-[22px] font-extrabold tracking-[4px] text-gradient-brand">
          ORBIT
        </h1>
      </header>

      {!isAuthenticated && (
        <section className="mx-auto w-full max-w-2xl px-6 py-6">
          <ConnectionPage />
        </section>
      )}

      <section className="flex flex-wrap items-center justify-center gap-6 px-6 py-10">
        <AppIcon
          label="Parallax"
          icon={Activity}
          enabled={isAuthenticated}
          onOpen={() => navigate("/parallax")}
        />
        <AppIcon
          label="MoonMarket"
          icon={Briefcase}
          enabled={isAuthenticated}
          onOpen={() => navigate("/moonmarket")}
        />
        <AppIcon
          label="Inflect"
          icon={NotebookPen}
          enabled={false}
          badge="Coming soon"
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npm run test -- src/orbit/__tests__/OrbitLauncher.test.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orbit/OrbitLauncher.tsx src/orbit/__tests__/OrbitLauncher.test.tsx
git commit -m "feat: add OrbitLauncher with auth-gated app icons"
```

---

### Task 5: Parallax + MoonMarket modules and the router

**Files:**
- Create: `src/modules/parallax/ParallaxModule.tsx`
- Create: `src/modules/moonmarket/MoonMarketModule.tsx`
- Test: `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`
- Create: `src/orbit/OrbitShell.tsx`
- Test: `src/orbit/__tests__/OrbitShell.test.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create the Parallax module wrapper**

Create `src/modules/parallax/ParallaxModule.tsx`. It renders the existing Parallax shell (the default export of `App.tsx`, now provider-free after Task 2):
```tsx
/**
 * ParallaxModule — mounts the existing Parallax app shell under /parallax/*.
 * Providers are supplied by OrbitProviders, so this just renders the shell.
 */
import ParallaxApp from "@/App";

export function ParallaxModule() {
  return <ParallaxApp />;
}
```

- [ ] **Step 2: Write the failing MoonMarket module test**

Create `src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

import { MoonMarketModule } from "@/modules/moonmarket/MoonMarketModule";

describe("MoonMarketModule", () => {
  it("renders the placeholder and navigates back to Orbit", () => {
    render(<MoonMarketModule />);
    expect(screen.getByText(/moonmarket/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to orbit/i }));
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
npm run test -- src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
```
Expected: FAIL — `Cannot find module '@/modules/moonmarket/MoonMarketModule'`.

- [ ] **Step 4: Implement the MoonMarket stub module**

Create `src/modules/moonmarket/MoonMarketModule.tsx`:
```tsx
/**
 * MoonMarketModule — stub mounted under /moonmarket/*. Real pages (Portfolio,
 * Transactions, shared OrderTicket) are ported in later plans. For the
 * foundation it proves the route mounts and can return to Orbit.
 */
import { useNavigate } from "react-router-dom";
import { Briefcase } from "lucide-react";

export function MoonMarketModule() {
  const navigate = useNavigate();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[var(--bg-1)] text-foreground">
      <Briefcase className="h-12 w-12 text-[var(--text-3)]" strokeWidth={1.5} />
      <h1 className="text-lg font-semibold">MoonMarket</h1>
      <p className="text-[12px] text-[var(--text-3)]">
        Portfolio and trading are being ported here.
      </p>
      <button
        type="button"
        onClick={() => navigate("/")}
        className="rounded-md border border-border px-3 py-1 text-[11px] text-[var(--text-2)] hover:border-[var(--clr-cyan)]"
      >
        ← Back to Orbit
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run the MoonMarket test to verify it passes**

Run:
```bash
npm run test -- src/modules/moonmarket/__tests__/MoonMarketModule.test.tsx
```
Expected: PASS (1 test).

- [ ] **Step 6: Write the failing router test**

Create `src/orbit/__tests__/OrbitShell.test.tsx`. We render the router at specific entries using `createMemoryRouter` and assert the right screen mounts. Stub the heavy Parallax module and the launcher to keep this a pure routing test.
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { orbitRoutes } from "@/orbit/OrbitShell";

vi.mock("@/orbit/OrbitLauncher", () => ({
  OrbitLauncher: () => <div data-testid="launcher" />,
}));
vi.mock("@/modules/parallax/ParallaxModule", () => ({
  ParallaxModule: () => <div data-testid="parallax" />,
}));
vi.mock("@/modules/moonmarket/MoonMarketModule", () => ({
  MoonMarketModule: () => <div data-testid="moonmarket" />,
}));

function renderAt(path: string) {
  const router = createMemoryRouter(orbitRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

describe("orbitRoutes", () => {
  it("renders the launcher at /", () => {
    renderAt("/");
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
  });
  it("renders Parallax at /parallax", () => {
    renderAt("/parallax");
    expect(screen.getByTestId("parallax")).toBeInTheDocument();
  });
  it("renders MoonMarket at /moonmarket", () => {
    renderAt("/moonmarket");
    expect(screen.getByTestId("moonmarket")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the router test to verify it fails**

Run:
```bash
npm run test -- src/orbit/__tests__/OrbitShell.test.tsx
```
Expected: FAIL — `orbitRoutes` is not exported from `@/orbit/OrbitShell`.

- [ ] **Step 8: Implement the router**

Create `src/orbit/OrbitShell.tsx`:
```tsx
/**
 * OrbitShell — top-level route table for the Orbit.
 *   /              → OrbitLauncher (combined auth + launcher)
 *   /parallax/*    → existing Parallax app
 *   /moonmarket/*  → MoonMarket (stub for now)
 *
 * `orbitRoutes` is exported separately so tests can mount it with a memory router.
 */
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { OrbitLauncher } from "./OrbitLauncher";
import { ParallaxModule } from "@/modules/parallax/ParallaxModule";
import { MoonMarketModule } from "@/modules/moonmarket/MoonMarketModule";

export const orbitRoutes: RouteObject[] = [
  { path: "/", element: <OrbitLauncher /> },
  { path: "/parallax/*", element: <ParallaxModule /> },
  { path: "/moonmarket/*", element: <MoonMarketModule /> },
];

export const orbitRouter = createBrowserRouter(orbitRoutes);
```

- [ ] **Step 9: Run the router test to verify it passes**

Run:
```bash
npm run test -- src/orbit/__tests__/OrbitShell.test.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 10: Wire `main.tsx` to the Orbit root**

Replace `src/main.tsx` entirely with:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { OrbitProviders } from "@/orbit/OrbitProviders";
import { orbitRouter } from "@/orbit/OrbitShell";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OrbitProviders>
      <RouterProvider router={orbitRouter} />
    </OrbitProviders>
  </React.StrictMode>,
);
```
Note: `styles.css` was previously imported by `App.tsx`; importing it here keeps global styles loading regardless of which module mounts first. Leave the `import "./styles.css"` in `App.tsx` as well — duplicate imports are deduped by Vite.

- [ ] **Step 11: Full typecheck + test + dev smoke**

Run:
```bash
npm run typecheck && npm run test
npm run dev
```
Expected: typecheck + all Vitest suites pass. In the dev browser at `http://localhost:1420`: the launcher renders at `/`; before IBKR auth the three icons are gray/disabled and the Parallax connection UI shows; after authenticating, Parallax + MoonMarket icons colorize; clicking Parallax mounts the full existing app; clicking MoonMarket shows the stub; "Back to Orbit" returns to `/`.

- [ ] **Step 12: Commit**

```bash
git add src/modules src/orbit/OrbitShell.tsx src/orbit/__tests__/OrbitShell.test.tsx src/main.tsx
git commit -m "feat: add orbit router mounting launcher, parallax, and moonmarket"
```

---

### Task 6: Consolidated sidecar — `/moonmarket` router prefix

Prove the single-sidecar pattern: the existing Parallax FastAPI backend answers a `/moonmarket`-prefixed route. Real MoonMarket endpoints (portfolio, orders) are added in later plans.

**Files:**
- Create: `backend/routers/moonmarket.py`
- Test: `backend/tests/test_moonmarket_router.py`
- Modify: `backend/main.py:364-368`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_moonmarket_router.py`:
```python
from fastapi.testclient import TestClient
from routers.moonmarket import router as moonmarket_router
from fastapi import FastAPI


def _client() -> TestClient:
    # Mount the router on a bare app so the test is isolated from the full
    # lifespan (gateway/IBKR/Ollama startup), which is unnecessary here.
    app = FastAPI()
    app.include_router(moonmarket_router)
    return TestClient(app)


def test_moonmarket_health_is_prefixed_and_ok():
    resp = _client().get("/moonmarket/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["module"] == "moonmarket"
    assert body["status"] == "ok"
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd backend && uv run pytest tests/test_moonmarket_router.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'routers.moonmarket'`.

- [ ] **Step 3: Implement the router**

Create `backend/routers/moonmarket.py`:
```python
"""
MoonMarket router — portfolio, orders, transactions for the MoonMarket module.

For the Orbit foundation this exposes only a health route, proving that the
single consolidated sidecar serves the `/moonmarket` prefix alongside
Parallax's existing routes. Portfolio/orders/transactions endpoints are
added in later plans.
"""
from fastapi import APIRouter

router = APIRouter(prefix="/moonmarket", tags=["moonmarket"])


@router.get("/health")
async def moonmarket_health() -> dict[str, str]:
    return {"module": "moonmarket", "status": "ok"}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd backend && uv run pytest tests/test_moonmarket_router.py -v
```
Expected: PASS (1 test).

- [ ] **Step 5: Register the router in `main.py`**

In `backend/main.py`, after the existing `drawings_router` include (around line 367-368), add:
```python
from routers.moonmarket import router as moonmarket_router
app.include_router(moonmarket_router)
```

- [ ] **Step 6: Run the full backend suite**

Run:
```bash
cd backend && uv run pytest -q
```
Expected: the new test passes and no previously-passing test regresses. (Pre-existing failures noted in `PROJECT_PLAN.md` Phase 10 known-issues are unrelated to this change; confirm the count does not increase.)

- [ ] **Step 7: Commit**

```bash
git add backend/routers/moonmarket.py backend/tests/test_moonmarket_router.py backend/main.py
git commit -m "feat: register /moonmarket router prefix on the consolidated sidecar"
```

---

### Task 7: End-to-end verification + plan/spec relocation note

**Files:**
- Manual verification only; optional doc move.

- [ ] **Step 1: Full frontend gate**

Run:
```bash
npm run typecheck && npm run test
```
Expected: all green.

- [ ] **Step 2: Full backend gate**

Run:
```bash
cd backend && uv run pytest -q
```
Expected: green (modulo the documented pre-existing failures).

- [ ] **Step 3: Live smoke test with the sidecar**

Run the backend, then the app:
```bash
cd backend && uv run uvicorn main:app --reload --port 8000   # terminal 1
npm run dev                                                   # terminal 2
```
Verify in the browser:
1. `/` shows the Orbit launcher with three gray icons + the Parallax connection UI.
2. `curl -s http://localhost:8000/moonmarket/health` returns `{"module":"moonmarket","status":"ok"}`.
3. After IBKR auth, Parallax + MoonMarket icons colorize; Inflect stays "Coming soon".
4. Parallax icon → full existing Parallax app; MoonMarket icon → stub; Back to Orbit works.

- [ ] **Step 4 (note for later): relocate planning docs into the Orbit repo**

The spec (`docs/superpowers/specs/2026-05-25-orbit-v1-design.md`) and this plan (`docs/superpowers/plans/2026-05-25-orbit-foundation.md`) live in the Orbit repo.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin feature/orbit-foundation
```
Open PR `feature/orbit-foundation → dev`, get review, squash-merge, delete the branch.

---

## Self-Review

**Spec coverage (against `2026-05-25-orbit-v1-design.md`, foundation-relevant items):**
- Monorepo / one React app → Tasks 1, 2, 5 (Parallax promoted; one app; router groups).
- Consolidated FastAPI sidecar → Task 6 (`/moonmarket` prefix on the Orbit sidecar).
- Combined auth + launcher (gray-until-connected) → Tasks 3, 4 (skeleton; full polish is Plan #2, explicitly scoped out here).
- Three app icons incl. Inflect "Coming soon" → Task 4.
- One Tauri binary → Task 1 (product rename; existing single-binary build retained).
- `conid`-keyed nav bridge, Portfolio/Transactions, OrderTicket, options → **out of scope for foundation**, covered by Plans #2-#6.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete code. The two `MANUAL` steps (GitHub rename, doc relocation) are explicitly flagged as human/optional and do not block code tasks.

**Type/name consistency:** `OrbitProviders`, `OrbitLauncher`, `AppIcon` (props `label`/`icon`/`enabled`/`onOpen`/`badge`), `ParallaxModule`, `MoonMarketModule`, `orbitRoutes`/`orbitRouter`, `useGatewayContext().isAuthenticated`, router paths `/`, `/parallax`, `/moonmarket` — all consistent across tasks and tests. Navigation uses `navigate("/parallax")` / `navigate("/moonmarket")` / `navigate("/")` consistently.
