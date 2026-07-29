import type { ViolationLocation } from "@archwall/core";
import { defineRule, isFirstParty, stronglyConnectedComponents } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { num, object, optional, ruleOptions } from "./schema.js";

export interface NoCyclesOptions {
  /** Display cap: list at most N module ids in the message. Default 8. */
  maxCycleLength?: number;
}

// A whole-graph rule, and one of the few that should be: cycle detection is a global
// property, not a predicate over one edge, so it uses `check` rather than `visits`.
//
// No requiredCapabilities: in progressive delivery a cycle among loaded modules is still a
// real cycle; absence of modules is not evidence either way.
export const noCycles = defineRule<NoCyclesOptions>({
  meta: {
    name: "no-cycles",
    description:
      "Forbids circular dependencies (static and reexport edges; dynamic imports break cycles).",
    defaultSeverity: "error",
    recommended: true,
    ...docsUrlFor("no-cycles"),
    messages: {
      cycle: "Circular dependency among {count} modules: {members}",
      selfImport: 'Module "{module}" imports itself',
    },
    optionsSchema: ruleOptions<NoCyclesOptions>(object({ maxCycleLength: optional(num) })),
  },
  check(ctx) {
    const maxLen = ctx.options.maxCycleLength ?? 8;
    const describe = (ids: readonly string[]): string => {
      const shown = ids.slice(0, maxLen).map(ctx.display).join(" → ");
      return ids.length > maxLen ? `${shown} → …` : shown;
    };
    // A cycle inside a dependency is not the user's architecture and cannot be fixed by
    // them; reporting it is pure noise. "Owns" means first-party, which INCLUDES sibling
    // workspace packages — a cycle spanning two packages of your own monorepo is the most
    // valuable cycle there is to report. `excluded` counts as foreign on purpose: you asked
    // for it to be left out of the analysis.
    const isForeign = (id: string): boolean => {
      const kind = ctx.graph.module(id)?.kind;
      return kind === undefined || !isFirstParty(kind);
    };

    const inMultiScc = new Set<string>();
    for (const raw of ctx.compute(stronglyConnectedComponents)) {
      if (raw.length <= 1) continue;
      for (const id of raw) inMultiScc.add(id);
      if (raw.every(isForeign)) continue;
      // Tarjan yields members in traversal order, which follows the host's module insertion
      // order — so the same cycle would be anchored on a different module under Vite than
      // under the CLI. Sorting makes the report a property of the cycle, not of who found it.
      const comp = [...raw].sort();
      ctx.report({
        // Every member is a location. A cycle has no single offending place, and the model
        // that could only name one forced the rest into the message string as prose.
        locations: comp.map((id): ViolationLocation => ({ type: "module", module: id })),
        // Identity is still the whole member set, so adding an unrelated file that sorts
        // earlier does not change the fingerprint of an unchanged cycle.
        identity: comp,
        messageId: "cycle",
        data: { count: comp.length, members: describe(comp) },
        explanation:
          "Break the cycle by extracting shared code downward or switching one edge to a dynamic import.",
      });
    }
    // Size-1 SCCs don't imply self-loops, so self-edges need their own pass.
    for (const e of ctx.graph.edges()) {
      if (e.from !== e.to || e.kind === "dynamic" || inMultiScc.has(e.from)) continue;
      if (isForeign(e.from)) continue;
      ctx.report({
        edge: e,
        messageId: "selfImport",
        data: { module: ctx.display(e.from) },
        explanation: "Self-imports are always circular.",
      });
    }
  },
});
