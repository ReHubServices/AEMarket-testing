import { createHmac, timingSafeEqual } from "node:crypto";

export type CheckoutRequest = {
  amount: number;
  currency: string;
  orderId: string;
  transactionId: string;
  username: string;
  customerEmail?: string | null;
  itemName?: string;
  returnUrl: string;
  webhookUrl: string;
};

export type CheckoutResponse = {
  providerPaymentId: string;
  providerAltPaymentId: string | null;
  checkoutUrl: string;
};

export type WebhookPaymentData = {
  providerPaymentId: string;
  transactionId: string | null;
  status: string;
  amount: number;
  currency: string;
};

function getApiKey() {
  return (process.env.VENPAYR_API_KEY ?? "").trim();
}

function getWebhookSecret() {
  const explicitSecret = (process.env.VENPAYR_WEBHOOK_SECRET ?? "").trim();
  if (explicitSecret) {
    return explicitSecret;
  }
  return getApiKey();
}

function getBaseUrl() {
  const base = process.env.VENPAYR_BASE_URL?.trim() || "https://dash.venpayr.com";
  return base.replace(/\/+$/, "");
}

function toStringValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function toMetadata(value: unknown) {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function resolveCustomerEmail(payload: CheckoutRequest) {
  const fromInput = toStringValue(payload.customerEmail);
  if (fromInput) {
    return fromInput;
  }
  const fallbackLocal =
    payload.username.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase() || "buyer";
  return `${fallbackLocal}@example.com`;
}

function resolveCustomerCountry() {
  const raw = (process.env.VENPAYR_CUSTOMER_COUNTRY ?? "US").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : "US";
}

export function isPaymentProviderConfigured() {
  return Boolean(getApiKey());
}

export function isWebhookVerificationConfigured() {
  return Boolean(getWebhookSecret());
}

export async function createCheckoutSession(payload: CheckoutRequest): Promise<CheckoutResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("VENPAYR_NOT_CONFIGURED");
  }

  const endpoint = `${getBaseUrl()}/api/v1/checkout/init`;
  const email = resolveCustomerEmail(payload);
  const itemName = payload.itemName?.trim() || `Order ${payload.orderId}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        items: [
          {
            name: itemName,
            price: payload.amount,
            unit_price: payload.amount,
            quantity: 1
          }
        ],
        customer: {
          email,
          first_name: payload.username.slice(0, 64),
          country: resolveCustomerCountry()
        },
        currency: payload.currency,
        return_url: payload.returnUrl,
        cancel_url: payload.returnUrl,
        webhook_url: payload.webhookUrl,
        metadata: {
          transactionId: payload.transactionId,
          transaction_id: payload.transactionId,
          orderId: payload.orderId,
          order_id: payload.orderId,
          external_order_id: payload.orderId,
          username: payload.username
        }
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    throw new Error(`VENPAYR_NETWORK_ERROR: ${message}`);
  }

  const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      toStringValue(raw.error) ??
      toStringValue(raw.message) ??
      `Payment session creation failed (${response.status})`;
    throw new Error(`VENPAYR_API_ERROR: ${message}`);
  }

  if (raw.success === false) {
    const message =
      toStringValue(raw.error) ?? toStringValue(raw.message) ?? "Payment session creation failed";
    throw new Error(message);
  }

  const payRef =
    toStringValue(raw.pay_ref) ??
    toStringValue(raw.payRef) ??
    null;

  const invoiceId =
    toStringValue(raw.invoice_id) ??
    toStringValue(raw.invoiceId) ??
    null;

  const providerPaymentId =
    payRef ??
    invoiceId ??
    toStringValue(raw.paymentId) ??
    toStringValue(raw.id) ??
    "";

  const providerAltPaymentId =
    payRef && invoiceId
      ? payRef === providerPaymentId
        ? invoiceId
        : payRef
      : null;

  const checkoutUrl =
    toStringValue(raw.checkout_url) ??
    toStringValue(raw.checkoutUrl) ??
    toStringValue(raw.url) ??
    "";

  if (!providerPaymentId || !checkoutUrl) {
    throw new Error("Invalid payment provider response");
  }

  return {
    providerPaymentId,
    providerAltPaymentId,
    checkoutUrl
  };
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null) {
  const secret = getWebhookSecret();
  if (!secret) {
    return false;
  }

  const normalizedHeader = signatureHeader?.trim();
  if (!normalizedHeader) {
    return false;
  }

  if (!normalizedHeader.toLowerCase().startsWith("sha256=")) {
    return false;
  }

  const actualSignature = normalizedHeader.slice(7).trim();
  if (!actualSignature || !/^[a-f0-9]{64}$/i.test(actualSignature)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actualSignature, "hex");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function parseWebhookPayload(input: unknown): WebhookPaymentData | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const root = input as Record<string, unknown>;
  const payload =
    typeof root.data === "object" && root.data !== null
      ? (root.data as Record<string, unknown>)
      : root;

  const metadata =
    toMetadata(payload.metadata) ??
    toMetadata(root.metadata);

  const providerPaymentId =
    toStringValue(payload.pay_ref) ??
    toStringValue(root.pay_ref) ??
    toStringValue(payload.invoice_id) ??
    toStringValue(root.invoice_id) ??
    toStringValue(payload.invoiceId) ??
    toStringValue(root.invoiceId) ??
    toStringValue(payload.paymentId) ??
    toStringValue(payload.id) ??
    toStringValue(root.id) ??
    "";
  if (!providerPaymentId) {
    return null;
  }

  const amount =
    toNumberValue(payload.amount) ||
    toNumberValue(root.amount) ||
    toNumberValue((payload as Record<string, unknown>).total);

  const currency = toStringValue(payload.currency) ?? toStringValue(root.currency) ?? "USD";

  const status =
    toStringValue(root.event) ??
    toStringValue(root.event_type) ??
    toStringValue(payload.status) ??
    toStringValue(root.status) ??
    toStringValue(payload.checkout_status) ??
    toStringValue(root.checkout_status) ??
    "";

  const transactionId =
    toStringValue(metadata?.transactionId) ??
    toStringValue(metadata?.transaction_id) ??
    toStringValue(payload.transaction_id) ??
    toStringValue(root.transaction_id) ??
    toStringValue(metadata?.external_order_id) ??
    toStringValue(metadata?.order_id) ??
    null;

  return {
    providerPaymentId,
    status,
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
    transactionId
  };
}

export function isPaymentConfirmed(status: string) {
  const normalized = status.toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  if (
    normalized.includes("failed") ||
    normalized.includes("declined") ||
    normalized.includes("cancel") ||
    normalized.includes("error")
  ) {
    return false;
  }

  return (
    normalized === "okay" ||
    normalized === "paid" ||
    normalized === "completed" ||
    normalized === "success" ||
    normalized === "succeeded" ||
    normalized === "payment.completed" ||
    normalized === "invoice.paid" ||
    normalized === "sale" ||
    normalized === "status:okay" ||
    normalized.includes("paid") ||
    normalized.includes("sale") ||
    normalized.includes("okay") ||
    normalized.includes("completed") ||
    normalized.includes("success") ||
    normalized.includes("confirmed")
  );
}
