"""
summarize_request_log.py — Phase 8 acceptance-dashboard script.

Reads backend/logs/requests.log (JSONL) and prints three tables:

  1. Top 10 endpoints by hit count with p50 / p95 / max duration_ms
  2. Request count per 5-second time bucket (last 60 buckets shown)
  3. 4xx and 5xx error counts

Usage:
    uv run python backend/scripts/summarize_request_log.py
    uv run python backend/scripts/summarize_request_log.py path/to/requests.log
    python backend/scripts/summarize_request_log.py --help
"""

from __future__ import annotations

import sys
from pathlib import Path


def _default_log_path() -> Path:
    """Return backend/logs/requests.log relative to this script's location."""
    return Path(__file__).resolve().parent.parent / "logs" / "requests.log"


def _load(log_path: Path) -> "polars.DataFrame":
    import polars as pl

    if not log_path.exists():
        print(f"Log file not found: {log_path}", file=sys.stderr)
        sys.exit(1)

    # Read JSONL — each row is one event (http, ws_connect, ws_disconnect).
    df = pl.read_ndjson(log_path)

    # Ensure expected columns exist with sensible defaults so the rest of
    # the script doesn't crash on a log that only has WS events or vice versa.
    if "kind" not in df.columns:
        print("Log file has no 'kind' column — is this a Parallax request log?", file=sys.stderr)
        sys.exit(1)

    return df


def _section(title: str) -> None:
    width = 72
    print()
    print("=" * width)
    print(f"  {title}")
    print("=" * width)


def summarize(log_path: Path) -> None:
    import polars as pl

    df = _load(log_path)

    # ── 1. Top 10 endpoints (HTTP only) ────────────────────────────────────

    http = df.filter(pl.col("kind") == "http")

    if http.is_empty():
        _section("Top 10 Endpoints — no HTTP rows found")
    else:
        top10 = (
            http
            .group_by("path")
            .agg(
                pl.len().alias("hits"),
                pl.col("duration_ms").median().round(1).alias("p50_ms"),
                pl.col("duration_ms").quantile(0.95).round(1).alias("p95_ms"),
                pl.col("duration_ms").max().round(1).alias("max_ms"),
            )
            .sort("hits", descending=True)
            .head(10)
        )

        _section("Top 10 Endpoints by Hit Count")
        col_w = [40, 6, 10, 10, 10]
        headers = ["path", "hits", "p50 ms", "p95 ms", "max ms"]
        fmt = "  ".join(f"{{:<{w}}}" for w in col_w)
        print(fmt.format(*headers))
        print("  ".join("-" * w for w in col_w))
        for row in top10.iter_rows(named=True):
            print(fmt.format(
                row["path"][:col_w[0]],
                row["hits"],
                row["p50_ms"],
                row["p95_ms"],
                row["max_ms"],
            ))

    # ── 2. 5-second request-count buckets ──────────────────────────────────

    if http.is_empty():
        _section("Request Buckets — no HTTP rows found")
    else:
        # Parse ISO-8601 ts column → Datetime, then truncate to 5s bucket.
        bucketed = (
            http
            .with_columns(
                pl.col("ts").str.to_datetime(format="%+", strict=False).alias("ts_dt")
            )
            .with_columns(
                pl.col("ts_dt").dt.truncate("5s").alias("bucket")
            )
            .group_by("bucket")
            .agg(pl.len().alias("count"))
            .sort("bucket")
            .tail(60)  # show at most the last 60 buckets (= 5 minutes)
        )

        _section("Request Count per 5-Second Bucket (last 60 buckets)")
        print(f"  {'bucket':<28}  {'count':>5}")
        print(f"  {'-'*28}  {'-----':>5}")
        for row in bucketed.iter_rows(named=True):
            bucket_str = str(row["bucket"])[:28]
            bar = "█" * min(row["count"], 40)
            print(f"  {bucket_str:<28}  {row['count']:>5}  {bar}")

    # ── 3. Error counts ─────────────────────────────────────────────────────

    _section("Error Summary")

    if http.is_empty():
        print("  No HTTP rows found.")
    else:
        has_status = "status" in http.columns
        if not has_status:
            print("  No 'status' column found in log rows.")
        else:
            count_4xx = http.filter(
                (pl.col("status") >= 400) & (pl.col("status") < 500)
            ).height
            count_5xx = http.filter(pl.col("status") >= 500).height
            total = http.height

            print(f"  Total HTTP requests : {total}")
            print(f"  4xx responses       : {count_4xx}")
            print(f"  5xx responses       : {count_5xx}")

            if count_4xx + count_5xx > 0:
                print()
                # Breakdown by path + status for errors
                errors = (
                    http
                    .filter(pl.col("status") >= 400)
                    .group_by(["path", "status"])
                    .agg(pl.len().alias("count"))
                    .sort(["status", "count"], descending=[False, True])
                )
                print(f"  {'path':<40}  {'status':>6}  {'count':>5}")
                print(f"  {'-'*40}  {'------':>6}  {'-----':>5}")
                for row in errors.iter_rows(named=True):
                    print(f"  {row['path'][:40]:<40}  {row['status']:>6}  {row['count']:>5}")

    print()


def main() -> None:
    args = sys.argv[1:]

    if "--help" in args or "-h" in args:
        print(__doc__)
        sys.exit(0)

    log_path = Path(args[0]) if args else _default_log_path()
    summarize(log_path)


if __name__ == "__main__":
    main()
