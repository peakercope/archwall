import { audit } from "@/application/audit";
import { saveUser } from "@/infrastructure/user-repository";
import { handle } from "@/presentation/http";

export const app = { handle, audit, saveUser };
