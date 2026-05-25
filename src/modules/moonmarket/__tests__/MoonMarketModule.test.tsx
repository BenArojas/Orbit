import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

import { MoonMarketModule } from "@/modules/moonmarket/MoonMarketModule";

describe("MoonMarketModule", () => {
  it("renders the placeholder and navigates back to Orbit", () => {
    render(<MoonMarketModule />);
    expect(screen.getByText(/moonmarket/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to orbit/i }));
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
