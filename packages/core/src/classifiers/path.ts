import * as path from "node:path";
import type { Classifier } from "../contracts/classifier.js";
import { defineClassifier } from "../contracts/classifier.js";
import { matchCaptures } from "../match.js";
import { sourceRelative } from "../paths.js";

export interface PathPattern {
  /**
   * Glob-lite, relative to the classifier `root` (itself under the config `sourceRoot`),
   * anchored full-match: `:name` captures one segment as a tag, `*` matches within a
   * segment, `**` across.
   */
  pattern: string;
  /** Literal tags, merged over the captures. */
  tags?: Record<string, string>;
  /**
   * Constrains captured values. A capture outside its allow-list makes the pattern NOT
   * match, so the next pattern is tried — this is how unknown top-level folders stay
   * untagged (and therefore ignored by every rule) instead of inventing layers.
   */
  only?: Record<string, readonly string[]>;
}

export interface PathClassifierOptions {
  name?: string;
  /** Directory the patterns are relative to, itself relative to the config `sourceRoot`. Default ".". */
  root?: string;
  /** First match wins. */
  patterns: PathPattern[];
}

/**
 * Declarative path→tag mapping. Every built-in preset is built on this, and it is the
 * supported way to describe a custom architecture without writing a classify function.
 */
export function pathClassifier(opts: PathClassifierOptions): Classifier {
  const { name = "path", root = ".", patterns } = opts;
  return defineClassifier({
    name,
    classify(module, ctx) {
      if (module.kind !== "source" || !module.file) return null;
      const base = path.resolve(ctx.sourceRoot, root);
      const rel = sourceRelative(base, module.file);
      // Outside the classifier's root: not ours to tag.
      if (rel === null) return null;

      for (const entry of patterns) {
        const captures = matchCaptures(rel, entry.pattern);
        if (!captures) continue;
        if (entry.only && !allowed(captures, entry.only)) continue;
        return { ...captures, ...entry.tags };
      }
      return null;
    },
  });
}

function allowed(
  captures: Record<string, string>,
  only: Record<string, readonly string[]>,
): boolean {
  return Object.entries(only).every(([key, values]) => {
    const captured = captures[key];
    return captured === undefined || values.includes(captured);
  });
}
