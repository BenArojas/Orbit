/**
 * Inflect formatting helpers.
 *
 * `formatMoney`/`formatNumber`/`formatPercent` mirror MoonMarket's formatters
 * (null/non-finite → "--"). `formatSignedMoney` adds an explicit + on positive
 * P&L for the calendar/trade views, and `formatHold` renders a hold duration
 * (seconds) as a compact h/m/s string.
 */

export function formatMoney(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatSignedMoney(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatMoney(value, currency)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatHold(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

export function isNeedsBasisStatus(status: string | null | undefined): boolean {
  return status === "INCOMPLETE_BASIS";
}

export function isNeedsBasisDirection(direction: string | null | undefined): boolean {
  return direction === "UNKNOWN";
}

export function isNeedsBasisTrade({
  status,
  direction,
}: {
  status?: string | null;
  direction?: string | null;
}): boolean {
  return isNeedsBasisStatus(status) || isNeedsBasisDirection(direction);
}

export function formatTradeStatus(status: string | null | undefined): string {
  if (isNeedsBasisStatus(status)) return "Needs basis";
  if (!status) return "--";
  return status;
}

export function formatTradeDirection(direction: string | null | undefined): string {
  if (isNeedsBasisDirection(direction)) return "Needs basis";
  if (!direction) return "--";
  return direction;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "June 2026" for a 1-based month. */
export function formatMonthLabel(year: number, month: number): string {
  const name = MONTH_NAMES[month - 1] ?? "";
  return `${name} ${year}`;
}
