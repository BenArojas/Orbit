import type { TriggerCondition, TriggerConditionValue } from "@/modules/parallax/api";

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

type ConditionLike = TriggerCondition | TriggerConditionValue;

export const TRIGGER_INDICATOR_LABELS: Record<string, string> = {
  close: "Price",
  rsi: "RSI",
  macd: "MACD",
  ema_9: "Price vs EMA 9",
  ema_21: "Price vs EMA 21",
  ema_50: "Price vs EMA 50",
  ema_200: "Price vs EMA 200",
  volume: "Volume",
  bbands: "Bollinger position",
  vwap: "Price vs VWAP",
  atr: "ATR",
  stoch: "Stochastic",
  obv: "OBV",
  adx: "ADX",
  news_candle: "News candle",
};

export const TRIGGER_INDICATOR_OPTIONS = Object.entries(TRIGGER_INDICATOR_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export function getTriggerIndicatorLabel(indicator: string): string {
  return TRIGGER_INDICATOR_LABELS[indicator] ?? indicator;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "";
  if (!Number.isFinite(value)) return "n/a";
  return numberFormatter.format(value);
}

function formatValue(indicator: string, value: number | null | undefined): string {
  const formatted = formatNumber(value);
  if (!formatted) return "";
  if (indicator === "volume") return `${formatted}x`;
  return formatted;
}

function shouldShowThreshold(indicator: string, threshold: number | null | undefined): boolean {
  if (threshold == null) return false;
  if ((indicator.startsWith("ema_") || indicator === "vwap") && threshold === 0) {
    return false;
  }
  return true;
}

function formatOperator(indicator: string, condition: string): string {
  const ema = indicator.match(/^ema_(\d+)$/);
  if (ema) {
    const period = ema[1];
    const labels: Record<string, string> = {
      above: `Price above EMA ${period}`,
      below: `Price below EMA ${period}`,
      crosses_above: `Price crosses above EMA ${period}`,
      crosses_below: `Price crosses below EMA ${period}`,
    };
    return labels[condition] ?? condition.replace(/_/g, " ");
  }
  if (indicator === "vwap") {
    const labels: Record<string, string> = {
      above: "Price above VWAP",
      below: "Price below VWAP",
      crosses_above: "Price crosses above VWAP",
      crosses_below: "Price crosses below VWAP",
    };
    return labels[condition] ?? condition.replace(/_/g, " ");
  }
  if (indicator === "close") {
    const labels: Record<string, string> = {
      above: "Price above",
      below: "Price below",
      crosses_above: "Price crosses above",
      crosses_below: "Price crosses below",
    };
    return labels[condition] ?? condition.replace(/_/g, " ");
  }
  if (indicator === "volume") {
    const labels: Record<string, string> = {
      above: "Volume above",
      below: "Volume below",
      crosses_above: "Volume crosses above",
      crosses_below: "Volume crosses below",
    };
    return labels[condition] ?? condition.replace(/_/g, " ");
  }
  if (indicator === "news_candle") return "News candle fires";
  return `${getTriggerIndicatorLabel(indicator)} ${condition.replace(/_/g, " ")}`;
}

export function getTriggerConditionLabel(condition: ConditionLike): string {
  return formatOperator(condition.indicator, condition.condition);
}

export function formatTriggerConditionValue(value: TriggerConditionValue): string {
  const threshold = shouldShowThreshold(value.indicator, value.threshold)
    ? formatValue(value.indicator, value.threshold)
    : "";
  const actual = formatValue(value.indicator, value.actual_value);
  return `${getTriggerConditionLabel(value)}${threshold ? ` ${threshold}` : ""} -> ${actual}`;
}

export function formatTriggerCondition(condition: ConditionLike): string {
  const threshold = shouldShowThreshold(condition.indicator, condition.threshold)
    ? formatValue(condition.indicator, condition.threshold)
    : "";
  return `${getTriggerConditionLabel(condition)}${threshold ? ` ${threshold}` : ""}`;
}
