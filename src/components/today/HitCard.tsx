/**
 * HitCard — hero card for a single firing trigger on the Today page.
 *
 * Pure presentation. Parent owns the data + handlers (the Today page wires
 * `onOpenChart` → `navigateToAnalysis`, `onDismiss`/`onSnooze` → the
 * mutation hooks from Task 7).
 */

import type { TriggerHit } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  dominantFamily,
  FAMILY_COLOR,
} from "@/components/tags/triggerColors";
import { formatTriggerConditionValue } from "@/components/triggers/formatTriggerCondition";

interface Props {
  hit: TriggerHit;
  onOpenChart: (h: TriggerHit) => void;
  onDismiss: (h: TriggerHit) => void;
  onSnooze: (h: TriggerHit, minutes: number) => void;
}

export function HitCard({ hit, onOpenChart, onDismiss, onSnooze }: Props) {
  const indicators = hit.condition_values.map((v) => v.indicator);
  const family = dominantFamily(indicators);
  const accent = FAMILY_COLOR[family];
  const conditionCount = hit.condition_values.length;

  return (
    <div
      className="rounded-md border border-border bg-gradient-to-br from-[var(--bg-2)] to-[var(--bg-1)] p-2"
      style={{ boxShadow: `0 0 12px ${accent}1a` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-bold text-[var(--text-1)]">
          {hit.symbol}
        </span>
        <span className="text-[9px] font-semibold text-[var(--text-3)]">
          {conditionCount}/{conditionCount}
        </span>
      </div>

      <div className="text-[10px] text-[var(--text-3)]">
        {hit.rule_name ?? "(deleted rule)"}
        {hit.watchlist_name && <> · {hit.watchlist_name}</>}
      </div>

      <div className="mt-1 flex flex-wrap gap-1">
        {hit.condition_values.map((v, i) => (
          <span
            key={i}
            className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 font-data text-[8.5px] text-[var(--text-2)]"
          >
            {formatTriggerConditionValue(v)}
          </span>
        ))}
      </div>

      <div className="mt-2 flex gap-1">
        <Button
          size="sm"
          variant="default"
          className="h-6 text-[9px]"
          onClick={() => onOpenChart(hit)}
        >
          Open chart
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[9px]"
          onClick={() => onSnooze(hit, 60)}
        >
          Snooze 1h
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[9px]"
          onClick={() => onDismiss(hit)}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
