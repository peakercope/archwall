import type { User } from "@/domain/user";

/**
 * Ports are owned by the domain and implemented by infrastructure. That is what makes
 * the infrastructure → domain edge point inward.
 *
 * ArchWall verifies the *direction* of that edge. It cannot verify that the inversion
 * actually happens at runtime — the composition root wires the implementation in
 * dynamically. See docs/presets/limitations.md.
 */
export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export interface Clock {
  now(): Date;
}
