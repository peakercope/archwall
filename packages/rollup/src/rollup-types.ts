/**
 * The slice of the Rollup plugin API this adapter touches, declared structurally so the
 * package hard-depends on neither Rollup nor Vite.
 *
 * The same technique `@archwall/bundler-plugin` uses for webpack and Rspack, for the same
 * reason: the adapter is defined by the shape of the hooks it uses, not by which of the
 * several bundlers that implement those hooks happens to be installed.
 */

export interface RollupModuleInfoLike {
  importedIds: readonly string[];
  dynamicallyImportedIds: readonly string[];
  /** Rollup's own externality verdict, where it still has one. Rolldown dropped it. */
  isExternal?: boolean | undefined;
}

export interface RollupPluginContextLike {
  resolve(
    source: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ): Promise<{ id: string } | null>;
  getModuleIds(): Iterable<string>;
  getModuleInfo(id: string): RollupModuleInfoLike | null;
  error(message: string): never;
  warn(message: string): void;
}

/**
 * The hook subset the adapter contributes. Deliberately assignable to Rollup's and Vite's
 * `Plugin` types without importing either — both are structurally wider.
 */
export interface RollupPluginLike {
  name: string;
  resolveId?(
    this: RollupPluginContextLike,
    source: string,
    importer: string | undefined,
  ): Promise<null> | null;
  buildEnd?(this: RollupPluginContextLike): Promise<void>;
}
