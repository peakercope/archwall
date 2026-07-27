import * as path from "node:path";
import { check } from "@archwall/cli";
import { sarifReporter } from "@archwall/core";
import { layered } from "@archwall/presets";
import { describe, expect, it } from "vitest";

/**
 * SARIF `artifactLocation.uri` must be REPOSITORY-relative: GitHub code scanning silently
 * fails to associate a result with a file when the uri does not match a path in the repo.
 * `reporters/sarif.ts` says exactly this in a comment.
 *
 * `root` used to be one field serving both purposes, so with the documented `root: "./src"`
 * every emitted uri lost its `src/` prefix. It is now two fields: reporters relativize
 * against `repoRoot`, while `include`/`exclude` and classifier patterns use `sourceRoot`.
 */
const FIXTURE = path.resolve(import.meta.dirname, "../../integration-kit/fixtures/layered-app");

async function sarifDocument(): Promise<{
  runs: { results: { locations: unknown[] }[] }[];
}> {
  const lines: string[] = [];
  await check({
    cwd: FIXTURE,
    config: {
      // Exactly the shape the README documents: the repo is FIXTURE, the sources are in src.
      sourceRoot: "src",
      presets: [
        layered({
          layers: ["presentation", "infrastructure", "application", "domain"],
          pure: ["domain"],
        }),
      ],
      reporters: [sarifReporter({ write: (l) => void lines.push(l) })],
      failOn: "never",
    },
  });
  return JSON.parse(lines.join("\n"));
}

function urisOf(doc: { runs: { results: { locations: unknown[] }[] }[] }): string[] {
  return doc.runs[0]!.results.flatMap((r) =>
    (
      r.locations as {
        physicalLocation: { artifactLocation: { uri: string } };
      }[]
    ).map((l) => l.physicalLocation.artifactLocation.uri),
  ).sort();
}

describe("SARIF artifact locations", () => {
  it("emits repository-relative uris, not source-root-relative ones", async () => {
    const uris = urisOf(await sarifDocument());
    // The fixture seeds two located violations, both under `src/`.
    expect(uris.length).toBeGreaterThan(0);
    for (const uri of uris) {
      expect(uri, `"${uri}" is not resolvable from the repository root`).toMatch(/^src\//);
    }
  });
});
