/**
 * The slice of the esbuild plugin API this adapter touches, declared structurally so the
 * package hard-depends on esbuild only as an optional peer.
 *
 * The same technique `@archwall/rollup` uses for Rollup and `@archwall/bundler-plugin` for
 * webpack and Rspack, for the same reason: the adapter is defined by the shape of what it
 * reads, not by which version of the tool happens to be installed.
 */

/**
 * One entry in a metafile input's `imports`.
 *
 * `kind` is `string`, not a closed union: esbuild adds kinds over time (`composes-from`
 * arrived in 0.17) and an adapter that treats exactly one of them specially has no reason
 * to enumerate — or to break on — the rest.
 */
export interface MetafileImportLike {
  /** Resolved path for a bundled import, relative to `absWorkingDir`; the bare specifier for an external one. */
  path: string;
  kind: string;
  external?: boolean | undefined;
  /** What the author wrote, present whenever esbuild resolved the import to something else. */
  original?: string | undefined;
}

export interface MetafileInputLike {
  imports: readonly MetafileImportLike[];
}

export interface MetafileLike {
  inputs: Record<string, MetafileInputLike>;
}

export interface BuildResultLike {
  metafile?: MetafileLike | undefined;
}

/** The build options the adapter reads. Deliberately a subset — esbuild's is far wider. */
export interface BuildOptionsLike {
  metafile?: boolean | undefined;
  bundle?: boolean | undefined;
  absWorkingDir?: string | undefined;
}

export interface PartialMessageLike {
  text: string;
}

/** What `onEnd` may return to contribute diagnostics to the build. */
export interface OnEndResultLike {
  errors?: PartialMessageLike[];
  warnings?: PartialMessageLike[];
}

export interface PluginBuildLike {
  initialOptions: BuildOptionsLike;
  onEnd(
    callback: (
      result: BuildResultLike,
    ) => Promise<OnEndResultLike | undefined> | OnEndResultLike | undefined,
  ): void;
}

/**
 * The plugin shape the adapter contributes. Assignable to esbuild's `Plugin` without
 * importing it — esbuild's is structurally wider.
 */
export interface EsbuildPluginLike {
  name: string;
  setup(build: PluginBuildLike): void;
}
