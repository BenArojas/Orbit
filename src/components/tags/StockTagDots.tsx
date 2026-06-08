/**
 * StockTagDots — inline visual indicator for rule-fire tags on a stock.
 *
 * Renders up to `max` small colored dots, one per fired rule, with a
 * `+N` overflow chip when there are more. Color is derived from the
 * dominant indicator family of each rule (see triggerColors.ts).
 *
 * Used by the watchlist sidebar, screener results, and the Today page —
 * single source of truth so the visual language stays consistent.
 */
import type { StockTagMap } from "@/modules/parallax/api";
import { dominantFamily, FAMILY_COLOR } from "./triggerColors";

type Tag = StockTagMap[number][number];

interface Props {
  tags: Tag[];
  max?: number;
}

export function StockTagDots({ tags, max = 3 }: Props) {
  if (!tags.length) return null;
  const visible = tags.slice(0, max);
  const overflow = tags.length - visible.length;
  return (
    <span className="inline-flex items-center gap-0.5">
      {visible.map((t) => {
        const color = FAMILY_COLOR[dominantFamily(t.indicators)];
        return (
          <span
            key={t.rule_id}
            data-testid="tag-dot"
            title={`${t.rule_name} · ${t.indicators.join(", ")}`}
            className="inline-block h-[5px] w-[5px] rounded-full"
            style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
          />
        );
      })}
      {overflow > 0 && (
        <span className="ml-0.5 rounded bg-[var(--bg-3)] px-1 text-[8px] text-[var(--text-3)]">
          +{overflow}
        </span>
      )}
    </span>
  );
}
