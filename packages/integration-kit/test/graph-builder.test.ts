import { ArchWallError, IR_VERSION } from "@archwall/core";
import { GraphBuilder } from "@archwall/integration-kit";
import { describe, expect, it } from "vitest";

const host = { name: "test", version: "1", capabilities: new Set<never>() };

describe("GraphBuilder", () => {
  it("builds a graph with defaults and IR version", () => {
    const g = new GraphBuilder({ host })
      .addModule({ id: "/a.ts" })
      .addModule({ id: "/b.ts" })
      .addEdge({ from: "/a.ts", to: "/b.ts" })
      .build();
    expect(g.irVersion).toBe(IR_VERSION);
    expect(g.delivery).toBe("complete");
    expect(g.modules.get("/a.ts")).toMatchObject({
      file: "/a.ts",
      kind: "source",
    });
    expect(g.edges[0]).toMatchObject({
      rawSpecifier: "/b.ts",
      resolvedPath: "/b.ts",
      kind: "static",
    });
  });
  it("merges repeated addModule calls", () => {
    const g = new GraphBuilder({ host })
      .addModule({ id: "x" })
      .addModule({ id: "x", packageName: "pkg" })
      .build();
    expect(g.modules.size).toBe(1);
    expect(g.modules.get("x")!.packageName).toBe("pkg");
  });
  it("auto-registers an unknown bare edge target as a package, not as unresolved", () => {
    const g = new GraphBuilder({ host })
      .addModule({ id: "a" })
      .addEdge({ from: "a", to: "react" })
      .build();
    expect(g.modules.get("react")).toMatchObject({
      kind: "package",
      packageName: "react",
      file: null,
    });
  });
  it("throws on unknown edge source", () => {
    expect(() => new GraphBuilder({ host }).addEdge({ from: "ghost", to: "a" }).build()).toThrow(
      ArchWallError,
    );
  });
  it("dedupes identical edges", () => {
    const g = new GraphBuilder({ host })
      .addModule({ id: "a" })
      .addModule({ id: "b" })
      .addEdge({ from: "a", to: "b" })
      .addEdge({ from: "a", to: "b" })
      .build();
    expect(g.edges).toHaveLength(1);
  });
});
