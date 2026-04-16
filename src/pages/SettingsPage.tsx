/**
 * Settings Page — Phase 7.3
 *
 * User-configurable app settings persisted to SQLite via the settings store.
 *
 * Settings:
 *   - Scanner interval (how often triggers are evaluated)
 *   - Default timeframe for new charts
 *   - Default period for history fetches
 *   - Desktop notifications on trigger alerts
 *
 * Design: single-column card layout matching the dark cinematic theme.
 * Each row: label on the left, control on the right.
 */

import { useSettingsStore } from "@/store";

// ── Timeframe options (matches chart store / IBKR bar sizes) ─────────────────

const TIMEFRAME_OPTIONS = [
  { value: "1m", label: "1 Minute" },
  { value: "5m", label: "5 Minutes" },
  { value: "15m", label: "15 Minutes" },
  { value: "30m", label: "30 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "4h", label: "4 Hours" },
  { value: "1D", label: "Daily" },
  { value: "1W", label: "Weekly" },
];

const PERIOD_OPTIONS = [
  { value: "1M", label: "1 Month" },
  { value: "3M", label: "3 Months" },
  { value: "6M", label: "6 Months" },
  { value: "1Y", label: "1 Year" },
  { value: "2Y", label: "2 Years" },
];

const SCAN_INTERVAL_OPTIONS = [
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 1800, label: "30 minutes" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 border-b border-border last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-[var(--text-1)]">{label}</p>
        {description && (
          <p className="mt-0.5 text-[10px] text-[var(--text-3)] leading-snug">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SelectControl({
  value,
  options,
  onChange,
}: {
  value: string | number;
  options: { value: string | number; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-[var(--bg-3)] px-3 py-1.5 text-[11px] text-[var(--text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)] transition-colors min-w-[130px]"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function ToggleControl({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--clr-cyan)] ${
        checked
          ? "bg-[var(--clr-cyan)] border-[var(--clr-cyan)]"
          : "bg-[var(--bg-4)] border-border"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// ── Section card wrapper ──────────────────────────────────────────────────────

function SettingsCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-[var(--bg-2)] px-5 py-1">
      <h2 className="pt-4 pb-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-3)]">
        {title}
      </h2>
      {children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    scanInterval,
    defaultTimeframe,
    defaultPeriod,
    notificationsEnabled,
    setScanInterval,
    setDefaultTimeframe,
    setDefaultPeriod,
    setNotificationsEnabled,
  } = useSettingsStore();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl px-6 py-8 flex flex-col gap-5">

        {/* Header */}
        <div>
          <h1 className="text-[16px] font-bold tracking-wide text-[var(--text-1)]">Settings</h1>
          <p className="mt-1 text-[11px] text-[var(--text-3)]">
            Changes are saved automatically to the local database.
          </p>
        </div>

        {/* Scanner */}
        <SettingsCard title="Scanner">
          <SettingRow
            label="Scan Interval"
            description="How often the background scanner evaluates active trigger rules."
          >
            <SelectControl
              value={scanInterval}
              options={SCAN_INTERVAL_OPTIONS}
              onChange={(v) => setScanInterval(Number(v))}
            />
          </SettingRow>
        </SettingsCard>

        {/* Charts */}
        <SettingsCard title="Charts">
          <SettingRow
            label="Default Timeframe"
            description="Bar size used when opening a new chart."
          >
            <SelectControl
              value={defaultTimeframe}
              options={TIMEFRAME_OPTIONS}
              onChange={setDefaultTimeframe}
            />
          </SettingRow>
          <SettingRow
            label="Default Period"
            description="Amount of history fetched when opening a new chart."
          >
            <SelectControl
              value={defaultPeriod}
              options={PERIOD_OPTIONS}
              onChange={setDefaultPeriod}
            />
          </SettingRow>
        </SettingsCard>

        {/* Notifications */}
        <SettingsCard title="Notifications">
          <SettingRow
            label="Trigger Alerts"
            description="Show a desktop notification when a trigger rule fires."
          >
            <ToggleControl
              checked={notificationsEnabled}
              onChange={setNotificationsEnabled}
            />
          </SettingRow>
        </SettingsCard>

        {/* About */}
        <SettingsCard title="About">
          <SettingRow label="Version">
            <span className="font-data text-[11px] text-[var(--text-3)]">0.1.0</span>
          </SettingRow>
          <SettingRow label="Storage">
            <span className="font-data text-[11px] text-[var(--text-3)]">Local SQLite</span>
          </SettingRow>
        </SettingsCard>

      </div>
    </div>
  );
}
