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
}

/**
 * Every rule ignores modules it cannot classify, which is what keeps ArchWall quiet about
 * node_modules and stray files — but it also means a typo'd folder name silently escapes
 * enforcement. This rule is the opposite end of that trade: inside the paths you claim to
 * have organised, an unclassified file is an error.
 */
export const requireTag = defineRule<RequireTagOptions>({
  meta: {
    name: "require-tag",
    description: "Every file under the given paths must be classified with the given tag.",
    defaultSeverity: "error",
    ...docsUrlFor("require-tag"),
    messages: {
      // The rule's own `message?` option was retired in favour of `ConfiguredRule.message`,
      // which does the same job for every rule rather than for the two that grew it.
      untagged:
        '"{file}" has no "{tag}" tag — it does not sit in any recognised part of the architecture',
    },
    optionsSchema: ruleOptions<RequireTagOptions>(
      object({
        tag: required(str),
        within: optional(arrayOf(str)),
      }),
    ),
  },
  visits: {
    modules: {
      filter: () => ({ moduleKind: "source" }),
      visit(m, ctx) {
        const { tag, within = ["**"] } = ctx.options;
        if (!m.file || m.tags.has(tag)) return;
        // `within` describes the source tree, so it is source-root relative — the same base
        // classifier patterns and `include` use.
        const rel = ctx.relative(m.file);
        if (rel === null) return;
        if (!within.some((p) => matchesPattern(rel, p))) return;
        ctx.report({
          module: m.id,
          messageId: "untagged",
          data: { file: rel, tag },
          explanation: `Files under [${within.join(", ")}] must be classified with "${tag}". Either move this file into a recognised location, exclude it, or extend your classifier.`,
        });
      },
    },
  },
});
