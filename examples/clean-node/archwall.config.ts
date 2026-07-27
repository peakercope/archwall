import { defineConfig, layered } from "archwall";

/**
 * Clean Architecture with the `layered` preset.
 *
 * The whole architecture is four ordered names plus one purity declaration. Everything
 * else — the classifier, the four rules, the messages — comes from the preset.
 */
export default defineConfig({
  // `repoRoot` stays at its default (this directory), so reported paths and SARIF URIs
  // are resolvable from a checkout; only the analysed source tree is `src`.
  sourceRoot: "src",
  presets: [
    layered({
      // Outermost → innermost. A layer may import its own layer or a lower one.
      layers: ["presentation", "infrastructure", "application", "domain"],
      // The Dependency Rule's teeth: the innermost layers own your rules, not your
      // libraries, so they may not reach for a package at all.
      pure: ["domain", "application"],
      // Nothing is exempt here. A real project usually allows a few pure-data helpers:
      //   allowExternals: ["zod", "date-fns"],
    }),
  ],
  reporters: ["console"],
  failOn: "error",
});
