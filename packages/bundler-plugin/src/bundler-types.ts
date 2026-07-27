/**
 * The slice of the Rspack/webpack compilation API this adapter touches, declared
 * structurally so the package hard-depends on neither bundler. Both are optional peers;
 * whichever one applies the plugin supplies these shapes.
 *
 * Verified against @rspack/core 1.7.12 and webpack 5.109.0. Where the two differ, the
 * type is written to the looser of the pair — notably `getOutgoingConnections`, which
 * returns an array on Rspack and a Set on webpack, so it is typed as Iterable.
 */

export interface ModuleLike {
  identifier(): string;
  /** Absolute path of the underlying file; absent for external/virtual modules. */
  resource?: string | undefined;
  nameForCondition?: () => string | null;
}

export interface DependencyLike {
  /** e.g. "esm import" (Rspack), "harmony import specifier" (webpack), "import()". */
  type?: string | undefined;
  /** What the author wrote: "@/features/auth". */
  request?: string | undefined;
  /** webpack only; Rspack's JS binding does not expose it today. */
  loc?: { start?: { line?: number; column?: number } } | undefined;
}

export interface ConnectionLike {
  dependency?: DependencyLike | null | undefined;
  module?: ModuleLike | null | undefined;
  resolvedModule?: ModuleLike | null | undefined;
}

export interface ModuleGraphLike {
  getOutgoingConnections(module: ModuleLike): Iterable<ConnectionLike>;
}

export interface CompilationLike {
  moduleGraph: ModuleGraphLike;
  errors: unknown[];
  warnings: unknown[];
  hooks: {
    finishModules: {
      tapPromise(name: string, fn: (modules: Iterable<ModuleLike>) => Promise<void>): void;
    };
  };
}

export interface CompilerLike {
  /** Project root; both bundlers set it from `context`. */
  context: string;
  /** Present only on Rspack. Note that Rspack ALSO defines `webpack`, so test this first. */
  rspack?: { rspackVersion?: string } | undefined;
  webpack?: { version?: string } | undefined;
  hooks: {
    compilation: {
      tap(name: string, fn: (compilation: CompilationLike) => void): void;
    };
  };
}
