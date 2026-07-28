import type { ArchWallRun, UserConfig } from "@archwall/integration-kit";
import { createArchWallRun, dropSelfEdges, formatViolation } from "@archwall/integration-kit";
import { archwallRollup } from "@archwall/rollup";
import type { Plugin, ViteDevServer } from "vite";
import { version as viteVersion } from "vite";
import { addDevModules } from "./dev-graph.js";

export type { DevModuleLike } from "./dev-graph.js";
export { addDevModules } from "./dev-graph.js";

/**
 * ArchWall for Vite.
 *
 * Build mode IS the Rollup adapter — Vite's build is Rollup, and every hook the build path
 * needs (`resolveId`, `buildEnd`, `getModuleIds`, `getModuleInfo`) is Rollup's. So this
 * package contributes exactly one thing on top of `@archwall/rollup`: dev mode, which is
 * the only genuinely Vite-shaped part.
 *
 * **Build is the source of truth; dev mode is fast feedback.** Dev runs progressively over
 * the loaded subgraph, reports to the console, and never fails the dev server.
 */
export default function archwall(options: { config?: string | UserConfig } = {}): Plugin {
  let isBuild = false;
  let root = process.cwd();
  let devRun: Promise<ArchWallRun> | undefined;
  let devServer: ViteDevServer | undefined;
  let devTimer: ReturnType<typeof setTimeout> | undefined;

  const build = archwallRollup({
    ...(options.config !== undefined ? { config: options.config } : {}),
    host: { name: "vite", version: viteVersion },
    cwd: () => root,
    // The Rollup hooks are inert until Vite says this is a build; dev has its own path.
    enabled: () => isBuild,
  });

  const scheduleDevAnalysis = (): void => {
    if (!devServer) return;
    clearTimeout(devTimer);
    devTimer = setTimeout(async () => {
      const server = devServer;
      if (!server) return;
      try {
        // Assigned before the first `await`, so two overlapping timers cannot each build a
        // run: the promise itself is the memo.
        devRun ??= createArchWallRun({
          host: {
            name: "vite",
            version: viteVersion,
            // Dev declares NO `raw-specifiers`: the dev module graph does not carry what
            // the author wrote, so a rule that matches on specifiers must skip loudly here
            // rather than quietly matching nothing. Nor `complete-graph` — only the modules
            // the browser has asked for are loaded.
            capabilities: new Set(["dynamic-imports"]),
          },
          cwd: root,
          // HMR instrumentation invents self-edges; the policy for dropping them is shared
          // code this host opts into, not something the adapter reimplements.
          transforms: [dropSelfEdges()],
          ...(typeof options.config === "string" ? { configPath: options.config } : {}),
          ...(typeof options.config === "object" ? { config: options.config } : {}),
        });
        const run = await devRun;
        const builder = run.graphBuilder("progressive");
        addDevModules(builder, server.moduleGraph.idToModuleMap.values());
        const { result } = await run.analyze(builder.build());
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
    resolveId: build.resolveId,
    buildEnd: build.buildEnd,
  } as Plugin;
}
