/**
 * Base URL for built-in rule documentation.
 *
 * Points at `docs/rules/` on the default branch, which is where the eight pages live. It
 * feeds SARIF's `helpUri` and the console reporter, so it must be an ABSOLUTE url that
 * actually resolves — a dead link in every uploaded SARIF run is worse than no link, which
 * is why {@link docsUrlFor} omits the field entirely rather than emitting a relative path.
 *
 * Pinned to `main` rather than a tag deliberately: pre-1.0, the docs that match the code a
 * user is running are the current ones. Revisit when releases are tagged.
 */
export const DOCS_BASE: string = "https://github.com/peakercope/archwall/blob/main/docs/rules";

/**
 * Spreadable `{ docsUrl }` for a rule's `meta`; empty when {@link DOCS_BASE} is `""`.
 *
 * Spreadable rather than `string | undefined` because `exactOptionalPropertyTypes` draws
 * the distinction this needs: "no documentation URL" must mean the key is ABSENT, not
 * present-and-undefined. A consumer that vendors these rules and has nowhere to publish
 * docs blanks the base and gets no `helpUri` at all, which is the correct degradation.
 */
export function docsUrlFor(ruleName: string): { docsUrl?: string } {
  return DOCS_BASE === "" ? {} : { docsUrl: `${DOCS_BASE}/${ruleName}.md` };
}
