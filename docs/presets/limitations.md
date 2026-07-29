# What ArchWall cannot check

ArchWall reads the import graph. That makes it exact about which module may reach which,
and silent about everything else. This page is the honest inventory — read it before
trusting a preset to protect something it cannot see.

## `import type` is erased

TypeScript's `import type` produces no runtime import, so it never appears in the graph.
Neither do inline type imports (`import { type Foo }`) once the type specifiers are
stripped.

```ts
// domain/repository.ts
import type { PrismaClient } from "@prisma/client";   // ← invisible to ArchWall
```

A `pure: ["domain"]` layer will **not** flag that line.

This matters most for exactly the architectures where it hurts: in Clean and Hexagonal,
ports are interfaces, so the dependencies you most want to police are often type-only. The
mitigation is a convention, not a rule — keep third-party types out of your core by
declaring your own interfaces there, which is what those architectures ask for anyway.

The upside of the same behaviour: infrastructure importing a domain interface with
`import type` creates no edge, so it can never be a false positive.

## Direction is not inversion

ArchWall confirms that `infrastructure → domain` points inward. It cannot confirm that
the domain depends on an *abstraction* rather than on a concrete class, because the
substitution happens at runtime in a DI container, a factory, or a composition root.

An architecture can satisfy every ArchWall rule and still be procedurally coupled. What
you get is the necessary condition, checked continuously — not the sufficient one.

## Runtime and dynamic edges

Invisible to a build-time graph:

- event buses, message queues, service locators
- DI containers resolving by string or symbol token
- `await import(someVariable)` — the specifier is not statically known
- HTTP calls between modules in the same repo
- Module Federation boundaries in micro-frontends

Note that a dynamic import with a *literal* specifier **is** captured, and is treated as
cycle-breaking (a legitimate way to resolve a circular dependency).

## Code shape

Nothing about the inside of a file is visible:

- **DDD aggregate boundaries** — "reference other aggregates by ID, never by object
  reference" produces an identical import either way
- whether a class is an entity, a value object, or a use case
- whether an interface is a genuine abstraction or a leaky one
- function length, complexity, layering *within* a file

## Naming and meaning

A preset can require that a folder exist and that its dependencies behave. It cannot tell
`billing` from `utils2`. Screaming Architecture is a naming discipline; the closest
enforcement is enumerating the folders you accept and rejecting the rest with `strict`.

## Package-manager and project graphs

ArchWall's graph is a **file** graph. It does not read `package.json` workspaces,
`project.json`, or `tsconfig` project references as first-class structure, which is why
Nx-style tag boundaries are not a preset in v1 — there is no *project* node for a tag to
attach to.

What does exist is per-module provenance: a module carries `kind: "workspace"` and the
owning package's name when it belongs to a sibling workspace package, so cross-package
imports are visible to `forbidden-dependencies` and `friend-modules` today. A first-class
project graph derived from that is a planned addition, not a redesign.

## Host-dependent details

Different hosts see different things, and ArchWall reports what it can rather than
pretending:

- **Import locations** — Rspack's JS binding does not expose them, so violations from an
  Rspack build have no line numbers. Rules needing them are skipped **loudly**, as a
  `rule-skipped` diagnostic in the run result, never dropped silently.
- **Dev mode is progressive.** In Vite dev the graph holds only what has been requested so
  far, so absence of a module is not evidence; rules needing a complete graph do not run.
  A build is the source of truth.
- **Third-party internals vary.** How much of a bundled package's internals appear in the
  graph differs by bundler. `no-cycles` therefore ignores cycles that lie entirely inside
  dependencies — they are not yours to fix, and reporting them would make results
  bundler-dependent.

## Silence is a result too

Every rule ignores modules it cannot classify. That is what keeps ArchWall quiet about
`node_modules` and stray files — and it means a misconfigured `sourceRoot` produces a green run
rather than an error, because nothing was tagged, so nothing matched.

ArchWall therefore audits its own coverage and emits a diagnostic when a run cannot have
found anything:

- `no-modules-classified` — source files were analysed, but not one carried a tag
- `empty-project` — no source modules survived the project boundary at all
- `empty-scope` — one rule's `scope` narrowed the graph to zero modules, so that rule could
  not have reported anything. Names the rule instance, so a typo in `scope.include` is a line
  of output rather than a green run

None is a violation, and none fails your build by default. All mean the same thing: the clean
result you just got is not evidence of a clean codebase. Use `strict` (or `require-tag`
directly) when you want unclassified files inside a known tree to be hard errors, and
`failOnDiagnostics` when you want any of these to fail CI:

```ts
export default defineConfig({
  failOnDiagnostics: { emptyScope: true, emptyAnalysis: true },
});
```

## What this adds up to

Static dependency analysis proves a small number of things completely, which is worth far
more than proving many things approximately. The presets are built to promise exactly that
much: [`fsd`](./fsd.md) and [`modules`](./modules.md) map almost entirely onto enforceable
constraints; [`layered`](./layered.md) enforces its direction and purity rules exactly, and
leaves the inversion argument to your design review.
