import type { Capability, GraphTransform, UserConfig } from "@archwall/integration-kit";
import { createAdapter, createModuleKindResolver } from "@archwall/integration-kit";
import type { EsbuildPluginLike, OnEndResultLike, PluginBuildLike } from "./esbuild-types.js";
import { addMetafileModules } from "./extract.js";

export interface EsbuildAdapterOptions {
  /** Path to an archwall.config file, or an inline config. Omit to discover the file. */
  config?: string | UserConfig;
  /** Host identity in the IR. A wrapping adapter supplies its own. */
  host?: { name: string; version: string };
  /** Extra capabilities the wrapping host can promise beyond this adapter's own. */
  capabilities?: Capability[];
  /** Project root for config discovery. Defaults to the build's `absWorkingDir`. */
  cwd?: () => string;
  /** Return false to skip analysis entirely. */
  enabled?: () => boolean;
  /** Transforms the host contributes. */
  transforms?: () => GraphTransform[] | undefined;
}

/**
 * Capabilities any esbuild build supports, whatever its options.
 *
 * `complete-graph` is NOT among them — see {@link archwallEsbuild}. Nor are
 * `import-locations` (the metafile carries no line or column, anywhere) or `reexport-edges`
 * (a re-export is recorded as a plain `import-statement`). Under-claiming both makes the
 * rules that need them skip loudly, which is the correct degradation.
 */
const BASE_CAPABILITIES: Capability[] = ["dynamic-imports", "raw-specifiers"];

/**
 * ArchWall for esbuild.
 *
 * esbuild exposes no module-graph hook, so extraction happens once at `onEnd` from the
 * build's **metafile** — the only place esbuild reports what it linked together. The plugin
 * turns `metafile` on itself; callers do not have to.
 *
 * ## About `raw-specifiers`
 *
 * The Rollup adapter has to claim this one *from evidence*, because `resolveId` is
 * first-wins: ordered after the resolvers it never observes what the author wrote
 * esbuild has no such hazard. The metafile is a record written after the fact, and it always
 * retains the pre-resolution specifier — as `original` when the import resolved elsewhere,
 * and as `path` itself when it did not. Plugin order cannot take it away, so claiming it
 * unconditionally is the honest claim rather than a relaxation of the rule.
 *
 * ## About `complete-graph`
 *
 * The same doctrine pointed the other way. Without `bundle: true` esbuild never follows an
 * import, so the metafile describes the entry points and nothing beyond them — verified: a
 * non-bundling build of a five-module fixture reports one input with zero imports. A
 * whole-graph rule run against that would report a clean project rather than an unanalysed
 * one, so the capability is claimed only when bundling is on.
 */
export function archwallEsbuild(options: EsbuildAdapterOptions = {}): EsbuildPluginLike {
  return {
    name: "archwall",

    setup(build: PluginBuildLike) {
      // The documented way for a plugin to get the build graph. Set unconditionally: it is
      // needed before `enabled()` can be meaningfully consulted, and generating a metafile
      // nobody reads is far cheaper than discovering at `onEnd` that there is none.
      build.initialOptions.metafile = true;

      // Metafile keys are relative to `absWorkingDir`, so the SAME value must resolve them;
      // anything else silently produces ids that match no file on disk.
      const rootOf = (): string => build.initialOptions.absWorkingDir ?? process.cwd();
      const adapter = createAdapter({
        host: () => ({
          name: options.host?.name ?? "esbuild",
          version: options.host?.version ?? "0.0.0",
          capabilities: new Set([
            ...BASE_CAPABILITIES,
            ...(build.initialOptions.bundle === true ? (["complete-graph"] as Capability[]) : []),
            ...(options.capabilities ?? []),
          ]),
        }),
        cwd: () => options.cwd?.() ?? rootOf(),
        config: options.config,
        ...(options.transforms !== undefined ? { transforms: options.transforms } : {}),
        ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
      });

      build.onEnd(async (result): Promise<OnEndResultLike | undefined> => {
        const { metafile } = result;
        // A failed build, or a plugin that reset the option after this one ran.
        if (metafile === undefined) return;

        const report = await adapter.check((builder, run) => {
          addMetafileModules(
            builder,
            metafile,
            createModuleKindResolver({ sourceRoot: run.config.sourceRoot }),
            rootOf(),
          );
        });
        if (report === undefined) return;

        // Reporters have already run; this is the host-diagnostics channel, governed by
        // `failOn`. An entry on `errors` fails the build — in watch mode without killing
        // the watcher — which is the esbuild analogue of Rollup's `this.error`.
        return report.failed
          ? { errors: [{ text: report.text }] }
          : { warnings: [{ text: report.text }] };
      });
    },
  };
}

export default archwallEsbuild;
