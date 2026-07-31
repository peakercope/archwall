# 22. Adapters share one run/report path

**Date:** 2026-07-31 · **Status:** Accepted

## Decision

`createAdapter()` in `@archwall/integration-kit` owns the sequence every bundler adapter repeated:
memoize a run across watch rebuilds, build a graph, `run.check` it, compose the message, and decide
whether the run failed. `@archwall/rollup`, `@archwall/bundler-plugin` (Rspack and webpack) and
`@archwall/esbuild` all go through it.

It returns a neutral `AdapterReport` — `{ result, failed, summary, text }` — and **does not emit**.
Each adapter spends its own three lines putting `text` on its host's channel. It returns `undefined`
when the adapter is disabled or the run was clean, the two cases where a host should stay silent.

`host` is a **thunk**, not a value. Capabilities are claimed from evidence gathered during the
build, and that evidence does not exist when the plugin is constructed.

**The Vite dev path and the CLI stay out.**

## Forces

Four call sites carried roughly forty near-identical lines each, and they were precisely where a
future cross-cutting concern — timing, caching, graph export — would need adding four times. The
composition `${summary}\n${detail}` existed in three copies, each an opportunity for the summary
line and its detail to stop matching.

But the hosts disagree irreconcilably about emission, on more axes than are obvious. Rollup calls
`this.error`, which **throws**. webpack pushes an `Error` with a custom `name` onto
`compilation.errors`. esbuild **returns** `{ errors: [{ text }] }` from its callback. Rollup also
has per-build cleanup (`rawSpecifiers.clear()`) that must run after the check but before the
throwing call. A helper that owned emission would have to model all of that.

Vite dev and the CLI diverge further still. Vite dev logs per violation with no summary line,
swallows every exception, ignores `failed` entirely, and runs on a debounce. The CLI never formats
a violation at all — its reporters already did — and turns `failed` into an exit code.

## Alternatives considered

- **One helper across all five call sites, with strategy callbacks.** Rejected: emission, payload
  type, message composition and error containment would each become a parameter, and the result
  serves the three bundler adapters and the two outliers equally badly. The dedup it buys over Vite
  dev and the CLI is a handful of lines; the cost is a helper nobody can read.
- **A helper that also emits, parameterized by a channel enum.** Rejected: `this.error` throwing is
  not a channel difference, it is a control-flow difference, and Rollup's pre-throw cleanup has
  nowhere to live under it.
- **Leave the duplication; it is only forty lines.** Rejected on the grounds the review states —
  the count is not the problem, the four-fold edit for every future concern is.
- **Put it in `@archwall/core`.** Rejected: `createArchWallRun` is impure by design (it loads
  config, opens sinks, drives reporters) and core performs no I/O. This belongs on the same side of
  that line as the run it wraps.

## Consequences

- A new cross-cutting concern for bundler adapters is added once.
- Vite dev and the CLI keep their own shapes, and the shared primitive between all five remains
  `formatViolation`, which core exports. That is the right seam: formatting is common, emission is
  not.
- `ArchWallPlugin` builds its adapter in `apply()` rather than in its constructor, because host
  identity comes from the compiler and one plugin instance may be applied to more than one.
- The run memo moved inside the adapter, which also fixed an inconsistency: Rollup and esbuild
  stored the resolved run (`let run: ArchWallRun | undefined` with `??= await`), so two overlapping
  rebuilds could each start one. The shared path stores the promise, as `bundler-plugin` already
  did.
- `@archwall/integration-kit` gains four exported symbols. It is the adapter-facing package, so
  this is its subject matter rather than scope creep.
