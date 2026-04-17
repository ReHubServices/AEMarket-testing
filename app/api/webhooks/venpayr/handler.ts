import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import {
  isPaymentConfirmed,
  isWebhookVerificationConfigured,
  parseWebhookPayload,
  verifyWebhookSignature
} from "@/lib/payment-provider";
import { confirmPaymentAndReservePurchase, fulfillOrder } from "@/lib/order-flow";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";

export async function handleVenpayrWebhook(request: NextRequest, limiterKey: string) {
  const limiter = checkRateLimit({
    key: createRateKey(request, limiterKey),
    maxRequests: 300,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  if (!isWebhookVerificationConfigured()) {
    return fail("Webhook secret is not configured", 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-venpayr-signature");
  if (!verifyWebhookSignature(rawBody, signature)) {
    return fail("Invalid signature", 401);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return fail("Invalid payload", 400);
  }

  const payment = parseWebhookPayload(parsedBody);
  if (!payment) {
    return fail("Unsupported webhook payload", 400);
  }

  if (!isPaymentConfirmed(payment.status)) {
    return ok({ received: true, ignored: true });
  }

  try {
    const reservation = await confirmPaymentAndReservePurchase({
      transactionId: payment.transactionId,
      providerPaymentId: payment.providerPaymentId,
      amount: payment.amount,
      currency: payment.currency
    });

    if (!reservation) {
      return ok({ received: true, state: "awaiting_balance_or_finalized" });
    }

    if (reservation.kind === "topup") {
      return ok({ received: true, wallet: true, userId: reservation.userId });
    }

    await fulfillOrder(reservation.orderId);
    return ok({ received: true, orderId: reservation.orderId, status: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    return fail(message, 500);
  }
}
