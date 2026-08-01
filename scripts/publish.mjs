// Publishes every non-private workspace package: Yarn packs, npm uploads.
//
// Why the split. Two manifest features this repo relies on are Yarn's, not
// npm's:
//
//   - `publishConfig.exports` (and any other manifest field under
//     publishConfig). Yarn substitutes those fields when it packs. npm treats
//     publishConfig as *npm config* and honours only keys it recognises -
//     `access`, `tag`, `registry` - warning "Unknown publishConfig config" and
//     dropping the rest. Under npm the published `exports` therefore stays
//     pointed at ./src/*.ts, which is not in the tarball at all (`files` is
//     ["dist"]), and every import of the package throws ERR_MODULE_NOT_FOUND.
//   - `workspace:` ranges. Yarn rewrites them to the packed version. npm only
//     resolves the protocol for workspaces it manages itself, and with no
//     package-lock.json here it writes them through verbatim, so installs fail
//     with EUNSUPPORTEDPROTOCOL. Internal ranges are plain semver now, so this
//     one is belt-and-braces rather than load-bearing.
//
// `changeset publish` shells out to `npm publish` and cannot be told to pack
// differently, which is how 0.1.0 and 0.2.0 shipped uninstallable while CI was
// green: `verify:pack` packs with Yarn, so it was checking a tarball no release
// ever uploaded.
//
// Going the other way - publishing with `yarn npm publish` - would fix the
// manifest but break releases: Yarn's publisher has no OIDC token exchange
// (it offers --provenance and nothing else), and .github/workflows/release.yml
// deliberately carries no NPM_TOKEN. Packing with Yarn and handing the finished
// tarball to `npm publish` keeps both halves: a correct manifest, and the npm
// CLI doing the upload so trusted publishing still mints its own credential.
//
// Idempotent, like the `changeset publish` it replaces: versions already on the
// registry are skipped, so a run that dies partway through resumes cleanly.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(root, "packages");

// `--dry-run` packs and hands everything to `npm publish --dry-run`, which
// validates the tarball and prints its contents without uploading. The registry
// lookups still run, so it also shows exactly which versions a real run would
// skip. Requires a build first, same as a real run.
const dryRun = process.argv.includes("--dry-run");

// `--only=<name,name>` narrows the run to the named packages. bootstrap-publish
// needs it to claim a brand-new name without touching the rest: a package that
// has been locked to OIDC on npmjs.com ("require two-factor authentication and
// disallow tokens") rejects a token-authenticated publish with E403, so a
// token-run that swept the whole group would die on the first package that is
// already set up correctly.
const onlyFlag = process.argv.find((arg) => arg.startsWith("--only="));
const only = onlyFlag ? new Set(onlyFlag.slice("--only=".length).split(",").filter(Boolean)) : null;

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "pipe", encoding: "utf8" });

// --- Collect the publishable set --------------------------------------------
const manifests = [];
for (const dir of readdirSync(packagesDir).sort()) {
  const manifest = JSON.parse(readFileSync(path.join(packagesDir, dir, "package.json"), "utf8"));
  if (manifest.private) continue;
  manifests.push({ dir, name: manifest.name, version: manifest.version, manifest });
}

if (only) {
  const unknown = [...only].filter((name) => !manifests.some((pkg) => pkg.name === name));
  if (unknown.length > 0) {
    console.error(`FAILED: --only names no publishable package: ${unknown.join(", ")}`);
    process.exit(1);
  }
}

const selected = only ? manifests.filter((pkg) => only.has(pkg.name)) : manifests;

// Publish dependencies before their dependents. Nothing forces this - npm
// accepts them in any order - but it keeps the registry from briefly holding a
// package whose own dependency does not exist at the version it asks for.
const names = new Set(selected.map((p) => p.name));
const ordered = [];
const seen = new Set();

const visit = (pkg, stack = []) => {
  if (seen.has(pkg.name)) return;
  if (stack.includes(pkg.name)) {
    throw new Error(`dependency cycle: ${[...stack, pkg.name].join(" -> ")}`);
  }
  for (const dep of Object.keys(pkg.manifest.dependencies ?? {})) {
    if (names.has(dep))
      visit(
        selected.find((p) => p.name === dep),
        [...stack, pkg.name],
      );
  }
  seen.add(pkg.name);
  ordered.push(pkg);
};

for (const pkg of selected) visit(pkg);

// --- Skip whatever the registry already has ---------------------------------
// `npm view` exits non-zero both for "this version does not exist" and for
// "this package does not exist" (a 404 - npm answers that way for names you
// have no rights to, rather than leaking whether they exist). Either way the
// version is not published, which is all this needs to know.
const published = (name, version) => {
  try {
    return run("npm", ["view", `${name}@${version}`, "version"]).trim() === version;
  } catch {
    return false;
  }
};

const pending = ordered.filter((pkg) => {
  if (published(pkg.name, pkg.version)) {
    console.log(`skip  ${pkg.name}@${pkg.version} (already on registry)`);
    return false;
  }
  return true;
});

if (pending.length === 0) {
  console.log("\nNothing to publish - every version is already on the registry.");
  process.exit(0);
}

// --- Pack with Yarn, upload with npm ----------------------------------------
const tarballDir = mkdtempSync(path.join(tmpdir(), "archwall-publish-"));

// One package failing does not stop the others. Stopping at the first error
// sounds safer and is not: 0.2.1 aborted on @archwall/test-utils, whose name
// was not yet on the registry, and took @archwall/vite and @archwall/webpack
// down with it - two packages with nothing wrong, left a version behind for a
// reason that had nothing to do with them. Dependencies are still attempted
// before their dependents, so anything that can go out does, and the run still
// exits non-zero with every failure named at the end.
const failures = [];

try {
  for (const pkg of pending) {
    try {
      const tarball = path.join(tarballDir, `${pkg.dir}.tgz`);
      run("yarn", ["workspace", pkg.name, "pack", "--out", tarball]);

      // --access is passed explicitly rather than left to publishConfig.access:
      // scoped packages default to `restricted`, and a first publish that lands
      // as restricted cannot be undone without unpublishing the name.
      const output = run("npm", [
        "publish",
        tarball,
        "--access",
        "public",
        ...(dryRun ? ["--dry-run"] : []),
      ]);
      console.log(output.trim());

      // changesets/action greps stdout for this exact line to decide that a
      // release happened and to push the tags `changeset tag` writes afterwards.
      // Withheld on a dry run so nothing downstream mistakes it for one.
      if (!dryRun) console.log(`New tag: ${pkg.name}@${pkg.version}`);
    } catch (error) {
      const detail = [
        error.stdout?.toString().trim(),
        error.stderr?.toString().trim(),
        error.message,
      ]
        .filter(Boolean)
        .join("\n");
      console.error(`\nFAILED ${pkg.name}@${pkg.version}:\n${detail}\n`);
      failures.push(pkg);
    }
  }
} finally {
  rmSync(tarballDir, { recursive: true, force: true });
}

const succeeded = pending.length - failures.length;
console.log(
  dryRun
    ? `\nDry run: ${succeeded} package(s) would be published.`
    : `\nPublished ${succeeded} of ${pending.length} package(s).`,
);

if (failures.length > 0) {
  console.error(`Failed: ${failures.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}`);
  process.exit(1);
}
