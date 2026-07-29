import { analyze, IR_VERSION, IrVersionMismatchError, resolveConfig } from "@archwall/core";
import { GraphBuilder } from "@archwall/integration-kit";
import { describe, expect, it } from "vitest";

const ROOT = "/proj";
const HOST = { name: "test", version: "0", capabilities: new Set<never>() };

function builder(irVersion?: string): GraphBuilder {
  return new GraphBuilder({
    host: HOST,
    repoRoot: ROOT,
    ...(irVersion !== undefined ? { irVersion } : {}),
  });
}

/**
 * `assertIrCompatible` exists to catch adapter/core SKEW — an adapter built against IR 1.x
 * loaded beside a core that speaks 2.x. It could not, because `GraphBuilder` never stamped a
 * version, so `ProjectGraph.create` defaulted it to the linked core's `IR_VERSION` and the
 * check compared that constant to itself. See docs/adr/0021-adapters-bake-their-ir-version.md.
 */
describe("GraphBuilder stamps an IR version", () => {
  it("stamps the version it was built against by default", () => {
    // In this repository the adapter and core are one working tree, so the build-time
    // constant and the linked one necessarily agree. What is being asserted is that a
    // version is stamped at all — before, the field was left to `ProjectGraph.create`.
    expect(builder().build().irVersion).toBe(IR_VERSION);
  });

  it("lets a third-party adapter supply its own", () => {
    expect(builder("2.0.0").build().irVersion).toBe("2.0.0");
  });

  it("makes the compatibility check reachable: a skewed major is rejected", async () => {
    const graph = builder("999.0.0")
      .addModule({ id: `${ROOT}/a.ts` })
      .build();
    await expect(analyze(graph, resolveConfig({}, { cwd: ROOT }))).rejects.toThrow(
      IrVersionMismatchError,
    );
  });

  it("accepts a skewed minor, because only the major is breaking", async () => {
    const [major] = IR_VERSION.split(".");
    const graph = builder(`${major}.999.0`)
      .addModule({ id: `${ROOT}/a.ts` })
      .build();
    await expect(analyze(graph, resolveConfig({}, { cwd: ROOT }))).resolves.toBeDefined();
  });
});
