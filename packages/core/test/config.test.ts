import * as path from "node:path";
import { configureRule, defineRule, resolveConfig } from "@archwall/core";
import { describe, expect, it } from "vitest";

const ruleA = defineRule<{ x?: number; y?: number }>({
  meta: { name: "a", description: "", defaultSeverity: "error" },
  check() {},
});
const ruleB = defineRule({
  meta: { name: "b", description: "", defaultSeverity: "warn" },
  check() {},
});
const preset = {
  name: "p",
  classifiers: [{ name: "c1", classify: () => null }],
  rules: [configureRule(ruleA, { x: 1, y: 2 }), configureRule(ruleB)],
};

describe("resolveConfig", () => {
  it("applies defaults and absolutizes both roots", () => {
    const r = resolveConfig({}, { cwd: "/proj" });
    expect(r.repoRoot).toBe(path.resolve("/proj", "."));
    expect(r.sourceRoot).toBe(path.resolve("/proj", "."));
    expect(r.failOn).toBe("error");
    expect(r.reporterSpecs).toEqual(["console"]);
    // Everything under root: the graph boundary must not re-filter by extension, or it
    // silently drops every .vue/.svelte/.astro module the host legitimately compiled.
    expect(r.include).toEqual(["**"]);
  });
  it("ADDS `exclude` to the defaults rather than replacing them", () => {
    // The classic trap: excluding one more pattern silently re-admitted node_modules and
    // every test file, and the new violations looked like an architecture change.
    const r = resolveConfig({ exclude: ["**/*.stories.*"] }, { cwd: "/proj" });
    expect(r.exclude).toContain("**/*.stories.*");
    expect(r.exclude).toContain("**/*.test.*");
    expect(r.exclude).toContain("**/node_modules/**");
  });

  it("lets the defaults be dropped, but only by saying so", () => {
    const r = resolveConfig({ exclude: ["only-this"], excludeDefaults: false }, { cwd: "/proj" });
    expect(r.exclude).toEqual(["only-this"]);
  });

  it("merges same-named rules: last writer wins, options shallow-merge", () => {
    const r = resolveConfig({
      presets: [preset],
      rules: [configureRule(ruleA, { y: 9 }, { severity: "warn" })],
    });
    const a = r.rules.find((x) => x.rule.meta.name === "a")!;
    expect(a.options).toEqual({ x: 1, y: 9 });
    expect(a.severity).toBe("warn");
  });
  it("uses meta.defaultSeverity when unset", () => {
    const r = resolveConfig({ presets: [preset] });
    expect(r.rules.find((x) => x.rule.meta.name === "b")!.severity).toBe("warn");
  });
  it("overrides always win, off drops the rule", () => {
    const r = resolveConfig({
      presets: [preset],
      overrides: { a: "off", b: "error" },
    });
    expect(r.rules.find((x) => x.rule.meta.name === "a")).toBeUndefined();
    expect(r.rules.find((x) => x.rule.meta.name === "b")!.severity).toBe("error");
  });
  it("concats preset then user classifiers", () => {
    const r = resolveConfig({
      presets: [preset],
      classifiers: [{ name: "c2", classify: () => null }],
    });
    expect(r.classifiers.map((c) => c.name)).toEqual(["c1", "c2"]);
  });
});

describe("rule instance ids", () => {
  const other = {
    name: "q",
    classifiers: [],
    rules: [configureRule(ruleA, { x: 100 })],
  };

  it("namespaces preset rules by preset name", () => {
    const r = resolveConfig({ presets: [preset] });
    expect(r.rules.map((x) => x.id).sort()).toEqual(["p/a", "p/b"]);
  });

  it("keeps two presets configuring the same rule independent", () => {
    const r = resolveConfig({ presets: [preset, other] });
    expect(r.rules.find((x) => x.id === "p/a")!.options).toEqual({
      x: 1,
      y: 2,
    });
    expect(r.rules.find((x) => x.id === "q/a")!.options).toEqual({ x: 100 });
  });

  it("rejects two presets with the same name instead of silently merging them", () => {
    // `presets: [fsd(), fsd({ src: "packages/b" })]` is the natural way to describe a
    // monorepo, and it used to produce identical ids whose options shallow-merged —
    // precisely the collision the namespacing was designed to prevent.
    const twin = {
      name: "p",
      classifiers: [],
      rules: [configureRule(ruleA, { x: 42 })],
    };
    // Reported, not thrown: a name collision costs you the collision, not the whole run.
    // The later preset is namespaced apart so the outcome is stated rather than merged.
    const r = resolveConfig({ presets: [preset, twin] });
    expect(r.diagnostics.map((d) => d.code)).toContain("invalid-config");
    expect(r.diagnostics[0]!.message).toMatch(/both named "p"/);
    expect(r.rules.map((x) => x.id).sort()).toEqual(["p#2/a", "p/a", "p/b"]);
  });

  it("replaces array options wholesale rather than concatenating them", () => {
    // One documented policy: top-level keys replace, arrays are values. Concatenating
    // would make it impossible for an override to REMOVE an entry.
    const listRule = defineRule<{ layers: string[] }>({
      meta: { name: "list", description: "", defaultSeverity: "error" },
      check() {},
    });
    const base = {
      name: "base",
      classifiers: [],
      rules: [configureRule(listRule, { layers: ["a", "b", "c"] })],
    };
    const r = resolveConfig({
      presets: [base],
      overrides: { "base/list": { options: { layers: ["only"] } } },
    });
    expect(r.rules.find((x) => x.id === "base/list")!.options).toEqual({
      layers: ["only"],
    });
  });

  it("gives a bare user rule its own id when no preset configures it", () => {
    const r = resolveConfig({ rules: [configureRule(ruleA, { x: 3 })] });
    expect(r.rules.map((x) => x.id)).toEqual(["a"]);
  });

  it("rejects a bare user rule when two presets make it ambiguous", () => {
    const r = resolveConfig({
      presets: [preset, other],
      rules: [configureRule(ruleA, { x: 5 })],
    });
    // The ambiguous entry is dropped and said so; every unambiguous rule still runs.
    expect(r.diagnostics.map((d) => d.message).join()).toMatch(
      /configured by more than one preset/,
    );
    expect(r.rules.map((x) => x.id)).toContain("p/a");
  });

  it("honours an explicit id, allowing two instances of one rule", () => {
    const r = resolveConfig({
      rules: [
        configureRule(ruleA, { x: 1 }, { id: "first" }),
        configureRule(ruleA, { x: 2 }, { id: "second" }),
      ],
    });
    expect(r.rules.map((x) => x.id)).toEqual(["first", "second"]);
  });
});

describe("overrides", () => {
  const two = {
    name: "q",
    classifiers: [],
    rules: [configureRule(ruleA), configureRule(ruleB)],
  };

  it("targets one instance by exact id", () => {
    const r = resolveConfig({
      presets: [preset, two],
      overrides: { "p/a": "off" },
    });
    expect(r.rules.find((x) => x.id === "p/a")).toBeUndefined();
    expect(r.rules.find((x) => x.id === "q/a")).toBeDefined();
  });

  it("targets every instance by bare rule name", () => {
    const r = resolveConfig({
      presets: [preset, two],
      overrides: { a: "off" },
    });
    expect(r.rules.filter((x) => x.rule.meta.name === "a")).toHaveLength(0);
  });

  it("targets a preset by glob", () => {
    const r = resolveConfig({
      presets: [preset, two],
      overrides: { "p/*": "warn" },
    });
    expect(r.rules.filter((x) => x.id.startsWith("p/")).every((x) => x.severity === "warn")).toBe(
      true,
    );
    expect(r.rules.find((x) => x.id === "q/b")!.severity).toBe("warn"); // its own default
    expect(r.rules.find((x) => x.id === "q/a")!.severity).toBe("error");
  });

  it("replaces options without touching severity", () => {
    const r = resolveConfig({
      presets: [preset],
      overrides: { "p/a": { options: { y: 42 } } },
    });
    const a = r.rules.find((x) => x.id === "p/a")!;
    expect(a.options).toEqual({ x: 1, y: 42 });
    expect(a.severity).toBe("error");
  });

  it("reports a key that matches no rule, listing what exists", () => {
    // A typo'd override key is a real mistake and must not pass silently — but it is also
    // not a reason to destroy the other thirty-nine rules' results, which is what throwing
    // from inside a bundler's buildEnd did.
    const r = resolveConfig({ presets: [preset], overrides: { "p/no-cycels": "off" } });
    const problem = r.diagnostics.find((d) => d.code === "invalid-config");
    expect(problem?.message).toMatch(/matches no configured rule.*p\/a, p\/b/s);
    expect(r.rules.map((x) => x.id).sort()).toEqual(["p/a", "p/b"]);
  });
});
