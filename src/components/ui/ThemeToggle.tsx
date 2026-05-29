/**
 * ThemeToggle — navbar top-right light/dark switch (Phase 8.9+)
 *
 * Flips `useSettingsStore.themeMode` between "dark" and "light" and keeps
 * `<html>` in sync. Parallax also runs a shell-level sync effect; doing it
 * here makes the same control work in Orbit routes that do not mount
 * Parallax's AppShell, such as MoonMarket.
 *
 * Icon: sun when in dark mode (click to go light), moon when in light
 * mode (click to go dark).
 */

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useSettingsStore } from "@/store";

export function ThemeToggle() {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const isDark = themeMode === "dark";

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("dark", "light");
    html.classList.add(themeMode);
  }, [themeMode]);

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
