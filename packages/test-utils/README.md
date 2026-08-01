# @archwall/test-utils

Fixture graph builders and violation assertions for testing ArchWall rules, presets, and
classifiers.

Part of [ArchWall](../../README.md).

## Why this is published

A rule is a pure function from a graph to violations, which makes it unusually easy to test —
but only if you can *build a graph by hand*. `ProjectGraph` is deliberately opaque and
`GraphQuery` is not public, so without this package the only way to test a rule would be to run
a real bundler over a real fixture directory for every case.

`runRule` runs your rule through the **real engine**, not a mock of it. Scoping, option
validation, message rendering, and fingerprinting all behave exactly as they do in a build, so
a test that passes here is evidence about production and not about a test harness.

```sh
npm install --save-dev @archwall/test-utils
```

## Testing a rule

```ts
import { buildFixtureGraph, expectViolations, runRule } from "@archwall/test-utils";
import { describe, it } from "vitest";
import { noUpwardImports } from "../src/no-upward-imports.js";

describe("no-upward-imports", () => {
  it("reports an import into a higher layer", async () => {
    const graph = buildFixtureGraph({
      modules: [
        { id: "/repo/src/ui/page.ts", tags: { layer: "ui" } },
        { id: "/repo/src/domain/rules.ts", tags: { layer: "domain" } },
      ],
      edges: [["/repo/src/domain/rules.ts", "/repo/src/ui/page.ts"]],
    });

    const violations = await runRule(noUpwardImports, graph, { layers: ["ui", "domain"] });

    expectViolations(violations, [
      { rule: "no-upward-imports", from: "/repo/src/domain/rules.ts", to: "/repo/src/ui/page.ts" },
    ]);
  });
});
```

`expectViolations` is order-insensitive and **exact**: every expectation must claim a distinct
violation and the counts must agree, so a rule that starts over-reporting fails the test rather
than passing it by coincidence.

## `buildFixtureGraph`

Shorthand throughout — a bare string is a `source` module, a `[from, to]` tuple is a static
edge — so the noise stays proportional to what the test is actually about.

```ts
buildFixtureGraph({
  modules: [
    "/repo/src/a.ts",                                            // source, no tags
    { id: "/repo/src/b.ts", tags: { layer: "domain" } },
    { id: "pkg:react", kind: "package", packageName: "react" },
    { id: "builtin:node:fs", kind: "builtin" },
  ],
  edges: [
    ["/repo/src/a.ts", "/repo/src/b.ts"],                        // static
    { from: "/repo/src/a.ts", to: "pkg:react", kind: "dynamic" },
    { from: "/repo/src/a.ts", to: "/repo/src/b.ts", attributes: { typeOnly: true } },
  ],
  // Every capability by default. Narrow it to test that a rule SKIPS when a host
  // cannot supply what it declares in `requiredCapabilities`.
  capabilities: ["complete-graph"],
  delivery: "complete",
});
```

Ids here are yours to choose. Real producers emit canonical ids (`file:src/a.ts`, `pkg:react`);
fixtures may use bare paths, and every path-matching helper degrades to treating them as
relative to the root — which is what keeps a test readable without a repo on disk.

## `runRule` options

```ts
await runRule(rule, graph, options, {
  repoRoot: "/repo",     // base for reported paths and fingerprints
  sourceRoot: "/repo/src", // base for path patterns and classifiers
  severity: "warn",      // override the rule's defaultSeverity
});
```

Both roots default to the platform filesystem root, so path-aware rules work without them
being set — supply them when a test is specifically about path matching.
