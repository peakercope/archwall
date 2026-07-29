import { IR_VERSION } from "@archwall/core";

/**
 * Injected by the bundler at build time; absent from the source tree by design.
 *
 * Declared as possibly-undefined because that is exactly what it is in the two situations
 * where no bundler ran: this repository's own test suite, and any consumer who resolves
 * `@archwall/core` to its source.
 */
declare const __ARCHWALL_IR_VERSION__: string | undefined;

/**
 * The IR version this package was BUILT against.
 *
 * The point of `assertIrCompatible` is to catch adapter/core SKEW — an adapter compiled
 * against IR 1.x loaded next to a core that speaks 2.x. Reading `IR_VERSION` from the linked
 * core at runtime cannot detect that, because it is the very constant being compared against:
 * the check could only ever fire under a duplicated-core install, never under the skew it
 * documents. Freezing the value at build time is what gives it something independent to say.
 *
 * The fallback is the linked constant, which is correct wherever it is reached: in this
 * repository core and the adapter are the same working tree by construction, so they cannot
 * be skewed. Published artifacts always carry the substituted literal — `test/ir-version.test.ts`
 * asserts the declaration is well-formed, and `scripts/verify-pack.mjs` checks the built output.
 */
export const BUILT_IR_VERSION: string =
  typeof __ARCHWALL_IR_VERSION__ === "string" ? __ARCHWALL_IR_VERSION__ : IR_VERSION;
