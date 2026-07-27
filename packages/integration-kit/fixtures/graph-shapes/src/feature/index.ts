import { util } from "@/shared";

// A DYNAMIC import. It must arrive as `kind: "dynamic"`, not "static": `no-cycles`
// treats a dynamic edge as a legal cycle-breaker, so mislabelling it changes results.
export async function run(): Promise<string> {
  const { lazy } = await import("./lazy");
  return util() + lazy();
}
