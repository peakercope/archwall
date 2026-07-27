/**
 * Extracts the package name from a resolved path inside node_modules
 * ("/app/node_modules/@scope/pkg/dist/x.js" → "@scope/pkg"). Returns undefined when
 * the path is not inside node_modules. Shared by every graph producer that has to
 * label external modules.
 */
export function packageNameFromPath(resolvedPath: string): string | undefined {
  const normalized = resolvedPath.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("node_modules/");
  if (idx === -1) return undefined;
  const rest = normalized.slice(idx + "node_modules/".length).split("/");
  return rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}
