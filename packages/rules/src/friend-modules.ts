import { defineRule } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { arrayOf, object, optional, recordOf, required, ruleOptions, str } from "./schema.js";

export interface FriendModulesOptions {
  /** e.g. "slice". */
  tagKey: string;
  /**
   * Strict allow-list: fromValue → allowed toValues. Same-value imports are always
   * allowed. Default {} — every crossing import is forbidden unless `alwaysAllow`
   * covers it.
   */
  friends?: Record<string, string[]>;
  /** Tag values every module may import without declaring them, e.g. ["shared"]. */
  alwaysAllow?: string[];
}

export const friendModules = defineRule<FriendModulesOptions>({
  meta: {
    name: "friend-modules",
    description:
      "Allow-list exceptions: a tag value may only import tag values declared as its friends.",
    defaultSeverity: "error",
    ...docsUrlFor("friend-modules"),
    optionsSchema: ruleOptions<FriendModulesOptions>(
      object({
        tagKey: required(str),
        friends: optional(recordOf(arrayOf(str))),
        alwaysAllow: optional(arrayOf(str)),
      }),
    ),
  },
  check(ctx) {
    const { tagKey, friends = {}, alwaysAllow = [] } = ctx.options;
    for (const e of ctx.graph.edges({ crossing: tagKey })) {
      const fromValue = ctx.graph.tagOf(e.from, tagKey)!;
      const toValue = ctx.graph.tagOf(e.to, tagKey)!;
      if (alwaysAllow.includes(toValue)) continue;
      if (friends[fromValue]?.includes(toValue)) continue;
      const allowed = [...(friends[fromValue] ?? []), ...alwaysAllow];
      ctx.report({
        edge: e,
        message: `"${e.from}" (${tagKey} "${fromValue}") may not import ${tagKey} "${toValue}" ("${e.to}") — not in its friend list`,
        explanation: `"${fromValue}" may import: ${allowed.join(", ") || "(nothing)"}.`,
      });
    }
  },
});
