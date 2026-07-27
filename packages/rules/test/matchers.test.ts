import type { ModuleNode } from "@archwall/core";
import { moduleMatches } from "@archwall/rules";
import { describe, expect, it } from "vitest";

const pkg = (packageName: string): ModuleNode =>
  ({
    id: packageName,
    file: null,
    kind: "package",
    packageName,
    tags: new Map(),
  }) as ModuleNode;

const local: ModuleNode = {
  id: "/a.ts",
  file: "/a.ts",
  kind: "source",
  tags: new Map(),
} as ModuleNode;

describe("moduleMatches packageName", () => {
  it("matches a bare name exactly", () => {
    expect(moduleMatches(pkg("react"), { packageName: "react" })).toBe(true);
    expect(moduleMatches(pkg("react-dom"), { packageName: "react" })).toBe(false);
  });

  it("matches a glob", () => {
    expect(moduleMatches(pkg("@company/ui"), { packageName: "@company/*" })).toBe(true);
    expect(moduleMatches(pkg("@other/ui"), { packageName: "@company/*" })).toBe(false);
  });

  it("matches any entry of a list", () => {
    expect(moduleMatches(pkg("date-fns"), { packageName: ["zod", "date-fns"] })).toBe(true);
    expect(moduleMatches(pkg("axios"), { packageName: ["zod", "date-fns"] })).toBe(false);
  });

  it("never matches a module without a package name", () => {
    expect(moduleMatches(local, { packageName: "*" })).toBe(false);
  });
});
