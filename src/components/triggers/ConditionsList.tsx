import type { TriggerCondition } from "@/modules/parallax/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getTriggerConditionLabel,
  TRIGGER_INDICATOR_OPTIONS,
} from "./formatTriggerCondition";

const CONDITION_OPTIONS: TriggerCondition["condition"][] = [
  "above", "below", "crosses_above", "crosses_below",
];

const NEWS_METHOD_OPTIONS = [
  { value: "volume_spike", label: "Volume spike" },
  { value: "range_spike", label: "Range spike" },
  { value: "gap", label: "Gap" },
  { value: "long_wick", label: "Long wick" },
] as const;

function usesAutoThreshold(indicator: string): boolean {
  return indicator.startsWith("ema_") || indicator === "vwap";
}

interface Props {
  value: TriggerCondition[];
  onChange: (next: TriggerCondition[]) => void;
}

export function ConditionsList({ value, onChange }: Props) {
  const update = (idx: number, patch: Partial<TriggerCondition>) => {
    onChange(value.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };
  const add = () => {
    onChange([
      ...value,
      { indicator: "rsi", condition: "below", threshold: 30, news_candle_method: null },
    ]);
  };
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const updateIndicator = (idx: number, indicator: string) => {
    if (indicator === "news_candle") {
      update(idx, {
        indicator,
        condition: "fires",
        threshold: 2,
        news_candle_method: "volume_spike",
      });
      return;
    }
    update(idx, {
      indicator,
      condition: value[idx]?.condition === "fires" ? "above" : value[idx].condition,
      threshold: usesAutoThreshold(indicator) ? 0 : value[idx]?.indicator === "news_candle" ? null : value[idx]?.threshold,
      news_candle_method: null,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-[var(--text-2)]">
        Automatic conditions · all must match
      </label>
      {value.map((c, idx) => (
        <div
          key={idx}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_40px] items-center gap-2 rounded border border-border p-2"
        >
          <select
            aria-label="indicator"
            value={c.indicator}
            onChange={(e) => updateIndicator(idx, e.target.value)}
            className="col-span-2 h-9 min-w-0 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-xs"
          >
            {TRIGGER_INDICATOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            aria-label="condition"
            value={c.condition}
            onChange={(e) =>
              update(idx, {
                condition: e.target.value as TriggerCondition["condition"],
                threshold: usesAutoThreshold(c.indicator) ? 0 : c.threshold,
              })
            }
            className="col-span-2 h-9 min-w-0 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-xs"
            disabled={c.indicator === "news_candle"}
          >
            {c.indicator !== "news_candle" && c.condition === "fires" && <option value="fires" disabled>Unsupported operator: fires</option>}
            {(c.indicator === "news_candle" ? ["fires" as const] : CONDITION_OPTIONS).map((cond) => (
              <option key={cond} value={cond}>
                {getTriggerConditionLabel({ ...c, condition: cond })}
              </option>
            ))}
          </select>
          {c.indicator === "news_candle" ? (
            <select
              aria-label="news candle method"
              value={c.news_candle_method ?? "volume_spike"}
              onChange={(e) =>
                update(idx, {
                  news_candle_method: e.target.value as TriggerCondition["news_candle_method"],
                })
              }
              className="h-9 min-w-0 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-xs"
            >
              {NEWS_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : usesAutoThreshold(c.indicator) ? (
            <div
              aria-label="threshold"
              title="The app compares price to the selected indicator automatically."
              className="flex h-9 min-w-0 items-center rounded-md border border-border bg-[var(--bg-1)] px-2 font-data text-xs text-[var(--text-3)]"
            >
              Auto
            </div>
          ) : (
            <Input
              type="number"
              aria-label="threshold"
              value={c.threshold ?? ""}
              onChange={(e) =>
                update(idx, {
                  threshold: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="h-9 min-w-0 bg-[var(--bg-1)] font-data text-xs"
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="remove"
            onClick={() => remove(idx)}
            className="h-10 w-10 p-0 text-[var(--text-3)] hover:text-[var(--clr-red)]"
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="h-9 self-start text-xs"
      >
        + Add condition
      </Button>
    </div>
  );
}
