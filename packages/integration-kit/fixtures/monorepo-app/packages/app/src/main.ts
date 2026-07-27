// Reaches into a SIBLING WORKSPACE PACKAGE (`@fx/lib`), resolved here by relative path so
// that all four graph producers resolve it identically without alias configuration.
//
// This one edge is the whole fixture: the target is first-party code owned by a different
// package in the same monorepo, which is the case `ModuleKind: "workspace"` exists for.
import { formatMoney } from "../../lib/src/index";

export const total = (): string => formatMoney(1999);
