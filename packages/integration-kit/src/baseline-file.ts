import * as fs from "node:fs";
import * as path from "node:path";
import type { BaselineFile } from "@archwall/core";
import { parseBaseline } from "@archwall/core";

/**
 * A baseline read attempt.
 *
 * `missing` is separate from `error` because the two have different answers: a missing file is
 * the expected state on the run that creates it, and an unreadable one never is.
 */
export type ReadBaselineResult = { file: BaselineFile } | { missing: true } | { error: string };

/**
 * Reads and parses a baseline. Never throws — every failure is a value, because the caller
 * turns it into a `baseline-invalid` diagnostic and an exception there would take the rest of
 * the run's findings with it.
 *
 * `@archwall/core` owns the format and cannot open files; this is the half that can.
 */
export function readBaseline(absPath: string): ReadBaselineResult {
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { missing: true };
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return parseBaseline(text);
}

/** Writes a baseline, creating its directory. Throws: `--update-baseline` failing to write is
 * a failure of the command's only job, and there is nothing useful to continue with. */
export function writeBaseline(absPath: string, text: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, "utf8");
}
