import { createId } from "@/lib/ids";
import { buyFromSupplier, getListingById } from "@/lib/provider";
import { normalizeMoney } from "@/lib/pricing";
import { readStore, updateStore } from "@/lib/store";
import { DeliveryPayload, OrderRecord, TransactionRecord } from "@/lib/types";

type PaymentReservation =
  | {
      kind: "topup";
      userId: string;
      orderId: null;
    }
  | {
      kind: "order";
      userId: string;
      orderId: string;
    };

function normalizeCouponCode(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim().toUpperCase();
}

export async function createOrderFromBalance(input: {
  userId: string;
  listingId: string;
  couponCode?: string | null;
}) {
  const listing = await getListingById(input.listingId);
  if (!listing) {
    throw new Error("Listing not found");
  }

  const now = new Date().toISOString();
  const orderId = createId("ord");
  const transactionId = createId("txn");
  const normalizedCouponCode = normalizeCouponCode(input.couponCode);

  return updateStore((store) => {
    const user = store.users.find((item) => item.id === input.userId);
    if (!user) {
      throw new Error("User not found");
    }
    let couponCode: string | null = null;
    let couponDiscountAmount = 0;
    let finalPrice = listing.price;

    if (normalizedCouponCode) {
      const coupon = store.coupons.find(
        (item) => item.code === normalizedCouponCode && item.isActive
      );
      if (!coupon) {
        throw new Error("INVALID_COUPON");
      }
      if (coupon.expiresAt) {
        const expiresAtMs = Date.parse(coupon.expiresAt);
        if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
          throw new Error("COUPON_EXPIRED");
        }
      }
      if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
        throw new Error("COUPON_LIMIT_REACHED");
      }

      const rawDiscount = normalizeMoney((listing.price * coupon.discountPercent) / 100);
      couponDiscountAmount = Math.min(listing.price, Math.max(0, rawDiscount));
      finalPrice = normalizeMoney(Math.max(0.01, listing.price - couponDiscountAmount));
      couponCode = coupon.code;
      coupon.usedCount += 1;
      coupon.updatedAt = now;
    }

    if (user.balance < finalPrice) {
      throw new Error("INSUFFICIENT_BALANCE");
    }

    user.balance = normalizeMoney(user.balance - finalPrice);

    const order: OrderRecord = {
      id: orderId,
      userId: user.id,
      listingId: listing.id,
      title: listing.title,
      imageUrl: listing.imageUrl,
      game: listing.game,
      category: listing.category,
      basePrice: listing.basePrice,
      finalPrice,
      couponCode,
      couponDiscountAmount: couponDiscountAmount > 0 ? couponDiscountAmount : null,
      currency: listing.currency,
      status: "processing",
      transactionId,
      supplierOrderId: null,
      delivery: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now
    };

    const transaction: TransactionRecord = {
      id: transactionId,
      userId: user.id,
      orderId: order.id,
      type: "purchase_debit",
      status: "completed",
      amount: finalPrice,
      currency: listing.currency,
      providerPaymentId: null,
      checkoutUrl: null,
      details:
        couponCode && couponDiscountAmount > 0
          ? `Balance deducted for account purchase (coupon ${couponCode}, -${couponDiscountAmount.toFixed(2)})`
          : "Balance deducted for account purchase",
      createdAt: now,
      updatedAt: now
    };

    store.orders.push(order);
    store.transactions.push(transaction);
    return { order, transaction, user };
  });
}

export async function attachCheckoutToTransaction(input: {
  transactionId: string;
  providerPaymentId: string;
  providerAltPaymentId?: string | null;
  checkoutUrl: string;
}) {
  await updateStore((store) => {
    const transaction = store.transactions.find((item) => item.id === input.transactionId);
    if (!transaction) {
      throw new Error("Transaction not found");
    }
    transaction.providerPaymentId = input.providerPaymentId;
    transaction.providerAltPaymentId = input.providerAltPaymentId ?? null;
    transaction.checkoutUrl = input.checkoutUrl;
    transaction.updatedAt = new Date().toISOString();
  });
}

export async function createTopUpTransaction(input: {
  userId: string;
  amount: number;
  currency?: string;
}) {
  const amount = normalizeMoney(input.amount);
  if (!Number.isFinite(amount) || amount < 3 || amount > 10000) {
    throw new Error("Top-up amount must be between 3 and 10,000");
  }

  const now = new Date().toISOString();
  const transactionId = createId("txn");
  const currency = (input.currency ?? "USD").toUpperCase();

  return updateStore((store) => {
    const user = store.users.find((item) => item.id === input.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const transaction: TransactionRecord = {
      id: transactionId,
      userId: user.id,
      orderId: null,
      type: "payment_credit",
      status: "pending",
      amount,
      currency,
      providerPaymentId: null,
      checkoutUrl: null,
      details: "Wallet top-up pending payment",
      createdAt: now,
      updatedAt: now
    };

    store.transactions.push(transaction);
    return { transaction, user };
  });
}

function isOrderFinal(status: OrderRecord["status"]) {
  return status === "completed" || status === "failed";
}

function isSupplierFundingFailure(message: string) {
  const text = message.toLowerCase();
  const patterns = [
    "insufficient",
    "not enough",
    "insufficient funds",
    "insufficient balance",
    "balance is too low",
    "low balance",
    "not enough balance",
    "not enough funds",
    "недостаточно средств",
    "не хватает средств",
    "недостаточный баланс",
    "мало средств"
  ];
  return patterns.some((pattern) => text.includes(pattern));
}

function isSupplierPurchaseCooldown(message: string) {
  const text = message.toLowerCase();
  const patterns = [
    "recently purchased this product",
    "please wait before purchasing again",
    "already purchased",
    "already bought",
    "too many purchase attempts",
    "purchase cooldown"
  ];
  return patterns.some((pattern) => text.includes(pattern));
}

function isSupplierListingUnavailable(message: string) {
  const text = message.toLowerCase();
  const patterns = [
    "listing not found",
    "item not found",
    "requested page could not be found",
    "could not be found",
    "not available",
    "unavailable",
    "already sold",
    "sold out",
    "no longer available",
    "cannot be purchased",
    "cant be purchased"
  ];
  return patterns.some((pattern) => text.includes(pattern));
}

function isSupplierRateLimited(message: string) {
  const text = message.toLowerCase();
  const patterns = [
    "too many requests",
    "rate limit",
    "retry later",
    "temporarily unavailable",
    "service unavailable",
    "gateway timeout"
  ];
  return patterns.some((pattern) => text.includes(pattern));
}

function isSupplierProtectedOrUnauthorized(message: string) {
  const text = message.toLowerCase();
  const patterns = [
    "unauthorized",
    "forbidden",
    "cloudflare",
    "_dfjs/b.js",
    "access denied",
    "captcha",
    "bot protection"
  ];
  return patterns.some((pattern) => text.includes(pattern));
}

function mapFulfillmentFailure(error: unknown) {
  const internalMessage = error instanceof Error ? error.message : "Purchase failed";
  if (isSupplierListingUnavailable(internalMessage)) {
    return {
      code: "B01",
      publicMessage: "This listing is no longer available. Please refresh and choose another listing.",
      internalMessage
    };
  }
  if (isSupplierPurchaseCooldown(internalMessage)) {
    return {
      code: "B03",
      publicMessage: "Listing is temporarily unavailable. Refresh and try another listing.",
      internalMessage
    };
  }
  if (isSupplierRateLimited(internalMessage)) {
    return {
      code: "B02",
      publicMessage: "Supplier is busy right now. Please try again in a moment.",
      internalMessage
    };
  }
  if (isSupplierProtectedOrUnauthorized(internalMessage)) {
    return {
      code: "B04",
      publicMessage: "Supplier verification is temporarily blocking purchases. Please try again shortly.",
      internalMessage
    };
  }
  if (isSupplierFundingFailure(internalMessage)) {
    return {
      code: "B00",
      publicMessage: "Unexpected error. Contact support.",
      internalMessage
    };
  }
  return {
    code: "B99",
    publicMessage: "Unexpected error. Contact support.",
    internalMessage
  };
}

export async function confirmPaymentAndReservePurchase(input: {
  transactionId: string | null;
  providerPaymentId: string;
  amount: number;
  currency: string;
}) {
  return updateStore((store): PaymentReservation | null => {
    const isMatchingReference = (transaction: TransactionRecord, reference: string) => {
      const primary = transaction.providerPaymentId?.trim();
      const alternate = transaction.providerAltPaymentId?.trim();
      return Boolean(reference && (primary === reference || alternate === reference));
    };

    const byTransactionId = input.transactionId
      ? store.transactions.find((item) => item.id === input.transactionId)
      : null;
    const byProviderReference = store.transactions.find((item) =>
      isMatchingReference(item, input.providerPaymentId)
    );
    const transaction = byTransactionId ?? byProviderReference;

    if (!transaction) {
      throw new Error("Transaction not found for webhook");
    }

    const hasKnownProviderReference = Boolean(
      transaction.providerPaymentId?.trim() || transaction.providerAltPaymentId?.trim()
    );
    if (hasKnownProviderReference && !isMatchingReference(transaction, input.providerPaymentId)) {
      throw new Error("Payment reference mismatch");
    }

    const expectedCurrency = transaction.currency.toUpperCase();
    const receivedCurrency = (input.currency || "").toUpperCase();
    if (receivedCurrency && expectedCurrency !== receivedCurrency) {
      throw new Error("Payment currency mismatch");
    }

    const expectedAmount = normalizeMoney(transaction.amount);
    const receivedAmount = normalizeMoney(input.amount);
    if (receivedAmount + 0.01 < expectedAmount) {
      throw new Error("Payment amount is lower than expected");
    }

    const user = store.users.find((item) => item.id === transaction.userId);
    if (!user) {
      throw new Error("User not found for transaction");
    }

    if (transaction.status !== "completed") {
      user.balance = normalizeMoney(user.balance + expectedAmount);
      transaction.status = "completed";
      transaction.details = "Payment confirmed";
      transaction.updatedAt = new Date().toISOString();
    }

    if (!transaction.orderId) {
      return {
        kind: "topup",
        userId: user.id,
        orderId: null
      };
    }

    const order = store.orders.find((item) => item.id === transaction.orderId);
    if (!order) {
      throw new Error("Order not found for transaction");
    }
    if (isOrderFinal(order.status)) {
      return null;
    }

    if (user.balance < order.finalPrice) {
      order.status = "awaiting_balance";
      order.updatedAt = new Date().toISOString();
      return null;
    }

    user.balance = normalizeMoney(user.balance - order.finalPrice);
    order.status = "processing";
    order.updatedAt = new Date().toISOString();

    const debitTx: TransactionRecord = {
      id: createId("txn"),
      userId: user.id,
      orderId: order.id,
      type: "purchase_debit",
      status: "completed",
      amount: order.finalPrice,
      currency: order.currency,
      providerPaymentId: null,
      checkoutUrl: null,
      details: "Balance deducted for account purchase",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.transactions.push(debitTx);

    return {
      kind: "order",
      userId: user.id,
      orderId: order.id
    };
  });
}

export async function fulfillOrder(orderId: string) {
  const initial = await readStore();
  const order = initial.orders.find((item) => item.id === orderId);
  if (!order || order.status !== "processing") {
    return null;
  }

  try {
    const purchase = await buyFromSupplier(order.listingId);
    const delivery = sanitizeDelivery(purchase.delivery);

    await updateStore((store) => {
      const target = store.orders.find((item) => item.id === orderId);
      if (!target || target.status !== "processing") {
        return;
      }
      target.supplierOrderId = purchase.supplierOrderId;
      target.delivery = delivery;
      target.status = "completed";
      target.updatedAt = new Date().toISOString();
    });

    return delivery;
  } catch (error) {
    const failure = mapFulfillmentFailure(error);
    console.error(
      `[${failure.code}] supplier purchase failed for order ${orderId}: ${failure.internalMessage}`
    );
    await updateStore((store) => {
      const target = store.orders.find((item) => item.id === orderId);
      if (!target || isOrderFinal(target.status)) {
        return;
      }
      const user = store.users.find((item) => item.id === target.userId);
      if (user) {
        user.balance = normalizeMoney(user.balance + target.finalPrice);
      }
      target.status = "failed";
      target.failureReason = failure.publicMessage;
      target.updatedAt = new Date().toISOString();
      store.transactions.push({
        id: createId("txn"),
        userId: target.userId,
        orderId: target.id,
        type: "refund_credit",
        status: "completed",
        amount: target.finalPrice,
        currency: target.currency,
        providerPaymentId: null,
        checkoutUrl: null,
        details: `Automatic refund after purchase failure (${failure.code})`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });
    throw new Error(failure.code);
  }
}

export async function getUserOrders(userId: string) {
  const store = await readStore();
  return store.orders
    .filter((order) => order.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getUserOrderById(userId: string, orderId: string) {
  const store = await readStore();
  const target = store.orders.find((order) => order.userId === userId && order.id === orderId);
  return target ?? null;
}

export async function getAdminOverview() {
  const store = await readStore();
  const totalVolume = store.transactions
    .filter((tx) => tx.type === "payment_credit" && tx.status === "completed")
    .reduce((sum, tx) => sum + tx.amount, 0);

  return {
    stats: {
      users: store.users.length,
      orders: store.orders.length,
      transactions: store.transactions.length,
      volume: normalizeMoney(totalVolume)
    },
    settings: store.settings,
    coupons: store.coupons
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    users: store.users
      .slice()
      .sort((a, b) => {
        if (b.balance !== a.balance) {
          return b.balance - a.balance;
        }
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, 100),
    orders: store.orders
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200),
    transactions: store.transactions
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200)
  };
}

export async function updateMarkupPercent(markupPercent: number) {
  if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 500) {
    throw new Error("Markup must be between 0 and 500");
  }
  await updateStore((store) => {
    store.settings.markupPercent = normalizeMoney(markupPercent);
  });
}

function sanitizeDelivery(payload: DeliveryPayload) {
  const rawSupplierPayload =
    typeof payload.rawSupplierPayload === "string" && payload.rawSupplierPayload.trim()
      ? payload.rawSupplierPayload
      : null;
  const deliveredItems = Array.isArray(payload.deliveredItems)
    ? payload.deliveredItems
        .map((item) => ({
          label: String(item?.label ?? "").trim(),
          value: String(item?.value ?? "").trim()
        }))
        .filter((item) => item.label && item.value)
        .slice(0, 120)
    : [];

  if (deliveredItems.length === 0) {
    const fallbackItems = [
      { label: "Account Username", value: payload.accountUsername || "N/A" },
      { label: "Account Password", value: payload.accountPassword || "N/A" },
      payload.accountEmail ? { label: "Account Email", value: payload.accountEmail } : null,
      payload.notes ? { label: "Notes", value: payload.notes } : null
    ].filter((item): item is { label: string; value: string } => Boolean(item));
    deliveredItems.push(...fallbackItems);
  }

  return {
    accountUsername: payload.accountUsername || "N/A",
    accountPassword: payload.accountPassword || "N/A",
    accountEmail: payload.accountEmail || null,
    notes: payload.notes || null,
    rawSupplierPayload,
    deliveredItems
  };
}
