import type { TriggerCondition } from "@/modules/parallax/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getTriggerConditionLabel,
  TRIGGER_INDICATOR_OPTIONS,
} from "./formatTriggerCondition";

const CONDITION_OPTIONS: TriggerCondition["condition"][] = [
  "above", "below", "crosses_above", "crosses_below", "fires",
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
      threshold: usesAutoThreshold(indicator) ? 0 : value[idx]?.threshold,
      news_candle_method: null,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] uppercase tracking-wider text-[var(--text-3)]">
        Conditions (ALL must pass on the same bar)
      </label>
      {value.map((c, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[1fr_1fr_90px_30px] items-center gap-2"
        >
          <select
            aria-label="indicator"
            value={c.indicator}
            onChange={(e) => updateIndicator(idx, e.target.value)}
            className="h-8 rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px]"
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
            className="h-8 rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px]"
            disabled={c.indicator === "news_candle"}
          >
            {CONDITION_OPTIONS.map((cond) => (
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
              className="h-8 rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px]"
            >
              {NEWS_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : usesAutoThreshold(c.indicator) ? (
            <div
              aria-label="threshold"
              title="The app compares price to the selected indicator automatically."
              className="flex h-8 items-center rounded-md border border-border bg-[var(--bg-1)] px-2 font-data text-[10px] text-[var(--text-3)]"
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
              className="h-8 bg-[var(--bg-1)] font-data text-[10px]"
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="remove"
            onClick={() => remove(idx)}
            className="h-8 w-8 p-0 text-[var(--text-3)] hover:text-[var(--clr-red)]"
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
        className="h-7 self-start text-[10px]"
      >
        + Add condition
      </Button>
    </div>
  );
}
