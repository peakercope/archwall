import { defineClassifier, defineConfig, definePreset, defineReporter, defineRule } from "archwall";
import { describe, expect, it } from "vitest";

describe("umbrella exports", () => {
  it("re-exports the define helpers from core", () => {
    for (const fn of [defineConfig, defineRule, definePreset, defineClassifier, defineReporter]) {
      expect(typeof fn).toBe("function");
    }
    expect(defineConfig({ failOn: "never" })).toEqual({ failOn: "never" });
  });
});
