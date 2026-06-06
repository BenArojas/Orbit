---
name: parallax-frontend
description: React/TypeScript frontend conventions for Orbit, especially the Parallax module. Use whenever working on components, hooks, pages, stores, charts, or any file under src/. Covers component patterns, state management, data fetching, styling, and project structure. Trigger on any frontend task — UI changes, new components, chart work, styling, or React code.
---

# Frontend Conventions

These conventions apply to Orbit's React app. Parallax is currently the mature module; MoonMarket and Inflect should reuse the same provider, query, styling, and component patterns as they are ported into Orbit.

## Project Structure

```
src/
├── components/
│   ├── charts/          # TradingView Lightweight Charts wrappers
│   ├── dashboard/       # Market pulse, gauges, sector panels
│   ├── screener/        # Screener table + filter controls
│   ├── indicators/      # Indicator config panels + pill toggles
│   ├── watchlist/       # Watchlist sidebar + trigger items
│   ├── ai/              # AI chat panel, signal card, config
│   └── ui/              # shadcn/ui component re-exports
├── hooks/               # Custom React hooks (useWatchlist, useLiveQuote, etc.)
├── store/               # Zustand stores
├── lib/                 # Utilities, type definitions, constants
├── pages/               # Top-level page/view components
└── App.tsx
```

## Component Patterns

- **PascalCase**, one component per file
- Pages are thin — compose from components, no business logic in pages
- Charts are wrapped components — never use TradingView Lightweight Charts directly in pages
- Use **shadcn/ui** for all base UI elements (buttons, inputs, dialogs, tables)
- No inline styles — Tailwind classes only

## State Management

- **Zustand** for global state (stores in `src/store/`)
- **React useState** for local/component-level state
- **TanStack Query v5** for all server data fetching — never fetch directly inside components
  - REST for screener data
  - WebSocket for live streaming data
- **React Router v7** for Orbit top-level routes (`/`, `/parallax/*`, `/moonmarket/*`, `/inflect/*`)
  - Keep module-local tabs and panels in module state unless they need a shareable URL.
  - Do not replace Parallax's internal Zustand navigation with routes unless the work explicitly changes top-level navigation.

## Hooks

Custom hooks live in `src/hooks/` with `use` prefix, camelCase naming.

Examples: `useWatchlist`, `useLiveQuote`, `useIndicators`, `useTriggerAlerts`

Hooks encapsulate data fetching (via TanStack Query), subscriptions, and reusable stateful logic. Components consume hooks — they don't manage fetch logic themselves.

## Stack Reference

- React 19 + TypeScript (strict mode)
- React Router DOM v7
- Tailwind CSS v4 + shadcn/ui
- TradingView Lightweight Charts v5
- Zustand (global state)
- TanStack Query v5 (data fetching)

## UI Aesthetic

Dense, information-rich, dark cinematic theme. Glowing accents, arc gauges, gradient effects. TradingView meets Bloomberg terminal with a sci-fi edge.

## Don'ts

- Don't put business logic in frontend components — it belongs in backend services
- Don't call IBKR or Ollama from the frontend — always go through the Python sidecar
- Don't fetch data outside of TanStack Query
- Don't use inline styles — Tailwind only
- Don't write complex Rust in src-tauri — keep it minimal, delegate to Python
