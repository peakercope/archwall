import { registerUser } from "@/application/register-user";

export const handle = (email: string): boolean => registerUser({ id: "1", email });
