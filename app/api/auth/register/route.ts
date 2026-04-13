import { NextRequest } from "next/server";
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";
import { fail, ok } from "@/lib/http";
import { registerUser } from "@/lib/auth";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "auth_register"),
    maxRequests: 6,
    windowMs: 10 * 60_000
  });
  if (!limiter.allowed) {
    return fail(`Too many registrations. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };

    if (!body.username || !body.password) {
      return fail("Username and password are required", 400);
    }

    const user = await registerUser({
      username: body.username,
      password: body.password
    });

    const token = createSessionToken(user.id, "user");
    const response = ok({ user });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    return fail(message, 400);
  }
}
