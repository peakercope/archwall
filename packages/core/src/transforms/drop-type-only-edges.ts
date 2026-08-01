import type { GraphTransform } from "../contracts/transform.js";
import { defineTransform } from "../contracts/transform.js";

/**
 * Removes edges the host marked `attributes.typeOnly`.
 *
 * This is the *policy* half of type-only support, deliberately separated from the *fact* half.
 * Producers report what the code says; whether an erased import counts as a dependency is a
 * question about the user's architecture, and different answers are legitimately right:
 *
 * - A layering rule usually SHOULD see type-only edges — `domain` importing an
 *   `infrastructure` type still couples the two at design time, which is the thing layering
 *   exists to prevent.
 * - A cycle rule usually should NOT — a type-only cycle costs nothing at runtime and
 *   `no-cycles` flagging one is the most common false positive in this whole category of tool.
 *
 * So it is off by default and opted into per config, rather than being baked into a producer.
 * Before this existed the CLI simply never emitted type-only edges, which made that choice for
 * everyone, made the CLI disagree with every bundler adapter, and left no way to get the
 * edges back.
 *
 * Only meaningful when the host declares `type-only-edges`; against a host that erased type
 * imports before ArchWall saw them, there is nothing here to remove and this is a no-op.
 */
export function dropTypeOnlyEdges(): GraphTransform {
  return defineTransform({
    name: "drop-type-only-edges",
    transform(graph) {
      graph.removeEdges((e) => e.attributes?.typeOnly === true);
    },
  });
}
