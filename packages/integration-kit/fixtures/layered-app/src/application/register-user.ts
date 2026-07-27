import { canRegister } from "@/domain/rules";
import type { User } from "@/domain/user";

export const registerUser = (user: User): boolean => canRegister(user.email);
