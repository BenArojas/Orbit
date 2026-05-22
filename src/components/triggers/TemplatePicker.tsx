import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type RuleTemplate, type TriggerCondition } from "@/lib/api";

interface Props {
  onPick: (t: {
    id: number;
    name: string;
    default_timeframe: string;
    conditions: TriggerCondition[];
  }) => void;
}

export function TemplatePicker({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const { data: templates } = useQuery<RuleTemplate[]>({
    queryKey: ["rule-templates"],
    queryFn: () => api.getRuleTemplates(),
    staleTime: Infinity,
  });

  return (
    <div className="rounded-md border border-border bg-[var(--bg-1)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-3)]"
      >
        <span>Start from a template</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="flex flex-col border-t border-border">
          {(templates ?? []).length === 0 && (
            <div className="px-3 py-2 text-[10px] text-[var(--text-3)]">
              No templates yet — built-ins seed on first launch.
            </div>
          )}
          {(templates ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() =>
                onPick({
                  id: t.id,
                  name: t.name,
                  default_timeframe: t.default_timeframe,
                  conditions: t.conditions,
                })
              }
              className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2 text-left hover:bg-[var(--bg-3)]"
            >
              <div>
                <div className="text-[11px] font-semibold text-[var(--text-1)]">
                  {t.name}
                </div>
                {t.description && (
                  <div className="text-[9px] text-[var(--text-3)]">
                    {t.description}
                  </div>
                )}
              </div>
              <span className="self-center rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[8px] text-[var(--text-3)]">
                {t.category}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
