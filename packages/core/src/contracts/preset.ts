import type { Classifier } from "./classifier.js";
import type { Reporter } from "./reporter.js";
import type { AnyConfiguredRule } from "./rule.js";
import type { GraphTransform } from "./transform.js";

/**
 * Everything a third party can ship as one installable unit.
 *
 * There is deliberately no separate `Plugin` type above this one. A second, near-identical
 * bundle would mean everyone has to learn which of the two they need and every downstream
 * API has to accept both; widening the one bundle that already exists costs a few optional
 * fields and no new vocabulary.
 *
 * The optional fields are declared up front on purpose: `Preset` is promised as stable, and
 * adding a field to a stable type is a breaking change for anyone who wrote
 * `satisfies Preset`.
 */
export interface Preset {
  name: string;
  classifiers: Classifier[];
  rules: AnyConfiguredRule[];
  /**
   * Passes that enrich the graph before classification — the slot a TypeScript type-edge
   * enricher, or any other "add facts the bundler didn't give us" pass, lives in.
   */
  transforms?: GraphTransform[];
  /**
   * Reporters the preset contributes. Appended to whatever the user configured rather
   * than replacing it: a preset that ships an uploader should not silently remove the
   * console output the user is reading.
   */
  reporters?: Reporter[];
}

export function definePreset<A extends unknown[]>(
  fn: (...args: A) => Preset,
): (...args: A) => Preset {
  return fn;
}
