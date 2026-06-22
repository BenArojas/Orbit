import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AiProviderBadge from "../AiProviderBadge";

describe("AiProviderBadge", () => {
  it("truncates long model ids while keeping the full native tooltip", () => {
    const model = "z-ai/glm-5.2-very-long-provider-variant";
    render(
      <AiProviderBadge
        providerName="openrouter"
        model={model}
        kind="cloud"
        fallbackUsed
        estimatedCost={0.02}
        actualCost={null}
      />,
    );

    const modelLabel = screen.getByTitle(model);
    expect(modelLabel).toHaveClass("min-w-0", "flex-1", "truncate");
    expect(screen.getByText("Estimated $0.02")).toHaveClass("shrink-0");
    expect(screen.getByText("Fallback")).toHaveClass("shrink-0");
  });

  it("renders local Ollama provider metadata", () => {
    render(
      <AiProviderBadge
        providerName="ollama"
        model="gemma4:26b"
        kind="local"
        fallbackUsed={false}
        estimatedCost={null}
        actualCost={null}
      />,
    );

    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getByText("Ollama")).toBeInTheDocument();
    expect(screen.getByText("gemma4:26b")).toBeInTheDocument();
  });

  it("renders fallback metadata when present", () => {
    render(
      <AiProviderBadge
        providerName="ollama"
        model="gemma4:26b"
        kind="local"
        fallbackUsed
        estimatedCost={null}
        actualCost={null}
      />,
    );

    expect(screen.getByText("Fallback")).toBeInTheDocument();
  });

  it("renders cloud provider cost metadata", () => {
    render(
      <AiProviderBadge
        providerName="openrouter"
        model="openrouter/auto"
        kind="cloud"
        fallbackUsed={false}
        estimatedCost={null}
        actualCost={0.0123}
      />,
    );

    expect(screen.getByText("Cloud")).toBeInTheDocument();
    expect(screen.getByText("OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("openrouter/auto")).toBeInTheDocument();
    expect(screen.getByText("Actual $0.01")).toBeInTheDocument();
  });

  it("renders estimated cloud cost before actual usage is available", () => {
    render(
      <AiProviderBadge
        providerName="openrouter"
        model="openrouter/auto"
        kind="cloud"
        fallbackUsed={false}
        estimatedCost={0.02}
        actualCost={null}
      />,
    );

    expect(screen.getByText("Estimated $0.02")).toBeInTheDocument();
  });
});
