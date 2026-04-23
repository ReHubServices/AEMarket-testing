import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { confirmPaymentAndReservePurchase } from "@/lib/order-flow";
import { verifyCheckoutPayment } from "@/lib/payment-provider";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";
import { readStore } from "@/lib/store";
import { getViewerFromRequest } from "@/lib/viewer";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "wallet_topup_verify"),
    maxRequests: 50,
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
    const body = (await request.json()) as {
      payRef?: string;
      transactionId?: string;
    };
    const payRef = String(body.payRef ?? "").trim();
    const providedTransactionId = String(body.transactionId ?? "").trim() || null;

    if (!payRef) {
      return fail("Payment reference is required", 400);
    }

    const verification = await verifyCheckoutPayment(payRef);
    if (!verification.confirmed) {
      return fail("Payment not completed yet", 409);
    }

    let amount = verification.amount;
    let currency = verification.currency;
    if (!(amount > 0) || !currency) {
      const store = await readStore();
      const fallbackTransaction = store.transactions.find((tx) => {
        if (verification.transactionId && tx.id === verification.transactionId) {
          return true;
        }
        if (providedTransactionId && tx.id === providedTransactionId) {
          return true;
        }
        return (
          tx.providerPaymentId === verification.providerPaymentId ||
          tx.providerAltPaymentId === verification.providerPaymentId
        );
      });
      if (fallbackTransaction) {
        amount = fallbackTransaction.amount;
        currency = fallbackTransaction.currency;
      }
    }

    const reservation = await confirmPaymentAndReservePurchase({
      transactionId: verification.transactionId ?? providedTransactionId,
      providerPaymentId: verification.providerPaymentId,
      amount,
      currency
    });

    if (!reservation) {
      const store = await readStore();
      const user = store.users.find((item) => item.id === viewer.id);
      return ok({
        status: "already_processed",
        balance: user?.balance ?? viewer.balance
      });
    }

    if (reservation.userId !== viewer.id) {
      return fail("Payment reference does not belong to current user", 403);
    }

    if (reservation.kind !== "topup") {
      return fail("Unsupported payment type", 400);
    }

    const store = await readStore();
    const user = store.users.find((item) => item.id === viewer.id);
    return ok({
      status: "credited",
      balance: user?.balance ?? viewer.balance
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet verification failed";
    if (message.includes("VENPAYR_NOT_CONFIGURED")) {
      return fail("Payment provider is not configured", 503);
    }
    if (message.includes("VENPAYR_NETWORK_ERROR")) {
      return fail("Payment provider network error", 502);
    }
    if (message.includes("VENPAYR_API_ERROR")) {
      return fail("Payment verification failed", 502);
    }
    if (message.includes("Transaction not found")) {
      return fail("Transaction was not found for this payment", 404);
    }
    if (message.includes("Payment amount is lower")) {
      return fail("Payment amount mismatch", 409);
    }
    if (message.includes("Payment currency mismatch")) {
      return fail("Payment currency mismatch", 409);
    }
    return fail("Wallet verification failed", 400);
  }
}
