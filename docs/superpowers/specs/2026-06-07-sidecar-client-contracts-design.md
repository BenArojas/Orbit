# Sidecar client contracts — current decision

`src/lib/sidecarClient.ts` owns shared FastAPI transport and typed API errors. `src/lib/api.ts` owns Orbit shell, gateway and authentication contracts.
Active product contracts live in the Parallax, MoonMarket and TWS Assistant owners. Inflect and AI-analysis contracts are retired.
Product APIs use the shared transport; components do not call IBKR or persistence directly. Domain computations belong in the sidecar, not transport facades.
See [frontend architecture](../../architecture/frontend.md) and [backend architecture](../../architecture/backend.md). Module extraction and migration checklists are completed history.
