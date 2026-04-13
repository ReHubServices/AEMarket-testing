import { createId } from "@/lib/ids";
import { buyFromSupplier, getListingById } from "@/lib/provider";
import { normalizeMoney } from "@/lib/pricing";
import { readStore, updateStore } from "@/lib/store";
import { DeliveryPayload, OrderRecord, TransactionRecord, UserRecord } from "@/lib/types";

type PaymentResult = {
  user: UserRecord;
  order: OrderRecord;
  transaction: TransactionRecord;
};

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

export async function createPendingOrder(input: { userId: string; listingId: string }) {
  const listing = await getListingById(input.listingId);
  if (!listing) {
    throw new Error("Listing not found");
  }

  const now = new Date().toISOString();
  const orderId = createId("ord");
  const transactionId = createId("txn");

  const result = await updateStore((store) => {
    const user = store.users.find((item) => item.id === input.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const order: OrderRecord = {
      id: orderId,
      userId: user.id,
      listingId: listing.id,
      title: listing.title,
      imageUrl: listing.imageUrl,
      game: listing.game,
      category: listing.category,
      basePrice: listing.basePrice,
      finalPrice: listing.price,
      currency: listing.currency,
      status: "pending_payment",
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
      type: "payment_credit",
      status: "pending",
      amount: listing.price,
      currency: listing.currency,
      providerPaymentId: null,
      checkoutUrl: null,
      details: "Waiting for payment confirmation",
      createdAt: now,
      updatedAt: now
    };

    store.orders.push(order);
    store.transactions.push(transaction);
    return { order, transaction, user };
  });

  return result;
}

export async function attachCheckoutToTransaction(input: {
  transactionId: string;
  providerPaymentId: string;
  checkoutUrl: string;
}) {
  await updateStore((store) => {
    const transaction = store.transactions.find((item) => item.id === input.transactionId);
    if (!transaction) {
      throw new Error("Transaction not found");
    }
    transaction.providerPaymentId = input.providerPaymentId;
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

export async function confirmPaymentAndReservePurchase(input: {
  transactionId: string | null;
  providerPaymentId: string;
  amount: number;
  currency: string;
}) {
  return updateStore((store): PaymentReservation | null => {
    const transaction = input.transactionId
      ? store.transactions.find((item) => item.id === input.transactionId)
      : store.transactions.find((item) => item.providerPaymentId === input.providerPaymentId);

    if (!transaction) {
      throw new Error("Transaction not found for webhook");
    }

    if (
      transaction.providerPaymentId &&
      transaction.providerPaymentId !== input.providerPaymentId
    ) {
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
    const message = error instanceof Error ? error.message : "Purchase failed";
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
      target.failureReason = message;
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
        details: "Automatic refund after purchase failure",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });
    throw error;
  }
}

export async function getUserOrders(userId: string) {
  const store = await readStore();
  return store.orders
    .filter((order) => order.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    users: store.users
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
  return {
    accountUsername: payload.accountUsername || "N/A",
    accountPassword: payload.accountPassword || "N/A",
    accountEmail: payload.accountEmail || null,
    notes: payload.notes || null
  };
}

export function toPaymentResult(input: PaymentResult) {
  return {
    userId: input.user.id,
    orderId: input.order.id,
    transactionId: input.transaction.id
  };
}
