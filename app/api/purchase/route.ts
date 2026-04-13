import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { createPendingOrder, attachCheckoutToTransaction } from "@/lib/order-flow";
import { createCheckoutSession } from "@/lib/payment-provider";
import { getViewerFromRequest } from "@/lib/viewer";
import { updateStore } from "@/lib/store";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

    const pending = await createPendingOrder({
      userId: viewer.id,
      listingId
    });

    try {
      const checkout = await createCheckoutSession({
        amount: pending.order.finalPrice,
        currency: pending.order.currency,
        orderId: pending.order.id,
        transactionId: pending.transaction.id,
        username: viewer.username,
        returnUrl: `${request.nextUrl.origin}/dashboard?order=${pending.order.id}`,
        webhookUrl: `${request.nextUrl.origin}/api/webhooks/card-setup`
      });

      await attachCheckoutToTransaction({
        transactionId: pending.transaction.id,
        providerPaymentId: checkout.providerPaymentId,
        checkoutUrl: checkout.checkoutUrl
      });

      return ok({
        orderId: pending.order.id,
        transactionId: pending.transaction.id,
        amount: pending.order.finalPrice,
        currency: pending.order.currency,
        checkoutUrl: checkout.checkoutUrl
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Payment initialization failed";
      await updateStore((store) => {
        const transaction = store.transactions.find(
          (tx) => tx.id === pending.transaction.id
        );
        if (transaction) {
          transaction.status = "failed";
          transaction.details = message;
          transaction.updatedAt = new Date().toISOString();
        }
        const order = store.orders.find((item) => item.id === pending.order.id);
        if (order) {
          order.status = "failed";
          order.failureReason = message;
          order.updatedAt = new Date().toISOString();
        }
      });
      if (message.toLowerCase().includes("payment endpoint missing")) {
        return fail("Payment provider is not configured", 503);
      }
      return fail(message, 502);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purchase initialization failed";
    return fail(message, 400);
  }
}
