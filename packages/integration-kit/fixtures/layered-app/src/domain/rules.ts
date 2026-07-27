// VIOLATION: purity-domain (the domain must not depend on a third-party package —
// here the UI framework, which the innermost layer has no business knowing about)
import { version } from "react";
import { isValidEmail } from "@/domain/user";

export const canRegister = (email: string): boolean => isValidEmail(email) && version.length > 0;
