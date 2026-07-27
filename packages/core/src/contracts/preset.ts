import type { Classifier } from "./classifier.js";
import type { Reporter } from "./reporter.js";
import type { ConfiguredRule } from "./rule.js";
import type { GraphTransform } from "./transform.js";

/**
 * Everything a third party can ship as one installable unit.
 *
 * This deliberately did NOT become a separate `Plugin` type sitting above `Preset`.
 * Shipping "archwall-preset-nx" used to mean telling users to wire a classifier *and*
 * rules *and* a reporter separately, which is the gap a `Plugin` concept would close — but
 * closing it by adding a second, near-identical bundle type means everyone has to learn
 * which of the two they need, and every downstream API has to accept both. Widening the
 * one bundle that already exists costs a few optional fields and no new vocabulary.
 *
 * Widened now, on purpose: `Preset` is promised as stable, and adding fields to a stable
 * type later is a breaking change for anyone who wrote `satisfies Preset`.
 */
export interface Preset {
  name: string;
  classifiers: Classifier[];
  rules: ConfiguredRule[];
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
