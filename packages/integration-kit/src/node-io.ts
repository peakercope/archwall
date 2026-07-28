import * as fs from "node:fs";
import * as path from "node:path";
import type { OutputDestination, OutputSink, ReporterIO } from "@archwall/core";

/**
 * A sink that buffers and writes once, on close.
 *
 * Reporters emit a whole document in one `write` today, but a streaming one would emit
 * many — and either way a single `writeFileSync` at the end is what makes the file either
 * complete or absent, never half-written because the process exited mid-run.
 */
class FileSink implements OutputSink {
  readonly #file: string;
  #chunks: string[] = [];

  constructor(file: string) {
    this.#file = file;
  }

  write(text: string): void {
    this.#chunks.push(text);
  }

  close(): void {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const body = this.#chunks.join("\n");
    fs.writeFileSync(this.#file, body.endsWith("\n") ? body : `${body}\n`, "utf8");
  }
}

/**
 * Filesystem-capable reporter IO.
 *
 * `@archwall/core` deliberately cannot open files — it stays runnable in a browser
 * playground or a worker — so the ability to write `archwall.sarif` lives here, in the
 * layer that already assumes Node. Every adapter and the CLI pass this by default, which
 * is why `output` works everywhere without core knowing what a file is.
 */
export function nodeIO(cwd: string = process.cwd()): ReporterIO {
  return {
    open(destination: OutputDestination): OutputSink {
      if (destination === "stdout") return { write: (text) => process.stdout.write(`${text}\n`) };
      if (destination === "stderr") return { write: (text) => process.stderr.write(`${text}\n`) };
      return new FileSink(path.resolve(cwd, destination));
    },
  };
}
