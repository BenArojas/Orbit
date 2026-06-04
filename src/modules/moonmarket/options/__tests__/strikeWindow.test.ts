import { describe, it, expect } from "vitest";
import { selectStrikesAroundPrice } from "../OptionsChainTable";

const S = [175, 180, 185, 190, 195, 200, 205];

describe("selectStrikesAroundPrice", () => {
  it("centers on spot in the middle", () => {
    expect([...selectStrikesAroundPrice(S, 192, 6)]).toEqual([180, 185, 190, 195, 200, 205]);
  });
  it("clamps when spot is above all strikes", () => {
    expect([...selectStrikesAroundPrice(S, 9999, 6)]).toEqual([180, 185, 190, 195, 200, 205]);
  });
  it("clamps when spot is below all strikes", () => {
    expect([...selectStrikesAroundPrice(S, 1, 6)]).toEqual([175, 180, 185, 190, 195, 200]);
  });
  it("tie-breaks to the upper strike when equidistant", () => {
    expect([...selectStrikesAroundPrice([10, 20], 15, 1)]).toEqual([20]);
  });
  it("returns first N when price is null (caller must gate this)", () => {
    expect([...selectStrikesAroundPrice(S, null, 3)]).toEqual([175, 180, 185]);
  });
  it("handles count > strikes length", () => {
    expect([...selectStrikesAroundPrice([1, 2], 1, 6)]).toEqual([1, 2]);
  });
});
