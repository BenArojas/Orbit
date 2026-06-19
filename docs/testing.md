# Testing Policy

Orbit tests important product promises, not every file, layer, or technology.
The default for a tracer-bullet slice is zero new tests.

## Critical Promises

1. Unsafe trades cannot happen.
2. Secrets and private data stay only in approved locations.
3. Stored data is not lost or corrupted.
4. Main user workflows work from start to finish.
5. External failures stop safely and visibly.

## Decision Rule

Before adding a test:

1. Name the critical promise the change can break.
2. Find whether an existing public-workflow test already protects it.
3. If no critical promise is affected, use type checking, build, or manual smoke.
4. If the promise is already covered, run that focused test; do not add another.
5. If it is uncovered, add one test at the highest practical public boundary.

Using an API, database, stream, or provider does not automatically require a
test. A serious or repeated regression gets one focused regression test; a
low-risk one-off bug may use manual verification.

## Budget

- Normal maximum: one new test per slice.
- Two are allowed only when success and fail-safe behavior protect distinct
  critical promises.
- Full relevant suites run only at the merge gate.
- Stop after two unsuccessful verification loops and ask for direction.
- Do not test the same behavior separately in service, router, hook, and UI.

## File Control

- Prefer one public-workflow test over several layer-specific unit tests.
- Keep new test files below 300 lines.
- Do not add to a file above 500 lines without removing duplication.
- Parameterize repeated inputs, providers, or error cases.
- Do not add snapshots, mock frameworks, or speculative test matrices.
- Splitting a large file without deleting duplication is not cleanup.
- Existing oversized suites are frozen until a separate cleanup mission is approved.

## Current Coverage Anchors

| Promise | Existing anchors |
|---|---|
| Trading safety | `backend/tests/test_orders_router.py`, `src/orbit/OrderTicket/__tests__/OrderTicket.test.tsx` |
| Stored-data integrity | `backend/tests/test_db_concurrent_writes.py` |
| Sidecar/external failure | `backend/tests/test_gateway.py`, `src/lib/sidecarClient.test.ts` |
| Module entry/main flows | tests beside `src/orbit/` and each `src/modules/<module>/` surface |
| Cloud secrets/privacy | Add one public-boundary test when the approved cloud path reaches `dev` |

These are discovery pointers, not commands to read or run every listed file.
