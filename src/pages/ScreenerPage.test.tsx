/**
 * ScreenerPage helper tests — pure functions extracted from the page so
 * they're testable without mounting the React tree.
 *
 * Currently covers:
 *   - resolveUsOnlyLock: handles the "S&P 500 gainers" type cards that
 *     must always run against US Listed/NASDAQ regardless of the user's
 *     selected location, plus the banner string we surface to explain it.
 */

import { describe, it, expect } from "vitest";
import { resolveUsOnlyLock } from "./ScreenerPage";

describe("resolveUsOnlyLock", () => {
  it("returns currentLocation unchanged when card isn't US-only", () => {
    const card = { title: "Liquid breakouts" };
    const out = resolveUsOnlyLock(card, "STK.HK.TSE_JPN");
    expect(out.effectiveLocation).toBe("STK.HK.TSE_JPN");
    expect(out.banner).toBeNull();
  });

  it("returns currentLocation unchanged when usOnly card is already on US", () => {
    const card = { title: "S&P 500 gainers", usOnly: true };
    const out = resolveUsOnlyLock(card, "STK.US.MAJOR");
    expect(out.effectiveLocation).toBe("STK.US.MAJOR");
    // No banner — nothing changed for the user
    expect(out.banner).toBeNull();
  });

  it("forces US + banner when usOnly card is clicked from a non-US location", () => {
    const card = { title: "S&P 500 gainers", usOnly: true };
    const out = resolveUsOnlyLock(card, "STK.HK.TSE_JPN");
    expect(out.effectiveLocation).toBe("STK.US.MAJOR");
    expect(out.banner).toBe(
      "Location set to US — Listed/NASDAQ. S&P 500 gainers is US-only.",
    );
  });

  it("uses the card's title in the banner copy", () => {
    const card = { title: "Some Other US-only Card", usOnly: true };
    const out = resolveUsOnlyLock(card, "STK.EU.LSE");
    expect(out.banner).toContain("Some Other US-only Card");
    expect(out.banner).toContain("US-only");
  });

  it("triggers from any non-US location, not just one", () => {
    const card = { title: "S&P 500 gainers", usOnly: true };
    for (const loc of [
      "STK.HK.TSE_JPN",
      "STK.EU.LSE",
      "STK.NA.CANADA",
      "STK.US.MINOR", // OTC counts as non-NASDAQ for this lock
    ]) {
      const out = resolveUsOnlyLock(card, loc);
      expect(out.effectiveLocation).toBe("STK.US.MAJOR");
      expect(out.banner).not.toBeNull();
    }
  });
});
