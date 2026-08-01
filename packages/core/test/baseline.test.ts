import type { BaselineFile, Violation } from "@archwall/core";
import {
  applyBaseline,
  FINGERPRINT_SCHEME,
  parseBaseline,
  serializeBaseline,
} from "@archwall/core";
import { describe, expect, it } from "vitest";

/**
 * The baseline FILE format — pure, and deliberately testable without a filesystem, because
 * `@archwall/core` cannot open one. Reading and writing live in `@archwall/integration-kit`.
 */

let counter = 0;
function violation(over: Partial<Violation> = {}): Violation {
  const n = ++counter;
  return {
    ruleName: "flag",
    ruleId: "flag",
    severity: "error",
    message: `finding ${n}`,
    locations: [{ type: "module", module: `/repo/src/${n}.ts` }],
    fingerprint: `${FINGERPRINT_SCHEME}:${String(n).padStart(16, "0")}`,
    ...over,
  };
}

const parsed = (text: string): BaselineFile => {
  const result = parseBaseline(text);
  if ("error" in result) throw new Error(`expected a file, got: ${result.error}`);
  return result.file;
};

describe("serializeBaseline", () => {
  it("round-trips through parseBaseline", () => {
    const v = violation();
    const file = parsed(serializeBaseline([v], "/repo"));
    expect(file.scheme).toBe(FINGERPRINT_SCHEME);
    expect(file.entries).toEqual([
      {
        fingerprint: v.fingerprint,
        ruleId: "flag",
        location: v.locations[0]!.type === "module" ? "src/1.ts" : "",
        message: v.message,
      },
    ]);
  });

  it("produces the same bytes twice, so a regenerated file that changed means findings changed", () => {
    const vs = [violation(), violation(), violation()];
    expect(serializeBaseline(vs, "/repo")).toBe(serializeBaseline([...vs].reverse(), "/repo"));
  });

  it("orders entries independently of the message, so rewording a rule is not a diff", () => {
    const a = violation({ ruleId: "b-rule", message: "zzz" });
    const b = violation({ ruleId: "a-rule", message: "aaa" });
    const before = parsed(serializeBaseline([a, b], "/repo")).entries.map((e) => e.fingerprint);
    const after = parsed(
      serializeBaseline(
        [
          { ...a, message: "aaa" },
          { ...b, message: "zzz" },
        ],
        "/repo",
      ),
    ).entries.map((e) => e.fingerprint);
    expect(after).toEqual(before);
  });

  it("writes repo-relative locations, so one developer's file matches another's", () => {
    const v = violation({ locations: [{ type: "module", module: "/repo/src/deep/x.ts" }] });
    expect(parsed(serializeBaseline([v], "/repo")).entries[0]!.location).toBe("src/deep/x.ts");
  });

  it("dedupes by fingerprint — one fingerprint can cover several findings", () => {
    const v = violation();
    expect(
      parsed(serializeBaseline([v, { ...v, message: "other" }], "/repo")).entries,
    ).toHaveLength(1);
  });

  it("ends with a newline, so the file is a well-formed text file in git", () => {
    expect(serializeBaseline([violation()], "/repo").endsWith("}\n")).toBe(true);
  });
});

describe("parseBaseline", () => {
  it("rejects a file written under a different fingerprint scheme, by name", () => {
    // The failure this prevents: under a bumped scheme every entry stops matching, and a
    // silent no-match is indistinguishable from "somebody added 400 violations".
    const result = parseBaseline(JSON.stringify({ scheme: "aw2", entries: [] }));
    expect("error" in result && result.error).toMatch(/aw2/);
    expect("error" in result && result.error).toMatch(/--update-baseline/);
  });

  it("reports malformed JSON rather than throwing", () => {
    expect(parseBaseline("{ not json")).toHaveProperty("error");
  });

  it("reports a missing entries array", () => {
    expect(parseBaseline(JSON.stringify({ scheme: FINGERPRINT_SCHEME }))).toHaveProperty("error");
  });

  it("reports an entry with no fingerprint, naming its index", () => {
    const result = parseBaseline(
      JSON.stringify({ scheme: FINGERPRINT_SCHEME, entries: [{ ruleId: "flag" }] }),
    );
    expect("error" in result && result.error).toMatch(/entry 0/);
  });

  it("accepts entries carrying only a fingerprint — the context fields are not load-bearing", () => {
    const file = parsed(
      JSON.stringify({ scheme: FINGERPRINT_SCHEME, entries: [{ fingerprint: "aw3:abc" }] }),
    );
    expect(file.entries[0]).toEqual({
      fingerprint: "aw3:abc",
      ruleId: "",
      location: "",
      message: "",
    });
  });
});

describe("applyBaseline", () => {
  const fileOf = (fingerprints: string[]): BaselineFile => ({
    scheme: FINGERPRINT_SCHEME,
    entries: fingerprints.map((fingerprint) => ({
      fingerprint,
      ruleId: "",
      location: "",
      message: "",
    })),
  });

  it("moves matched findings to suppressed and leaves the rest counted", () => {
    const [a, b] = [violation(), violation()];
    const applied = applyBaseline([a, b], fileOf([a.fingerprint]));
    expect(applied.violations).toEqual([b]);
    expect(applied.suppressed).toEqual([a]);
    expect(applied.stale).toEqual([]);
  });

  it("preserves input order in both lists, so reporter output stays byte-stable", () => {
    const vs = [violation(), violation(), violation(), violation()];
    const applied = applyBaseline(vs, fileOf([vs[0]!.fingerprint, vs[2]!.fingerprint]));
    expect(applied.violations).toEqual([vs[1], vs[3]]);
    expect(applied.suppressed).toEqual([vs[0], vs[2]]);
  });

  it("suppresses EVERY finding sharing one fingerprint, not an arbitrary one", () => {
    // Two imports of one dependency from one module share a fingerprint by design. Accepting
    // "domain must not import react" has to mean accepting it, not half of it.
    const v = violation();
    const twin = { ...v, message: "second import" };
    const applied = applyBaseline([v, twin], fileOf([v.fingerprint]));
    expect(applied.suppressed).toHaveLength(2);
    expect(applied.violations).toEqual([]);
  });

  it("reports entries the run did not produce as stale, sorted", () => {
    const v = violation();
    const applied = applyBaseline([v], fileOf(["aw3:zzz", v.fingerprint, "aw3:aaa"]));
    expect(applied.stale).toEqual(["aw3:aaa", "aw3:zzz"]);
  });

  it("suppresses nothing against an empty baseline", () => {
    const vs = [violation(), violation()];
    const applied = applyBaseline(vs, fileOf([]));
    expect(applied.violations).toEqual(vs);
    expect(applied.suppressed).toEqual([]);
  });
});
