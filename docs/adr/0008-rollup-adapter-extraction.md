# 8. Rollup is its own adapter package

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

`@archwall/rollup` holds the adapter for every Rollup-shaped host. `@archwall/vite` depends
on it and adds only dev mode.

## Forces

The Vite adapter's build path used `resolveId`, `buildEnd`, `getModuleIds`, `getModuleInfo`,
`error`, and `warn` — all Rollup, none Vite. The Vite-specific code was exactly
`configResolved`, `configureServer`, and the dev-mode traversal of `server.moduleGraph`.

So the Rollup adapter already existed; it was filed under someone else's name. Rollup users
could not install it, Rolldown users could not reuse it, and no test ever ran it against a
plain Rollup build.

This is the same coupling `@archwall/bundler-plugin` was created to undo for Rspack and
webpack — left standing one package over.

## Consequences

- A Rollup build is now a first-class host with its own conformance test against the shared
  fixture.
- Running the adapter under real Rollup immediately exposed a latent over-claim: `resolveId`
  is a **first-wins** hook, so an adapter ordered after the resolvers never observes what the
  author wrote — yet `raw-specifiers` was claimed unconditionally. Under Vite 8 the same is
  true for aliases, which the README already documented as a limitation while the code
  claimed otherwise.

  The capability is now claimed **from evidence** (did we actually capture any specifiers?)
  rather than from intent. Place the plugin first and specifier rules run; place it late and
  they skip loudly. That is the behaviour the capability system exists to produce, and it
  was only discovered by giving the adapter a host of its own.
