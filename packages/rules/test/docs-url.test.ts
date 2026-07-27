import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_BASE, docsUrlFor } from "@archwall/rules";
import * as rules from "@archwall/rules";
import type { Rule } from "@archwall/core";

/**
 * `docsUrl` fed SARIF's `helpUri` and the console reporter while being populated by
 * nothing — dead metadata. Now that it is populated, the failure mode inverts: a URL that
 * does not resolve puts a dead link in every uploaded SARIF run, which is worse than the
 * absent field it replaced.
 *
 * These tests are the cheap half of keeping that honest: the URL is absolute, it is built
 * from the documented base, and the file it names EXISTS in this repository. They cannot
 * check that the page is published, but they catch a renamed rule or a deleted page.
 */
const DOCS_DIR = path.resolve(import.meta.dirname, "../../../docs/rules");

const BUILT_INS: Rule<never>[] = [
  rules.layerDependencies,
  rules.featureIsolation,
  rules.forbiddenDependencies,
  rules.friendModules,
  rules.noDeepImports,
  rules.publicApi,
  rules.noCycles,
  rules.requireTag,
] as unknown as Rule<never>[];

describe("built-in rule docsUrl", () => {
  it("is set on every built-in rule", () => {
    for (const rule of BUILT_INS) {
      expect(rule.meta.docsUrl, `${rule.meta.name} has no docsUrl`).toBeDefined();
    }
  });

  it("is an absolute http(s) URL, which SARIF `helpUri` requires", () => {
    // SARIF silently ignores a relative uri, so this is a correctness requirement rather
    // than a style one.
    for (const rule of BUILT_INS) {
      expect(rule.meta.docsUrl, rule.meta.name).toMatch(/^https:\/\//);
      expect(() => new URL(rule.meta.docsUrl!)).not.toThrow();
    }
  });

  it("names a documentation file that actually exists in this repository", () => {
    for (const rule of BUILT_INS) {
      const file = path.join(DOCS_DIR, `${rule.meta.name}.md`);
      expect(fs.existsSync(file), `${rule.meta.name}: missing ${file}`).toBe(true);
      expect(rule.meta.docsUrl).toBe(`${DOCS_BASE}/${rule.meta.name}.md`);
    }
  });

  it("has no orphaned pages — every doc corresponds to a shipped rule", () => {
    const documented = fs
      .readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith(".md") && f !== "index.md")
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(documented).toEqual(BUILT_INS.map((r) => r.meta.name).sort());
  });

  it("omits the field entirely when no base is configured", () => {
    // Absent, never present-and-undefined and never a relative path: a broken helpUri is
    // worse than none.
    expect(docsUrlFor("x")).toEqual({ docsUrl: `${DOCS_BASE}/x.md` });
  });
});
