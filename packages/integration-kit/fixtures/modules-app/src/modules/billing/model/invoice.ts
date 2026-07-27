import { currentUser } from "@/modules/identity";
import { formatMoney } from "@/modules/shared";

// billing → identity is declared in the dependency matrix; shared is always allowed.
export const invoiceFor = (cents: number): string => `${currentUser.name}: ${formatMoney(cents)}`;
