import * as path from "node:path";
import { defineRule, matchesPattern } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { arrayOf, object, optional, required, ruleOptions, str } from "./schema.js";

export interface RequireTagOptions {
  /** Tag key every matched module must carry, e.g. "layer". */
  tag: string;
  /**
   * Glob-lite paths, relative to the config `sourceRoot`, that must be classified.
   * Default ["**"] — the whole project.
   */
  within?: string[];
  /** Overrides the default message. */
  message?: string;
}

/**
 * Every rule ignores modules it cannot classify, which is what keeps ArchWall quiet
 * about node_modules and stray files — but it also means a typo'd folder name silently
 * escapes enforcement. This rule is the opposite end of that trade: inside the paths
 * you claim to have organised, an unclassified file is an error.
 */
export const requireTag = defineRule<RequireTagOptions>({
  meta: {
    name: "require-tag",
    description: "Every file under the given paths must be classified with the given tag.",
    defaultSeverity: "error",
    ...docsUrlFor("require-tag"),
    optionsSchema: ruleOptions<RequireTagOptions>(
      object({
        tag: required(str),
        within: optional(arrayOf(str)),
        message: optional(str),
      }),
    ),
  },
  check(ctx) {
    const { tag, within = ["**"], message } = ctx.options;
    // `within` is a path pattern describing the source tree, so it is source-root
    // relative — the same base `pathClassifier` patterns and `include` use.
    const base = ctx.sourceRoot;
    ctx.graph.modules({ moduleKind: "source" }).forEach((m) => {
      if (!m.file || m.tags.has(tag)) return;
      const rel = path.relative(base, m.file.replaceAll("\\", "/")).replaceAll("\\", "/");
      if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return;
      if (!within.some((p) => matchesPattern(rel, p))) return;
      ctx.report({
        module: m.id,
        message:
          message ??
          `"${rel}" has no "${tag}" tag — it does not sit in any recognised part of the architecture`,
        explanation: `Files under [${within.join(", ")}] must be classified with "${tag}". Either move this file into a recognised location, exclude it, or extend your classifier.`,
      });
    });
  },
});
