import type {
  ArchWallRun,
  Capability,
  GraphTransform,
  UserConfig,
} from "@archwall/integration-kit";
import {
  createArchWallRun,
  createModuleKindResolver,
  dropSelfEdges,
  formatViolation,
} from "@archwall/integration-kit";
import type { Plugin, ViteDevServer } from "vite";
import { version as viteVersion } from "vite";
import { addDevModules } from "./dev-graph.js";

export type { DevModuleLike } from "./dev-graph.js";
export { addDevModules } from "./dev-graph.js";

export default function archwall(options: { config?: string | UserConfig } = {}): Plugin {
  let isBuild = false;
  let root = process.cwd();
  let devRun: ArchWallRun | undefined;
  let devServer: ViteDevServer | undefined;
  let devTimer: ReturnType<typeof setTimeout> | undefined;
  const rawSpecifiers = new Map<string, string>();

  const makeRun = (capabilities: Capability[], transforms?: GraphTransform[]) =>
    createArchWallRun({
      host: {
        name: "vite",
        version: viteVersion,
        capabilities: new Set(capabilities),
      },
      cwd: root,
      ...(transforms !== undefined ? { transforms } : {}),
      ...(typeof options.config === "string" ? { configPath: options.config } : {}),
      ...(typeof options.config === "object" ? { config: options.config } : {}),
    });

  const scheduleDevAnalysis = () => {
    if (!devServer) return;
    clearTimeout(devTimer);
    devTimer = setTimeout(async () => {
      const server = devServer;
      if (!server) return;
      try {
        // Dev deliberately declares NO `raw-specifiers`: the dev module graph does not
        // carry what the author wrote, and a rule that matches on specifiers must skip
        // loudly here rather than quietly matching nothing.
        // HMR instrumentation invents self-edges; the policy for dropping them is shared
        // code this host opts into, not something the adapter reimplements.
        devRun ??= await makeRun(["dynamic-imports"], [dropSelfEdges()]);
        const builder = devRun.graphBuilder("progressive");
        addDevModules(builder, server.moduleGraph.idToModuleMap.values());
        const { result } = await devRun.analyze(builder.build());
        for (const v of result.violations)
          server.config.logger.warn(formatViolation(v, result.repoRoot));
      } catch (err) {
        // Dev mode is fast feedback and never breaks the server.
        server.config.logger.warn(`archwall: analysis failed: ${String(err)}`);
      }
    }, 200);
  };

  return {
    name: "archwall",
    configResolved(config) {
      isBuild = config.command === "build";
      root = config.root;
    },
    configureServer(server) {
      devServer = server;
    },
    transform() {
      if (!isBuild) scheduleDevAnalysis();
      return null;
    },
    async resolveId(source, importer) {
      // Passive: record what the author wrote per resolved target, never influence resolution.
      if (!isBuild || !importer) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (resolved) rawSpecifiers.set(`${importer} ${resolved.id}`, source);
      return null;
    },
    async buildEnd() {
      if (!isBuild) return;
      // Build mode records the author's specifier in `resolveId`, so it can claim
      // `raw-specifiers`; dev mode above deliberately cannot.
      const run = await makeRun(["complete-graph", "dynamic-imports", "raw-specifiers"]);
      const builder = run.graphBuilder("complete");
      const kinds = createModuleKindResolver({
        sourceRoot: run.config.sourceRoot,
      });
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (!info) continue;
        const file = id.startsWith("\0") ? null : (id.split("?")[0] ?? id);
        builder.addModule({
          id,
          file,
          // Facts only: the id, the file, and Rollup's own externality verdict where it
          // still exists. What those add up to is not this adapter's decision.
          ...kinds.infer({
            id,
            file,
            isExternal: (info as { isExternal?: boolean }).isExternal,
          }),
        });
        for (const to of info.importedIds) {
          builder.addEdge({
            from: id,
            to,
            rawSpecifier: rawSpecifiers.get(`${id} ${to}`) ?? to,
            resolvedPath: to,
            kind: "static",
          });
        }
        for (const to of info.dynamicallyImportedIds) {
          builder.addEdge({
            from: id,
            to,
            rawSpecifier: rawSpecifiers.get(`${id} ${to}`) ?? to,
            resolvedPath: to,
            kind: "dynamic",
          });
        }
      }
      const { failed, summary, result } = await run.analyze(builder.build());
      // The map is per-build; keeping it would leak across watch rebuilds.
      rawSpecifiers.clear();
      if (result.violations.length === 0) return;
      const detail = result.violations.map((v) => formatViolation(v, result.repoRoot)).join("\n");
      if (failed) this.error(`${summary}\n${detail}`);
      else this.warn(`${summary}\n${detail}`);
    },
  };
}
