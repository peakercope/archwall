import type { Classifier, ModuleKind, ModuleNode } from "@archwall/core";
import { matchCaptures, matchesPattern, pathClassifier } from "@archwall/core";
import { describe, expect, it } from "vitest";

const ROOT = "/proj";

function tag(
  classifier: Classifier,
  file: string | null,
  kind: ModuleKind = "source",
): Record<string, string> | null {
  const module = { id: file ?? "x", file, kind, tags: new Map() } as ModuleNode;
  const patch = classifier.classify(module, { sourceRoot: ROOT });
  return (patch as Record<string, string> | null) ?? null;
}

describe("matchCaptures", () => {
  it("captures one segment per :name", () => {
    expect(matchCaptures("features/auth/model/store.ts", ":layer/:slice/:segment/**")).toEqual({
      layer: "features",
      slice: "auth",
      segment: "model",
    });
  });
  it("returns an empty object for a capture-less match, null for a miss", () => {
    expect(matchCaptures("a/b.ts", "a/**")).toEqual({});
    expect(matchCaptures("a/b.ts", "z/**")).toBeNull();
  });
  it("keeps * inside a segment and ** across segments", () => {
    expect(matchesPattern("a/index.ts", "a/index.*")).toBe(true);
    expect(matchesPattern("a/b/index.ts", "a/index.*")).toBe(false);
    expect(matchesPattern("a/b/c/index.ts", "a/**")).toBe(true);
  });
  it("does not let a capture swallow a separator", () => {
    expect(matchCaptures("a/b/c.ts", ":one")).toBeNull();
  });
});

describe("pathClassifier", () => {
  const fsd = pathClassifier({
    name: "fsd",
    root: "src",
    patterns: [
      {
        pattern: ":layer/:slice/index.*",
        tags: { visibility: "public" },
        only: { layer: ["features"] },
      },
      {
        pattern: ":layer/:slice/:segment/**",
        tags: { visibility: "internal" },
        only: { layer: ["features"] },
      },
      { pattern: ":layer/**", only: { layer: ["features", "shared"] } },
    ],
  });

  it("applies the first matching pattern", () => {
    expect(tag(fsd, "/proj/src/features/auth/index.ts")).toEqual({
      layer: "features",
      slice: "auth",
      visibility: "public",
    });
    expect(tag(fsd, "/proj/src/features/auth/model/store.ts")).toEqual({
      layer: "features",
      slice: "auth",
      segment: "model",
      visibility: "internal",
    });
  });

  it("falls through to the next pattern when `only` rejects a capture", () => {
    // shared is not a sliced layer, so the first two patterns must not claim it.
    expect(tag(fsd, "/proj/src/shared/lib/format.ts")).toEqual({
      layer: "shared",
    });
  });

  it("leaves unknown top-level folders untagged", () => {
    expect(tag(fsd, "/proj/src/vendor/thing.ts")).toBeNull();
  });

  it("ignores files outside its root, externals, and file-less modules", () => {
    expect(tag(fsd, "/proj/scripts/build.ts")).toBeNull();
    expect(tag(fsd, "/elsewhere/src/features/a/index.ts")).toBeNull();
    expect(tag(fsd, "/proj/src/features/auth/index.ts", true)).toBeNull();
    expect(tag(fsd, null)).toBeNull();
  });

  it("normalizes windows separators", () => {
    expect(tag(fsd, "/proj/src/features\\auth\\index.ts")).toEqual({
      layer: "features",
      slice: "auth",
      visibility: "public",
    });
  });

  it("lets literal tags win over a capture of the same name", () => {
    const c = pathClassifier({
      patterns: [{ pattern: ":layer/**", tags: { layer: "fixed" } }],
    });
    expect(tag(c, "/proj/anything/x.ts")).toEqual({ layer: "fixed" });
  });
});
