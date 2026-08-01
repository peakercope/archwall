// Token-authenticated first publish of every package name the registry does not
// know yet. (Private packages version with the group but never reach npm, and
// this script skips them the same way scripts/publish.mjs does.)
//
// Why this exists: npm's trusted-publisher settings live on a package's own
// Settings -> Publishing access page, so OIDC cannot be configured for a
// package that does not exist yet. Release #1 has to be token-based; every
// release after it runs unattended through .github/workflows/release.yml with
// no long-lived credential anywhere.
//
// Not only release #1: a package that joins the group later - or one that
// drops `"private": true`, as @archwall/test-utils did after 0.1.0 - carries
// the same unclaimed name, and the release workflow 404s on it until this
// script claims it.
//
// It publishes *only* the unclaimed names, never the whole group, and that is
// load-bearing rather than tidiness. Once a package has "require two-factor
// authentication and disallow tokens" set (step 5 below), a token-authenticated
// publish of it fails with E403. A run that swept every package would abort on
// the first one already locked down correctly, without ever reaching the new
// name. Names that already exist are not this script's problem: the release
// workflow publishes them over OIDC.
//
// Run it in this order:
//
//   1. Create the `@archwall` org (or claim the scope) on npmjs.com.
//   2. Merge the "chore: version packages" PR so every package sits at the
//      same non-0.0.0 version with changelogs written.
//   3. Create a granular access token with publish permission, then:
//
//        NPM_TOKEN=npm_xxx node scripts/bootstrap-publish.mjs
//
//   4. For each package this run published, on npmjs.com: Settings ->
//      Publishing access -> add a trusted publisher. Organization `peakercope`,
//      repository `archwall`, workflow `release.yml`, allowed action
//      `npm publish`. This is per-package and unavoidable.
//   5. Revoke the token from step 3, and set "Require two-factor authentication
//      and disallow tokens" on the package to lock publishing to OIDC.
//   6. Re-run the release workflow. It publishes the rest of the group at this
//      version over OIDC, including anything this run skipped.
//
// Safe to re-run: publish.mjs skips any version already on the registry, so a
// run that dies partway through resumes cleanly, and a run with nothing left to
// claim exits without touching anything.
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

// --- Which names does the registry not know? --------------------------------
// Anything other than a clean 404 is treated as unknown rather than assumed
// missing: publishing on the back of a network blip would claim a name from a
// half-answered question.
const nameExists = (name) => {
  try {
    capture("npm", ["view", name, "name"]);
    return true;
  } catch (error) {
    const stderr = error.stderr?.toString() ?? "";
    if (stderr.includes("E404")) return false;
    return fail(`could not ask the registry about ${name}:\n${stderr.trim()}`);
  }
};

const unclaimed = [...versions.keys()].filter((name) => !nameExists(name));

if (unclaimed.length === 0) {
  console.log("Every package name is already on the registry - nothing to bootstrap.");
  console.log("Releases run through .github/workflows/release.yml over OIDC.");
  process.exit(0);
}

console.log(`Claiming ${unclaimed.length} unpublished name(s) at ${version}:`);
for (const name of unclaimed) console.log(`  ${name}`);
console.log(
  `\nThe other ${versions.size - unclaimed.length} package(s) are left to the release workflow.`,
);

// --- Build, verify, publish -------------------------------------------------
// The same build -> verify:pack -> publish path `yarn release` runs, minus the
// `changeset tag` at the end: tags belong to the release workflow, which pushes
// them, not to a local bootstrap.
//
// The token goes in a temp userconfig rather than ~/.npmrc or the repo, so it
// never outlives the process and cannot be committed by accident.
const npmrcDir = mkdtempSync(path.join(tmpdir(), "archwall-publish-"));
const npmrc = path.join(npmrcDir, "npmrc");
writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`, {
  mode: 0o600,
});

try {
  for (const [cmd, args] of [
    ["yarn", ["build"]],
    ["yarn", ["verify:pack"]],
    ["node", ["scripts/publish.mjs", `--only=${unclaimed.join(",")}`]],
  ]) {
    execFileSync(cmd, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc },
    });
  }
} finally {
  rmSync(npmrcDir, { recursive: true, force: true });
}

console.log(`
Claimed ${unclaimed.join(", ")} at ${version}. Now, on npmjs.com:

  1. For each name above: Settings -> Publishing access -> add a trusted
     publisher (GitHub Actions, org "peakercope", repo "archwall", workflow
     "release.yml", allowed action "npm publish").
  2. Revoke the token used for this run, and set "Require two-factor
     authentication and disallow tokens" to lock the package to OIDC.
  3. Re-run the release workflow to publish the rest of the group at ${version}.`);
