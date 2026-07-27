/**
 * Facts about import specifiers, shared by everything that has to reason about one.
 *
 * These live apart from both `GraphBuilder` and `createModuleKindResolver` because both
 * need them and neither owns them — putting them in either would make the other import
 * its consumer.
 */

/** Node builtins are runtime-provided, not dependencies — a purity rule must not flag them. */
const BUILTIN = /^(node:|bun:|deno:)/;
const BARE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

export function isBuiltinSpecifier(specifier: string): boolean {
  return BUILTIN.test(specifier) || BARE_BUILTINS.has(specifier);
}

/**
 * Package name from a bare specifier ("@scope/pkg/sub" → "@scope/pkg"). Relative, absolute,
 * and subpath-imports specifiers have no package name — and that absence is meaningful: it
 * is what separates "a dependency we could not resolve" from "a dangling relative import".
 */
export function barePackageName(specifier: string): string | undefined {
  if (specifier === "") return undefined;
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#"))
    return undefined;
  const parts = specifier.split("/");
  return parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : parts[0];
}
