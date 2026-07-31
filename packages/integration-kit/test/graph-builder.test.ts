import { ArchWallError, IR_VERSION } from "@archwall/core";
import { GraphBuilder } from "@archwall/integration-kit";
import { describe, expect, it } from "vitest";

const host = { name: "test", version: "1", capabilities: new Set<never>() };
const builder = (repoRoot = "/") => new GraphBuilder({ host, repoRoot });

describe("GraphBuilder", () => {
  it("builds a graph with defaults and IR version", () => {
    const g = builder()
      .addModule({ id: "/a.ts" })
      .addModule({ id: "/b.ts" })
      .addEdge({ from: "/a.ts", to: "/b.ts" })
      .build();
    expect(g.irVersion).toBe(IR_VERSION);
    expect(g.delivery).toBe("complete");
    expect(g.module("file:a.ts")).toMatchObject({
      file: "/a.ts",
      kind: "source",
    });
    expect(g.edges()[0]).toMatchObject({
      from: "file:a.ts",
      to: "file:b.ts",
      rawSpecifier: "file:b.ts",
      kind: "static",
    });
  });

  it("merges repeated addModule calls", () => {
    const g = builder()
      .addModule({ id: "x", kind: "package" })
      .addModule({ id: "x", kind: "package", packageName: "pkg" })
      .build();
    expect(g.moduleCount).toBe(1);
    expect(g.module("pkg:pkg")?.packageName).toBe("pkg");
  });

  it("auto-registers an unknown bare edge target as a package, not as unresolved", () => {
    const g = builder().addModule({ id: "/a.ts" }).addEdge({ from: "/a.ts", to: "react" }).build();
    expect(g.module("pkg:react")).toMatchObject({
      kind: "package",
      packageName: "react",
      file: null,
    });
  });

  it("throws on unknown edge source", () => {
    expect(() => builder().addEdge({ from: "ghost", to: "a" }).build()).toThrow(ArchWallError);
  });

  it("dedupes identical edges", () => {
    const g = builder()
      .addModule({ id: "/a.ts" })
      .addModule({ id: "/b.ts" })
      .addEdge({ from: "/a.ts", to: "/b.ts" })
      .addEdge({ from: "/a.ts", to: "/b.ts" })
      .build();
    expect(g.edges()).toHaveLength(1);
  });
});

/**
 * Identity is the IR's, not the host's — the property that makes a violation fingerprint the same under every bundler.
 */
describe("canonical module ids", () => {
  it("identifies first-party files by their repo-relative path", () => {
    const g = builder("/repo").addModule({ id: "/repo/src/a.ts" }).build();
    expect([...g.moduleIds()]).toEqual(["file:src/a.ts"]);
  });

  it("keeps a file outside the repo root absolute rather than emitting a ../ chain", () => {
    const g = builder("/repo").addModule({ id: "/elsewhere/a.ts" }).build();
    expect([...g.moduleIds()]).toEqual(["file:/elsewhere/a.ts"]);
  });

  it("collapses every file of a dependency onto one node", () => {
    // The whole reason `pkg:` carries no subpath: an esbuild external is never resolved, so
    // its subpath is unknowable, and a scheme that kept file granularity would diverge by host.
    const g = builder("/repo")
      .addModule({ id: "/repo/src/a.ts" })
      .addModule({
        id: "/repo/node_modules/react/index.js",
        file: "/repo/node_modules/react/index.js",
        kind: "package",
        packageName: "react",
      })
      .addModule({
        id: "/repo/node_modules/react/jsx-runtime.js",
        file: "/repo/node_modules/react/jsx-runtime.js",
        kind: "package",
        packageName: "react",
      })
      .addEdge({
        from: "/repo/src/a.ts",
        to: "/repo/node_modules/react/index.js",
        rawSpecifier: "react",
      })
      .addEdge({
        from: "/repo/src/a.ts",
        to: "/repo/node_modules/react/jsx-runtime.js",
        rawSpecifier: "react/jsx-runtime",
      })
      .build();
    expect([...g.moduleIds()].sort()).toEqual(["file:src/a.ts", "pkg:react"]);
    // Two distinct imports stay two edges: edge identity includes the raw specifier.
    expect(
      g
        .edges()
        .map((e) => e.rawSpecifier)
        .sort(),
    ).toEqual(["react", "react/jsx-runtime"]);
  });

  it("gives a bare external and a resolved one the same id", () => {
    const resolved = builder("/repo")
      .addModule({ id: "/repo/src/a.ts" })
      .addModule({
        id: "/repo/node_modules/react/index.js",
        file: "/repo/node_modules/react/index.js",
        kind: "package",
        packageName: "react",
      })
      .addEdge({ from: "/repo/src/a.ts", to: "/repo/node_modules/react/index.js" })
      .build();
    const bare = builder("/repo")
      .addModule({ id: "/repo/src/a.ts" })
      .addModule({ id: "react", file: null, kind: "package", packageName: "react" })
      .addEdge({ from: "/repo/src/a.ts", to: "react" })
      .build();
    expect([...resolved.moduleIds()].sort()).toEqual([...bare.moduleIds()].sort());
  });

  it("normalizes a bare builtin onto its prefixed spelling", () => {
    const g = builder("/repo")
      .addModule({ id: "/repo/src/a.ts" })
      .addModule({ id: "fs", file: null, kind: "builtin", specifier: "fs" })
      .addModule({ id: "node:path", file: null, kind: "builtin", specifier: "node:path" })
      .addEdge({ from: "/repo/src/a.ts", to: "fs" })
      .addEdge({ from: "/repo/src/a.ts", to: "node:path" })
      .build();
    expect([...g.moduleIds()].sort()).toEqual([
      "builtin:node:fs",
      "builtin:node:path",
      "file:src/a.ts",
    ]);
  });

  it("names the host in a virtual id and strips the host's own marker", () => {
    const g = builder("/repo")
      .addModule({ id: "\0virtual:preload-helper", file: null, kind: "virtual" })
      .build();
    expect([...g.moduleIds()]).toEqual(["virtual:test:virtual:preload-helper"]);
  });

  it("drops the self-edges collapsing a dependency creates, but keeps a genuine self-import", () => {
    const g = builder("/repo")
      .addModule({ id: "/repo/src/a.ts" })
      .addModule({
        id: "/repo/node_modules/react/index.js",
        file: "/repo/node_modules/react/index.js",
        kind: "package",
        packageName: "react",
      })
      .addModule({
        id: "/repo/node_modules/react/cjs/react.js",
        file: "/repo/node_modules/react/cjs/react.js",
        kind: "package",
        packageName: "react",
      })
      // A dependency's own internal import: an artifact of the collapse, not the user's code.
      .addEdge({
        from: "/repo/node_modules/react/index.js",
        to: "/repo/node_modules/react/cjs/react.js",
        rawSpecifier: "./cjs/react.js",
      })
      // A real self-import, which is a real finding.
      .addEdge({ from: "/repo/src/a.ts", to: "/repo/src/a.ts", rawSpecifier: "./a" })
      .build();
    expect(g.edges().map((e) => `${e.from} -> ${e.to}`)).toEqual([
      "file:src/a.ts -> file:src/a.ts",
    ]);
  });
});
