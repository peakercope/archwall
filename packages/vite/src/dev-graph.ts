import type { GraphBuilder } from "@archwall/integration-kit";

/** The shape we need from Vite's dev-server ModuleGraph nodes. */
export interface DevModuleLike {
  id: string | null;
  file: string | null;
  importedModules: Iterable<DevModuleLike>;
}

/**
 * Feeds a progressive graph from the dev module graph. Modules without an id (not yet
 * resolved) are skipped.
 *
 * The dev graph has no raw specifiers, so edges degrade to the resolved id — which is why
 * the dev host must NOT declare the `raw-specifiers` capability: a rule that matches on
 * what the author wrote would otherwise match nothing here and report a clean run.
 *
 * Self-edges are dropped by the shared `dropSelfEdges` transform rather than here. HMR
 * instrumentation adds them (React Fast Refresh makes every transformed component module
 * import itself) and that reasoning is not Vite-specific; keeping the policy local meant
 * the next host with HMR would reimplement it and the two could then disagree.
 */
export function addDevModules(builder: GraphBuilder, mods: Iterable<DevModuleLike>): void {
  for (const m of mods) {
    if (m.id === null) continue;
    builder.addModule({
      id: m.id,
      file: m.file,
      kind: m.file === null ? "virtual" : "source",
    });
    for (const dep of m.importedModules) {
      if (dep.id === null) continue;
      builder.addEdge({ from: m.id, to: dep.id, kind: "static" });
    }
  }
}
