import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const qc = useQueryClient();
  const { data: templates } = useQuery<RuleTemplate[]>({
    queryKey: ["rule-templates"],
    queryFn: () => api.getRuleTemplates(),
    staleTime: Infinity,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteRuleTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rule-templates"] }),
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
        <div className="flex max-h-56 flex-col overflow-y-auto border-t border-border">
          {(templates ?? []).length === 0 && (
            <div className="px-3 py-2 text-[10px] text-[var(--text-3)]">
              No templates yet — built-ins seed on first launch.
            </div>
          )}
          {(templates ?? []).map((t) => (
            <div
              key={t.id}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2 hover:bg-[var(--bg-3)]"
            >
              <button
                type="button"
                onClick={() =>
                  onPick({
                    id: t.id,
                    name: t.name,
                    default_timeframe: t.default_timeframe,
                    conditions: t.conditions,
                  })
                }
                className="min-w-0 text-left"
              >
                <div className="text-[11px] font-semibold text-[var(--text-1)]">
                  {t.name}
                </div>
                {t.description && (
                  <div className="text-[9px] text-[var(--text-3)]">
                    {t.description}
                  </div>
                )}
              </button>
              <span className="self-center rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[8px] text-[var(--text-3)]">
                {t.category}
              </span>
              {!t.is_builtin && (
                <button
                  type="button"
                  aria-label={`Delete ${t.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(t.id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-3)] hover:bg-[rgba(255,68,102,0.12)] hover:text-[var(--clr-red)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
