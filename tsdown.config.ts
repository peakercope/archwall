import { defineConfig } from "tsdown";

import { shared } from "./tsdown.shared.ts";

export default defineConfig({ ...shared, workspace: ["packages/*"] });
