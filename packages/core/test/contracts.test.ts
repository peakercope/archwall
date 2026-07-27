import type { Rule } from "@archwall/core";
import {
  configureRule,
  defineClassifier,
  defineGraphComputation,
  definePreset,
  defineReporter,
  defineRule,
} from "@archwall/core";
import { describe, expect, it } from "vitest";

const dummy: Rule<{ max: number }> = {
  meta: { name: "dummy", description: "d", defaultSeverity: "error" },
  check() {},
};

describe("extension contracts", () => {
  it("defineRule returns a rule that is also callable", () => {
    // One export per rule instead of two. `xRule` + `x` was an identical 5-line trailer
    // on every rule and a second name users had to learn the reason for.
    const callable = defineRule(dummy);
    expect(callable.meta).toBe(dummy.meta);
    expect(callable.check).toBe(dummy.check);
    const configured = callable({ max: 3 }, { severity: "warn" });
    expect(configured.rule).toBe(callable);
    expect(configured.options).toEqual({ max: 3 });
    expect(configured.severity).toBe("warn");
  });
  it("configureRule keeps settings out of the options bag", () => {
    // Merging them meant `id` and `severity` were reserved names no rule could ever use
    // as an option — a hidden constraint on every rule that will ever be written.
    const c = configureRule(dummy, { max: 3 }, { severity: "warn", id: "custom" });
    expect(c.rule).toBe(dummy);
    expect(c.options).toEqual({ max: 3 });
    expect(c.severity).toBe("warn");
    expect(c.id).toBe("custom");
  });
  it("configureRule with no opts leaves severity undefined", () => {
    const c = configureRule(dummy);
    expect(c.severity).toBeUndefined();
    expect(c.options).toEqual({});
  });
  it("other helpers are identity", () => {
    const cl = { name: "c", classify: () => null };
    const rep = { name: "r", onRunEnd: () => {} };
    const an = { name: "a", compute: () => 1 };
    expect(defineClassifier(cl)).toBe(cl);
    expect(defineReporter(rep)).toBe(rep);
    expect(defineGraphComputation(an)).toBe(an);
    const presetFn = definePreset(() => ({
      name: "p",
      classifiers: [],
      rules: [],
    }));
    expect(presetFn().name).toBe("p");
  });
});
