# AI Run Inspector UX Lifecycle Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the AI Run Inspector and Analysis metadata inside their fixed surfaces, close the review dialog only after the cloud stream is accepted, and make the resulting receipt reliably reachable.

**Architecture:** Preserve the existing preview, SSE, Zustand, and metadata-only receipt boundaries. Add a small lifecycle callback contract to the prepared-analysis stream, identify the accepted run with a response header, and let the inspector reconcile that run through the existing `/ai/runs` endpoint if the terminal SSE receipt is missed. Keep layout changes inside the existing components and Tailwind system.

**Tech Stack:** React 19, TypeScript strict mode, Zustand, TanStack Query v5, Tailwind/shadcn, Vitest and Testing Library; FastAPI, pytest.

**Status:** APPROVED FOR EXECUTION on 2026-06-19. `PROJECT_PLAN.md` tracks this mission as IN PROGRESS. Execute Slice 1 only, then stop at its checkpoint.

## Global Constraints

- Execute this plan before `2026-06-19-ai-prompt-grounding-evaluation-loop.md`.
- Do not change prompt text, indicator facts, cloud payload contents, routing policy, key storage, or model selection.
- API keys remain in the OS keychain only. Receipts remain metadata-only.
- Do not widen the 340px Analysis rail.
- Do not add a frontend or backend dependency.
- Use TDD through routes, hooks, and rendered components.
- After each slice, stop and report what was proven before continuing.

## Resolved UX Contract

- Payload text soft-wraps inside the dialog. Copy still returns the exact unmodified JSON string.
- The dialog never grows wider than its viewport bounds because of payload, model, generation ID, receipt, or comparison content.
- `AI Analysis` stays on one line. Latest provider, model, cost, and fallback metadata occupy a second full-width row.
- The full model ID is available through a native tooltip while the visible value truncates.
- Clicking `Send to OpenRouter` changes the action to `Sending...` and disables Send and Compare.
- The dialog remains open while the server validates the snapshot and route.
- A successful `2xx` streaming response closes the dialog so the user can see the Analysis response.
- A non-`2xx` response keeps the dialog open and shows the typed error.
- The accepted response carries `X-Orbit-AI-Run-ID`; no secret or prompt content is added to headers.
- Completed and failed runs expose a compact `View last run` action that reopens the inspector on Receipt.
- The SSE receipt is primary. `/ai/runs` is a recovery path keyed by the accepted run ID.
- Actual `$0.0000` is displayed as a real cost rather than omitted by a truthiness check.

## Policy Impact

**None expected.** This plan changes presentation and lifecycle observability only. It does not change Orbit safety rules, cloud/local boundaries, stored data, or AI authority. The new response header is additive and non-secret.

## File Map

- `src/components/ai/AiRunInspectorDialog.tsx`: contained layout, lifecycle copy, receipt-first reopening, and cost rendering.
- `src/components/ai/AiProviderBadge.tsx`: bounded latest-run metadata row.
- `src/components/ai/AiChatPanel.tsx`: two-row header and reachable `View last run` action.
- `src/hooks/useAiAnalyzeStream.ts`: accepted/completed/rejected lifecycle callbacks and accepted run ID.
- `src/hooks/useAiRunInspector.ts`: inspector phase, open/close behavior, receipt reconciliation.
- `src/modules/parallax/api.ts`: reuse `aiRuns`; no new receipt endpoint.
- `backend/routers/ai.py`: attach the generated run ID to the prepared stream response.
- Existing AI component, hook, and route tests prove the behavior through public interfaces.

---

## Slice 1: AFK - Contain the Inspector and Analysis Header

**Proof target:** Real long payload and provider metadata remain inside the current dialog and 340px rail without changing the information shown.

**Files:**
- Modify: `src/components/ai/AiRunInspectorDialog.tsx`
- Modify: `src/components/ai/AiProviderBadge.tsx`
- Modify: `src/components/ai/AiChatPanel.tsx`
- Test: `src/components/ai/__tests__/AiRunInspectorDialog.test.tsx`
- Test: `src/components/ai/__tests__/AiProviderBadge.test.tsx`
- Test: `src/components/ai/__tests__/AiChatPanel.test.tsx`

**Interfaces:**
- Consumes: existing `AIAnalysisPreview`, `AIRunReceipt`, and `AIProviderMetadata`.
- Produces: unchanged component props and unchanged copied payload bytes.

- [ ] **Step 1: Add the failing long-content component behaviors**

Add a payload test using one message whose content is at least 2,000 characters and a badge test using `z-ai/glm-5.2-very-long-provider-variant`. Assert:

```tsx
fireEvent.click(screen.getByRole("tab", { name: "Payload" }));
const payload = screen.getByTestId("ai-run-payload");
expect(payload).toHaveClass("whitespace-pre-wrap", "break-words", "max-w-full");

expect(screen.getByTitle("z-ai/glm-5.2-very-long-provider-variant")).toBeTruthy();
expect(screen.getByTestId("ai-run-metadata-row")).toBeTruthy();
```

Keep the existing copy assertion and strengthen it so `navigator.clipboard.writeText` receives `JSON.stringify(requestBody, null, 2)` exactly.

- [ ] **Step 2: Run the focused tests red**

Run:

```bash
npm test -- src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx
```

Expected: FAIL because the payload has no containment classes or test ID, the full model ID has no tooltip, and the header has no metadata row.

- [ ] **Step 3: Apply the minimum containment layout**

Use a zero-minimum grid column and propagate `min-w-0 max-w-full` through the dialog, tabs, and tab panels. Render payload with soft wrapping:

```tsx
<DialogContent className="grid min-w-0 grid-cols-[minmax(0,1fr)] ...">
  <Tabs className="min-h-0 min-w-0 max-w-full">
    <TabsContent value="payload" className="relative min-h-0 min-w-0 max-w-full overflow-y-auto">
      <pre
        data-testid="ai-run-payload"
        className="max-h-[55vh] max-w-full whitespace-pre-wrap break-words rounded-md bg-muted p-3 pr-10 text-[11px] leading-relaxed"
      >
        {payload}
      </pre>
    </TabsContent>
  </Tabs>
</DialogContent>
```

Do not transform the `payload` string before copying it.

- [ ] **Step 4: Move latest-run metadata to a bounded second row**

Make the header a two-row block:

```tsx
<div className="shrink-0 border-b border-[var(--border)] px-4 py-2">
  <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold">
    {/* status dot and AI Analysis */}
  </div>
  {showChat && lastProviderMetadata && (
    <div data-testid="ai-run-metadata-row" className="mt-1 min-w-0">
      <AiProviderBadge {...badgeProps} />
    </div>
  )}
</div>
```

In `AiProviderBadge`, make the outer element `w-full min-w-0`, give the model `min-w-0 flex-1 truncate`, add `title={model}`, and keep cost/fallback `shrink-0`.

- [ ] **Step 5: Run the focused tests green**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 6: Verify the real layouts**

Start the existing app normally and verify:

1. The supplied WULF payload remains inside the dialog at the current desktop viewport.
2. A 320px-wide viewport keeps the payload, tabs, and footer inside the dialog.
3. The 340px Analysis rail keeps `AI Analysis` on one line and shows bounded provider/model/cost metadata below it.
4. Copy Payload still produces byte-for-byte equivalent formatted JSON.

Capture screenshots for the slice report. Do not add a browser-test dependency in this slice.

- [ ] **Step 7: Commit Slice 1**

```bash
git add src/components/ai/AiRunInspectorDialog.tsx src/components/ai/AiProviderBadge.tsx src/components/ai/AiChatPanel.tsx src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx
git commit -m "fix: contain ai run inspector layouts"
```

**Checkpoint:** Stop. Report the desktop and narrow-viewport evidence before Slice 2.

---

## Slice 2: AFK - Close on Acceptance and Recover the Receipt

**Proof target:** One reviewed cloud run closes the dialog only after HTTP acceptance, cannot be submitted twice through the UI, and remains inspectable after completion or failure.

**Files:**
- Modify: `backend/routers/ai.py`
- Test: `backend/tests/test_ai_provider_routes.py`
- Modify: `src/hooks/useAiAnalyzeStream.ts`
- Modify: `src/hooks/useAiRunInspector.ts`
- Modify: `src/components/ai/AiRunInspectorDialog.tsx`
- Modify: `src/components/ai/AiChatPanel.tsx`
- Test: `src/hooks/__tests__/useAiAnalyzeStream.test.ts`
- Test: `src/hooks/__tests__/useAiRunInspector.test.ts`
- Test: `src/components/ai/__tests__/AiRunInspectorDialog.test.tsx`
- Test: `src/components/ai/__tests__/AiChatPanel.test.tsx`

**Interfaces:**
- Produces backend header: `X-Orbit-AI-Run-ID: <uuid>` on accepted prepared streams.
- Produces frontend lifecycle callbacks:

```ts
export interface PreparedAnalyzeLifecycle {
  onAccepted?: (runId: string | null) => void;
  onCompleted?: (receipt: AIRunReceipt | null) => void;
  onRejected?: (error: Error, receipt: AIRunReceipt | null) => void;
}
```

- Produces inspector phase: `"review" | "submitting" | "running" | "completed" | "failed"`.

- [ ] **Step 1: Write the failing route-header behavior**

Extend the successful prepared-stream route test:

```python
response = client.post("/ai/analyze/stream", json={"snapshot_id": snapshot_id})
assert response.status_code == 200
run_id = response.headers["X-Orbit-AI-Run-ID"]
UUID(run_id)
events = [
    json.loads(line.removeprefix("data: "))
    for line in response.iter_lines()
    if line.startswith("data: ")
]
assert events[-1]["receipt"]["run_id"] == run_id
```

- [ ] **Step 2: Run the backend test red**

```bash
cd backend
uv run python -m pytest tests/test_ai_provider_routes.py -q -k "prepared and stream and receipt"
```

Expected: FAIL because the response has no run-ID header.

- [ ] **Step 3: Add the non-secret accepted-run header**

In the prepared stream branch, return:

```python
return StreamingResponse(
    prepared_event_stream(),
    media_type="text/event-stream",
    headers={"X-Orbit-AI-Run-ID": run_id},
)
```

Run Step 2 again. Expected: PASS.

- [ ] **Step 4: Write failing stream lifecycle tests**

Add public hook behaviors proving:

```ts
expect(onAccepted).not.toHaveBeenCalled();
resolveFetchResponse(okStreamingResponse({ runId: "run-123" }));
await waitFor(() => expect(onAccepted).toHaveBeenCalledWith("run-123"));
await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(successReceipt));
```

For a `409`, assert `onAccepted` is not called and `onRejected` receives the typed error. For a terminal SSE error, assert acceptance happens first and rejection receives the failed receipt.

- [ ] **Step 5: Add lifecycle callbacks at the HTTP and terminal boundaries**

Call `onAccepted` only after `resp.ok && resp.body`. Read the run ID case-insensitively through `resp.headers.get("X-Orbit-AI-Run-ID")`. Call `onCompleted` after the `done` receipt is committed and `onRejected` for HTTP or SSE failures.

Do not move receipt ownership out of Zustand; the callbacks make the inspector lifecycle explicit while the existing store remains the shared latest-run state.

- [ ] **Step 6: Write failing inspector lifecycle tests**

Prove these behaviors through `useAiRunInspector`:

```ts
act(() => result.current.send());
expect(result.current.phase).toBe("submitting");
expect(result.current.open).toBe(true);

callbacks.onAccepted?.("run-123");
expect(result.current.phase).toBe("running");
expect(result.current.open).toBe(false);

callbacks.onCompleted?.(successReceipt);
act(() => result.current.openLastRun());
expect(result.current.open).toBe(true);
expect(result.current.phase).toBe("completed");
expect(result.current.receipt).toEqual(successReceipt);
```

Also mock `parallaxApi.aiRuns(10)` returning `run-123` and prove it supplies the receipt when `onCompleted(null)` is received.

- [ ] **Step 7: Implement the inspector state machine and reconciliation**

Keep this state local to `useAiRunInspector`:

```ts
type InspectorPhase = "review" | "submitting" | "running" | "completed" | "failed";

const [phase, setPhase] = useState<InspectorPhase>("review");
const [acceptedRunId, setAcceptedRunId] = useState<string | null>(null);
const [terminalReceipt, setTerminalReceipt] = useState<AIRunReceipt | null>(null);
```

Use the SSE receipt first. When an accepted run has no terminal receipt, call the existing `parallaxApi.aiRuns(10)` through TanStack Query and select only an exact `run_id` match. Do not guess by model or timestamp.

`openLastRun()` opens only when a terminal or reconciled receipt exists.

- [ ] **Step 8: Render honest lifecycle actions and receipt costs**

- Send is enabled only in `review`.
- Send label is `Sending...` in `submitting`.
- Send and Compare are disabled in `submitting` and `running`.
- The footer is absent after acceptance.
- Reopening a completed/failed run selects Receipt.
- `Attempt` renders actual cost when `actual_cost_usd !== null`; otherwise it renders estimated cost when available.
- Add `View last run` beside the latest-run metadata only when a receipt exists.

- [ ] **Step 9: Run the complete UX slice verification**

```bash
cd backend
uv run python -m pytest tests/test_ai_provider_routes.py -q -k "prepared or runs"
cd ..
npm test -- src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/components/ai/__tests__/AiProviderBadge.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts src/hooks/__tests__/useAiRunInspector.test.ts
npm run build
git diff --check
```

Expected: PASS. Existing unrelated React `act(...)` warnings must be reported rather than described as new failures.

- [ ] **Step 10: Perform the accepted-close manual smoke**

1. Open Review Cloud Run and click Send once.
2. Confirm `Sending...` appears while validation is pending.
3. Confirm the dialog closes when the stream is accepted and the Analysis response becomes visible.
4. Confirm the action cannot create a second charged run.
5. Open `View last run` and confirm Receipt shows tokens, generation ID, duration, estimated cost, and actual cost.
6. Force a mocked `409` and confirm the dialog stays open with a typed error.

- [ ] **Step 11: Commit Slice 2**

```bash
git add backend/routers/ai.py backend/tests/test_ai_provider_routes.py src/hooks/useAiAnalyzeStream.ts src/hooks/useAiRunInspector.ts src/components/ai/AiRunInspectorDialog.tsx src/components/ai/AiChatPanel.tsx src/hooks/__tests__/useAiAnalyzeStream.test.ts src/hooks/__tests__/useAiRunInspector.test.ts src/components/ai/__tests__/AiRunInspectorDialog.test.tsx src/components/ai/__tests__/AiChatPanel.test.tsx
git commit -m "fix: complete ai run inspector lifecycle"
```

**Checkpoint:** Stop for user review. Do not start the payload-integrity plan automatically.

## Acceptance Criteria

- No payload or metadata text enlarges the dialog or Analysis rail.
- Copied payload remains exact.
- The dialog closes on accepted `2xx`, not on click and not on first model token.
- Validation failures remain visible inside the dialog.
- Duplicate UI submission is blocked.
- The accepted run ID links the stream to its metadata-only receipt.
- A missed terminal receipt is recovered by exact run ID.
- Completed and failed receipts are reachable after the dialog closes.
- Zero actual cost is displayed truthfully.
- Prompt and signal behavior are unchanged.

## Execution Instruction

Execute Slice 1 only. Use TDD, run its focused tests and viewport verification, commit it, and stop for user approval before Slice 2.
