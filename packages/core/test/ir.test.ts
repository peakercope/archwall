import {
  ArchWallError,
  assertIrCompatible,
  IR_VERSION,
  IrVersionMismatchError,
  irMajor,
} from "@archwall/core";
import { describe, expect, it } from "vitest";

describe("IR versioning", () => {
  it("exposes a semver IR_VERSION", () => {
    expect(IR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("parses majors", () => {
    expect(irMajor("2.3.1")).toBe(2);
  });
  it("throws ArchWallError on malformed versions", () => {
    expect(() => irMajor("nope")).toThrow(ArchWallError);
  });
  it("accepts same-major graphs", () => {
    expect(() => assertIrCompatible("1.99.0")).not.toThrow();
  });
  it("rejects other-major graphs, naming both versions", () => {
    expect(() => assertIrCompatible("2.0.0")).toThrow(IrVersionMismatchError);
    expect(() => assertIrCompatible("2.0.0")).toThrow(/2\.0\.0/);
    expect(() => assertIrCompatible("2.0.0")).toThrow(new RegExp(IR_VERSION.replace(/\./g, "\\.")));
  });
});
