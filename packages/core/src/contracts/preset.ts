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
/**
 * Descriptive facts about a preset. Nothing in core reads these yet — they exist now because
 * `Preset` is promised as stable, so this is the last moment at which adding them is free.
 *
 * The index signature is the load-bearing part: with it, every future named field is additive
 * and a third party can carry its own facts without waiting for core. Without it, this type
 * would have exactly the problem it exists to solve.
 */
export interface PresetMeta {
  /** The preset package's version, for reporters and bug reports. */
  version?: string;
  description?: string;
  docsUrl?: string;
  [key: string]: unknown;
}

export interface Preset {
  name: string;
  classifiers: Classifier[];
  rules: AnyConfiguredRule[];
  /** See {@link PresetMeta}. Purely descriptive; it never affects analysis. */
  meta?: PresetMeta;
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
