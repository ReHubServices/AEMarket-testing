import { NextRequest } from "next/server";
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";
import { fail, ok } from "@/lib/http";
import { loginUser, toPublicViewer } from "@/lib/auth";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const ipLimiter = checkRateLimit({
    key: createRateKey(request, "auth_login_ip"),
    maxRequests: 20,
    windowMs: 60_000
  });
  if (!ipLimiter.allowed) {
    return fail(`Too many requests. Retry in ${ipLimiter.retryAfterSeconds}s`, 429);
  }

  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
      adminOnly?: boolean;
    };

    if (!body.username || !body.password) {
      return fail("Username and password are required", 400);
    }

    const accountLimiter = checkRateLimit({
      key: createRateKey(request, "auth_login_account", body.username.toLowerCase().trim()),
      maxRequests: 8,
      windowMs: 5 * 60_000
    });
    if (!accountLimiter.allowed) {
      return fail(`Too many login attempts. Retry in ${accountLimiter.retryAfterSeconds}s`, 429);
    }

    const user = await loginUser({
      username: body.username,
      password: body.password,
      adminOnly: Boolean(body.adminOnly)
    });

    if (!user) {
      return fail("Invalid credentials", 401);
    }

    const token = createSessionToken(user.id, user.isAdmin ? "admin" : "user");
    const response = ok({ user: toPublicViewer(user) });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    return response;
  } catch {
    return fail("Login failed", 500);
  }
}
