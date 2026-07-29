import picomatch from "picomatch";

/**
 * Pattern matching, on ONE grammar.
 *
 * Patterns appear in `include`/`exclude`, `overrides` keys, `pathClassifier` patterns,
 * specifier patterns, and the CLI scanner. This is the grammar all of them share, anchored
 * full-match:
 *
 *   *       matches within one segment (no "/")
 *   **      matches across segments, and ZERO of them: `src/**` matches `src` itself and
 *           `src/**\/*.ts` matches `src/index.ts`
 *   {a,b}   alternation, nestable
 *   :name   captures exactly one segment as `name` — {@link matchCaptures} only
 *
 * Two implementations, deliberately. {@link matchesPattern} delegates to picomatch;
 * {@link matchCaptures} compiles its own regex, because `:name` SEGMENT CAPTURES are the one
 * thing picomatch cannot do and they are how `pathClassifier` turns a path into tags
 * (`:layer/:slice/**` → `{ layer, slice }`). Extracting a capture is a different job from
 * deciding a match; reimplementing the decision is the price of doing it.
 *
 * What keeps that price honest is that the grammar above is the CONTRACT and both
 * implementations owe it: `test/match-dialect.test.ts` asserts they agree on match/no-match
 * across a shared corpus. `{app,pages}/**` used to mean alternation in one place and a
 * literal brace in the other; that is what the differential test exists to prevent recurring.
 *
 * BEYOND the grammar above, picomatch accepts more than the capture compiler does — extglobs
 * (`+(a|b)`), negation (`!`), `?`, numeric ranges (`{1..3}`), POSIX classes. Those are not
 * part of the contract, are not exercised by the differential test, and must not be used in a
 * classifier pattern, where they match literally. Widening the shared grammar means teaching
 * {@link translate} the same syntax and extending the corpus, in that order.
 *
 * ONE divergence is known and deliberate: a trailing `**` preceded by a wildcard segment.
 * We read it consistently (`X` alone always matches); picomatch does so for literal and brace
 * prefixes but not for wildcard ones, and inconsistently even there. The test file states the
 * case and pins picomatch's behaviour so we find out if it ever changes.
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
  // Evict the oldest rather than clearing: `Map` iterates in insertion order, so this is a
  // one-line LRU-ish bound. Clearing threw away 499 live entries to make room for one, which
  // turned a full cache into a recompile of every pattern on the next pass.
  if (store.size >= MAX_CACHED) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
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

/** Regex metacharacters that must survive as literals. `*` and `{` never reach the escaper. */
const META = /[.+?^$}()|[\]\\]/;

interface Compiled {
  regex: RegExp;
  /**
   * Capture name per regex group, positionally: `names[k]` names group `k + 1`. Dense,
   * because `:name` is the only construct that emits a capturing group — alternation uses
   * `(?:…)`.
   */
  names: string[];
}

const compiled = new Map<string, Compiled>();

/** Index of the `}` closing the `{` at `start`, or -1 if it is never closed. */
function closingBrace(pattern: string, start: number): number {
  let depth = 0;
  for (let i = start; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Splits a brace body on its top-level commas, leaving nested groups intact. */
function splitAlternatives(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

/** Translates one pattern into regex source, appending any capture names it emits. */
function translate(pattern: string, names: string[]): string {
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
    // Globstar swallows the slash next to it, which is the whole of what makes `**` mean
    // "zero or more directories" rather than "one or more". Without these three cases
    // `src/**/*.ts` misses `src/index.ts` and `src/**` misses `src` itself — silently, and
    // in exactly the patterns every preset is built from.
    if (rest.startsWith("/**/")) {
      source += "\\/(?:.*\\/)?";
      i += 4;
      continue;
    }
    if (rest === "/**") {
      source += "(?:\\/.*)?";
      i += 3;
      continue;
    }
    if (i === 0 && rest.startsWith("**/")) {
      source += "(?:.*\\/)?";
      i += 3;
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
    if (rest.startsWith("{")) {
      const end = closingBrace(pattern, i);
      // An unclosed `{` falls through to the escaper and matches literally, which is what
      // picomatch does with it too.
      if (end !== -1) {
        // Alternatives share ONE `names` array, appended in source order, so group numbering
        // stays aligned with it. Only one alternative can match, so a `:name` inside any of
        // the others comes back undefined and is dropped when captures are extracted.
        const alternatives = splitAlternatives(pattern.slice(i + 1, end));
        source += `(?:${alternatives.map((a) => translate(a, names)).join("|")})`;
        i = end + 1;
        continue;
      }
    }
    const ch = pattern[i]!;
    source += META.test(ch) ? `\\${ch}` : ch;
    i += 1;
  }
  return source;
}

function compile(pattern: string): Compiled {
  return cached(compiled, pattern, () => {
    const names: string[] = [];
    const source = translate(pattern, names);
    // The lookahead requires at least one character, so an all-wildcard pattern does not match
    // the empty string — picomatch does not either, and an empty path is not a path.
    return { regex: new RegExp(`^(?=[\\s\\S])${source}$`), names };
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
    const captured = m[idx + 1];
    // Undefined when the group sits in a brace alternative that did not match — that part of
    // the pattern never participated, so the tag is absent rather than empty.
    if (captured !== undefined) out[name] = captured;
  });
  return out;
}
