import { defineConfig } from "tsdown";

import { shared } from "../../tsdown.shared.ts";

// src/internal.ts is the unstable half of core's surface
// (docs/adr/0018-public-and-internal-core-surface.md). A second entry, not a deep import into
// dist: tsdown generates one export subpath per entry, so this produces "./internal" while
// src/index.ts keeps "." along with main/module/types.
//
// Unlike the CLI's src/bin.ts, this entry must NOT be excluded from `exports` - @archwall/cli
// and @archwall/integration-kit import it in production code, so it has to resolve for anyone
// who installs them. That reintroduces the node10 problem `exclude` exists to dodge: node10
// ignores `exports` entirely and cannot resolve a subpath, which attw reports as a failure
// under the strict profile. `typesVersions` in package.json is the answer - node10 does
// consult it. That key is hand-written; everything else in package.json's exports block is
// generated from this entry list on every build.
export default defineConfig({
  ...shared,
  entry: ["src/index.ts", "src/internal.ts"],
});
