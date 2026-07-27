// A TSCONFIG PATH ALIAS ("@/…") plus a BARREL plus a DYNAMIC import plus a BUILTIN —
// the four graph shapes the conformance suite never exercised.

import * as path from "node:path";
import { run } from "@/feature";

export const main = async (): Promise<string> => (await run()) + path.sep;
