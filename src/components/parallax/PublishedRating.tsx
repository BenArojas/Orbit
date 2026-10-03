import type { RSLeader, RSRating } from "@/modules/parallax/api";

export function PublishedSourceNotice({
  freshness,
  publishedAt,
  sourceStatus,
  isLoading = false,
  isError = false,
}: {
    freshness?: "stale" | "unknown";
    publishedAt?: string | null;
    sourceStatus?: "available" | "stale" | "unavailable";
  isLoading?: boolean;
  isError?: boolean;
}) {
  const parsed = publishedAt ? new Date(publishedAt) : null;
  const date = parsed && !Number.isNaN(parsed.valueOf()) ? parsed.toLocaleDateString() : "publication date unavailable";
  if (!freshness && !sourceStatus && !isLoading && !isError) return null;
  return <div className={`space-y-1 rounded-md border px-3 py-2 text-xs ${freshness === "stale" ? "border-[var(--clr-orange)] text-[var(--clr-orange)]" : "border-[var(--border-1)] text-[var(--text-2)]"}`}>
    {isError && <p role="alert">Fred rating lookup failed; displayed ratings may be out of date.</p>}
    {sourceStatus === "unavailable"
      ? <p role="status">Fred rating snapshot unavailable</p>
      : freshness
      ? <p role="status">{freshness === "stale" ? "Fred publication is stale" : "Fred published snapshot; price-session date unconfirmed"} · published {date}</p>
      : <p role="status">{isLoading ? "Checking Fred rating source…" : "Fred source freshness unavailable"}</p>}
  </div>;
}

export function PublishedRating({
  rating,
  loading = false,
  lookupFailed = false,
}: {
  rating?: RSLeader | RSRating;
  loading?: boolean;
  lookupFailed?: boolean;
}) {
  if (lookupFailed) return <span>Lookup failed</span>;
  if (!rating) return <span>{loading ? "Loading Fred rating…" : "Unavailable"}</span>;
  if ("status" in rating) {
    if (rating.status === "unverified") return <span>US listing unverified</span>;
    if (rating.status === "not_published") return <span>Unavailable in Fred dataset</span>;
    if (rating.status === "source_unavailable") return <span>Fred rating snapshot unavailable</span>;
  }
  return <span className="font-data tabular-nums" aria-label={rating.published_percentile == null ? "Fred published RS percentile unavailable" : `Fred published RS percentile: ${rating.published_percentile}`}>
    {rating.published_percentile == null ? "Unavailable" : rating.published_percentile}
  </span>;
}
