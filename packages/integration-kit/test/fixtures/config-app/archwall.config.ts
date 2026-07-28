import { defineConfig, defineRule, THIRD_PARTY_KINDS } from "@archwall/core";

const banExternals = defineRule({
  meta: {
    name: "ban-externals",
    description: "test rule",
    defaultSeverity: "error",
  },
  check(ctx) {
    ctx.graph.modules({ moduleKind: THIRD_PARTY_KINDS }).forEach((m) => {
      ctx.report({ module: m.id, message: `external ${m.id} banned` });
    });
  },
});

export default defineConfig({
  rules: [{ rule: banExternals }],
  reporters: ["json"],
  failOn: "error",
});
