import * as path from "node:path";
import { build } from "vite";
import { describe, expect, it, vi } from "vitest";

const exampleDir = path.resolve(import.meta.dirname, "../../../examples/vite");

/**
 * The worked example is documentation, not a conformance fixture: its five seeded
 * mistakes ship commented out so a reader's first `build` is green. That makes it a
 * smoke test rather than an assertion about rule behaviour — it catches the example
 * rotting (a renamed layer, a dropped alias, a demo left uncommented) without weakening
 * FSD_APP_EXPECTED, which is what actually pins adapter output.
 *
 * The build goes through the example's real `vite.config.ts` and `archwall.config.ts`,
 * so plugin discovery and the `@` alias are covered too. `configLoader: "runner"` mirrors
 * the example's own scripts — needed only because `@archwall/vite` is consumed here as
 * raw TypeScript source.
 */
describe("examples/vite", () => {
  it("builds green under its own contract, with a non-empty graph", async () => {
    // Reporters write through a ReporterIO sink, which under Node is `process.stdout`
    // rather than `console.log` — that is what lets `--output` send a document to a file
    // without the console reporter's commentary landing in it.
    const lines: string[] = [];
    const log = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      lines.push(String(chunk).replace(/\n$/, ""));
      return true;
    }) as typeof process.stdout.write);
    try {
      await build({
        root: exampleDir,
        logLevel: "silent",
        configLoader: "runner",
        build: { write: false },
      });
    } finally {
      log.mockRestore();
    }

    // The example's console reporter ends every run with this summary.
    const summary = lines.find((l) => /error\(s\), .* warning\(s\)/.test(l));
    expect(summary, `no archwall summary in output:\n${lines.join("\n")}`).toBeDefined();
    expect(summary).toMatch(/^0 error\(s\), 0 warning\(s\)/);

    // Guards against a silently disabled plugin: greenness only means something if
    // archwall actually saw the app.
    const [, modules, edges] = /(\d+) modules, (\d+) edges/.exec(summary!) ?? [];
    expect(Number(modules)).toBeGreaterThan(20);
    expect(Number(edges)).toBeGreaterThan(20);
  }, 60_000);
});
