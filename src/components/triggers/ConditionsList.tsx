import type { TriggerCondition } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const INDICATOR_OPTIONS = [
  "rsi", "macd", "ema_9", "ema_20", "ema_21", "ema_50", "ema_200",
  "fibonacci", "volume", "bbands", "vwap", "atr", "stoch", "obv", "adx",
  "news_candle",
];

const CONDITION_OPTIONS: TriggerCondition["condition"][] = [
  "above", "below", "crosses_above", "crosses_below", "fires",
];

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
            onChange={(e) => update(idx, { indicator: e.target.value })}
            className="h-8 rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px]"
          >
            {INDICATOR_OPTIONS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
          <select
            aria-label="condition"
            value={c.condition}
            onChange={(e) =>
              update(idx, { condition: e.target.value as TriggerCondition["condition"] })
            }
            className="h-8 rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px]"
          >
            {CONDITION_OPTIONS.map((cond) => (
              <option key={cond} value={cond}>
                {cond.replace(/_/g, " ")}
              </option>
            ))}
          </select>
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
