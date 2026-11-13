# Orbit repository rules

Orbit is a personal trading decision-support desktop app, not an autonomous trader.

## Safety and money

- Python owns actionable money math, sizing, risk, guardrails, and indicator values.
  Use decimal/tick-aware arithmetic for money; do not make the UI or an LLM authoritative.
- The agent never places, modifies, or cancels orders. No order tools, shell access,
  sidecar credential, or direct IBKR connection may be exposed to it.
- Paper only until the owner separately approves live trading in Phase 10.
  A paper port alone is not proof: require one connected `DU` account too.
- Never weaken a safety gate or remove a safety test to make a check pass.
- Session secrets stay in memory. Never log them, store them in URLs/browser storage,
  or put them in an agent's context. Portfolio sharing defaults off.

## Workflow

- Follow `docs/testing.md` and the canonical docs under `docs/architecture/`.
- The approved redesign is `docs/design/2026-11-12-plan-agent/`. Its decision log
  takes precedence for that build. Implement one phase at a time, then report
  validation and get approval before the next phase.
- Design records use `docs/design/<date>-<feature>/` with `brief.md`,
  `scenarios.md`, `decision.md`, `spec.md`, and `mockups/`.
- Preserve user data and uncommitted work. Database migrations need a recoverable
  backup and copy-based validation. Tests use temporary databases.
- Test critical promises at the highest practical public boundary. Use fake
  brokers in automated tests; actual paper orders require an explicit paper test.
- Do not treat prototype math, broker responses, or timing as production evidence.
