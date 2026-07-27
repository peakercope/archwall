import { invoiceFor } from "@/modules/billing";
// VIOLATION: public-api (the app shell must also go through a module's public API)
import { currentUser } from "@/modules/identity/model/user";
import { report } from "@/modules/reporting";

export const app = [invoiceFor(500), report(), currentUser.name];
