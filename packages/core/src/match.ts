import picomatch from "picomatch";

/**
 * Pattern matching, on ONE engine.
 *
 * This file used to open with "The one glob engine" while being one of two: `include`,
 * `exclude`, and the CLI scanner ran on picomatch, and overrides, `pathClassifier`, and
 * specifier matching ran on the hand-rolled compiler below. The two had different syntax —
 * brace alternation `{ts,tsx}` worked in `exclude` and silently failed in a classifier
 * pattern — so the comment was not merely stale, it actively misled.
 *
 * Matching is now picomatch everywhere. What remains here is the one thing picomatch does
 * not do: `:name` SEGMENT CAPTURES, which is how `pathClassifier` turns a path into tags
 * (`:layer/:slice/**` → `{ layer, slice }`). That is a different job from matching, not a
 * second dialect of it, and it is built by translating captures into a regex once.
 *
 * Syntax, anchored full-match:
 *   *       matches within one segment (no "/")
 *   **      matches across segments
 *   {a,b}   alternation (picomatch)
 *   :name   captures exactly one segment as `name` — {@link matchCaptures} only
 */

/**
 * Bounded compile cache.
 *
 * Unbounded module-level caches leak in long-lived watch processes whenever patterns are
 * dynamic, and both caches here are keyed by user-supplied strings. Patterns come from
 * configuration and are few, so a small cap costs nothing and removes the failure mode.
 */
const MAX_CACHED = 500;

function cached<V>(store: Map<string, V>, key: string, make: () => V): V {
  const hit = store.get(key);
  if (hit !== undefined) return hit;
  const value = make();
  if (store.size >= MAX_CACHED) store.clear();
  store.set(key, value);
  return value;
}

const matchers = new Map<string, (value: string) => boolean>();

/**
 * Anchored full-match test.
 *
 * `dot: true` so a pattern matches dotfiles without every caller remembering to say so —
 * a rule that silently skips `.storybook/` is the kind of quiet gap this tool exists to
 * prevent.
 */
export function matchesPattern(value: string, pattern: string): boolean {
  return cached(matchers, pattern, () => picomatch(pattern, { dot: true }))(value);
}

/** Segments of the capture grammar, in the order the regex builder must handle them. */
const CAPTURE = /^:([A-Za-z_][A-Za-z0-9_]*)/;

interface Compiled {
  regex: RegExp;
  /** Capture names in positional order; empty when the pattern has none. */
  names: string[];
}

const compiled = new Map<string, Compiled>();

function compile(pattern: string): Compiled {
  return cached(compiled, pattern, () => {
    const names: string[] = [];
    let source = "";
    let i = 0;
    while (i < pattern.length) {
      const rest = pattern.slice(i);
      const capture = CAPTURE.exec(rest);
      if (capture) {
        names.push(capture[1]!);
        source += "([^/]+)";
        i += capture[0].length;
        continue;
      }
      if (rest.startsWith("**")) {
        source += ".*";
        i += 2;
        continue;
      }
      if (rest.startsWith("*")) {
        source += "[^/]*";
        i += 1;
        continue;
      }
      source += pattern[i]!.replace(/[.+^${}()|[\]\\?]/, "\\$&");
      i += 1;
    }
    return { regex: new RegExp(`^${source}$`), names };
  });
}

/**
 * Anchored full-match returning the `:name` captures, or null when the pattern does not
 * match. A pattern with no captures yields an empty object on match — callers must check
 * for null rather than for emptiness.
 */
export function matchCaptures(value: string, pattern: string): Record<string, string> | null {
  const { regex, names } = compile(pattern);
  const m = regex.exec(value);
  if (!m) return null;
  const out: Record<string, string> = {};
  names.forEach((name, idx) => {
    out[name] = m[idx + 1]!;
  });
  return out;
}
