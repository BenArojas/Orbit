"""Inflect service package — FIFO trade matching, calendar aggregation,
and journal CRUD for Orbit's trading-journal module.

Round-trip trades are derived on demand from the shared `fills` projection
(never persisted in v1); the only durable Inflect-owned row is the
`journal_entry`. See docs/superpowers/specs/2026-06-01-inflect-journal-design.md.
"""
