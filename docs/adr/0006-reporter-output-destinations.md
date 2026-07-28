# 6. Each reporter has its own output destination

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

`ReporterIO.open(destination)` returns an `OutputSink`. A reporter is configured as
`{ reporter, output }`, where `output` is `"stdout"`, `"stderr"`, or a file path. The CLI
gains `--output`, and writes its summary to stderr unconditionally.

## Forces

`ReporterIO` was a single `write(line)`, shared by every reporter in a run. So
`archwall check --reporter json > out.json` wrote the JSON document and then the CLI's
human-readable summary to the same stream, producing a file that was not JSON. The same for
SARIF.

This is the CI path — the one that matters most and is least likely to be exercised by hand,
because a developer running the command in a terminal sees output that looks fine.

## Alternatives

**Suppress the summary when a machine reporter is active.** Fixes the one symptom. Does not
let `console` and `sarif` run in the same build, which is what CI actually wants: readable
logs *and* an uploadable artifact.

**Have reporters open their own files.** Puts `node:fs` in `@archwall/core`, which is
deliberately runnable without a filesystem (browser playground, worker, edge runtime).

## Consequences

- Core ships a console-only `defaultIO`; `@archwall/integration-kit` ships `nodeIO`, which
  can open files. Asking the portable IO for a file path is an error rather than a silent
  fallback to stdout — a run told to write `archwall.sarif` that printed to the terminal has
  failed at its actual job.
- Sinks are closed in a `finally`, so a reporter that throws leaves complete files rather
  than truncated ones.
- The CLI's summary on stderr follows the convention every tool in a pipeline already uses.
