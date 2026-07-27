import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ArchWallPlugin } from "@archwall/rspack";

export const fixturesRoot = path.resolve(import.meta.dirname, "../../integration-kit/fixtures");
export const fixtureDir = path.join(fixturesRoot, "fsd-app");
export const srcRoot = path.join(fixtureDir, "src");

/** Locates any conformance fixture by name; every one is `<name>/src/main.ts` + a `@` alias. */
export function fixture(name: string): { dir: string; src: string } {
  const dir = path.join(fixturesRoot, name);
  return { dir, src: path.join(dir, "src") };
}

export interface BuildOutcome {
  hasErrors: boolean;
  hasWarnings: boolean;
  text: string;
}

/**
 * The fixture is TypeScript, so both bundlers need a transform: Rspack uses its built-in
 * swc (no dependency), webpack the swc-loader package. Everything else — the `@` alias,
 * extension resolution, development mode — is identical, which is the point.
 */
function config(
  loader: "builtin:swc-loader" | "swc-loader",
  plugin: ArchWallPlugin,
  outDir: string,
  where = { dir: fixtureDir, src: srcRoot },
) {
  return {
    context: where.dir,
    mode: "development" as const,
    devtool: false as const,
    entry: path.join(where.src, "main.ts"),
    output: { path: outDir },
    resolve: { extensions: [".ts", ".js"], alias: { "@": where.src } },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader,
          options: { jsc: { parser: { syntax: "typescript" } } },
        },
      ],
    },
    plugins: [plugin],
    stats: "errors-warnings" as const,
    infrastructureLogging: { level: "error" as const },
  };
}

async function compile(
  factory: (c: unknown) => {
    run(cb: (err: Error | null, stats?: unknown) => void): void;
    close(cb: () => void): void;
  },
  cfg: unknown,
): Promise<BuildOutcome> {
  const compiler = factory(cfg);
  const stats = await new Promise<{
    hasErrors(): boolean;
    hasWarnings(): boolean;
    toString(o: unknown): string;
  }>((resolve, reject) => {
    compiler.run((err, s) => (err ? reject(err) : resolve(s as never)));
  });
  await new Promise<void>((resolve) =>
    compiler.close(() => {
      resolve();
    }),
  );
  return {
    hasErrors: stats.hasErrors(),
    hasWarnings: stats.hasWarnings(),
    text: stats.toString({ preset: "errors-warnings", colors: false }),
  };
}

function withTempOut<T>(fn: (outDir: string) => Promise<T>): Promise<T> {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "archwall-bundle-"));
  return fn(outDir).finally(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });
}

export function buildWithRspack(
  plugin: ArchWallPlugin,
  where?: { dir: string; src: string },
): Promise<BuildOutcome> {
  return withTempOut(async (outDir) => {
    const { rspack } = await import("@rspack/core");
    return compile(rspack as never, config("builtin:swc-loader", plugin, outDir, where));
  });
}

export function buildWithWebpack(
  plugin: ArchWallPlugin,
  where?: { dir: string; src: string },
): Promise<BuildOutcome> {
  return withTempOut(async (outDir) => {
    const webpack = (await import("webpack")).default;
    return compile(webpack as never, config("swc-loader", plugin, outDir, where));
  });
}
