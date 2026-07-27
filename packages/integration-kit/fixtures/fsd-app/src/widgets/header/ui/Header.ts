import { authStore } from "@/features/auth"; // ok: barrel import, downward layer
import { format } from "@/shared/lib/format";
export const header = format(String(Boolean(authStore)));
