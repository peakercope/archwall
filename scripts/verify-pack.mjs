// Verifies what consumers actually get: packs every workspace package, installs
// the tarballs into a scratch project outside the workspace, then runs two
// checks against that install.
//
//   1. CJS load    - require() every dual-format package. Guards the format
//                    matrix in the design doc against a dependency going
//                    ESM-only in a future major.
//   2. CLI smoke   - run the real `archwall` binary against a copy of
//                    examples/clean-node. Exercises the compiled bin, its
//                    shebang, the generated publishConfig, and cross-package
//                    resolution between built artifacts.
//
// Why this cannot run inside the workspace: `exports` points at TypeScript
// source during development, so a built .cjs that requires @archwall/core
// would load core's src/index.ts, which imports "./errors.js" - a path that
// only exists as .ts. Built output is only loadable once packed and installed.
//
// Why `overrides`: Yarn rewrites workspace:^ ranges to a plain "0.0.0" when it
// packs, and 0.0.0 does not exist on the registry. Overrides pin every
// @archwall/* dependency to its local tarball so nothing is fetched from npm.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(root, "packages");
const scratch = mkdtempSync(path.join(tmpdir(), "archwall-pack-"));

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });

/** Pull the `require` target out of an exports entry, which may be a string or a conditions object. */
function requireTarget(entry) {
  if (!entry || typeof entry === "string") return undefined;
  const req = entry.require;
  return typeof req === "string" ? req : req?.default;
}

try {
  // --- Pack every workspace package -----------------------------------------
  const tarballDir = path.join(scratch, "tarballs");
  mkdirSync(tarballDir);
  const deps = {};
  const names = [];

  for (const dir of readdirSync(packagesDir).sort()) {
    const manifest = JSON.parse(readFileSync(path.join(packagesDir, dir, "package.json"), "utf8"));
    const tarball = path.join(tarballDir, `${dir}.tgz`);
    run("yarn", ["workspace", manifest.name, "pack", "--out", tarball], root);
    deps[manifest.name] = `file:${tarball}`;
    names.push(manifest.name);
  }
  console.log(`packed ${names.length} packages`);

  // --- Install them into a scratch project ----------------------------------
  const project = path.join(scratch, "project");
  mkdirSync(project);
  writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify(
      {
        name: "archwall-pack-smoke",
        version: "1.0.0",
        private: true,
        type: "module",
        dependencies: deps,
        overrides: deps,
      },
      null,
      2,
    ),
  );

  console.log("installing tarballs...");
  run("npm", ["install", "--silent", "--no-audit", "--no-fund"], project);

  // --- Check 1: every dual-format package loads as CommonJS -----------------
  let checked = 0;
  let skipped = 0;

  for (const name of names) {
    const installed = JSON.parse(
      readFileSync(path.join(project, "node_modules", name, "package.json"), "utf8"),
    );
    if (!requireTarget(installed.exports?.["."])) {
      console.log(`  - ${name}: ESM-only, skipped`);
      skipped++;
      continue;
    }
    run(process.execPath, ["-e", `require(${JSON.stringify(name)})`], project);
    console.log(`  v ${name}`);
    checked++;
  }
  console.log(`CJS load: ${checked} package(s) OK, ${skipped} ESM-only skipped`);

  // --- Check 2: the real CLI binary against a copy of the example -----------
  // Copied into the scratch project so the config's `archwall` import resolves
  // to the installed tarball rather than back to workspace source.
  const example = path.join(root, "examples", "clean-node");
  cpSync(path.join(example, "src"), path.join(project, "src"), {
    recursive: true,
  });
  cpSync(path.join(example, "archwall.config.ts"), path.join(project, "archwall.config.ts"));

  // A standalone equivalent of the example's tsconfig. It cannot be copied: it
  // extends ../../tsconfig.base.json, which does not exist outside the repo.
  // The CLI reads `paths` to resolve the example's `@/...` specifiers - without
  // it they look like third-party packages and the purity rules fire.
  writeFileSync(
    path.join(project, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: { paths: { "@/*": ["./src/*"] } },
        include: ["src", "archwall.config.ts"],
      },
      null,
      2,
    ),
  );

  const bin = path.join(project, "node_modules", ".bin", "archwall");
  const output = run(bin, ["check"], project);
  console.log(`\n--- archwall check ---\n${output.trim()}\n-----------------------`);
  console.log("\nOK: packed CLI ran successfully against examples/clean-node");
} catch (error) {
  // The CLI reports violations on stdout, so surface both streams.
  const detail = [error.stdout?.toString().trim(), error.stderr?.toString().trim(), error.message]
    .filter(Boolean)
    .join("\n");
  console.error(`\nFAILED: ${detail}`);
  console.error(`\nScratch directory kept for inspection: ${scratch}`);
  process.exit(1);
}

rmSync(scratch, { recursive: true, force: true });
