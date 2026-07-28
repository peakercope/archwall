import * as path from "node:path";

/** Forward slashes everywhere, so one string form crosses platforms. */
function normalize(p: string): string {
  return p.replaceAll("\\", "/");
}

/**
 * A file's path relative to `root`, forward-slashed, or `null` when it does not lie
 * strictly inside `root`.
 *
 * The one answer to "where is this file, in the terms my patterns are written in".
 * `include`/`exclude`, classifier patterns, `RuleScope.include`, and `require-tag`'s
 * `within` all describe positions in a tree, and they must all agree on what a position
 * is — including on the edge cases: the root itself is not *inside* the root, and a file
 * above it has no position at all.
 *
 * A path that is already relative is taken as relative *to the root* rather than resolved
 * against `process.cwd()`. Real producers emit absolute paths, but in-memory graphs (tests,
 * `@archwall/test-utils`) use bare ids, and resolving those against the working directory
 * would silently place every module outside the project.
 */
export function sourceRelative(root: string, file: string): string | null {
  const normalized = normalize(file);
  if (!path.isAbsolute(normalized)) return normalized === "" ? null : normalized;
  const rel = normalize(path.relative(root, normalized));
  if (rel === "" || rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) return null;
  return rel;
}

/**
 * Repository-relative, for anything that leaves the process: violation fingerprints,
 * reporter output, SARIF `artifactLocation.uri`.
 *
 * Absolute paths are the right module identity *inside* a run and wrong in every output,
 * because they make results machine-specific. SARIF in particular is silently useless with
 * absolute URIs: GitHub code scanning cannot associate the result with a repository file.
 *
 * Distinct from {@link sourceRelative} in its failure mode, deliberately: an id outside the
 * root is returned as-is rather than as `null`, because output must always print something,
 * whereas matching must be able to say "not here".
 */
export function toRelative(root: string, id: string): string {
  const normalized = normalize(id);
  if (!path.isAbsolute(normalized)) return normalized;
  const rel = sourceRelative(root, normalized);
  // Outside the root: keep it absolute rather than emitting a ../../.. chain that is just
  // as machine-specific and harder to read.
  return rel ?? normalized;
}

/**
 * FNV-1a, 64-bit, as 16 lowercase hex chars.
 *
 * Not `node:crypto`: core stays runnable wherever a graph can be built (browser playground,
 * worker, edge runtime), and this hash is used for identity, never for security.
 */
export function stableHash(input: string): string {
  // 64-bit FNV-1a via two 32-bit halves, since JS bitwise ops are 32-bit.
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 5) | (c >>> 3)), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Joins parts into one hashable string.
 *
 * `\0` rather than a space: parts are paths and specifiers, which may contain spaces, and
 * a delimiter that can occur inside a part makes two different tuples hash identically.
 */
export function hashParts(parts: readonly string[]): string {
  return stableHash(parts.join("\0"));
}
