/**
 * ScreenerAiPanel tests — Commit 4 additions
 *
 * Covers:
 *  - Panel not rendered when isOpen=false
 *  - 5 approved PRESET_QUERIES chips render (no "Earnings this week + high IV")
 *  - "Not ready" state shown when Ollama is unavailable
 *  - Input + send button render when Ollama is ready
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as ReactQueryModule from "@tanstack/react-query";
import ScreenerAiPanel from "./ScreenerAiPanel";

// ── Module mocks ──────────────────────────────────────────────

vi.mock("@/store/screener", () => ({
  useScreenerStore: () => ({
    addFilter: vi.fn(),
    selectedPreset: null,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));

// Controls Ollama state for tests
let mockIsReady = true;
let mockOllamaState = "ready";
let mockSelectedModel: string | null = "llama3.2:latest";

vi.mock("@/hooks/useAiStatus", () => ({
  useAiStatus: () => ({
    isReady: mockIsReady,
    selectedModel: mockSelectedModel,
    ollamaState: mockOllamaState,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsReady = true;
  mockOllamaState = "ready";
  mockSelectedModel = "llama3.2:latest";
});

// ── Visibility ────────────────────────────────────────────────

describe("Panel visibility", () => {
  it("renders nothing when isOpen=false", () => {
    const { container } = render(<ScreenerAiPanel isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel when isOpen=true", () => {
    render(<ScreenerAiPanel isOpen={true} />);
    expect(screen.getByText("AI Filters")).toBeInTheDocument();
  });
});

// ── PRESET_QUERIES chips ──────────────────────────────────────

describe("PRESET_QUERIES chips", () => {
  beforeEach(() => {
    mockIsReady = true;
    mockOllamaState = "ready";
  });

  const APPROVED_CHIPS = [
    "Oversold large caps",
    "High momentum small caps",
    "Low float high volume",
    "Strong uptrend breakout",
    "Value stocks with growth",
  ] as const;

  it.each(APPROVED_CHIPS)("renders approved chip: %s", (chip) => {
    render(<ScreenerAiPanel isOpen={true} />);
    expect(screen.getByText(chip)).toBeInTheDocument();
  });

  it("does NOT render the rejected chip 'Earnings this week + high IV'", () => {
    render(<ScreenerAiPanel isOpen={true} />);
    expect(
      screen.queryByText("Earnings this week + high IV")
    ).not.toBeInTheDocument();
  });

  it("renders exactly 5 chips", () => {
    render(<ScreenerAiPanel isOpen={true} />);
    // Chips are in the "Quick prompts" section — all are buttons
    // We identify them by the "Quick prompts" label container
    const section = screen.getByText("Quick prompts").closest("div")!;
    const buttons = section.querySelectorAll("button");
    expect(buttons).toHaveLength(5);
  });
});

// ── Ollama not-ready state ────────────────────────────────────

describe("Ollama not-ready states", () => {
  it("shows 'Ollama not ready' when state is not_installed", () => {
    mockIsReady = false;
    mockOllamaState = "not_installed";
    render(<ScreenerAiPanel isOpen={true} />);
    expect(screen.getByText("Ollama not ready")).toBeInTheDocument();
    expect(screen.getByText("Install Ollama to use AI filters")).toBeInTheDocument();
  });

  it("shows pull-model message when state is no_models", () => {
    mockIsReady = false;
    mockOllamaState = "no_models";
    render(<ScreenerAiPanel isOpen={true} />);
    expect(screen.getByText(/Pull a model/)).toBeInTheDocument();
  });

  it("hides the text input when Ollama is not ready", () => {
    mockIsReady = false;
    mockOllamaState = "not_installed";
    render(<ScreenerAiPanel isOpen={true} />);
    expect(
      screen.queryByPlaceholderText(/Describe what you're looking for/)
    ).not.toBeInTheDocument();
  });
});

// ── Ready state UI ────────────────────────────────────────────

describe("Ready state", () => {
  it("renders the text input when Ollama is ready", () => {
    render(<ScreenerAiPanel isOpen={true} />);
    expect(
      screen.getByPlaceholderText(/Describe what you're looking for/i)
    ).toBeInTheDocument();
  });

  it("shows the selected model name in the header", () => {
    render(<ScreenerAiPanel isOpen={true} />);
    // The model name is truncated (split on ":") — should show "llama3.2"
    expect(screen.getByText("llama3.2")).toBeInTheDocument();
  });

  it("shows empty-state guidance before any query is submitted", () => {
    render(<ScreenerAiPanel isOpen={true} />);
    expect(
      screen.getByText("Ask me what you're looking for")
    ).toBeInTheDocument();
  });
});
