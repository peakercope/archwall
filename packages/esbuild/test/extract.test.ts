import * as path from "node:path";
import { edgeKindOf, moduleIdOf } from "@archwall/esbuild";
import { describe, expect, it } from "vitest";

/**
 * The metafile walk, exercised without esbuild.
 *
 * The real build in `esbuild-build.test.ts` proves the adapter works; these prove the two
 * decisions it makes about every entry, including the shapes a fixture never produces.
 */

const ROOT = path.resolve("/repo");

describe("edgeKindOf", () => {
  it.each([
    ["dynamic-import", "dynamic"],
    ["import-statement", "static"],
    ["require-call", "static"],
    ["require-resolve", "static"],
    ["import-rule", "static"],
    ["url-token", "static"],
    ["composes-from", "static"],
    ["entry-point", "static"],
  ])("maps %s to %s", (kind, expected) => {
    expect(edgeKindOf(kind)).toBe(expected);
  });

  it("falls back to static for a kind esbuild has not invented yet", () => {
    // `static` is the only kind `no-cycles` treats as binding, so an unknown guessed as
    // `dynamic` would silently excuse a real cycle.
    expect(edgeKindOf("some-future-kind")).toBe("static");
  });
});

describe("moduleIdOf", () => {
  it("resolves a relative key against the build's working directory", () => {
    expect(moduleIdOf("src/main.ts", ROOT)).toEqual({
      id: path.join(ROOT, "src/main.ts"),
      file: path.join(ROOT, "src/main.ts"),
      virtual: false,
    });
  });

  it("resolves a key that climbs out of the working directory", () => {
    // What a bundled dependency looks like: esbuild emits it relative, however far up.
    const key = "../../node_modules/react/index.js";
    const resolved = path.resolve(ROOT, key);
    expect(moduleIdOf(key, ROOT)).toEqual({ id: resolved, file: resolved, virtual: false });
  });

  it("treats a data-URL input as virtual", () => {
    const key = "<data:text/javascript,export default 1>";
    expect(moduleIdOf(key, ROOT)).toEqual({ id: key, file: null, virtual: true });
  });

  it("treats a plugin namespace as virtual, including a hyphenated one", () => {
    // Verified against esbuild 0.28: a plugin's `namespace` becomes a `namespace:path` key.
    expect(moduleIdOf("my-ns:thing", ROOT)).toEqual({
      id: "my-ns:thing",
      file: null,
      virtual: true,
    });
  });

  it("does NOT mistake a Windows drive letter for a plugin namespace", () => {
    // esbuild emits an absolute path when a file is on a different drive than
    // `absWorkingDir`. Reading `C:` as a namespace would drop the file from the graph.
    const out = moduleIdOf("C:/src/main.ts", ROOT);
    expect(out.virtual).toBe(false);
    expect(out.file).not.toBeNull();
  });
});
