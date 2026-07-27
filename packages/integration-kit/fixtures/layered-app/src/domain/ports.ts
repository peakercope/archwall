import type { User } from "@/domain/user";

/**
 * A port: owned by the domain, implemented by infrastructure. ArchWall sees the
 * infrastructure → domain edge (correct direction) but cannot verify that the wiring
 * actually inverts at runtime — see docs/presets/limitations.md.
 */
export interface UserRepository {
  save(user: User): Promise<void>;
}
