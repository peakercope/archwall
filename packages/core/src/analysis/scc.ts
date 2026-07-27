import { defineGraphComputation } from "../contracts/analysis.js";
import type { ModuleId } from "../graph/ir.js";

/**
 * Strongly connected components over static+reexport edges (a dynamic import is a
 * legal cycle-breaker). Iterative Tarjan — recursion would overflow at 10k+ modules.
 * Every module appears in exactly one component.
 */
export const stronglyConnectedComponents = defineGraphComputation<readonly (readonly ModuleId[])[]>(
  {
    name: "scc",
    compute(q) {
      const index = new Map<ModuleId, number>();
      const low = new Map<ModuleId, number>();
      const onStack = new Set<ModuleId>();
      const stack: ModuleId[] = [];
      const out: (readonly ModuleId[])[] = [];
      let counter = 0;
      const neighbors = (v: ModuleId): ModuleId[] =>
        q
          .edgesOutOf(v)
          .filter((e) => e.kind !== "dynamic" && q.has(e.to))
          .map((e) => e.to);
      for (const root of q.moduleIds()) {
        if (index.has(root)) continue;
        const work: [ModuleId, number, ModuleId[]][] = [[root, 0, neighbors(root)]];
        while (work.length > 0) {
          const frame = work[work.length - 1]!;
          const [v, i, ns] = frame;
          if (i === 0) {
            index.set(v, counter);
            low.set(v, counter);
            counter++;
            stack.push(v);
            onStack.add(v);
          }
          if (i < ns.length) {
            frame[1] = i + 1;
            const w = ns[i]!;
            if (!index.has(w)) work.push([w, 0, neighbors(w)]);
            else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
          } else {
            if (low.get(v) === index.get(v)) {
              const comp: ModuleId[] = [];
              for (;;) {
                const w = stack.pop()!;
                onStack.delete(w);
                comp.push(w);
                if (w === v) break;
              }
              out.push(comp);
            }
            work.pop();
            const parent = work[work.length - 1];
            if (parent) low.set(parent[0], Math.min(low.get(parent[0])!, low.get(v)!));
          }
        }
      }
      return out;
    },
  },
);
