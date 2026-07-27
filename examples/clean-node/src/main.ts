import { InMemoryUserRepository } from "@/infrastructure/in-memory-user-repository";
import { newId, systemClock } from "@/infrastructure/system-clock";
import { registerRoute } from "@/presentation/register-route";

/**
 * The composition root. This is the one place allowed to know every layer at once — it
 * exists to wire concrete adapters into the ports the use cases declare.
 *
 * It sits OUTSIDE the four layer directories, so the `layered` preset leaves it
 * unclassified and no dependency rule applies to it. That is deliberate: a composition
 * root that could not reach across layers could not compose anything.
 */
const deps = { users: new InMemoryUserRepository(), clock: systemClock, newId };

export const handleRegister = (body: { email?: unknown }) => registerRoute(body, deps);

const result = await handleRegister({ email: "ada@example.com" });
console.log(result);
