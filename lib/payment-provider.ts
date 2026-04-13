import { createHmac, timingSafeEqual } from "node:crypto";

export type CheckoutRequest = {
  amount: number;
  currency: string;
  orderId: string;
  transactionId: string;
  username: string;
  returnUrl: string;
  webhookUrl: string;
};

export type CheckoutResponse = {
  providerPaymentId: string;
  checkoutUrl: string;
};

export type WebhookPaymentData = {
  providerPaymentId: string;
  transactionId: string | null;
  status: string;
  amount: number;
  currency: string;
};

function getApiToken() {
  return process.env.CARD_SETUP_API_TOKEN ?? "";
}

function getWebhookSecret() {
  return process.env.CARD_SETUP_WEBHOOK_SECRET ?? "";
}

export async function createCheckoutSession(payload: CheckoutRequest): Promise<CheckoutResponse> {
  const endpoint = process.env.CARD_SETUP_CREATE_URL;
  if (!endpoint) {
    throw new Error("Payment endpoint missing");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      amount: payload.amount,
      currency: payload.currency,
      reference: payload.transactionId,
      orderId: payload.orderId,
      customerName: payload.username,
      returnUrl: payload.returnUrl,
      webhookUrl: payload.webhookUrl,
      metadata: {
        transactionId: payload.transactionId,
        orderId: payload.orderId
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Payment session creation failed");
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const providerPaymentId = String(raw.paymentId ?? raw.id ?? "");
  const checkoutUrl = String(raw.checkoutUrl ?? raw.url ?? "");
  if (!providerPaymentId || !checkoutUrl) {
    throw new Error("Invalid payment provider response");
  }

  return {
    providerPaymentId,
    checkoutUrl
  };
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null) {
  const secret = getWebhookSecret();
  if (!secret) {
    return false;
  }
  if (!signatureHeader) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = signatureHeader.replace(/^sha256=/i, "");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function parseWebhookPayload(input: unknown): WebhookPaymentData | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const event = input as Record<string, unknown>;
  const payload =
    typeof event.data === "object" && event.data !== null
      ? (event.data as Record<string, unknown>)
      : event;

  const providerPaymentId = String(
    payload.paymentId ?? payload.id ?? payload.reference ?? ""
  );
  if (!providerPaymentId) {
    return null;
  }

  const amount = Number(payload.amount ?? 0);
  const currency = String(payload.currency ?? "USD");
  const status = String(payload.status ?? event.type ?? "");

  const metadata =
    typeof payload.metadata === "object" && payload.metadata !== null
      ? (payload.metadata as Record<string, unknown>)
      : null;

  const transactionId = metadata?.transactionId
    ? String(metadata.transactionId)
    : payload.reference
      ? String(payload.reference)
      : null;

  return {
    providerPaymentId,
    status,
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
    transactionId
  };
}

export function isPaymentConfirmed(status: string) {
  const normalized = status.toLowerCase();
  return (
    normalized.includes("paid") ||
    normalized.includes("success") ||
    normalized.includes("confirmed")
  );
}
