import { matchCaptures, matchesPattern } from "@archwall/core";
import { describe, expect, it } from "vitest";

/**
 * The two pattern implementations owe the same grammar.
 *
 * `matchesPattern` delegates to picomatch; `matchCaptures` compiles its own regex because
 * picomatch cannot do `:name` segment captures. That is two implementations of one contract,
 * and the failure mode is silent: `{app,pages}/**` used to be alternation in `include` and a
 * literal brace in a classifier pattern, so a preset matched nothing and reported nothing.
 *
 * This suite is the thing that keeps them aligned. A pattern belongs in the corpus if it is
 * part of the documented grammar (`*`, `**`, `{a,b}`, `:name`); picomatch's extras — extglobs,
 * negation, `?`, numeric ranges, POSIX classes — are deliberately out of contract and out of
 * the corpus. See the header comment in `src/match.ts`.
 */

/** Patterns spanning the documented grammar. `:name` is stripped for the picomatch side. */
const PATTERNS = [
  "src/index.ts",
  "src/*.ts",
  "src/**",
  "src/**/*.ts",
  "**/*.test.ts",
  "*",
  "**",
  "{app,pages}/**",
  "{app,pages}/*.ts",
  "src/{features,entities}/**",
  "src/{features,entities}/*/index.ts",
  "{a,b,c}/x.ts",
  "src/{a,{b,c}}/**",
  "{app,pages}/:slice/**",
  ":layer/:slice/**",
  ":layer/**",
  "src/:layer/{model,ui}/**",
  "packages/*/src/**",
  ".storybook/**",
  "src/a.b.ts",
];

const VALUES = [
  "src/index.ts",
  "src/main.ts",
  "src/a.b.ts",
  "src/features/auth/index.ts",
  "src/features/auth/model/store.ts",
  "src/entities/user/index.ts",
  "src/entities/user/ui/card.tsx",
  "app/routes/home.tsx",
  "app/index.ts",
  "pages/about/index.ts",
  "pages/about/ui/x.ts",
  "widgets/header/index.ts",
  "a/x.ts",
  "b/x.ts",
  "d/x.ts",
  "src/a/deep/nested.ts",
  "src/b/deep/nested.ts",
  "packages/core/src/index.ts",
  "packages/core/test/x.test.ts",
  ".storybook/main.ts",
  "x.test.ts",
  "src/model/x.test.ts",
  "",
  "src",
  "app",
];

/**
 * `:name` has no picomatch equivalent, so the comparison runs against the same pattern with
 * each capture replaced by `*` — which is exactly what a capture matches: one segment.
 */
function withoutCaptures(pattern: string): string {
  return pattern.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "*");
}

// The one documented divergence: a trailing "/**" preceded by a WILDCARD segment.
//
// We say "X/**" matches X and everything under it, always. picomatch says so for a literal or
// brace prefix ("src/**" matches "src"; "{app,pages}/**" matches "app") but not for a wildcard
// one ("*/**" does not match "src") — and it is not even consistent within that corner:
// "*a/**" matches "ba" while "a*/**" does not match "ab". That is an implementation detail of
// picomatch's glob collapsing, not a rule anyone could state, so the capture compiler keeps
// the consistent reading rather than reproducing it.
//
// Blast radius is small and known: the shape only arises as ":layer/**", and pathClassifier
// only ever sees modules that have a file, so a bare directory name is never the value.
// `isKnownDivergence` is a predicate rather than a list of skipped pairs, so the exception
// stays one stated rule instead of a growing pile of exclusions.
function isKnownDivergence(pattern: string, value: string): boolean {
  if (!pattern.endsWith("/**")) return false;
  const prefix = pattern.slice(0, -3);
  const lastSegment = prefix.slice(prefix.lastIndexOf("/") + 1);
  if (!lastSegment.includes("*") && !lastSegment.includes(":")) return false;
  // Only when the value stops exactly at the prefix — i.e. the globstar matched nothing.
  return value.split("/").length === prefix.split("/").length;
}

describe("pattern grammar is shared by both implementations", () => {
  it("matchCaptures and matchesPattern agree on every pattern × value in the corpus", () => {
    const disagreements: string[] = [];
    for (const pattern of PATTERNS) {
      const picomatchPattern = withoutCaptures(pattern);
      for (const value of VALUES) {
        if (isKnownDivergence(pattern, value)) continue;
        const byCaptures = matchCaptures(value, pattern) !== null;
        const byPicomatch = matchesPattern(value, picomatchPattern);
        if (byCaptures !== byPicomatch) {
          disagreements.push(
            `${JSON.stringify(pattern)} vs ${JSON.stringify(value)}: ` +
              `matchCaptures=${byCaptures}, matchesPattern=${byPicomatch}`,
          );
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("pins picomatch's trailing-globstar inconsistency, so we learn if it is ever fixed", () => {
    // If these flip, `isKnownDivergence` can shrink or go away entirely — and this test
    // failing is the only way we would find out.
    expect(matchesPattern("src", "src/**")).toBe(true);
    expect(matchesPattern("app", "{app,pages}/**")).toBe(true);
    expect(matchesPattern("src", "*/**")).toBe(false);
    expect(matchesPattern("ba", "*a/**")).toBe(true);
    expect(matchesPattern("ab", "a*/**")).toBe(false);
  });

  it("reads a trailing globstar consistently, whatever precedes it", () => {
    for (const [pattern, value] of [
      ["src/**", "src"],
      ["{app,pages}/**", "app"],
      [":layer/**", "src"],
      ["*/**", "src"],
    ] as const) {
      expect(matchCaptures(value, pattern)).not.toBeNull();
    }
  });
});

describe("brace alternation in capture patterns", () => {
  // The specific bug C9 named: alternation was picomatch syntax in `include` and a literal
  // brace in a classifier pattern, so every preset built on `pathClassifier` silently
  // disagreed with the project boundary that selected the files it was given.
  it("treats {a,b} as alternation, not as a literal brace", () => {
    expect(matchCaptures("app/routes/home.tsx", "{app,pages}/**")).toEqual({});
    expect(matchCaptures("pages/about/index.ts", "{app,pages}/**")).toEqual({});
    expect(matchCaptures("widgets/header/index.ts", "{app,pages}/**")).toBeNull();
    // The literal reading, which is what it used to do.
    expect(matchCaptures("{app,pages}/x.ts", "{app,pages}/**")).toBeNull();
  });

  it("captures across an alternation", () => {
    expect(matchCaptures("app/auth/model/store.ts", "{app,pages}/:slice/**")).toEqual({
      slice: "auth",
    });
    expect(matchCaptures("pages/about/ui/x.ts", "{app,pages}/:slice/**")).toEqual({
      slice: "about",
    });
  });

  it("handles nested alternation", () => {
    expect(matchCaptures("src/a/deep/nested.ts", "src/{a,{b,c}}/**")).toEqual({});
    expect(matchCaptures("src/c/deep/nested.ts", "src/{a,{b,c}}/**")).toEqual({});
    expect(matchCaptures("src/d/deep/nested.ts", "src/{a,{b,c}}/**")).toBeNull();
  });

  it("drops captures from the alternative that did not match, rather than emitting undefined", () => {
    // Group numbering spans every alternative, so the untaken branch's group is undefined.
    // It must be absent from the tag record — a tag whose value is `undefined` would compare
    // unequal to everything and silently disable a `scope.tag` gate.
    const tags = matchCaptures("src/entities/user.ts", "src/{features/:feature,entities/:entity}");
    expect(tags).toEqual({ entity: "user.ts" });
    expect(Object.hasOwn(tags!, "feature")).toBe(false);
  });

  it("matches an unclosed brace literally", () => {
    expect(matchCaptures("{app/x.ts", "{app/x.ts")).toEqual({});
    expect(matchCaptures("app/x.ts", "{app/x.ts")).toBeNull();
  });
});
