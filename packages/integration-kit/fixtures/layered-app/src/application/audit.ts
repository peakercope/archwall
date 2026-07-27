// VIOLATION: layer-dependencies (application must not reach up into infrastructure)
import { saveUser } from "@/infrastructure/user-repository";

export const audit = (email: string): Promise<void> => saveUser({ id: email, email });
