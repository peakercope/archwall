import * as path from "node:path";
import { barePackageName, createModuleKindResolver } from "@archwall/integration-kit";
import { describe, expect, it } from "vitest";

/**
 * The policy every graph producer shares. It used to be written three times — once per
 * adapter — and the copies disagreed about `workspace`, which is the whole reason this
 * lives in one place now. These assertions are the contract each adapter inherits.
 */
const MONOREPO = path.resolve(import.meta.dirname, "../fixtures/monorepo-app");
const APP_SRC = path.join(MONOREPO, "packages/app/src");
const resolver = createModuleKindResolver({ sourceRoot: APP_SRC });
const infer = (file: string | null, extra: Record<string, unknown> = {}) =>
  resolver.infer({ id: file ?? "x", file, ...extra });

describe("createModuleKindResolver", () => {
  it("calls a file in the analysed package's own tree `source`", () => {
    expect(infer(path.join(APP_SRC, "main.ts"))).toEqual({ kind: "source" });
  });

  it("calls a sibling package's file `workspace` and labels the owning package", () => {
    // The case the three separate implementations disagreed on: first-party code that
    // belongs to a *different* package is neither `source` nor a third-party `package`.
    expect(infer(path.join(MONOREPO, "packages/lib/src/index.ts"))).toEqual({
      kind: "workspace",
      workspace: "@fx/lib",
    });
  });

  it("calls anything under node_modules `package`, even though it is a real file", () => {
    expect(infer("/repo/node_modules/@scope/pkg/dist/x.js")).toEqual({
      kind: "package",
      packageName: "@scope/pkg",
    });
  });

  it("keeps a file outside sourceRoot but inside the same package as `source`", () => {
    // Being outside `sourceRoot` is a project-BOUNDARY question; the engine re-kinds it
    // `excluded`. Deciding it here would conflate two different decisions.
    expect(infer(path.join(MONOREPO, "packages/app/vite.config.ts"))).toEqual({
      kind: "source",
    });
  });

  it("calls a builtin a builtin even when the host claims it has a file", () => {
    // Bundlers hand back `file = id` for any id that is not `\0`-prefixed, so `node:path`
    // arrives looking like a file path. It is not under node_modules, so the owning-package
    // walk found an unrelated package.json above the working directory and labelled a Node
    // builtin a `workspace` sibling — under all three bundlers, while the CLI got it right.
    expect(infer("node:path", { id: "node:path" })).toEqual({
      kind: "builtin",
    });
    expect(infer("node:fs/promises", { id: "node:fs/promises" })).toEqual({
      kind: "builtin",
    });
  });

  it("does not treat a bare specifier as a file just because the host passed one", () => {
    expect(infer("react", { id: "react" })).toEqual({
      kind: "package",
      packageName: "react",
    });
  });

  it("distinguishes runtime builtins from dependencies when there is no file", () => {
    expect(infer(null, { id: "node:fs" })).toEqual({ kind: "builtin" });
    expect(
      infer(null, {
        id: 'external node-commonjs "node:fs"',
        specifier: "node:fs",
      }),
    ).toEqual({
      kind: "builtin",
    });
    expect(infer(null, { id: 'external "react"', specifier: "react" })).toEqual({
      kind: "package",
      packageName: "react",
    });
  });

  it("treats a \\0-prefixed id as virtual regardless of anything else", () => {
    expect(resolver.infer({ id: "\0virtual:mod", file: null })).toEqual({
      kind: "virtual",
    });
  });

  it("separates an unresolved bare specifier from an unresolved relative one", () => {
    // A bare specifier that did not resolve is still an intended dependency; a relative
    // one is a genuine dangling import, and the two deserve different rules.
    expect(infer(null, { id: "lodash", specifier: "lodash", unresolved: true })).toEqual({
      kind: "package",
      packageName: "lodash",
    });
    expect(infer(null, { id: "./gone", specifier: "./gone", unresolved: true })).toEqual({
      kind: "unresolved",
    });
  });

  it("honours the host's own externality verdict when it has one", () => {
    // Rollup knows; Rolldown dropped `isExternal`, so absence must not read as `false`.
    expect(
      infer("/somewhere/outside", {
        id: "/somewhere/outside",
        isExternal: true,
      }),
    ).toEqual({
      kind: "package",
    });
  });
});

describe("barePackageName", () => {
  it("handles scopes, subpaths, and the specifiers that have no package", () => {
    expect(barePackageName("react")).toBe("react");
    expect(barePackageName("@scope/pkg/sub/path")).toBe("@scope/pkg");
    expect(barePackageName("./relative")).toBeUndefined();
    expect(barePackageName("/absolute")).toBeUndefined();
    expect(barePackageName("#internal")).toBeUndefined();
  });
});
