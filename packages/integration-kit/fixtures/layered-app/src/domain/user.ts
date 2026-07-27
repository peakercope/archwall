export interface User {
  id: string;
  email: string;
}

export const isValidEmail = (email: string): boolean => email.includes("@");
