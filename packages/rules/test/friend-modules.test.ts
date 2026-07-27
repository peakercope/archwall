import { friendModules } from "@archwall/rules";
import { buildFixtureGraph, expectViolations, runRule } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

describe("friend-modules", () => {
  const g = buildFixtureGraph({
    modules: [
      { id: "auth", tags: { slice: "auth" } },
      { id: "session", tags: { slice: "session" } },
      { id: "cart", tags: { slice: "cart" } },
      { id: "plain" },
    ],
    edges: [
      ["auth", "session"],
      ["auth", "cart"],
      ["auth", "plain"],
      ["cart", "cart"],
    ],
  });
  it("allows listed friends and same-value; reports the rest", async () => {
    const violations = await runRule(friendModules, g, {
      tagKey: "slice",
      friends: { auth: ["session"] },
    });
    expectViolations(violations, [{ rule: "friend-modules", from: "auth", to: "cart" }]);
  });

  it("forbids every crossing import when no friends are declared", async () => {
    const violations = await runRule(friendModules, g, { tagKey: "slice" });
    expectViolations(violations, [
      { rule: "friend-modules", from: "auth", to: "session" },
      { rule: "friend-modules", from: "auth", to: "cart" },
    ]);
  });

  it("lets every module import an alwaysAllow value without declaring it", async () => {
    const violations = await runRule(friendModules, g, {
      tagKey: "slice",
      alwaysAllow: ["session", "cart"],
    });
    expectViolations(violations, []);
  });

  it("names what the importer may reach in the explanation", async () => {
    const violations = await runRule(friendModules, g, {
      tagKey: "slice",
      friends: { auth: ["session"] },
      alwaysAllow: ["shared"],
    });
    expect(violations[0]!.explanation).toContain("session, shared");
  });
});
