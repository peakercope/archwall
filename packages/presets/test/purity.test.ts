import type { ModuleKind, Violation } from "@archwall/core";
import { analyze, resolveConfig } from "@archwall/core";
import { layered } from "@archwall/presets";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const ROOT = "/proj";

/** A domain module importing one dependency of the given kind. */
async function domainImporting(
  target: {
    id: string;
    kind: ModuleKind;
    packageName?: string;
    workspace?: string;
  },
  opts: { allowBuiltins?: boolean; allowExternals?: string[] } = {},
): Promise<readonly Violation[]> {
  const graph = buildFixtureGraph({
    modules: [
      { id: `${ROOT}/domain/rules.ts`, file: `${ROOT}/domain/rules.ts` },
      { id: target.id, file: null, ...target },
    ],
    edges: [
      {
        from: `${ROOT}/domain/rules.ts`,
        to: target.id,
        rawSpecifier: target.id,
      },
    ],
  });
  const config = resolveConfig(
    {
      presets: [
        layered({
          layers: ["application", "domain"],
          pure: ["domain"],
          ...opts,
        }),
      ],
      reporters: [],
    },
    { cwd: ROOT },
  );
  return (await analyze(graph, config)).violations;
}

const purity = (vs: readonly Violation[]) => vs.filter((v) => v.ruleId === "layered/purity-domain");

describe("layered({ pure }) — what counts as impure", () => {
  it("flags an npm dependency", async () => {
    const vs = await domainImporting({
      id: "react",
      kind: "package",
      packageName: "react",
    });
    expect(purity(vs)).toHaveLength(1);
  });

  it("flags a runtime builtin by default", async () => {
    // Clean/Onion push nondeterminism to the edges, so `node:crypto` in the domain is a
    // genuine violation — but it is now a *distinguishable* one, not 'a third-party package'.
    const vs = await domainImporting({ id: "node:crypto", kind: "builtin" });
    expect(purity(vs)).toHaveLength(1);
    expect(purity(vs)[0]!.message).not.toContain("third-party");
  });

  it("allows runtime builtins under allowBuiltins", async () => {
    const vs = await domainImporting(
      { id: "node:assert", kind: "builtin" },
      { allowBuiltins: true },
    );
    expect(purity(vs)).toHaveLength(0);
  });

  it("never flags a sibling workspace package", async () => {
    // The bug the ModuleKind split exists to fix: `external: boolean` could not tell
    // `@myorg/shared-kernel` from `lodash`, so monorepo-internal imports were reported
    // as third-party dependencies.
    const vs = await domainImporting({
      id: `${ROOT}/../shared-kernel/index.ts`,
      kind: "workspace",
      workspace: "@myorg/shared-kernel",
    });
    expect(purity(vs)).toHaveLength(0);
  });

  it("still honours allowExternals for npm dependencies", async () => {
    const vs = await domainImporting(
      { id: "zod", kind: "package", packageName: "zod" },
      { allowExternals: ["zod"] },
    );
    expect(purity(vs)).toHaveLength(0);
  });
});
