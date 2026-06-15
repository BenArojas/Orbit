import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AiProviderBadge from "../AiProviderBadge";

describe("AiProviderBadge", () => {
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
});
