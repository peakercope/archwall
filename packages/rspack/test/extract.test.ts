import { edgeKindOf, moduleIdOf } from "@archwall/rspack";
import { describe, expect, it } from "vitest";

describe("edgeKindOf", () => {
  // Rspack and webpack name the same concepts differently; both vocabularies must map,
  // which is why the mapping is substring-based rather than an enumeration.
  it.each([
    ["esm import", "static"],
    ["esm import specifier", "static"],
    ["esm export import", "reexport"],
    ["esm export import specifier", "reexport"],
    ["harmony side effect evaluation", "static"],
    ["harmony import specifier", "static"],
    ["harmony export imported specifier", "reexport"],
    ["import()", "dynamic"],
    ["cjs require", "static"],
  ])("maps %s to %s", (type, expected) => {
    expect(edgeKindOf(type)).toBe(expected);
  });

  it("falls back to static for an unknown or absent type", () => {
    expect(edgeKindOf(undefined)).toBe("static");
    expect(edgeKindOf("some future dependency")).toBe("static");
  });
});

describe("moduleIdOf", () => {
  const abs = "/app/src/main.ts";

  it("uses the resource, never the loader-prefixed identifier", () => {
    const id = moduleIdOf({
      identifier: () => `builtin:swc-loader??ruleSet[1].rules[0].use[0]!${abs}`,
      resource: abs,
    });
    expect(id).toBe(abs);
  });

  it("strips the query so build variants of one file are one node", () => {
    expect(moduleIdOf({ identifier: () => "x", resource: `${abs}?raw` })).toBe(abs);
  });

  it("falls back to nameForCondition, then to the identifier", () => {
    expect(moduleIdOf({ identifier: () => "x", nameForCondition: () => abs })).toBe(abs);
    expect(
      moduleIdOf({
        identifier: () => 'external "react"',
        nameForCondition: () => null,
      }),
    ).toBe('external "react"');
  });
});
