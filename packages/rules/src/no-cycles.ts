import { defineRule, isFirstParty, stronglyConnectedComponents } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { num, object, optional, ruleOptions } from "./schema.js";

export interface NoCyclesOptions {
  /** Display cap: list at most N module ids in the message. Default 8. */
  maxCycleLength?: number;
}

// No requiredCapabilities: in progressive delivery a cycle among loaded modules is
// still a real cycle; absence of modules is not evidence either way.
export const noCycles = defineRule<NoCyclesOptions>({
  meta: {
    name: "no-cycles",
    description:
      "Forbids circular dependencies (static and reexport edges; dynamic imports break cycles).",
    defaultSeverity: "error",
    ...docsUrlFor("no-cycles"),
    optionsSchema: ruleOptions<NoCyclesOptions>(object({ maxCycleLength: optional(num) })),
  },
  check(ctx) {
    const maxLen = ctx.options.maxCycleLength ?? 8;
    const describe = (ids: readonly string[]): string => {
      const shown = ids.slice(0, maxLen).join(" → ");
      return ids.length > maxLen ? `${shown} → …` : shown;
    };
    // A cycle inside a dependency is not the user's architecture and cannot be fixed by
    // them; reporting it is pure noise, and how much of a package's internals a host
    // exposes varies by bundler. Only cycles the project owns are reported.
    //
    // "Owns" means first-party, which INCLUDES sibling workspace packages. This used to
    // test `external`, defined as `kind !== "source"`, so a cycle spanning two packages of
    // your own monorepo — the most valuable cycle there is to report — was silently
    // dropped. `excluded` counts as foreign here on purpose: you asked for it to be left
    // out of the analysis.
    const isForeign = (id: string): boolean => {
      const kind = ctx.graph.module(id)?.kind;
      return kind === undefined || !isFirstParty(kind);
    };

    const inMultiScc = new Set<string>();
    for (const raw of ctx.compute(stronglyConnectedComponents)) {
      if (raw.length <= 1) continue;
      for (const id of raw) inMultiScc.add(id);
      if (raw.every(isForeign)) continue;
      // Tarjan yields members in traversal order, which follows the host's module
      // insertion order — so the same cycle would be *anchored on a different module*
      // under Vite than under the CLI, and its message would list them differently.
      // Sorting makes the report a property of the cycle, not of who found it.
      const comp = [...raw].sort();
      ctx.report({
        // Anchored on the first member for reporting, but identified by the whole member
        // set: a cycle has no single offending location, and keying identity on `comp[0]`
        // meant adding an unrelated file that sorts earlier changed the fingerprint of an
        // unchanged cycle.
        module: comp[0]!,
        identity: comp,
        message: `Circular dependency among ${comp.length} modules: ${describe(comp)}`,
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
        message: `Module "${e.from}" imports itself`,
        explanation: "Self-imports are always circular.",
      });
    }
  },
});
