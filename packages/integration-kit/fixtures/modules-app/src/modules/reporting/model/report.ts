// VIOLATIONS: friend-modules (reporting may not depend on billing) and public-api
// (this reaches past billing's index.ts into its internals).
import { invoiceFor } from "@/modules/billing/model/invoice";

export const report = (): string => invoiceFor(1000);
