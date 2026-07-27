import * as path from "node:path";

/**
 * Project-relative, forward-slashed, for anything that leaves the process: violation
 * fingerprints, reporter output, SARIF `artifactLocation.uri`.
 *
 * Absolute paths are correct *inside* a run — they are the module identity every host
 * agrees on — and wrong in every output, because they make results machine-specific.
 * SARIF in particular is silently useless with absolute URIs: GitHub code scanning
 * cannot associate the result with a file in the repository.
 *
 * Ids that are not absolute paths (bare specifiers, virtual `\0`-prefixed ids) are
 * returned normalized but otherwise untouched — they have no root to be relative to.
 */
export function toRelative(root: string, id: string): string {
  const normalized = id.replaceAll("\\", "/");
  if (!path.isAbsolute(normalized)) return normalized;
  const rel = path.relative(root, normalized).replaceAll("\\", "/");
  // Outside the root: keep it absolute rather than emitting a ../../.. chain that is
  // just as machine-specific but harder to read.
  return rel === "" || rel.startsWith("../") ? normalized : rel;
}

/**
 * FNV-1a, 64-bit, as 16 lowercase hex chars.
 *
 * Deliberately not `node:crypto`: core must stay runnable wherever the graph can be
 * built (browser playground, worker, edge runtime), and this hash is used for identity,
 * never for security.
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
