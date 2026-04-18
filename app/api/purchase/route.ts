import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { createOrderFromBalance, fulfillOrder } from "@/lib/order-flow";
import { getViewerFromRequest } from "@/lib/viewer";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "purchase"),
    maxRequests: 20,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const viewer = await getViewerFromRequest(request);
  if (!viewer) {
    return fail("Authentication required", 401);
  }

  try {
    const body = (await request.json()) as { listingId?: string };
    const listingId = body.listingId?.trim();

    if (!listingId) {
      return fail("Listing ID is required", 400);
    }

    const reserved = await createOrderFromBalance({
      userId: viewer.id,
      listingId
    });

    try {
      await fulfillOrder(reserved.order.id);

      return ok({
        orderId: reserved.order.id,
        transactionId: reserved.transaction.id,
        amount: reserved.order.finalPrice,
        currency: reserved.order.currency,
        status: "completed"
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "B99";
      if (code === "B03") {
        return fail("Listing is temporarily unavailable. Refresh and try another listing.", 409);
      }
      if (code === "B00" || code === "B99") {
        return fail(`Something Failed, Contact Support and Give them this error code: ${code}`, 502);
      }
      return fail("Unable to complete purchase", 502);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purchase initialization failed";
    if (message === "INSUFFICIENT_BALANCE") {
      return fail("Insufficient balance. Add funds to continue.", 400);
    }
    if (message === "Listing not found") {
      return fail("Listing not found", 404);
    }
    return fail("Purchase failed", 400);
  }
}
