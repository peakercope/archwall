import { authStore } from "@/features/auth/model/store"; // VIOLATIONS: feature-isolation + public-api (deep cross-slice import of an internal module)
export const addToCart = () => authStore;
