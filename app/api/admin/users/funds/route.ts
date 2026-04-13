import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { normalizeMoney } from "@/lib/pricing";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";
import { updateStore } from "@/lib/store";
import { getViewerFromRequest } from "@/lib/viewer";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "admin_users_funds"),
    maxRequests: 40,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const viewer = await getViewerFromRequest(request);
  if (!viewer || !viewer.isAdmin) {
    return fail("Unauthorized", 401);
  }

  try {
    const body = (await request.json()) as { userId?: string; amount?: number };
    const userId = body.userId?.trim();
    const amount = Number(body.amount);

    if (!userId) {
      return fail("User ID is required", 400);
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      return fail("Amount must be between 0.01 and 1,000,000", 400);
    }

    const rounded = normalizeMoney(amount);

    const result = await updateStore((store) => {
      const user = store.users.find((item) => item.id === userId);
      if (!user) {
        throw new Error("User not found");
      }
      user.balance = normalizeMoney(user.balance + rounded);
      return {
        userId: user.id,
        username: user.username,
        balance: user.balance,
        added: rounded
      };
    });

    return ok(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add funds";
    return fail(message, 400);
  }
}
