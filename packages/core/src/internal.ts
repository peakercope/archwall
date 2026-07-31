/**
 * The unstable half of core's surface. No compatibility guarantee: anything here may change
 * shape or disappear in any release, including a patch.
 *
 * Two invariants hold for everything in this barrel:
 *
 *   1. It is reachable only through `@archwall/core/internal`, never through `@archwall/core`.
 *      A symbol exported from both barrels is a bug — it is frozen by the public one no matter
 *      what this comment says. `test/public-surface.test.ts` fails on any overlap.
 *   2. Its only consumers are first-party: ArchWall's own packages and its own tests. That is
 *      deliberate, not a leak — every package here ships in lockstep from one repo, so there is
 *      no version skew to protect against, and the alternative is a second copy of `toRelative`
 *      in `@archwall/integration-kit` and of `sourceRelative` in `@archwall/cli`.
 *
 * These are engine mechanics: graph indexing and query-key derivation, the boundary/transform
 * pipeline, the computation cache, path normalisation, and the identity hash. The public entry
 * point exposes what these produce, never the machinery that produces it — which is what keeps
 * the interned or columnar store reachable without an IR major.
 */

export { GraphComputationCache } from "./analysis/cache.js";
export type { BoundaryConfig, PrepareConfig, PrepareResult } from "./engine/prepare.js";
export { applyProjectBoundary, prepareGraph } from "./engine/prepare.js";
export { GraphDraft } from "./graph/ir.js";
export { filterKey, GraphIndex } from "./graph/query.js";
export { hashParts, sourceRelative, stableHash, toRelative } from "./paths.js";
