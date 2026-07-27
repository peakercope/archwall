import { check } from "@archwall/cli";

/**
 * Against a published ArchWall this file would not exist — you would run `archwall
 * check`. Inside this monorepo the packages are consumed as raw TypeScript, so the
 * example uses the documented programmatic entry point instead.
 */
const { failed, summary } = await check({ cwd: import.meta.dirname });
console.log(summary);
process.exitCode = failed ? 1 : 0;
