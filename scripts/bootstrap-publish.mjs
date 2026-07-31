// One-time, token-authenticated first publish of the 12 publishable packages.
// (@archwall/test-utils is private: it versions with the group but never
// reaches npm, and this script skips it the same way `changeset publish` does.)
//
// Why this exists: npm's trusted-publisher settings live on a package's own
// Settings -> Publishing access page, so OIDC cannot be configured for a
// package that does not exist yet. Release #1 has to be token-based; every
// release after it runs unattended through .github/workflows/release.yml with
// no long-lived credential anywhere.
//
// Run it once, in this order:
//
//   1. Create the `@archwall` org (or claim the scope) on npmjs.com.
//   2. Merge the "chore: version packages" PR so every package sits at the
//      same non-0.0.0 version with changelogs written.
//   3. Create a granular access token with publish permission, then:
//
//        NPM_TOKEN=npm_xxx node scripts/bootstrap-publish.mjs
//
//   4. For each of the 12 published packages on npmjs.com: Settings ->
//      Publishing access -> add a trusted publisher. Organization `peakercope`,
//      repository `archwall`, workflow `release.yml`, allowed action
//      `npm publish`. This is per-package and unavoidable.
//   5. Revoke the token from step 3. Optionally set "Require two-factor
//      authentication and disallow tokens" per package to lock publishing to
//      OIDC from here on.
//
// Safe to re-run: `changeset publish` skips any version already on the
// registry, so a run that dies partway through resumes cleanly.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(root, "packages");

const capture = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, stdio: "pipe", encoding: "utf8" }).trim();

const fail = (message) => {
  console.error(`bootstrap-publish: ${message}`);
  process.exit(1);
};

// --- Preconditions ----------------------------------------------------------
// Each of these is a way the first publish goes wrong permanently: a name
// claimed at the wrong version, or a tarball built from uncommitted work.

if (!process.env.NPM_TOKEN) {
  fail("NPM_TOKEN is not set. Create a granular access token with publish permission.");
}

if (capture("git", ["status", "--porcelain"]) !== "") {
  fail("working tree is dirty. Publish only from a committed state.");
}

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
  fail(`on branch "${branch}". The first publish must come from main.`);
}

const versions = new Map();
for (const dir of readdirSync(packagesDir).sort()) {
  const manifest = JSON.parse(readFileSync(path.join(packagesDir, dir, "package.json"), "utf8"));
  if (manifest.private) continue;
  versions.set(manifest.name, manifest.version);
}

const distinct = new Set(versions.values());
if (distinct.size !== 1) {
  const detail = [...versions].map(([name, v]) => `  ${name} ${v}`).join("\n");
  fail(`packages are not in lockstep - found ${distinct.size} versions:\n${detail}`);
}

const version = [...distinct][0];
if (version === "0.0.0") {
  fail('still at 0.0.0. Run "yarn version-packages" and merge the version PR first.');
}

const remaining = readdirSync(path.join(root, ".changeset")).filter((f) => f.endsWith(".md"));
if (remaining.length > 0) {
  fail(`${remaining.length} unconsumed changeset(s). Run "yarn version-packages" first.`);
}

console.log(`Publishing ${versions.size} packages at ${version}:`);
for (const name of versions.keys()) console.log(`  ${name}`);

// --- Build, verify, publish -------------------------------------------------
// `yarn release` is the same script CI runs, so the bootstrap and every later
// release go through an identical build -> verify:pack -> publish path. The
// only difference is where the credential comes from.
//
// The token goes in a temp userconfig rather than ~/.npmrc or the repo, so it
// never outlives the process and cannot be committed by accident.
const npmrcDir = mkdtempSync(path.join(tmpdir(), "archwall-publish-"));
const npmrc = path.join(npmrcDir, "npmrc");
writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`, {
  mode: 0o600,
});

try {
  execFileSync("yarn", ["release"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc },
  });
} finally {
  rmSync(npmrcDir, { recursive: true, force: true });
}

console.log(`
Published ${version}. Now configure trusted publishing so no token is needed again:

  For each package on npmjs.com -> Settings -> Publishing access -> add a
  trusted publisher (GitHub Actions, org "peakercope", repo "archwall",
  workflow "release.yml", allowed action "npm publish").

Then revoke the token used for this run.`);
