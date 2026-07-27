import type { User } from "@/domain/user";

// Infrastructure may depend on the domain (inward), and on third-party packages.
export const saveUser = async (user: User): Promise<void> => {
  void user;
};
