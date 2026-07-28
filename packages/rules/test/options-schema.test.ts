import { configureRule, resolveConfig } from "@archwall/core";
import { forbiddenDependencies, layerDependencies, noCycles, requireTag } from "@archwall/rules";
import { describe, expect, it } from "vitest";

/**
 * `optionsSchema` shipped as dead metadata: the field existed and no rule populated it, so
 * the first thing a user got wrong produced a stack trace instead of a sentence.
 * `layerDependencies({})` from a plain-JS config crashed inside `layers.indexOf` and
 * surfaced as an opaque `rule-failed`.
 */
const diagnose = (rule: Parameters<typeof configureRule>[0], options: Record<string, unknown>) =>
  resolveConfig({ rules: [configureRule(rule, options)] }).diagnostics.map((d) => d.message);

describe("built-in rule options schemas", () => {
  it("names the missing option instead of crashing inside the rule", () => {
    const messages = diagnose(layerDependencies, {});
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/"layers" is required/);
  });

  it("names the wrong type, with the path to it", () => {
    expect(diagnose(layerDependencies, { layers: "domain" })[0]).toMatch(
      /"layers" must be an array/,
    );
    expect(diagnose(layerDependencies, { layers: [1, 2] })[0]).toMatch(
      /"layers\[0\]" must be a string/,
    );
    expect(diagnose(noCycles, { maxCycleLength: "8" })[0]).toMatch(
      /"maxCycleLength" must be a number/,
    );
  });

  it("catches a typo'd option rather than silently ignoring it", () => {
    // The most common configuration mistake there is, and the one whose silent failure
    // looks exactly like success: the rule runs with the default you believed you changed.
    const messages = diagnose(requireTag, { tag: "layer", withn: ["src/**"] });
    expect(messages[0]).toMatch(/"withn" is not a recognised option/);
    expect(messages[0]).toMatch(/tag, within/);
  });

  it("validates nested matcher shapes", () => {
    const messages = diagnose(forbiddenDependencies, {
      forbid: [{ from: { tag: { layer: "domain" } }, to: { packageName: 42 } }],
    });
    expect(messages[0]).toMatch(/forbid\[0\]\.to\.packageName/);
  });

  it("accepts valid options and leaves the rule configured", () => {
    const config = resolveConfig({
      rules: [
        configureRule(layerDependencies, {
          layers: ["ui", "domain"],
          tagKey: "layer",
        }),
      ],
    });
    expect(config.diagnostics).toHaveLength(0);
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0]!.options).toEqual({
      layers: ["ui", "domain"],
      tagKey: "layer",
    });
  });
});
