import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TodayPage from "@/pages/TodayPage";
import { QuickAlertReview } from "@/components/analysis/QuickAlertReview";
import { useNavigationStore } from "@/store/navigation";
import type { TriggerHit } from "@/modules/parallax/api";

const { api } = vi.hoisted(() => ({ api: { getTriggerHits: vi.fn(), getTriggerRules: vi.fn(), dismissTriggerHit: vi.fn(), updateTriggerRule: vi.fn(), deleteTriggerRule: vi.fn() } }));
vi.mock("@/modules/parallax/api", () => ({ parallaxApi: api }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => ({ addHandler: () => () => {} }) }));
vi.mock("@/components/triggers", () => ({ RuleModal: () => null }));

function Harness() {
  const screen = useNavigationStore((state) => state.activeScreen);
  const context = useNavigationStore((state) => state.analysisContext);
  return screen === "analysis" ? <QuickAlertReview hitId={context.triggerHitId!} conid={context.conid} /> : <TodayPage />;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.values(api).forEach((mock) => mock.mockReset()); });

it("groups repeated alerts, opens Analysis in one click, and keeps a successful dismissal quiet across refetch and return", async () => {
  const rule = { id: 4, name: "BB", enabled: true, revision: 1, timeframe: "30m", conditions: [], ibkr_mirror_target: null, conid: 555, symbol: "NBIS" };
  const hit = { id: 11, rule_id: 4, conid: 555, symbol: "NBIS", rule_name: "BB", triggered_at: "2026-10-09T15:00:00Z", condition_values: [{ indicator: "bbands", condition: "above", threshold: 0, actual_value: .4 }], dismissed_at: null, watchlist_name: null };
  const metadata = { snoozed_until: null, source_watchlist: null, target_watchlist: null, moved_back: false, expires_at: null };
  let hits: TriggerHit[] = [{ ...metadata, ...hit, id: 10, triggered_at: "2026-10-08 15:00:00" }, { ...metadata, ...hit }];
  api.getTriggerHits.mockImplementation(async ({ status }: { status: string }) => status === "active" ? hits.filter((item) => !item.dismissed_at) : hits);
  api.getTriggerRules.mockResolvedValue([rule]);
  api.dismissTriggerHit.mockRejectedValueOnce(new Error("sidecar unavailable")).mockImplementation(async () => { hits = hits.map((item) => ({ ...item, dismissed_at: "2026-10-09T16:00:00Z" })); });
  useNavigationStore.setState((state) => ({ activeScreen: "today", analysisContext: { returnTo: "today", setupPlanId: null, conid: null }, todayContext: { ...state.todayContext, view: "alerts", alertsScrollTop: 0, alertHistoryOpen: false }, analysisDraftDirty: false }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  expect(await screen.findByText("New alerts · 1")).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Open NBIS BB in Analysis" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Open NBIS BB in Analysis" }));
  await screen.findByRole("button", { name: "Dismiss alert" });
  expect(useNavigationStore.getState().analysisContext).toMatchObject({ returnTo: "today", triggerHitId: 11, conid: 555 });
  expect(api.dismissTriggerHit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss alert" }));
  await waitFor(() => expect(api.dismissTriggerHit).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Dismiss alert" })).not.toBeDisabled());
  expect(useNavigationStore.getState().activeScreen).toBe("analysis");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss alert" }));
  expect(await screen.findByText("No new alerts")).toBeVisible();
  await client.invalidateQueries({ queryKey: ["trigger-hits"] });
  expect(screen.queryByRole("button", { name: "Open NBIS BB in Analysis" })).toBeNull();
  expect(rule.enabled).toBe(true);
  fireEvent.click(screen.getByText("History"));
  await screen.findByText("NBIS · BB · 2 alerts");
  fireEvent.click(screen.getByText("NBIS · BB · 2 alerts"));
  expect(screen.getAllByText("Acknowledged")).toHaveLength(2);
  expect(screen.getByText(new Date("2026-10-08T15:00:00Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))).toBeVisible();
  fireEvent.click(screen.getByText("Alert rules · 1"));
  vi.spyOn(window, "confirm").mockReturnValue(false);
  api.deleteTriggerRule.mockRejectedValueOnce(new Error("Delete failed. Try again.")).mockImplementation(async () => { api.getTriggerRules.mockResolvedValue([]); hits = []; });
  fireEvent.click(screen.getByRole("button", { name: "Delete BB" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(api.deleteTriggerRule).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete BB" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete alert" }));
  await within(dialog).findByRole("alert");
  expect(screen.getByRole("button", { name: "Delete alert" })).not.toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete alert" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.deleteTriggerRule).toHaveBeenCalledWith(4);
  expect(screen.queryByRole("button", { name: "Delete BB" })).toBeNull();
  expect(screen.queryByText("NBIS · BB · 2 alerts")).toBeNull();
  expect(window.confirm).not.toHaveBeenCalled();
  client.clear();
});
