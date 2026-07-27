import { isRegisterable } from "@/domain/user";

// Try it: uncomment to see `layered/purity-domain` fire. The domain layer owns your
// rules, not your libraries — a Node built-in is as much an outside dependency as npm.
// import { randomUUID } from "node:crypto";

export type RegistrationOutcome = { ok: true; id: string } | { ok: false; reason: string };

export function decideRegistration(
  email: string,
  existing: boolean,
  id: string,
): RegistrationOutcome {
  if (!isRegisterable(email)) return { ok: false, reason: "invalid-email" };
  if (existing) return { ok: false, reason: "already-registered" };
  return { ok: true, id };
}
