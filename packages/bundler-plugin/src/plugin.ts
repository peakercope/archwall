import type { ArchWallRun, Capability, HostInfo, UserConfig } from "@archwall/integration-kit";
import {
  createArchWallRun,
  createModuleKindResolver,
  formatViolation,
} from "@archwall/integration-kit";
import type { CompilerLike } from "./bundler-types.js";
import { addCompilationModules } from "./extract.js";

export interface ArchWallPluginOptions {
  /** Path to an archwall.config file, or an inline config. Omit to discover the file. */
  config?: string | UserConfig;
}

const PLUGIN_NAME = "archwall";

function hostOf(compiler: CompilerLike): HostInfo {
  // Rspack defines BOTH `rspack` and a webpack-compat `webpack` object, so check it first.
  const isRspack = compiler.rspack !== undefined;
  // `dependency.request` is the unresolved request as written, on both bundlers.
  const capabilities: Capability[] = [
    "complete-graph",
    "dynamic-imports",
    "reexport-edges",
    "raw-specifiers",
  ];
  // Only webpack's dependencies carry `loc`; Rspack's JS binding does not expose it
  // (verified against 1.7.12). Under-claiming makes a loc-dependent rule skip loudly,
  // which is the correct degradation — claiming it falsely would produce silent nonsense.
  if (!isRspack) capabilities.push("import-locations");
  return {
    name: isRspack ? "rspack" : "webpack",
    version: (isRspack ? compiler.rspack?.rspackVersion : compiler.webpack?.version) ?? "0.0.0",
    capabilities: new Set(capabilities),
  };
}

/**
 * ArchWall plugin for Rspack and webpack.
 *
 * Analysis runs at `finishModules`, which fires once all modules are built and before
 * optimization — so the graph is complete and untouched by tree shaking. Watch-mode
 * rebuilds fire the same hook with a complete graph, so unlike the Vite adapter there is
 * no separate progressive path: one code path, `delivery: "complete"`, always.
 *
 * ```js
 * const ArchWallPlugin = require("@archwall/rspack").default;
 * module.exports = { plugins: [new ArchWallPlugin()] };
 * ```
 */
export class ArchWallPlugin {
  readonly #options: ArchWallPluginOptions;
  /** Memoized so watch rebuilds don't re-transpile the config file every time. */
  #run: Promise<ArchWallRun> | undefined;

  constructor(options: ArchWallPluginOptions = {}) {
    this.#options = options;
  }

  apply(compiler: CompilerLike): void {
    const { config } = this.#options;
    const makeRun = () =>
      createArchWallRun({
        host: hostOf(compiler),
        cwd: compiler.context,
        ...(typeof config === "string" ? { configPath: config } : {}),
        ...(typeof config === "object" ? { config } : {}),
      });

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.finishModules.tapPromise(PLUGIN_NAME, async (modules) => {
        this.#run ??= makeRun();
        const run = await this.#run;
        const builder = run.graphBuilder("complete");
        const kinds = createModuleKindResolver({
          sourceRoot: run.config.sourceRoot,
        });
        addCompilationModules(builder, compilation.moduleGraph, modules, kinds);

        const { failed, summary, result } = await run.check(builder.build());
        if (result.violations.length === 0) return;
        const detail = result.violations.map((v) => formatViolation(v, result.repoRoot)).join("\n");
        const diagnostic = new Error(`${summary}\n${detail}`);
        diagnostic.name = "ArchWallError";
        // Reporters have already run; this is the host-diagnostics channel, governed by
        // failOn. In watch mode an error marks the build failed without killing the watcher.
        if (failed) compilation.errors.push(diagnostic);
        else compilation.warnings.push(diagnostic);
      });
    });
  }
}

export default ArchWallPlugin;
