export interface User {
  readonly id: string;
  readonly email: string;
}

/** A domain invariant: pure logic, no I/O, no libraries. */
export function isRegisterable(email: string): boolean {
  return email.includes("@") && email.length <= 254;
}
