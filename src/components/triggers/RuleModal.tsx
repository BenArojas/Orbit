import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  parallaxApi,
  type TriggerCondition,
  type TriggerRuleCreate,
  type WatchlistInfo,
} from "@/modules/parallax/api";
import { ConditionsList } from "./ConditionsList";
import { TemplatePicker } from "./TemplatePicker";

type Scope = "watchlist" | "stock";

const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];

interface Props {
  trigger?: React.ReactNode;
  initial?: Partial<TriggerRuleCreate> & { id?: number };
  onClose?: () => void;
}

const empty = (): TriggerRuleCreate => ({
  name: "",
  enabled: true,
  timeframe: "1D",
  scan_interval_seconds: 300,
  watchlist_name: null,
  conid: null,
  symbol: null,
  template_id: null,
  ibkr_mirror_target: null,
  conditions: [
    { indicator: "rsi", condition: "below", threshold: 30, news_candle_method: null },
  ],
});

export function RuleModal({ trigger, initial, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [scope, setScope] = useState<Scope>(
    initial?.watchlist_name ? "watchlist" : "stock",
  );
  const [form, setForm] = useState<TriggerRuleCreate>({ ...empty(), ...initial });
  const qc = useQueryClient();

  const { data: watchlists } = useQuery({
    queryKey: ["watchlists"],
    queryFn: ({ signal }) => parallaxApi.getWatchlists(signal),
    enabled: open,
    staleTime: Infinity,
  });

  const submit = useMutation({
    mutationFn: (body: TriggerRuleCreate) =>
      initial?.id
        ? parallaxApi.updateTriggerRule(initial.id, body)
        : parallaxApi.createTriggerRule(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trigger-rules"] });
      toast.success(initial?.id ? "Rule updated" : "Rule created");
      setOpen(false);
      onClose?.();
    },
    onError: (err) =>
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
  });

  const saveTemplate = useMutation({
    mutationFn: () =>
      parallaxApi.createRuleTemplate({
        name: form.name,
        description: null,
        category: "custom",
        default_timeframe: form.timeframe,
        conditions: form.conditions,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rule-templates"] });
      toast.success(`Saved "${form.name}" as a template`);
    },
    onError: () => toast.error("Could not save template"),
  });

  const onTemplate = (t: {
    id: number;
    name: string;
    default_timeframe: string;
    conditions: TriggerCondition[];
  }) => {
    setForm((f) => ({
      ...f,
      name: f.name || t.name,
      template_id: t.id,
      timeframe: t.default_timeframe,
      conditions: t.conditions,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: TriggerRuleCreate = {
      ...form,
      watchlist_name: scope === "watchlist" ? form.watchlist_name : null,
      conid: scope === "stock" ? form.conid : null,
      symbol: scope === "stock" ? form.symbol : null,
    };
    if (scope === "watchlist" && !payload.watchlist_name) {
      toast.error("Pick a watchlist");
      return;
    }
    if (scope === "stock" && !payload.conid) {
      toast.error("Resolve a symbol first");
      return;
    }
    if (!payload.name) {
      toast.error("Name the rule");
      return;
    }
    if (!payload.conditions.length) {
      toast.error("At least one condition is required");
      return;
    }
    submit.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : (
        <DialogTrigger render={<Button size="sm">+ Add rule</Button>} />
      )}
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] max-w-lg overflow-hidden border-border bg-[var(--bg-2)]">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-8">
            <DialogTitle className="text-sm">
              {initial?.id ? "Edit Rule" : "New Rule"}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Rule help"
              onClick={() => setShowHelp((next) => !next)}
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {showHelp && <RuleHelp />}

        <form
          onSubmit={handleSubmit}
          data-testid="rule-modal-scroll"
          className="min-h-0 overflow-y-auto pr-1"
        >
          <div className="flex flex-col gap-3">
            <TemplatePicker onPick={onTemplate} />

            <div>
              <label className="mb-1 block text-[10px] text-[var(--text-3)]">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-8 bg-[var(--bg-1)] text-xs"
                placeholder="e.g. Golden Pocket Bounce"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] text-[var(--text-3)]">Scope</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={scope === "watchlist" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScope("watchlist")}
                >
                  Watchlist
                </Button>
                <Button
                  type="button"
                  variant={scope === "stock" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScope("stock")}
                >
                  Single stock
                </Button>
              </div>
            </div>

            {scope === "watchlist" ? (
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-3)]">
                  Watchlist
                </label>
                <select
                  value={form.watchlist_name ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, watchlist_name: e.target.value || null })
                  }
                  className="h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px]"
                >
                  <option value="">Pick a watchlist…</option>
                  {(watchlists ?? []).map((w: WatchlistInfo) => (
                    <option key={w.id} value={w.name}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <StockResolver
                symbol={form.symbol ?? ""}
                conid={form.conid ?? 0}
                onResolved={(symbol, conid) => setForm({ ...form, symbol, conid })}
              />
            )}

            <ConditionsList
              value={form.conditions}
              onChange={(next) => setForm({ ...form, conditions: next })}
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-3)]">
                  Timeframe
                </label>
                <select
                  value={form.timeframe}
                  onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
                  className="h-8 w-full rounded-md border border-border bg-[var(--bg-1)] px-2 text-[10px]"
                >
                  {TIMEFRAME_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-3)]">
                  Also add hits to IBKR watchlist (optional)
                </label>
                <Input
                  value={form.ibkr_mirror_target ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, ibkr_mirror_target: e.target.value || null })
                  }
                  placeholder="Leave empty for Orbit-only"
                  className="h-8 bg-[var(--bg-1)] text-[10px]"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={submit.isPending}
              className="bg-gradient-cta text-sm font-semibold"
            >
              {submit.isPending
                ? "Saving…"
                : initial?.id
                ? "Save changes"
                : "Create rule"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!form.name || !form.conditions.length || saveTemplate.isPending}
              onClick={() => saveTemplate.mutate()}
              className="self-start text-[10px]"
            >
              {saveTemplate.isPending ? "Saving…" : "Save current as template…"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RuleHelp() {
  return (
    <div className="rounded-md border border-border bg-[var(--bg-1)] px-3 py-2 text-[10px] leading-4 text-[var(--text-3)]">
      <div>
        <strong className="text-[var(--text-2)]">Target:</strong> choose one stock
        or a whole watchlist.
      </div>
      <div>
        <strong className="text-[var(--text-2)]">Timeframe:</strong> a 15m rule
        checks 15-minute candles.
      </div>
      <div>
        <strong className="text-[var(--text-2)]">EMA:</strong> Price above EMA
        200 means price is above the long-term trend line.
      </div>
      <div>
        <strong className="text-[var(--text-2)]">Volume:</strong> 1.5x means
        volume is 50% higher than normal.
      </div>
      <div>
        <strong className="text-[var(--text-2)]">Mirror:</strong> also add hits
        to an IBKR watchlist; leave it empty for Orbit-only alerts.
      </div>
    </div>
  );
}

function StockResolver({
  symbol,
  conid,
  onResolved,
}: {
  symbol: string;
  conid: number;
  onResolved: (symbol: string, conid: number) => void;
}) {
  const [text, setText] = useState(symbol);
  const [err, setErr] = useState<string | null>(null);
  const resolve = async () => {
    setErr(null);
    try {
      const r = await parallaxApi.resolveConid(text.toUpperCase());
      onResolved(r.symbol, r.conid);
    } catch (e) {
      setErr(`Could not resolve "${text}"`);
    }
  };
  return (
    <div>
      <label className="mb-1 block text-[10px] text-[var(--text-3)]">Symbol</label>
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value.toUpperCase())}
          className="h-8 bg-[var(--bg-1)] font-data text-xs"
          placeholder="AAPL"
        />
        <Button type="button" variant="outline" size="sm" onClick={resolve}>
          Resolve
        </Button>
      </div>
      {conid > 0 && (
        <span className="mt-0.5 block font-data text-[9px] text-[var(--clr-green)]">
          conid: {conid}
        </span>
      )}
      {err && (
        <span className="mt-0.5 block text-[9px] text-[var(--clr-red)]">{err}</span>
      )}
    </div>
  );
}
