import { GraphBuilder } from "@archwall/integration-kit";
import { describe, expect, it } from "vitest";

const builder = () =>
  new GraphBuilder({
    host: { name: "test", version: "0", capabilities: new Set(["type-only-edges"]) },
    repoRoot: "/repo",
  });

const only = <T>(items: readonly T[]): T => {
  expect(items).toHaveLength(1);
  return items[0] as T;
};

describe("GraphBuilder edge attribute merging", () => {
  it("carries attributes through canonicalisation", () => {
    const b = builder();
    b.addModule({ id: "/repo/a.ts", file: "/repo/a.ts", kind: "source" });
    b.addModule({ id: "/repo/b.ts", file: "/repo/b.ts", kind: "source" });
    b.addEdge({ from: "/repo/a.ts", to: "/repo/b.ts", attributes: { typeOnly: true } });
    expect(only(b.build().edges()).attributes).toEqual({ typeOnly: true });
  });

  /**
   * The case the merge exists for:
   *
   * ```ts
   * import type { A } from "./b";
   * import { c } from "./b";
   * ```
   *
   * One dependency, and it is NOT type-only — erasing the type import leaves the value import.
   * Union semantics here would mark it erasable and let a "type-only may cross this boundary"
   * rule wave through a genuine violation.
   */
  it("drops typeOnly when the same dependency is also imported for a value", () => {
    const b = builder();
    b.addModule({ id: "/repo/a.ts", file: "/repo/a.ts", kind: "source" });
    b.addModule({ id: "/repo/b.ts", file: "/repo/b.ts", kind: "source" });
    b.addEdge({
      from: "/repo/a.ts",
      to: "/repo/b.ts",
      rawSpecifier: "./b",
      attributes: { typeOnly: true },
    });
    b.addEdge({ from: "/repo/a.ts", to: "/repo/b.ts", rawSpecifier: "./b" });
    expect(only(b.build().edges()).attributes).toBeUndefined();
  });

  it("is order-independent — the value import may come first", () => {
    const b = builder();
    b.addModule({ id: "/repo/a.ts", file: "/repo/a.ts", kind: "source" });
    b.addModule({ id: "/repo/b.ts", file: "/repo/b.ts", kind: "source" });
    b.addEdge({ from: "/repo/a.ts", to: "/repo/b.ts", rawSpecifier: "./b" });
    b.addEdge({
      from: "/repo/a.ts",
      to: "/repo/b.ts",
      rawSpecifier: "./b",
      attributes: { typeOnly: true },
    });
    expect(only(b.build().edges()).attributes).toBeUndefined();
  });

  it("keeps typeOnly when every contributing import agrees", () => {
    const b = builder();
    b.addModule({ id: "/repo/a.ts", file: "/repo/a.ts", kind: "source" });
    b.addModule({ id: "/repo/b.ts", file: "/repo/b.ts", kind: "source" });
    for (let i = 0; i < 2; i++) {
      b.addEdge({
        from: "/repo/a.ts",
        to: "/repo/b.ts",
        rawSpecifier: "./b",
        attributes: { typeOnly: true },
      });
    }
    expect(only(b.build().edges()).attributes).toEqual({ typeOnly: true });
  });

  /**
   * Every file of a dependency collapses onto one `pkg:` node, so edges that were distinct
   * before canonicalisation meet after it. The same merge must apply on that path too.
   */
  it("merges across ids that collapse onto one package node", () => {
    const b = builder();
    b.addModule({ id: "/repo/a.ts", file: "/repo/a.ts", kind: "source" });
    b.addModule({
      id: "/repo/node_modules/react/index.js",
      file: "/repo/node_modules/react/index.js",
      kind: "package",
      packageName: "react",
    });
    b.addModule({
      id: "/repo/node_modules/react/jsx-runtime.js",
      file: "/repo/node_modules/react/jsx-runtime.js",
      kind: "package",
      packageName: "react",
    });
    b.addEdge({
      from: "/repo/a.ts",
      to: "/repo/node_modules/react/index.js",
      rawSpecifier: "react",
      attributes: { typeOnly: true },
    });
    b.addEdge({
      from: "/repo/a.ts",
      to: "/repo/node_modules/react/jsx-runtime.js",
      rawSpecifier: "react",
    });
    const edge = only(b.build().edges());
    expect(edge.to).toBe("pkg:react");
    expect(edge.attributes).toBeUndefined();
  });

  it("keeps a value edge free of an attributes key entirely", () => {
    const b = builder();
    b.addModule({ id: "/repo/a.ts", file: "/repo/a.ts", kind: "source" });
    b.addModule({ id: "/repo/b.ts", file: "/repo/b.ts", kind: "source" });
    b.addEdge({ from: "/repo/a.ts", to: "/repo/b.ts" });
    expect("attributes" in only(b.build().edges())).toBe(false);
  });
});
