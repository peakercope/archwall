# 4. Violations carry a list of locations

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

`Violation.locations` is a required array of tagged unions — `edge`, `module`, or `path` —
replacing the optional `edge?` / `module?` pair.

## Forces

A violation could name one place, and only if that place was an edge or a module.

The rule that exposed it is `no-cycles`. A cycle has no single offending location; it has N
of them. The old model forced it to anchor on `comp[0]`, put the real answer in a
non-rendered `identity` field, and serialise the members into the message string as
`a → b → c → …`. The most valuable finding the tool produces was the one it could least
express, and a consumer wanting the member list had to parse English out of a sentence.

The same shape blocks three things on the roadmap: a baseline file keyed on identity, IDE
integration that highlights every participant in a cycle, and SARIF results with more than
one `physicalLocation` — which SARIF has always supported.

## Alternatives

**Add `modules?: ModuleId[]` alongside the existing fields.** A third optional field with
overlapping meaning, and every consumer would need to know which of the three to read first.

**Leave it and let `no-cycles` be special.** It is not special — "these files together
violate a constraint" describes deprecation cohorts, layer-crossing bundles, and package
boundary findings too.

## Consequences

- `primaryEdge`, `primaryModule`, and `primarySourceLocation` exist for the common
  single-location case, so ordinary consumers do not think about arrays.
- The console reporter lists every member of a multi-location finding; SARIF emits every
  location that has a source position.
- Fingerprints are derived from all locations, so the scheme version moved to `aw2`.
- `messageId` and `data` landed in the same change: a location list is only half of "stop
  making consumers parse the message".
