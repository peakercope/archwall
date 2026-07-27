import type { UserRepository } from "@/domain/ports";
import type { User } from "@/domain/user";

/** An adapter: implements a domain port. The dependency points inward, which is legal. */
export class InMemoryUserRepository implements UserRepository {
  readonly #byEmail = new Map<string, User>();

  async findByEmail(email: string): Promise<User | null> {
    return this.#byEmail.get(email) ?? null;
  }

  async save(user: User): Promise<void> {
    this.#byEmail.set(user.email, user);
  }
}
