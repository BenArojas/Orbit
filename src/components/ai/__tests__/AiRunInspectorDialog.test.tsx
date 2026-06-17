import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AiRunInspectorDialog from "../AiRunInspectorDialog";

describe("AiRunInspectorDialog", () => {
  it("shows the reviewed summary and exact payload, then confirms only the snapshot", () => {
    const onConfirm = vi.fn();
    render(
      <AiRunInspectorDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
        preview={{
          snapshot_id: "snapshot-123",
          expires_at: "2026-06-18T12:10:00Z",
          provider_name: "openrouter",
          model: {
            id: "anthropic/claude-sonnet-4",
            name: "Claude Sonnet 4",
            context_length: 200000,
            max_completion_tokens: 4096,
            prompt_price_per_token: "0.000003",
            completion_price_per_token: "0.000015",
            request_price: "0",
          },
          request_body: {
            model: "anthropic/claude-sonnet-4",
            messages: [{ role: "user", content: "Analyze AAPL." }],
            stream: true,
            max_tokens: 4096,
          },
          disclosure: {
            sent_to_cloud: ["technical indicators and chart context"],
            kept_local: ["IBKR credentials", "API keys"],
            exact_payload_available_until: "2026-06-18T12:10:00Z",
          },
          cost: {
            currency: "USD",
            estimated_input_tokens: 1000,
            expected_output_tokens: 1024,
            max_output_tokens: 4096,
            estimated_cost_usd: "0.01836",
            maximum_cost_usd: "0.06444",
          },
          fallback_enabled: false,
        }}
      />,
    );

    expect(screen.getByText("Claude Sonnet 4")).toBeTruthy();
    expect(screen.getByText("IBKR credentials")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Payload" }));
    expect(screen.getByText(/Analyze AAPL/)).toBeTruthy();
    expect(screen.queryByText(/Authorization/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Send to OpenRouter/i }));
    expect(onConfirm).toHaveBeenCalledWith("snapshot-123");
  });
});
