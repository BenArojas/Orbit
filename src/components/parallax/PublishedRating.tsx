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
  return <div className={`rounded-md border px-2.5 py-1.5 text-[11px] ${freshness === "stale" ? "border-[var(--clr-orange)] text-[var(--clr-orange)]" : "border-[var(--border-1)] text-[var(--text-2)]"}`}>
    {isError
      ? <p role="alert">Fred rating lookup failed{freshness === "stale" ? "; retained ratings are stale" : freshness === "unknown" ? "; source freshness is unconfirmed" : ""}{publishedAt ? ` · published ${date}` : ""}. IBKR prices and charts may still be available.</p>
      : sourceStatus === "unavailable"
        ? <p role="status">Fred RS snapshot is unavailable. IBKR prices and charts may still be available.</p>
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
  const unavailable = (reason?: string) => <span className="inline-flex items-center gap-1">
    <span>RS rating unavailable</span>
    {reason && <details className="inline">
      <summary aria-label="Why is the RS rating unavailable?" className="cursor-pointer underline decoration-dotted underline-offset-2">Why?</summary>
      <span className="ml-1 text-[var(--text-2)]">{reason} Unavailable RS evidence does not automatically mean the IBKR price or existing chart is unavailable.</span>
    </details>}
  </span>;
  if (lookupFailed) return unavailable();
  if (!rating) return loading ? <span>Checking RS rating…</span> : unavailable("No published RS rating is attached to this name.");
  if ("status" in rating) {
    if (rating.status === "unverified") return unavailable("The listing could not be verified as the corresponding US security.");
    if (rating.status === "not_published") return unavailable("Fred's published dataset has no rating for this verified listing.");
    if (rating.status === "source_unavailable") return unavailable();
  }
  if (rating.published_percentile == null) return unavailable("Fred did not publish an RS percentile for this listing.");
  return <span className="font-data tabular-nums" aria-label={rating.published_percentile == null ? "Fred published RS percentile unavailable" : `Fred published RS percentile: ${rating.published_percentile}`}>
    {rating.published_percentile}
  </span>;
}
