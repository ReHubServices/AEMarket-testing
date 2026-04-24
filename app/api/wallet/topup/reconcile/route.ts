import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { confirmPaymentAndReservePurchase } from "@/lib/order-flow";
import { verifyCheckoutPayment } from "@/lib/payment-provider";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { readStore } from "@/lib/store";
import { validateMutationRequest } from "@/lib/request-security";
import { getViewerFromRequest } from "@/lib/viewer";

export const runtime = "nodejs";

function collectReferences(input: Array<string | null | undefined>) {
  const references: string[] = [];
  for (const raw of input) {
    const value = String(raw ?? "").trim();
    if (!value) {
      continue;
    }
    if (!references.includes(value)) {
      references.push(value);
    }
  }
  return references;
}

async function verifyUsingReferences(references: string[]) {
  let pending: Awaited<ReturnType<typeof verifyCheckoutPayment>> | null = null;
  let pendingReference = "";
  let lastError: unknown = null;

  for (const reference of references) {
    try {
      const verification = await verifyCheckoutPayment(reference);
      if (verification.confirmed) {
        return { verification, reference };
      }
      if (!pending) {
        pending = verification;
        pendingReference = reference;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (pending) {
    return { verification: pending, reference: pendingReference };
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error("Payment reference is required");
}

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { allowMissingOrigin: false });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "wallet_topup_reconcile"),
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

  const store = await readStore();
  const pendingTransactions = store.transactions
    .filter(
      (tx) =>
        tx.userId === viewer.id &&
        tx.type === "payment_credit" &&
        tx.status === "pending" &&
        tx.orderId == null &&
        Boolean(tx.providerPaymentId || tx.providerAltPaymentId)
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  let credited = 0;
  let checked = 0;

  for (const tx of pendingTransactions) {
    const references = collectReferences([tx.providerPaymentId, tx.providerAltPaymentId]);
    if (references.length === 0) {
      continue;
    }
    checked += 1;
    try {
      const { verification, reference } = await verifyUsingReferences(references);
      if (!verification.confirmed) {
        continue;
      }
      const reservation = await confirmPaymentAndReservePurchase({
        transactionId: tx.id,
        providerPaymentId: reference,
        amount: verification.amount > 0 ? verification.amount : tx.amount,
        currency: verification.currency || tx.currency
      });
      if (reservation && reservation.kind === "topup") {
        credited += 1;
      }
    } catch {
      continue;
    }
  }

  const refreshed = await readStore();
  const user = refreshed.users.find((item) => item.id === viewer.id);
  return ok({
    checked,
    credited,
    balance: user?.balance ?? viewer.balance
  });
}
