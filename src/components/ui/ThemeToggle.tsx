/**
 * ThemeToggle — navbar top-right light/dark switch (Phase 8.9+)
 *
 * Flips `useSettingsStore.themeMode` between "dark" and "light". The
 * actual class swap on <html> is done by the global effect in App.tsx
 * (see `useThemeClass`), which keeps this component purely presentational.
 *
 * Icon: sun when in dark mode (click to go light), moon when in light
 * mode (click to go dark).
 */

import { Moon, Sun } from "lucide-react";
import { useSettingsStore } from "@/store";

export function ThemeToggle() {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const isDark = themeMode === "dark";

  return (
    <button
      type="button"
      onClick={() => setThemeMode(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-[var(--bg-2)] text-[var(--text-2)] transition-colors hover:bg-[var(--bg-3)] hover:text-[var(--text-1)] cursor-pointer"
    >
      {isDark ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
    </button>
  );
}

export default ThemeToggle;
