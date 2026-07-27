import type { Clock } from "@/domain/ports";

/** Infrastructure may use whatever it likes — that is the point of pushing I/O outward. */
export const systemClock: Clock = { now: () => new Date() };

export const newId = (): string => `u_${Math.random().toString(36).slice(2, 10)}`;
