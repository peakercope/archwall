# 16. Baselines, not ignore comments

**Date:** 2026-07-28 · **Status:** Proposed

## Decision

Suppression is a versioned file keyed by violation fingerprint — `archwall.baseline.json` — written
by `archwall baseline --update`. Config gains `baseline?: string | false`.

A baselined violation is downgraded to `info`, excluded from the `failOn` gate, and counted
separately in the summary. A baseline entry that matches nothing in the current run produces a
`stale-baseline` diagnostic.

There are no ignore comments, and there will not be.

## Forces

ArchWall reasons about a **resolved module graph**, not about source text. There is no line to
attach `// archwall-ignore` to, and no file the tool is guaranteed to have read — a violation can
be about an edge whose importer the tool never opened, or about a cycle spanning forty files with
no single offending place ([ADR-0004](0004-violation-locations.md)). Source-level suppression is
not merely unimplemented; it is unavailable in principle.

That makes a file the only possible mechanism, and it makes suppression an **adoption** feature
rather than a convenience one: without it, ArchWall can only be introduced to a greenfield project.
Every existing codebase reports its entire architectural debt on the first run, with no way to
ratchet.

The fingerprint was designed for exactly this — derived from the rule instance and the offending
locations, deliberately *not* from the message, so improving a rule's wording does not invalidate
every entry. It only became usable once module identity was made canonical
([ADR-0012](0012-canonical-module-identity.md)); building the baseline first would have frozen a
format on top of unstable identity.

## Alternatives considered

- **Per-rule `allow` lists in config.** Verbose at adoption scale (hundreds of entries), and it
  mixes policy with exceptions in one file, so the config no longer states what the architecture
  *is*.
- **Severity downgrade only** (`overrides: { "fsd/public-api": "warn" }`). Blunt: it disables the
  rule for new code as well as old, which is the opposite of a ratchet.
- **Source comments.** Impossible, as above.
- **Silently ignoring baselined violations.** Rejected: it violates the project's standing doctrine
  that silence is a result too. Baselined findings are reported as `info` and counted.

## Consequences

- A stateful file enters the workflow, and it must be committed.
- The fingerprint scheme becomes a hard compatibility promise. It is already versioned
  (`FINGERPRINT_SCHEME`), so a scheme change makes a stale baseline **error** rather than silently
  mismatching every entry.
- A moved or renamed file changes its canonical id and therefore its fingerprint, producing stale
  entries. `stale-baseline` makes that visible instead of leaving dead entries to accumulate.
- The baseline file carries its own version field from the first release.
