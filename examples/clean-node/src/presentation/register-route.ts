import { type RegisterUserDeps, registerUser } from "@/application/register-user";

export interface HttpResponse {
  status: number;
  body: unknown;
}

/** Presentation translates transport concerns into a use-case call, and back. */
export async function registerRoute(
  body: { email?: unknown },
  deps: RegisterUserDeps,
): Promise<HttpResponse> {
  if (typeof body.email !== "string") return { status: 400, body: { error: "email-required" } };
  const outcome = await registerUser(body.email, deps);
  return outcome.ok
    ? { status: 201, body: { id: outcome.id } }
    : { status: 422, body: { error: outcome.reason } };
}
