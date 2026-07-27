// A BARREL. Every producer must resolve an import of "@/shared" through this file to
// `util.ts` — the case that motivates analysing the compiled graph rather than source text.
export { util } from "./util";
