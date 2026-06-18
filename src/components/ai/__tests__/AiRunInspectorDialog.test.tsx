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
    fireEvent.click(screen.getByRole("tab", { name: "Compare" }));
    expect(screen.getByRole("button", { name: "Run comparison" })).toBeDisabled();
    expect(screen.getByText("A ready local Ollama model is required for comparison.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Send to OpenRouter/i }));
    expect(onConfirm).toHaveBeenCalledWith("snapshot-123");
  });

  it("shows concrete OpenRouter success metadata in the Receipt tab", () => {
    render(
      <AiRunInspectorDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        preview={null}
        receipt={{
          run_id: "run-1",
          requested_provider: "openrouter",
          requested_model: "anthropic/claude-sonnet-4",
          executed_provider: "openrouter",
          resolved_model: "anthropic/claude-sonnet-4",
          fallback_used: false,
          fallback_reason: null,
          status: "success",
          attempts: [{
            provider_name: "openrouter",
            requested_model: "anthropic/claude-sonnet-4",
            resolved_model: "anthropic/claude-sonnet-4",
            status: "success",
            provider_request_id: "gen-123",
            input_tokens: 120,
            output_tokens: 80,
            reasoning_tokens: 10,
            cached_tokens: 25,
            estimated_cost_usd: "0.02",
            actual_cost_usd: "0.0123",
            duration_ms: 640,
            error_code: null,
          }],
          created_at: "2026-06-18T12:00:00Z",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Receipt" }));
    expect(screen.getAllByText("anthropic/claude-sonnet-4").length).toBeGreaterThan(0);
    expect(screen.getByText("gen-123")).toBeTruthy();
    expect(screen.getByText("120 in / 80 out")).toBeTruthy();
    expect(screen.getByText("$0.0123 actual")).toBeTruthy();
    expect(screen.getByText("640 ms")).toBeTruthy();
  });

  it("shows both attempts and the reason when Ollama fallback succeeds", () => {
    render(
      <AiRunInspectorDialog
        open
        preview={null}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        receipt={{
          run_id: "run-2",
          requested_provider: "openrouter",
          requested_model: "anthropic/claude-sonnet-4",
          executed_provider: "ollama",
          resolved_model: "gemma4:26b",
          fallback_used: true,
          fallback_reason: "ai_provider_network_error",
          status: "fallback_success",
          attempts: [
            {
              provider_name: "openrouter", requested_model: "anthropic/claude-sonnet-4",
              resolved_model: null, status: "failed", provider_request_id: null,
              input_tokens: null, output_tokens: null, reasoning_tokens: null,
              cached_tokens: null, estimated_cost_usd: "0.02", actual_cost_usd: null,
              duration_ms: 100, error_code: "ai_provider_network_error",
            },
            {
              provider_name: "ollama", requested_model: "anthropic/claude-sonnet-4",
              resolved_model: "gemma4:26b", status: "fallback_success",
              provider_request_id: null, input_tokens: null, output_tokens: null,
              reasoning_tokens: null, cached_tokens: null, estimated_cost_usd: null,
              actual_cost_usd: null, duration_ms: 800, error_code: null,
            },
          ],
          created_at: "2026-06-18T12:00:00Z",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Receipt" }));
    expect(screen.getByText("Fallback succeeded")).toBeTruthy();
    expect(screen.getByText("ai_provider_network_error")).toBeTruthy();
    expect(screen.getByText("OpenRouter failed")).toBeTruthy();
    expect(screen.getByText("Local Ollama fallback succeeded")).toBeTruthy();
  });

  it("keeps historical receipts metadata-only and shows blocked runs without request ids", () => {
    render(
      <AiRunInspectorDialog
        open
        preview={null}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        receipt={{
          run_id: "run-3", requested_provider: "openrouter", requested_model: "model-1",
          executed_provider: null, resolved_model: null, fallback_used: false,
          fallback_reason: null, status: "blocked", created_at: "2026-06-18T12:00:00Z",
          attempts: [{
            provider_name: "openrouter", requested_model: "model-1", resolved_model: null,
            status: "blocked", provider_request_id: null, input_tokens: null,
            output_tokens: null, reasoning_tokens: null, cached_tokens: null,
            estimated_cost_usd: "1.00", actual_cost_usd: null, duration_ms: 0,
            error_code: "ai_cost_limit_exceeded",
          }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Payload" }));
    expect(screen.getByText("Exact payload expired by design.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Receipt" }));
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy generation ID" })).toBeNull();
  });

  it("compares objective local and cloud results without declaring a winner", () => {
    const receipt = {
      run_id: "run-compare", requested_provider: "ollama" as const,
      requested_model: "gemma4:26b", executed_provider: "ollama" as const,
      resolved_model: "gemma4:26b", fallback_used: false, fallback_reason: null,
      status: "success" as const, created_at: "2026-06-18T12:00:00Z",
      attempts: [{
        provider_name: "ollama" as const, requested_model: "gemma4:26b",
        resolved_model: "gemma4:26b", status: "success" as const,
        provider_request_id: null, input_tokens: null, output_tokens: null,
        reasoning_tokens: null, cached_tokens: null, estimated_cost_usd: null,
        actual_cost_usd: null, duration_ms: 900, error_code: null,
      }],
    };
    const quality = {
      response_completed: true, signal_parsed: true, entry_present: true,
      stop_present: true, target_present: true, checks_count: 5,
      narrative_characters: 21,
    };
    render(
      <AiRunInspectorDialog
        open preview={null} receipt={null} localReady
        onOpenChange={vi.fn()} onConfirm={vi.fn()} onCompare={vi.fn()}
        comparison={{
          snapshot_id: "snapshot-123", same_input: true,
          local: { receipt, message: "Local narrative", signal: null, quality },
          cloud: {
            receipt: {
              ...receipt, run_id: "run-cloud", requested_provider: "openrouter",
              requested_model: "anthropic/claude-sonnet-4",
              executed_provider: "openrouter", resolved_model: "anthropic/claude-sonnet-4",
              attempts: [{
                ...receipt.attempts[0], provider_name: "openrouter",
                requested_model: "anthropic/claude-sonnet-4",
                resolved_model: "anthropic/claude-sonnet-4",
                actual_cost_usd: "0.0027", duration_ms: 640,
              }],
            },
            message: "Cloud narrative", signal: null, quality,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Compare" }));
    expect(screen.getByText("Same prepared market facts and prompt.")).toBeTruthy();
    expect(screen.getByText("Local Ollama · gemma4:26b")).toBeTruthy();
    expect(screen.getByText("OpenRouter · anthropic/claude-sonnet-4")).toBeTruthy();
    expect(screen.getByText("Local narrative")).toBeTruthy();
    expect(screen.getByText("Cloud narrative")).toBeTruthy();
    expect(screen.getByText("Completeness")).toBeTruthy();
    expect(screen.getByText("Latency")).toBeTruthy();
    expect(screen.getByText("Cost")).toBeTruthy();
    expect(screen.queryByText(/winner|accuracy|recommended model/i)).toBeNull();
  });
});
