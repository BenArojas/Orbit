---
name: parallax-hub
description: IBKR Hub multi-module context. Use when working on cross-module concerns, the instruments table, conid lookups, or anything involving MoonMarket or Inflect boundaries. Trigger when discussing shared database schema, module boundaries, or the relationship between Parallax, MoonMarket, and Inflect.
---

# IBKR Hub Context

Parallax is one of three modules in the **IBKR Hub** — a single Tauri binary:

- **Parallax** — technical analysis (this app)
- **MoonMarket** — portfolio & account management
- **Inflect** — trading journal (Phase 4, built last)

All three share one Python FastAPI sidecar and one SQLite database.

## conid is the Universal Key

`conid` (IBKR's contract ID integer) is the primary identifier for all instruments across every module. Never store or link instruments by ticker string — always by conid.

The `instruments` table in SQLite is the shared cache for conid → symbol/name/type lookups. Parallax owns this table (task 1.4). All other modules read from it.

## Module Boundaries

**What Inflect needs from Parallax:** Nothing special. Inflect calls the existing `/indicators` endpoint to fetch indicator context at trade entry time. Build the indicator API for Parallax's own needs — Inflect rides along for free.

**What NOT to add for Inflect:**
- No journal hooks, callbacks, or event emissions in Parallax
- No "save to journal" buttons or UI in Parallax
- No schema changes beyond the `instruments` table already planned
