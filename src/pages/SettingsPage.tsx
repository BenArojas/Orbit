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

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettingsStore } from "@/store";
import { useGatewayContext } from "@/context/GatewayContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import PulseConfigSection from "@/components/settings/PulseConfigSection";

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

// ── Troubleshooting commands ──────────────────────────────────────────────────

/**
 * Hard-coded list of macOS commands Ben uses when the app gets wedged.
 * Rendered verbatim so they can be copied to a terminal with one click.
 *
 * If the app gains Windows support, gate this list per platform
 * (use navigator.userAgent or a Tauri os plugin call).
 */
const TROUBLESHOOTING_COMMANDS: { cmd: string; desc: string }[] = [
  {
    cmd: "lsof -nP -iTCP:5001",
    desc: "See which process is holding port 5001 (IBKR Gateway).",
  },
  {
    cmd: "lsof -ti:5001 | xargs kill -9",
    desc: "Force-kill whoever owns port 5001. Use when the gateway won't start.",
  },
  {
    cmd: "pkill -f 'ibgroup.*clientportal.gw'",
    desc: "Kill the IBKR Gateway java process by name.",
  },
  {
    cmd: "pkill -f parallax-sidecar",
    desc: "Kill the FastAPI sidecar if it's wedged and not responding.",
  },
];

function CommandRow({ cmd, desc }: { cmd: string; desc: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(cmd).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Failed to copy"),
    );
  }

  return (
    <div className="py-3 border-b border-border last:border-0">
      <div className="flex items-start gap-2">
        <code className="flex-1 min-w-0 font-data text-[11px] text-[var(--text-1)] bg-[var(--bg-3)] px-2 py-1.5 rounded break-all">
          {cmd}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy command"
          className="shrink-0 rounded-md p-1.5 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-3)] transition-colors cursor-pointer"
          title={copied ? "Copied" : "Copy to clipboard"}
        >
          {copied ? (
            <Check size={13} className="text-[var(--clr-green)]" />
          ) : (
            <Copy size={13} />
          )}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-3)] leading-snug">
        {desc}
      </p>
    </div>
  );
}

// ── Clear React Query cache ───────────────────────────────────────────────────

/**
 * Drops all in-memory TanStack Query cache entries. Useful when a
 * `staleTime: Infinity` query (like `["conid", resolve]` on the pulse
 * bar) is holding onto a stale resolution from a previous session and
 * the only way to refresh it would be a full app restart.
 *
 * This does NOT touch SQLite — your settings, watchlists, pulse-config
 * rows, triggers, etc. are all safe.
 */
function ClearQueryCacheRow() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  function clear() {
    setBusy(true);
    try {
      qc.clear();
      toast.success("Query cache cleared — refetching…");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to clear cache";
      toast.error(msg);
    } finally {
      // Brief lockout so the button doesn't flicker on rapid clicks.
      setTimeout(() => setBusy(false), 400);
    }
  }

  return (
    <SettingRow
      label="Clear Query Cache"
      description="Drops all in-memory React Query data (resolved conids, quotes, candles). Every component refetches on next render. Doesn't touch the database."
    >
      <button
        type="button"
        onClick={clear}
        disabled={busy}
        className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--bg-3)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "Clearing…" : "Clear cache"}
      </button>
    </SettingRow>
  );
}

// ── Factory reset dialog ──────────────────────────────────────────────────────

/**
 * Destructive action — wipes root/logs, root/Jts, and any *.cookie / *.session
 * files in the gateway home. Preserves the JRE, Gateway binaries, and
 * conf.yaml so no re-download is required.
 *
 * Use when Reset Session alone didn't clear a wedged auth state — typically
 * when IBKR's dispatcher stopped handing us a fresh download on subsequent
 * login attempts because a stale local cookie is masking the new session.
 */
function FactoryResetRow() {
  const { factoryReset, actionLoading } = useGatewayContext();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  async function confirm() {
    setRunning(true);
    try {
      await factoryReset();
      toast.success("Gateway factory reset complete");
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Factory reset failed";
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <SettingRow
        label="Factory Reset Gateway"
        description="Clears cached IBKR session files (logs, cookies, Jts). Keeps binaries and config. Use only if 'Reset session' didn't help."
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={actionLoading || running}
          className="cursor-pointer rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--clr-red)]/10 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderColor: "var(--clr-red)", color: "var(--clr-red)" }}
        >
          Factory Reset
        </button>
      </SettingRow>

      <Dialog open={open} onOpenChange={(v) => !running && setOpen(v)}>
        <DialogContent className="max-w-sm bg-[var(--bg-2)] border-border">
          <DialogHeader>
            <DialogTitle className="text-[13px] font-semibold text-[var(--text-1)]">
              Factory Reset Gateway?
            </DialogTitle>
            <DialogDescription className="text-[11px] text-[var(--text-3)] leading-snug">
              This stops the gateway, deletes cached session files (logs,
              cookies, Jts), and restarts it. You'll need to log in to IBKR
              again. Your settings, watchlists, and local database are not
              touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={running}
              className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--bg-3)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={running}
              className="cursor-pointer rounded-md px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "var(--clr-red)" }}
            >
              {running ? "Resetting…" : "Reset Gateway"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

        {/* Market Pulse (Phase 8.9+) */}
        <SettingsCard title="Market Pulse">
          <PulseConfigSection />
        </SettingsCard>

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

        {/* Troubleshooting */}
        <SettingsCard title="Troubleshooting">
          <ClearQueryCacheRow />
          <FactoryResetRow />
          <div className="pt-2 pb-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-3)] mb-1">
              Terminal commands (macOS)
            </p>
            <p className="text-[10px] text-[var(--text-3)] leading-snug mb-2">
              Copy and paste into Terminal when things get stuck.
            </p>
            {TROUBLESHOOTING_COMMANDS.map((c) => (
              <CommandRow key={c.cmd} cmd={c.cmd} desc={c.desc} />
            ))}
          </div>
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
