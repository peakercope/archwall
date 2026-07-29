import { defineRule } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { arrayOf, object, optional, recordOf, required, ruleOptions, str } from "./schema.js";

export interface FriendModulesOptions {
  /** e.g. "slice". */
  tagKey: string;
  /**
   * Strict allow-list: fromValue → allowed toValues. Same-value imports are always allowed.
   * Default {} — every crossing import is forbidden unless `alwaysAllow` covers it.
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
    messages: {
      notAFriend:
        '"{from}" ({tagKey} "{fromValue}") may not import {tagKey} "{toValue}" ("{to}") — not in its friend list',
    },
    optionsSchema: ruleOptions<FriendModulesOptions>(
      object({
        tagKey: required(str),
        friends: optional(recordOf(arrayOf(str))),
        alwaysAllow: optional(arrayOf(str)),
      }),
    ),
  },
  visits: {
    edges: {
      filter: (o) => ({ crossing: o.tagKey }),
      visit(e, ctx) {
        const { tagKey, friends = {}, alwaysAllow = [] } = ctx.options;
        const fromValue = ctx.graph.tagOf(e.from, tagKey)!;
        const toValue = ctx.graph.tagOf(e.to, tagKey)!;
        if (alwaysAllow.includes(toValue)) return;
        if (friends[fromValue]?.includes(toValue)) return;
        const allowed = [...(friends[fromValue] ?? []), ...alwaysAllow];
        ctx.report({
          edge: e,
          messageId: "notAFriend",
          data: {
            from: ctx.display(e.from),
            to: ctx.display(e.to),
            tagKey,
            fromValue,
            toValue,
          },
          explanation: `"${fromValue}" may import: ${allowed.join(", ") || "(nothing)"}.`,
        });
      },
    },
  },
});
