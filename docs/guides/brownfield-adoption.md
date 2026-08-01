# Adopting ArchWall on an existing codebase

A boundary tool turned on for the first time reports every boundary that was ever crossed. On
a five-year-old repository that is a wall of findings, and the usual response is to turn the
tool back off.

A **baseline** is the way through: a committed file listing the violations you accept for now.
They are reported as suppressed rather than as failures, so CI goes green immediately and the
only thing that can break the build is a *new* violation. You then pay the accepted debt down
at whatever pace you like.

## Turn it on

Point your config at a baseline path, relative to `repoRoot`:

```ts
import { defineConfig, fsd } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  presets: [fsd()],
  baseline: "archwall-baseline.json",
});
```

Then write the file from what your code does today:

```sh
archwall check --update-baseline
```

Commit it. The next run is green:

```
0 error(s), 0 warning(s), 137 suppressed — 812 modules, 2104 edges in 340ms
```

The suppressed count is printed on every run, deliberately. Debt you cannot see is debt nobody
pays down.

## What happens next

**A new violation fails the build.** That is the point — the wall stops moving outward.

**A fixed violation is reported as stale.** Its baseline entry no longer matches anything:

```
warn: Baseline "archwall-baseline.json" has 3 entries this run did not produce — the finding
was fixed, or the code it was about is gone. Prune with `archwall check --update-baseline`
```

Pruning is `archwall check --update-baseline` again. This does not fail the build by default,
because failing CI for fixing something punishes exactly the behaviour a baseline exists to
encourage. If you want the file kept honest, opt in:

```ts
failOnDiagnostics: { baselineStale: true },
```

**Nothing else suppresses.** A graph-based linter has no source text, so there is no
`// archwall-ignore` and there never will be. If you want a rule permanently relaxed somewhere,
that is a `scope` or an `overrides` entry in your config, not a baseline entry — the baseline
is for debt you intend to repay.

## What the file looks like

```json
{
  "scheme": "aw3",
  "entries": [
    {
      "fingerprint": "aw3:3c1f9a02b7d45e18",
      "ruleId": "fsd/public-api",
      "location": "src/features/cart/ui/Cart.tsx -> src/features/auth/model/store.ts",
      "message": "\"store.ts\" is internal to slice \"auth\" and may not be imported from outside it"
    }
  ]
}
```

Only `fingerprint` is matched on. `ruleId`, `location`, and `message` are there so that a diff
in a pull request is something a reviewer can actually approve — they are regenerated on every
write and never compared.

The file is deterministic: regenerate it with no code changes and you get the same bytes.

## What invalidates an entry

A fingerprint is `(rule instance, offending locations)` — deliberately not the message, and not
the bundler.

**Survives:**

- Rewording a rule's message, or upgrading to a version that reworded it.
- An alias rewritten to a relative path (`@/b` → `./b`).
- An edge reclassified between `static` and `reexport`.
- A different developer, a different machine, a different checkout directory.
- A different bundler. A baseline written by a developer running Vite suppresses in CI running
  the standalone CLI — that is what canonical module identity is for, and it is tested.

**Does not survive:**

- Moving or renaming a file. The location changed, so it is a different finding. Regenerate.
- Renaming a rule instance, or moving a rule between presets.
- A bump of `scheme`. ArchWall refuses a baseline written under an older scheme and says so
  by name, rather than silently matching nothing and reporting your whole baseline as new.

## Failure modes it will not hide

**A missing or unreadable baseline fails the run.** If `baseline` is configured and the file is
absent, corrupt, or written under another scheme, you get a `baseline-invalid` diagnostic and a
non-zero exit — not a quiet run in which nothing is suppressed and every accepted finding
reappears as new.

**Stale entries are not reported when the run was partial.** If the graph was delivered
progressively, or a rule was skipped for missing host capabilities, or a rule crashed, then an
unmatched entry is not evidence that anything was fixed — so ArchWall says nothing rather than
inviting you to prune entries that are still live.

**`--update-baseline` still fails on diagnostics.** A run in which a rule crashed saw less than
the whole picture, and freezing that into a baseline is how a real violation gets accepted
without anyone seeing it.

## Ratcheting down

The baseline is a worklist. Pick a slice, fix it, regenerate:

```sh
archwall check --update-baseline && git diff --stat archwall-baseline.json
```

The diff tells you exactly how much you paid off.
