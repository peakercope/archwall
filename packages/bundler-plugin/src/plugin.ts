import type { Adapter, Capability, HostInfo, UserConfig } from "@archwall/integration-kit";
import { createAdapter, createModuleKindResolver } from "@archwall/integration-kit";
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
  /**
   * Built in `apply`, not in the constructor: the host identity comes from the compiler, and
   * one plugin instance may be applied to more than one. The adapter memoizes the run inside
   * itself, so watch rebuilds still do not re-transpile the config file.
   */
  #adapter: Adapter | undefined;

  constructor(options: ArchWallPluginOptions = {}) {
    this.#options = options;
  }

  apply(compiler: CompilerLike): void {
    this.#adapter ??= createAdapter({
      host: () => hostOf(compiler),
      cwd: () => compiler.context,
      config: this.#options.config,
    });
    const adapter = this.#adapter;

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.finishModules.tapPromise(PLUGIN_NAME, async (modules) => {
        const report = await adapter.check((builder, run) => {
          addCompilationModules(
            builder,
            compilation.moduleGraph,
            modules,
            createModuleKindResolver({ sourceRoot: run.config.sourceRoot }),
          );
        });
        if (report === undefined) return;

        const diagnostic = new Error(report.text);
        diagnostic.name = "ArchWallError";
        // Reporters have already run; this is the host-diagnostics channel, governed by
        // failOn. In watch mode an error marks the build failed without killing the watcher.
        if (report.failed) compilation.errors.push(diagnostic);
        else compilation.warnings.push(diagnostic);
      });
    });
  }
}

export default ArchWallPlugin;
