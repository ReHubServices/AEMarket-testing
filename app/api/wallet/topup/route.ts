import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { attachCheckoutToTransaction, createTopUpTransaction } from "@/lib/order-flow";
import { createCheckoutSession, isPaymentProviderConfigured } from "@/lib/payment-provider";
import { getViewerFromRequest } from "@/lib/viewer";
import { updateStore } from "@/lib/store";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";

export const runtime = "nodejs";

function extractApiStatusCode(message: string) {
  const prefixed = message.match(/VENPAYR_API_ERROR:\s*(\d{3})/i)?.[1];
  if (prefixed) {
    return prefixed;
  }
  const paren = message.match(/\((\d{3})\)/)?.[1];
  if (paren) {
    return paren;
  }
  return "000";
}

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "wallet_topup"),
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
  if (!isPaymentProviderConfigured()) {
    return fail("Payment provider is not configured", 503);
  }

  try {
    const body = (await request.json()) as { amount?: number; currency?: string };
    const amount = Number(body.amount);
    const currency = typeof body.currency === "string" ? body.currency : "USD";

    const pending = await createTopUpTransaction({
      userId: viewer.id,
      amount,
      currency
    });

    try {
      const checkout = await createCheckoutSession({
        amount: pending.transaction.amount,
        currency: pending.transaction.currency,
        orderId: `wallet_${pending.transaction.id}`,
        transactionId: pending.transaction.id,
        username: viewer.username,
        customerEmail: viewer.email,
        itemName: "Wallet Top-up",
        returnUrl: `${request.nextUrl.origin}/dashboard?wallet=1`,
        webhookUrl: `${request.nextUrl.origin}/api/webhooks/venpayr`
      });

      await attachCheckoutToTransaction({
        transactionId: pending.transaction.id,
        providerPaymentId: checkout.providerPaymentId,
        providerAltPaymentId: checkout.providerAltPaymentId,
        checkoutUrl: checkout.checkoutUrl
      });

      return ok({
        transactionId: pending.transaction.id,
        amount: pending.transaction.amount,
        currency: pending.transaction.currency,
        checkoutUrl: checkout.checkoutUrl
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment initialization failed";
      console.error(`Wallet checkout initialization failed for user ${viewer.id}: ${message}`);
      await updateStore((store) => {
        const transaction = store.transactions.find(
          (tx) => tx.id === pending.transaction.id
        );
        if (transaction) {
          transaction.status = "failed";
          transaction.details = message;
          transaction.updatedAt = new Date().toISOString();
        }
      });
      if (message.includes("VENPAYR_NOT_CONFIGURED")) {
        return fail("Payment provider is not configured", 503);
      }
      if (message.includes("VENPAYR_NETWORK_ERROR")) {
        return fail("Payment provider network error. Check base URL and deployment connectivity.", 502);
      }
      if (message.includes("VENPAYR_API_ERROR:")) {
        const code = extractApiStatusCode(message);
        return fail(`Payment API error (P${code})`, 502);
      }
      if (message.toLowerCase().includes("payment") || message.toLowerCase().includes("checkout")) {
        return fail("Payment API error (P000)", 502);
      }
      return fail("Unable to initialize wallet checkout", 502);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Top-up failed";
    if (message.includes("between 3 and 10,000")) {
      return fail(message, 400);
    }
    return fail("Top-up failed", 400);
  }
}
