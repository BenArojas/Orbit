# vendor/lightweight-charts-drawing

Vendored copy of [`deepentropy/lightweight-charts-drawing`](https://github.com/deepentropy/lightweight-charts-drawing).

## Version info

| Field        | Value                                      |
|--------------|--------------------------------------------|
| Upstream URL | https://github.com/deepentropy/lightweight-charts-drawing |
| Tag          | v0.1.1                                     |
| Commit SHA   | 778f1e5cf3d62c2499dd4c686a00ab66bb01c44f   |
| Vendor date  | 2026-05-17                                 |
| License      | MIT (confirmed in upstream package.json)   |

## Why vendored

Parallax is a 100% local app (project rule 3). The library is pre-1.0 with active
development; vendoring pins us to a known-good version and eliminates network
installs at build time.

## Local modifications

None. Do not edit the vendored source directly to fix bugs — file an upstream issue
first. If a local patch is absolutely necessary, document it here under
**LOCAL_PATCHES** and in `LOCAL_PATCHES.md`.

## Updating

1. `git clone --depth 1 --branch <new-tag> https://github.com/deepentropy/lightweight-charts-drawing /tmp/lc-drawing-new`
2. Diff `src/` against `vendor/lightweight-charts-drawing/src/`.
3. Manually merge non-breaking changes.
4. Re-run integration tests (`npm test`).
5. Update Tag, Commit SHA, and Vendor date in this README.

Periodic review cadence: every 3 months, or when a critical bug surfaces upstream.

## Integration

The vendored source is re-exported through `src/lib/drawings.ts`. The rest of the app
imports from `@/lib/drawings`, never directly from `vendor/`. This isolates the
dependency — a future replacement or fork is a single-file change.

TypeScript path alias: `@vendor/lightweight-charts-drawing` → `vendor/lightweight-charts-drawing/src/index.ts`
