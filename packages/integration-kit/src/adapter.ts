import type { AnalysisResult, GraphTransform, HostInfo, UserConfig } from "@archwall/core";
import { formatViolation } from "@archwall/core";
import type { GraphBuilder } from "./graph-builder.js";
import type { ArchWallRun } from "./run.js";
import { createArchWallRun } from "./run.js";

/**
 * What a host needs to report a run, with nothing host-specific decided.
 *
 * `text` is composed here rather than by each adapter because the composition was the part
 * that drifted: the summary line and the per-violation detail must stay attached, and three
 * copies of `${summary}\n${detail}` is three chances for one of them to stop matching.
 */
export interface AdapterReport {
  result: AnalysisResult;
  /** Per the config's `failOn` and `failOnDiagnostics`. Which channel a host uses is its own. */
  failed: boolean;
  summary: string;
  /** `${summary}\n${detail}` — the message to hand the host verbatim. */
  text: string;
}

export interface AdapterOptions {
  /**
   * Host identity, as a thunk.
   *
   * Not a value: capabilities are claimed from evidence gathered during the build, and the
   * evidence does not exist when the plugin is constructed. Rollup claims `raw-specifiers`
   * only if `resolveId` actually observed any; esbuild claims `complete-graph` only under
   * `bundle: true`. Resolving this eagerly would freeze every such claim at its default.
   */
  host: () => HostInfo;
  /** Project root for config discovery, read lazily so a wrapper can resolve it late. */
  cwd: () => string;
  /** Path to an archwall.config file, or an inline config. Omit to discover the file. */
  config?: string | UserConfig | undefined;
  /** Transforms the host contributes, appended after the config's own. */
  transforms?: (() => GraphTransform[] | undefined) | undefined;
  /** Return false to skip analysis entirely — how Vite turns the build path off in dev. */
  enabled?: (() => boolean) | undefined;
}

export interface Adapter {
  /**
   * Build a graph and check it.
   *
   * Returns `undefined` when the adapter is disabled or the run was clean — the two cases
   * where a host has nothing to report and should stay silent.
   */
  check(
    populate: (builder: GraphBuilder, run: ArchWallRun) => void | Promise<void>,
  ): Promise<AdapterReport | undefined>;
}

/**
 * The run/report path shared by every bundler adapter.
 *
 * Rollup, Rspack/webpack and esbuild each repeated the same sequence: memoize a run across
 * watch rebuilds, build a graph, `run.check` it, compose a message, and pick a channel by
 * `failed`. Four copies of forty lines, and exactly where cross-cutting concerns — timing,
 * caching, graph export — would otherwise need adding four times.
 *
 * What it deliberately does NOT do is emit. Hosts disagree irreconcilably about that: Rollup
 * calls `this.error` (which throws), webpack pushes an `Error` onto `compilation.errors`,
 * esbuild *returns* `{ errors }` from its callback. So this returns a neutral report and each
 * adapter spends its own three lines on its own channel.
 *
 * The Vite dev path and the CLI stay out. Vite dev logs per violation with no summary,
 * swallows exceptions, and ignores `failed` entirely; the CLI turns `failed` into an exit code
 * and never formats a violation at all, because its reporters already did. Both would need
 * strategy callbacks for emission, payload, composition and containment — a shared helper
 * serving two shapes badly. They already share the real primitive, `formatViolation`.
 */
export function createAdapter(options: AdapterOptions): Adapter {
  // Memoized across watch rebuilds so the config file is not re-transpiled every time. The
  // PROMISE is stored, not the resolved run: two rebuilds can overlap, and awaiting before
  // assigning would let both start a run.
  let run: Promise<ArchWallRun> | undefined;

  return {
    async check(populate) {
      if (options.enabled?.() === false) return undefined;

      const transforms = options.transforms?.();
      const { config } = options;
      run ??= createArchWallRun({
        host: options.host(),
        cwd: options.cwd(),
        ...(transforms !== undefined && transforms.length > 0 ? { transforms } : {}),
        ...(typeof config === "string" ? { configPath: config } : {}),
        ...(typeof config === "object" ? { config } : {}),
      });
      const resolved = await run;

      const builder = resolved.graphBuilder("complete");
      await populate(builder, resolved);

      const { failed, summary, result } = await resolved.check(builder.build());
      if (result.violations.length === 0) return undefined;

      const detail = result.violations.map((v) => formatViolation(v, result.repoRoot)).join("\n");
      return { result, failed, summary, text: `${summary}\n${detail}` };
    },
  };
}
