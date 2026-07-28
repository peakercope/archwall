import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConfig } from "@archwall/core";
import { loadConfig, materializeConfig } from "@archwall/integration-kit";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `extends` and named plugins are what make an organisation-wide configuration possible.
 *
 * A `Preset` cannot set `failOn`, `include`, `exclude`, `repoRoot`, or `reporters`, so
 * without inheritance a shared config is a preset plus a README telling every repository
 * to copy twenty lines. And without name resolution a preset can only be `import`ed, which
 * forecloses JSON/YAML configuration and any `--preset` flag forever.
 *
 * Both are resolved HERE rather than in core: this is the layer with a module resolver,
 * and `resolveConfig` must stay synchronous and runnable without a filesystem.
 */
const dirs: string[] = [];

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archwall-extends-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  }
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("extends", () => {
  it("inherits scalars, with the deriving config winning", async () => {
    const cwd = project({
      "base.ts": `export default { sourceRoot: "lib", failOn: "warn", include: ["**"] };`,
      "archwall.config.ts": `export default { extends: "./base.ts", sourceRoot: "src" };`,
    });
    const { config } = await loadConfig({ cwd });
    expect(config.sourceRoot).toBe("src");
    expect(config.failOn).toBe("warn");
  });

  it("concatenates arrays base-first, so a derivation ADDS rather than replaces", async () => {
    // Replacement would make `extends` useless for its main job: a base that contributes
    // rules and a repo that adds two more is the normal case.
    const cwd = project({
      "base.ts": `export default { exclude: ["**/*.stories.*"], reporters: ["json"] };`,
      "archwall.config.ts": `export default { extends: "./base.ts", exclude: ["vendor/**"] };`,
    });
    const { config } = await loadConfig({ cwd });
    expect(config.exclude).toEqual(["**/*.stories.*", "vendor/**"]);
    expect(config.reporters).toEqual(["json"]);
  });

  it("merges `overrides` key-wise with the deriving config winning", async () => {
    const cwd = project({
      "base.ts": `export default { overrides: { "a": "warn", "b": "off" } };`,
      "archwall.config.ts": `export default { extends: "./base.ts", overrides: { "b": "error" } };`,
    });
    const { config } = await loadConfig({ cwd });
    expect(config.overrides).toEqual({ a: "warn", b: "error" });
  });

  it("follows a chain, nearest-last", async () => {
    const cwd = project({
      "root.ts": `export default { failOn: "never", sourceRoot: "root" };`,
      "middle.ts": `export default { extends: "./root.ts", sourceRoot: "middle" };`,
      "archwall.config.ts": `export default { extends: "./middle.ts" };`,
    });
    const { config } = await loadConfig({ cwd });
    expect(config.sourceRoot).toBe("middle");
    expect(config.failOn).toBe("never");
  });

  it("applies several parents left-to-right, later winning", async () => {
    const cwd = project({
      "a.ts": `export default { sourceRoot: "a", failOn: "never" };`,
      "b.ts": `export default { sourceRoot: "b" };`,
      "archwall.config.ts": `export default { extends: ["./a.ts", "./b.ts"] };`,
    });
    const { config } = await loadConfig({ cwd });
    expect(config.sourceRoot).toBe("b");
    expect(config.failOn).toBe("never");
  });

  it("rejects a cycle instead of recursing forever", async () => {
    const cwd = project({
      "a.ts": `export default { extends: "./archwall.config.ts" };`,
      "archwall.config.ts": `export default { extends: "./a.ts" };`,
    });
    await expect(loadConfig({ cwd })).rejects.toThrow(/Circular `extends`/);
  });

  it("is fully resolved before the engine sees it", async () => {
    const cwd = project({
      "base.ts": `export default { failOn: "warn" };`,
      "archwall.config.ts": `export default { extends: "./base.ts" };`,
    });
    const { config } = await loadConfig({ cwd });
    expect(config.extends).toBeUndefined();
    // An unresolved `extends` reaching resolveConfig is a config error, not a silent no-op.
    expect(resolveConfig(config, { cwd }).diagnostics).toEqual([]);
    const complaint = resolveConfig({ extends: "./base.ts" }, { cwd }).diagnostics;
    expect(complaint.map((d) => d.code)).toContain("invalid-config");
  });

  it("treats an inline config the same as a file, so behaviour does not depend on where it came from", async () => {
    const cwd = project({ "base.ts": `export default { failOn: "warn", sourceRoot: "lib" };` });
    const config = await materializeConfig({ extends: "./base.ts", sourceRoot: "src" }, { cwd });
    expect(config.failOn).toBe("warn");
    expect(config.sourceRoot).toBe("src");
  });
});

describe("named plugins", () => {
  it("resolves a preset by name, calling it with the given options", async () => {
    const cwd = project({
      "my-preset.ts": `export default (opts) => ({
        name: "mine",
        classifiers: [],
        rules: [],
        reporters: opts.loud ? [{ name: "loud", onRunEnd() {} }] : [],
      });`,
      "archwall.config.ts": `export default { presets: [["./my-preset.ts", { loud: true }]] };`,
    });
    const { config } = await loadConfig({ cwd });
    const resolved = resolveConfig(config, { cwd });
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.reporterSpecs).toHaveLength(2);
  });

  it("resolves a bare rule object by name, configuring it with the given settings", async () => {
    const cwd = project({
      "my-rule.ts": `export default {
        meta: { name: "mine", description: "", defaultSeverity: "warn" },
        visits: { modules: { visit() {} } },
      };`,
      "archwall.config.ts": `export default { rules: [["./my-rule.ts", {}, { severity: "error" }]] };`,
    });
    const { config } = await loadConfig({ cwd });
    const resolved = resolveConfig(config, { cwd });
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.rules.map((r) => [r.id, r.severity])).toEqual([["mine", "error"]]);
  });

  it("resolves a callable rule by name, letting the package do its own configuring", async () => {
    const cwd = project({
      "callable-rule.ts": `const rule = {
        meta: { name: "callable", description: "", defaultSeverity: "warn" },
        visits: { modules: { visit() {} } },
      };
      export default (options, settings) => ({ rule, options, ...settings });`,
      "archwall.config.ts": `export default { rules: [["./callable-rule.ts", { x: 1 }, { id: "custom" }]] };`,
    });
    const { config } = await loadConfig({ cwd });
    const resolved = resolveConfig(config, { cwd });
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.rules.map((r) => r.id)).toEqual(["custom"]);
    expect(resolved.rules[0]!.options).toEqual({ x: 1 });
  });

  it("resolves a reporter by name, keeping its output destination", async () => {
    const cwd = project({
      "my-reporter.ts": `export default { name: "mine", onRunEnd() {} };`,
      "archwall.config.ts": `export default {
        reporters: [{ reporter: "./my-reporter.ts", output: "out.txt" }],
      };`,
    });
    const { config } = await loadConfig({ cwd });
    const spec = config.reporters![0] as { reporter: { name: string }; output: string };
    expect(spec.reporter.name).toBe("mine");
    expect(spec.output).toBe("out.txt");
  });

  it("says which name failed rather than surfacing a bare module-not-found", async () => {
    const cwd = project({
      "archwall.config.ts": `export default { presets: ["archwall-preset-does-not-exist"] };`,
    });
    await expect(loadConfig({ cwd })).rejects.toThrow(/archwall-preset-does-not-exist/);
  });

  it("rejects a module that resolves but is not the kind of thing it was asked for", async () => {
    const cwd = project({
      "not-a-preset.ts": `export default { hello: "world" };`,
      "archwall.config.ts": `export default { presets: ["./not-a-preset.ts"] };`,
    });
    await expect(loadConfig({ cwd })).rejects.toThrow(/does not export a preset/);
  });
});
