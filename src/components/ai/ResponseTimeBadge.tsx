/**
 * ResponseTimeBadge — non-intrusive performance indicator next to the model
 * picker.
 *
 * Shows a colored dot + the rolling average response time across recent
 * /ai/analyze runs *for the currently selected model*. Samples are kept
 * in-memory only (useAiStore.responseTimes) — restarting the app wipes them.
 *
 * Color thresholds (no suggestion text — let the user infer):
 *   green  < 30s   — comfortable headroom, model fits the hardware
 *   amber  30–60s  — usable but slow
 *   red    > 60s   — consider a smaller model
 *
 * Hidden when there are no samples yet for the selected model. We don't
 * filter by stale samples — if you switch models, the next run starts a
 * fresh stream of samples for that model's name.
 */

import { useMemo } from "react";
import { useAiStore } from "@/store";

interface ResponseTimeBadgeProps {
  /** Currently selected model name — used to filter samples. */
  selectedModel: string | null;
  /** Number of most-recent samples to average. Default 5. */
  windowSize?: number;
}

interface BadgeColor {
  /** Border + dot color */
  color: string;
  /** Soft background tint behind the badge */
  bg: string;
}

const GREEN: BadgeColor = {
  color: "var(--clr-green)",
  bg:    "rgba(0, 255, 136, 0.08)",
};
const AMBER: BadgeColor = {
  color: "var(--clr-amber, #ff9f1c)",
  bg:    "rgba(255, 159, 28, 0.08)",
};
const RED: BadgeColor = {
  color: "var(--clr-red)",
  bg:    "rgba(255, 68, 102, 0.08)",
};

function colorFor(avgMs: number): BadgeColor {
  const s = avgMs / 1000;
  if (s < 30) return GREEN;
  if (s < 60) return AMBER;
  return RED;
}

function formatAvg(avgMs: number): string {
  const s = avgMs / 1000;
  if (s < 1) return "<1s";
  if (s < 60) return `${s.toFixed(1)}s`;
  const mins = Math.floor(s / 60);
  const rem = Math.round(s - mins * 60);
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
}

export default function ResponseTimeBadge({
  selectedModel,
  windowSize = 5,
}: ResponseTimeBadgeProps) {
  const samples = useAiStore((s) => s.responseTimes);

  const avgMs = useMemo(() => {
    if (!selectedModel) return null;
    // Filter to the currently-selected model so we don't mix samples across
    // model switches. Take the last `windowSize` matching samples.
    const matching = samples
      .filter((s) => s.model === selectedModel)
      .slice(-windowSize);
    if (matching.length === 0) return null;
    const sum = matching.reduce((acc, s) => acc + s.durationMs, 0);
    return sum / matching.length;
  }, [samples, selectedModel, windowSize]);

  // No data yet — render nothing rather than an empty placeholder
  if (avgMs == null) return null;

  const c = colorFor(avgMs);

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] font-data text-[9px]"
      style={{ borderColor: c.color, background: c.bg, color: c.color }}
      title={`Rolling avg of last ${Math.min(windowSize, samples.filter((s) => s.model === selectedModel).length)} runs on ${selectedModel}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: c.color, boxShadow: `0 0 4px ${c.color}` }}
      />
      avg {formatAvg(avgMs)}
    </span>
  );
}
