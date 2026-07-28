# 5. Rules report `messageId` + `data`, not sentences

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

`RuleMeta.messages` maps a `messageId` to a `{placeholder}` template. Rules report an id and
a data bag; the engine renders. `ConfiguredRule.message` retargets the wording per instance.

## Forces

Rules built finished sentences inline with template literals. That made wording a property
of the report site, which meant:

- Nothing was translatable, and nothing could be reworded without editing the rule.
- Machine consumers had to parse English to recover the layer names, slice names, or
  specifier a finding was about.
- Two built-in rules — `forbidden-dependencies` and `require-tag` — had independently grown
  their own `message?` **option**, solving the same problem twice, per-rule, for the two
  rules whose authors happened to want it. That is the framework being asked for a feature.

## Alternatives

**Keep per-rule `message?` options and add them to the remaining rules.** Multiplies one
concern across every rule that will ever be written, and still leaves `data` unavailable.

**Full i18n with a catalogue.** Premature. The seam is what matters now; a catalogue can sit
behind `meta.messages` later without changing a single rule.

## Consequences

- `RequireTagOptions.message` is gone, replaced by the instance-level setting.
- `ForbiddenDependencyEntry.message` stays: it varies per *entry* within one rule instance,
  which instance-level templating cannot express.
- An unknown placeholder renders verbatim (`{vlaue}`) rather than blank, so a typo is
  visible rather than silently producing an empty phrase.
- A reported `messageId` with no template is an `invalid-config` diagnostic — a rule bug,
  surfaced rather than swallowed.
