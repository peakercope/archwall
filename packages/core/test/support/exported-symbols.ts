import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * The export specifiers of a barrel file, split by what survives compilation.
 *
 * Types are erased, so a runtime namespace cannot report them — no amount of `Object.keys`
 * will ever see `ModuleNode`. The barrel source is the only artifact that still knows, and it
 * is also the artifact a reviewer reads, which is the point: the frozen list is checked
 * against the file people edit rather than against a build output that would have to exist
 * first.
 */
export interface BarrelSurface {
  /** Names that exist at runtime: classes, functions, consts, enums. */
  values: string[];
  /** Names erased at compile time: interfaces, type aliases, `export type` specifiers. */
  types: string[];
  /** Module specifiers of bare `export * from "…"`, which name no symbols of their own. */
  starReexports: string[];
  /**
   * Every module specifier this barrel re-exports from, star or named. Prose mentioning a
   * package is not a re-export of it, so questions like "does this leak `/internal`?" have to
   * be asked of the declarations rather than of the file's text.
   */
  sources: string[];
}

/**
 * Classifies every export of one barrel file.
 *
 * Parsed, not regex-matched: `export type { A }` and `export { type A }` are the same
 * declaration and must classify identically, and a regex that got that right would still miss
 * `export { A as B }`.
 *
 * Deliberately syntactic — no `ts.Program`, no type checker, no tsconfig — so it runs under a
 * plain `vitest run` on a cold checkout with nothing built. The consequence is that a
 * re-export is classified by how the barrel DECLARES it, not by what the source module
 * actually declares. That is not a gap, it is the check: a value re-exported as `export type`
 * is exactly the bug being hunted, and comparing this against the runtime namespace is what
 * surfaces it.
 */
export function readBarrelSurface(file: string): BarrelSurface {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const values: string[] = [];
  const types: string[] = [];
  const starReexports: string[] = [];
  const sources: string[] = [];

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const from = statement.moduleSpecifier;
      if (from !== undefined && ts.isStringLiteral(from)) sources.push(from.text);
      if (statement.exportClause === undefined) {
        // `export * from "…"` names nothing; the caller decides what that means.
        const specifier = statement.moduleSpecifier;
        if (specifier !== undefined && ts.isStringLiteral(specifier)) {
          starReexports.push(specifier.text);
        }
        continue;
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        // `export * as ns from "…"` is one value binding named `ns`.
        values.push(statement.exportClause.name.text);
        continue;
      }
      for (const element of statement.exportClause.elements) {
        // `export type { A }` marks the declaration; `export { type A }` marks the element.
        const target = statement.isTypeOnly || element.isTypeOnly ? types : values;
        target.push(element.name.text);
      }
      continue;
    }

    const isExported =
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
    if (!isExported) continue;

    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      types.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) values.push(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      values.push(statement.name.text);
    }
  }

  return { values: values.toSorted(), types: types.toSorted(), starReexports, sources };
}

/**
 * The two-sided difference between a frozen list and what the code now exports, naming every
 * symbol rather than dumping both lists and leaving the reader to diff them.
 *
 * Same shape as `assertGraphsMatch` in @archwall/integration-kit: collect problems, throw
 * once with all of them, so one run tells you everything that moved.
 */
export function diffSymbols(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): string[] {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return [
    ...actual
      .filter((n) => !expectedSet.has(n))
      .toSorted()
      .map((n) => `${label}: + ${n} (added, not in the frozen list)`),
    ...expected
      .filter((n) => !actualSet.has(n))
      .toSorted()
      .map((n) => `${label}: - ${n} (removed, still in the frozen list)`),
  ];
}
