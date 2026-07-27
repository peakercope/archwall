import type { ModuleKind, ModuleNode } from "@archwall/core";
import { matchesPattern } from "@archwall/core";
import { arrayOf, either, object, optional, recordOf, str, type Validator } from "./schema.js";

export interface ModuleMatcher {
  /** ALL entries must match module tags. */
  tag?: Record<string, string>;
  /**
   * What the module is. This replaced an `external?: boolean`, which could not tell a
   * Node builtin or a sibling workspace package from a third-party dependency — the very
   * distinction a purity rule depends on. Use `THIRD_PARTY_KINDS` for "any dependency"
   * and `FIRST_PARTY_KINDS` for "code we own".
   */
  moduleKind?: ModuleKind | readonly ModuleKind[];
  /** Package name(s); glob-lite, so "@company/*" works. A bare name matches exactly. */
  packageName?: string | string[];
  /** Owning workspace package name(s); glob-lite. */
  workspace?: string | string[];
}

/** Shape of {@link ModuleMatcher}, for the rules whose options embed one. */
export const moduleMatcherSchema: Validator = object({
  tag: optional(recordOf(str)),
  moduleKind: optional(either(str, arrayOf(str))),
  packageName: optional(either(str, arrayOf(str))),
  workspace: optional(either(str, arrayOf(str))),
});

function matchesAny(value: string | undefined, patterns: string | readonly string[]): boolean {
  if (value === undefined) return false;
  const list = typeof patterns === "string" ? [patterns] : patterns;
  return list.some((p) => matchesPattern(value, p));
}

export function moduleMatches(m: ModuleNode, matcher: ModuleMatcher): boolean {
  if (matcher.tag && !Object.entries(matcher.tag).every(([k, v]) => m.tags.get(k) === v))
    return false;
  if (matcher.moduleKind !== undefined) {
    const kinds =
      typeof matcher.moduleKind === "string" ? [matcher.moduleKind] : matcher.moduleKind;
    if (!kinds.includes(m.kind)) return false;
  }
  if (matcher.workspace !== undefined && !matchesAny(m.workspace, matcher.workspace)) return false;
  if (matcher.packageName !== undefined) {
    const patterns = Array.isArray(matcher.packageName)
      ? matcher.packageName
      : [matcher.packageName];
    if (m.packageName === undefined) return false;
    if (!patterns.some((p) => matchesPattern(m.packageName!, p))) return false;
  }
  return true;
}

/**
 * Glob-lite, anchored full-match: "*" matches within one path segment (no "/"),
 * "**" matches across segments. Re-exported from core so specifiers, override keys,
 * and path patterns all share one engine.
 */
export const specifierMatches = (specifier: string, pattern: string): boolean =>
  matchesPattern(specifier, pattern);
