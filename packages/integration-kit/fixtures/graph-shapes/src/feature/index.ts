import { util } from "@/shared";
// A TYPE-ONLY import. Every bundler erases this before a plugin hook can see it, so only the
// CLI (which lexes source) reports the edge at all — and it reports it LABELLED, never
// silently dropped. That is the divergence `type-only-edges` exists to make legible.
//
// It targets `@/shared/util`, a module already present via the barrel, ON PURPOSE: pointing at
// a file nothing else imports would make the CLI's MODULE set differ too, and the axis under
// test here is the edge.
import type { util as UtilFn } from "@/shared/util";

// A DYNAMIC import. It must arrive as `kind: "dynamic"`, not "static": `no-cycles`
// treats a dynamic edge as a legal cycle-breaker, so mislabelling it changes results.
export async function run(): Promise<string> {
  const { lazy } = await import("./lazy");
  const fn: typeof UtilFn = util;
  return fn() + lazy();
}
