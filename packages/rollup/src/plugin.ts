import type {
  ArchWallRun,
  Capability,
  GraphTransform,
  UserConfig,
} from "@archwall/integration-kit";
import {
  createArchWallRun,
  createModuleKindResolver,
  formatViolation,
} from "@archwall/integration-kit";
import type { RollupPluginContextLike, RollupPluginLike } from "./rollup-types.js";

export interface RollupAdapterOptions {
  /** Path to an archwall.config file, or an inline config. Omit to discover the file. */
  config?: string | UserConfig;
  /** Host identity in the IR. A wrapping adapter (Vite) supplies its own. */
  host?: { name: string; version: string };
  /** Extra capabilities the wrapping host can promise beyond this adapter's own. */
  capabilities?: Capability[];
  /** Project root for config discovery, read lazily so a wrapper can resolve it late. */
  cwd?: () => string;
  /** Return false to skip analysis entirely — how Vite turns the build path off in dev. */
  enabled?: () => boolean;
  /** Transforms the host contributes. */
  transforms?: () => GraphTransform[] | undefined;
}

/**
 * Capabilities every Rollup-shaped host can claim unconditionally.
 *
 * `raw-specifiers` is deliberately NOT among them — see {@link archwallRollup}.
 */
const BASE_CAPABILITIES: Capability[] = ["complete-graph", "dynamic-imports"];

/**
 * ArchWall for any Rollup-shaped host.
 *
 * ## About `raw-specifiers`
 *
 * Rollup's `resolveId` is a first-wins hook: once a plugin returns a resolution, later
 * plugins are never called for that import. So this adapter observes what the author wrote
 * only when it is ordered **before** the resolvers (alias, node-resolve, tsconfig paths) —
 * and under some hosts, notably Vite 8, aliases are expanded before any plugin sees them.
 *
 * Claiming the capability regardless would be the exact failure the capability system
 * exists to prevent: every specifier-matching rule would match nothing and report a clean
 * run rather than an unavailable one. So the claim is made from evidence — whether anything
 * was actually captured — rather than from intent. Place the plugin first and
 * specifier rules run; place it late and they skip loudly.
 */
export function archwallRollup(options: RollupAdapterOptions = {}): RollupPluginLike {
  let run: ArchWallRun | undefined;
  const rawSpecifiers = new Map<string, string>();
  const isEnabled = (): boolean => options.enabled?.() ?? true;

  return {
    name: "archwall",

    async resolveId(this: RollupPluginContextLike, source, importer) {
      // Passive: record what the author wrote per resolved target, never influence
      // resolution. `skipSelf` keeps this hook from recursing into itself.
      if (!isEnabled() || importer === undefined) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (resolved) rawSpecifiers.set(`${importer}\0${resolved.id}`, source);
      return null;
    },

    async buildEnd(this: RollupPluginContextLike) {
      if (!isEnabled()) return;
      const cwd = options.cwd?.() ?? process.cwd();
      const transforms = options.transforms?.();
      // Evidence, not intent: we saw the author's specifiers only if `resolveId` ran ahead
      // of the resolvers. A run is memoized across watch rebuilds, so this is decided on
      // the first build — which is also the first time there is anything to decide it from.
      const observedSpecifiers = rawSpecifiers.size > 0;
      run ??= await createArchWallRun({
        host: {
          name: options.host?.name ?? "rollup",
          version: options.host?.version ?? "0.0.0",
          capabilities: new Set([
            ...BASE_CAPABILITIES,
            ...(observedSpecifiers ? (["raw-specifiers"] as Capability[]) : []),
            ...(options.capabilities ?? []),
          ]),
        },
        cwd,
        ...(transforms !== undefined && transforms.length > 0 ? { transforms } : {}),
        ...(typeof options.config === "string" ? { configPath: options.config } : {}),
        ...(typeof options.config === "object" ? { config: options.config } : {}),
      });

      const builder = run.graphBuilder("complete");
      const kinds = createModuleKindResolver({ sourceRoot: run.config.sourceRoot });
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (!info) continue;
        const file = id.startsWith("\0") ? null : (id.split("?")[0] ?? id);
        builder.addModule({
          id,
          file,
          // Facts only: the id, the file, and the host's own externality verdict where it
          // still exists. What those add up to is not this adapter's decision.
          ...kinds.infer({ id, file, isExternal: info.isExternal }),
        });
        for (const to of info.importedIds) {
          builder.addEdge({
            from: id,
            to,
            rawSpecifier: rawSpecifiers.get(`${id}\0${to}`) ?? to,
            resolvedPath: to,
            kind: "static",
          });
        }
        for (const to of info.dynamicallyImportedIds) {
          builder.addEdge({
            from: id,
            to,
            rawSpecifier: rawSpecifiers.get(`${id}\0${to}`) ?? to,
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
      // Reporters have already run; this is the host-diagnostics channel, governed by
      // `failOn`.
      if (failed) this.error(`${summary}\n${detail}`);
      else this.warn(`${summary}\n${detail}`);
    },
  };
}

export default archwallRollup;
