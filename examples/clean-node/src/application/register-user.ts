import type { Clock, UserRepository } from "@/domain/ports";
import { decideRegistration, type RegistrationOutcome } from "@/domain/registration";

// Try it: uncomment to see `layered/layer-dependencies` fire. A use case depends on the
// PORT, never on the adapter that implements it — otherwise the arrow points outward.
// import { InMemoryUserRepository } from "@/infrastructure/in-memory-user-repository";

export interface RegisterUserDeps {
  users: UserRepository;
  clock: Clock;
  newId(): string;
}

export async function registerUser(
  email: string,
  deps: RegisterUserDeps,
): Promise<RegistrationOutcome> {
  const existing = await deps.users.findByEmail(email);
  const outcome = decideRegistration(email, existing !== null, deps.newId());
  if (outcome.ok) await deps.users.save({ id: outcome.id, email });
  return outcome;
}
