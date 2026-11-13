# Frontend Architecture

This is the canonical guide for Orbit's React/Tauri frontend.

## Boundary

- React and Tauri present local UI; all application data flows through FastAPI.
- `src/lib/sidecarClient.ts` alone owns sidecar transport mechanics and
  `ApiError`.
- `src/lib/api.ts` owns Orbit shell, gateway, and authentication contracts.
- Product contracts live in `src/modules/parallax/api.ts` and
  `src/modules/moonmarket/api.ts`.
- Module APIs use `sidecarRequest`; components do not call `fetch` directly.
- `sidecarSession.ts` obtains an in-memory launch credential from the narrow
  Rust `sidecar_session` command. No browser storage, URL, or DOM field holds it.
  The transport attaches it to HTTP requests and both streaming hooks offer it
  as a WebSocket subprotocol.
- Rust launches the sidecar in development and packaged builds. Generic shell
  spawn/execute/stdin capabilities are not granted to the webview.
- Browser-only Vite is not an authorized mutation client. Use Tauri for working
  application flows, and never add a Vite environment-variable credential.

## State and UI

- TanStack Query owns server state and request caching.
- Zustand owns shared client/UI state; `useState` owns local component state.
- WebSocket subscriptions stay behind hooks rather than individual components.
- The retained `/ws` product stream now receives TWS-derived updates through a
  backend compatibility bridge. Existing quote labels distinguish live, delayed,
  frozen, and unknown feeds; the backend alone decides entry-data eligibility.
- Settings includes a one-time Client Portal watchlist import. All later
  watchlist edits are local. An import failure leaves local data unchanged.
- Market posture is `healthy`, `selective`, or `defensive`. RS notices explicitly
  limit coverage to 30 leaders; an omitted name has unknown RS, not a lagging rank.
- React Router owns top-level Orbit module routes. Parallax's internal screens
  remain in its existing Zustand navigation until an approved change says otherwise.
- Reuse existing `src/components/ui` primitives and Tailwind/CSS tokens.
- Keep pages/layouts thin; put reusable stateful behavior in hooks and domain
  behavior in the Python sidecar.

## Structure

- `src/orbit/`: shared shell, providers, account context, and OrderTicket.
- `src/modules/`: Parallax and MoonMarket product surfaces/contracts.
- `src/components/`: reusable feature and UI components.
- `src/hooks/`: shared queries, mutations, and subscriptions.
- `src/store/`: shared Zustand stores.
- `src/lib/`: transport and framework-neutral utilities.

## Commands

```bash
npm run tauri dev
npm run typecheck
npm run build
npm test -- <focused-file>
```

Use `docs/testing.md` before adding or reading tests.

## Detailed Decision

- `docs/superpowers/specs/2026-06-07-sidecar-client-contracts-design.md`
