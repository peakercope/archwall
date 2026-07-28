import { analyze, configureRule, defineRule, resolveConfig } from "@archwall/core";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * Rules report a messageId and a data bag, not a finished sentence.
 *
 * That makes the wording a property of the rule's metadata — retargetable per instance,
 * translatable, and machine-groupable — instead of a template literal baked into the
 * report site. Two built-in rules had independently grown their own `message?` *option*
 * before this existed, which is the framework asking for a feature.
 */
const greet = defineRule<{ who?: string }>({
  meta: {
    name: "greet",
    description: "",
    defaultSeverity: "error",
    messages: { hello: 'hello {who}, from "{module}"' },
  },
  visits: {
    modules: {
      visit(m, ctx) {
        ctx.report({
          module: m.id,
          messageId: "hello",
          data: { who: ctx.options.who ?? "world", module: m.id },
        });
      },
    },
  },
});

const graph = () => buildFixtureGraph({ modules: ["/p/a.ts"] });

const run = async (
  rule: Parameters<typeof analyze>[1]["rules"][number] | ReturnType<typeof configureRule>,
) => analyze(graph(), resolveConfig({ rules: [rule as never] }, { cwd: "/p" }));

describe("message templates", () => {
  it("renders the rule's template with the reported data", async () => {
    const result = await run(configureRule(greet));
    expect(result.violations[0]!.message).toBe('hello world, from "/p/a.ts"');
  });

  it("carries messageId and data alongside the rendered text", async () => {
    const result = await run(configureRule(greet, { who: "team" }));
    expect(result.violations[0]).toMatchObject({
      messageId: "hello",
      data: { who: "team", module: "/p/a.ts" },
      message: 'hello team, from "/p/a.ts"',
    });
  });

  it("lets an instance retarget the wording without forking the rule", async () => {
    const result = await run(configureRule(greet, {}, { message: "custom: {who}" }));
    expect(result.violations[0]!.message).toBe("custom: world");
    // The id is unchanged, so machine consumers still group these together.
    expect(result.violations[0]!.messageId).toBe("hello");
  });

  it("retargets by id when several messages exist", async () => {
    const two = defineRule({
      meta: {
        name: "two",
        description: "",
        defaultSeverity: "error",
        messages: { a: "A {x}", b: "B {x}" },
      },
      visits: {
        modules: {
          visit(m, ctx) {
            ctx.report({ module: m.id, messageId: "a", data: { x: 1 } });
            ctx.report({ module: m.id, messageId: "b", data: { x: 2 } });
          },
        },
      },
    });
    const result = await analyze(
      graph(),
      resolveConfig(
        { rules: [configureRule(two, {}, { message: { b: "only B changed: {x}" } })] },
        { cwd: "/p" },
      ),
    );
    expect(result.violations.map((v) => v.message).sort()).toEqual(["A 1", "only B changed: 2"]);
  });

  it("also accepts `overrides.message`, like every other instance setting", async () => {
    const result = await analyze(
      graph(),
      resolveConfig(
        { rules: [configureRule(greet)], overrides: { greet: { message: "via override" } } },
        { cwd: "/p" },
      ),
    );
    expect(result.violations[0]!.message).toBe("via override");
  });

  it("leaves an unknown placeholder verbatim rather than blanking it", async () => {
    const typo = defineRule({
      meta: {
        name: "typo",
        description: "",
        defaultSeverity: "error",
        messages: { m: "value is {vlaue}" },
      },
      visits: {
        modules: {
          visit: (m, ctx) => ctx.report({ module: m.id, messageId: "m", data: { value: 1 } }),
        },
      },
    });
    const result = await run(configureRule(typo));
    // Visible in the output, rather than silently rendering "value is ".
    expect(result.violations[0]!.message).toBe("value is {vlaue}");
  });

  it("reports a missing template as a config problem instead of printing nothing useful", async () => {
    const missing = defineRule({
      meta: { name: "missing", description: "", defaultSeverity: "error" },
      visits: { modules: { visit: (m, ctx) => ctx.report({ module: m.id, messageId: "nope" }) } },
    });
    const result = await run(configureRule(missing));
    expect(result.diagnostics.map((d) => d.code)).toContain("invalid-config");
    expect(result.diagnostics.find((d) => d.code === "invalid-config")?.message).toMatch(
      /no template is defined/,
    );
  });

  it("still accepts a literal message, for rules with genuinely per-finding wording", async () => {
    const literal = defineRule({
      meta: { name: "literal", description: "", defaultSeverity: "error" },
      visits: {
        modules: { visit: (m, ctx) => ctx.report({ module: m.id, message: "as written" }) },
      },
    });
    const result = await run(configureRule(literal));
    expect(result.violations[0]!.message).toBe("as written");
  });
});

describe("rule deprecation", () => {
  it("warns when a deprecated rule is configured, and still runs it", async () => {
    const old = defineRule({
      meta: {
        name: "old",
        description: "",
        defaultSeverity: "error",
        messages: { m: "found" },
        deprecated: { since: "1.2.0", replacedBy: "new-rule", reason: "Renamed for clarity." },
      },
      visits: { modules: { visit: (m, ctx) => ctx.report({ module: m.id, messageId: "m" }) } },
    });
    const result = await run(configureRule(old));
    const d = result.diagnostics.find((x) => x.code === "rule-deprecated");
    expect(d?.message).toMatch(/deprecated since 1\.2\.0.*use "new-rule".*Renamed for clarity/);
    // Deprecated is not disabled: it warns and keeps working, which is the whole point.
    expect(result.violations).toHaveLength(1);
    expect(result.rules[0]!.deprecated).toBe(true);
  });

  it("does not fail the run by default, since a deprecation is not a broken rule", async () => {
    const config = resolveConfig({}, { cwd: "/p" });
    expect(config.failOnDiagnostics.deprecated).toBe(false);
  });
});
