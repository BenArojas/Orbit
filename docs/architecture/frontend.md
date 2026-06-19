# Frontend Architecture

This is the canonical guide for Orbit's React/Tauri frontend.

## Boundary

- React and Tauri present local UI; all application data flows through FastAPI.
- `src/lib/sidecarClient.ts` alone owns sidecar transport mechanics and
  `ApiError`.
- `src/lib/api.ts` owns Orbit shell, gateway, and authentication contracts.
- Product contracts live in `src/modules/parallax/api.ts`,
  `src/modules/moonmarket/api.ts`, and `src/modules/inflect/api.ts`.
- Module APIs use `sidecarRequest`; components do not call `fetch` directly.

## State and UI

- TanStack Query owns server state and request caching.
- Zustand owns shared client/UI state; `useState` owns local component state.
- WebSocket subscriptions stay behind hooks rather than individual components.
- React Router owns top-level Orbit module routes. Parallax's internal screens
  remain in its existing Zustand navigation until an approved change says otherwise.
- Reuse existing `src/components/ui` primitives and Tailwind/CSS tokens.
- Keep pages/layouts thin; put reusable stateful behavior in hooks and domain
  behavior in the Python sidecar.

## Structure

- `src/orbit/`: shared shell, providers, account context, and OrderTicket.
- `src/modules/`: Parallax, MoonMarket, and Inflect product surfaces/contracts.
- `src/components/`: reusable feature and UI components.
- `src/hooks/`: shared queries, mutations, and subscriptions.
- `src/store/`: shared Zustand stores.
- `src/lib/`: transport and framework-neutral utilities.

## Commands

```bash
npm run dev
npm run typecheck
npm run build
npm test -- <focused-file>
```

Use `docs/testing.md` before adding or reading tests.

## Detailed Decision

- `docs/superpowers/specs/2026-06-07-sidecar-client-contracts-design.md`
