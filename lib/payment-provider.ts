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

function firstNonEmpty(values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = (value ?? "").trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function readEnvCaseInsensitive(name: string) {
  const exact = process.env[name];
  if (exact && exact.trim()) {
    return exact.trim();
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() === target) {
      const normalized = String(value ?? "").trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return "";
}

function getApiKey() {
  const raw = firstNonEmpty([
    readEnvCaseInsensitive("VENPAYR_API_KEY"),
    readEnvCaseInsensitive("VENPAYR_STORE_API_KEY"),
    readEnvCaseInsensitive("VENPAYR_LIVE_API_KEY"),
    readEnvCaseInsensitive("VENPAYR_API_TOKEN"),
    readEnvCaseInsensitive("VENPAYR_API_SECRET"),
    readEnvCaseInsensitive("VENPAYR_SECRET_KEY"),
    readEnvCaseInsensitive("VENPAYR_SECRET"),
    readEnvCaseInsensitive("CARD_SETUP_API_KEY"),
    readEnvCaseInsensitive("CARD_SETUP_API_SECRET"),
    readEnvCaseInsensitive("CARD_SETUP_SECRET_KEY"),
    readEnvCaseInsensitive("CARD_SETUP_API_TOKEN")
  ]);
  if (!raw) {
    return "";
  }
  const withoutQuotes = raw.replace(/^['"]|['"]$/g, "");
  const withoutPrefix = withoutQuotes.replace(/^bearer\s+/i, "").trim();
  const withoutZeroWidth = withoutPrefix.replace(/[\u200B-\u200D\uFEFF]/g, "");
  return withoutZeroWidth.replace(/\s+/g, "");
}

function getWebhookSecret() {
  const explicitSecretRaw = firstNonEmpty([
    readEnvCaseInsensitive("VENPAYR_WEBHOOK_SECRET"),
    readEnvCaseInsensitive("CARD_SETUP_WEBHOOK_SECRET")
  ]);
  const explicitSecret = explicitSecretRaw.replace(/^['"]|['"]$/g, "").trim();
  if (explicitSecret) {
    return explicitSecret;
  }
  return getApiKey();
}

function getBaseUrl() {
  const base =
    firstNonEmpty([
      readEnvCaseInsensitive("VENPAYR_BASE_URL"),
      readEnvCaseInsensitive("CARD_SETUP_BASE_URL")
    ]) || "https://dash.venpayr.com";
  return base.replace(/\/+$/, "");
}

function getBaseUrlCandidates() {
  const configured = getBaseUrl();
  return Array.from(
    new Set(
      [
        configured,
        "https://dash.venpayr.com",
        "https://api.venpayr.com",
        "https://dashboard.card-setup.com"
      ]
        .map((value) => value.trim().replace(/\/+$/, ""))
        .filter(Boolean)
    )
  );
}

function toRecord(value: unknown) {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function getBodyErrorMessage(raw: Record<string, unknown>) {
  const data = toRecord(raw.data);
  return (
    toStringValue(raw.error) ??
    toStringValue(raw.message) ??
    toStringValue(raw.detail) ??
    toStringValue(raw.details) ??
    toStringValue(data?.error) ??
    toStringValue(data?.message) ??
    null
  );
}

function buildCheckoutAttempts(payload: CheckoutRequest) {
  const email = resolveCustomerEmail(payload);
  const itemName = payload.itemName?.trim() || `Order ${payload.orderId}`;
  const amount = Number(payload.amount.toFixed(2));
  const customer = {
    email,
    first_name: payload.username.slice(0, 64),
    country: resolveCustomerCountry()
  };
  const metadata = {
    transactionId: payload.transactionId,
    transaction_id: payload.transactionId,
    orderId: payload.orderId,
    order_id: payload.orderId,
    external_order_id: payload.orderId,
    username: payload.username
  };
  const shared = {
    customer,
    currency: payload.currency,
    return_url: payload.returnUrl,
    cancel_url: payload.returnUrl,
    webhook_url: payload.webhookUrl,
    metadata
  };

  return [
    {
      endpointSuffix: "/api/v1/checkout/init/product",
      body: {
        product: {
          name: itemName,
          price: amount,
          currency: payload.currency,
          external_id: payload.orderId
        },
        quantity: 1,
        ...shared
      }
    },
    {
      endpointSuffix: "/api/v1/checkout/init",
      body: {
        items: [
          {
            name: itemName,
            price: amount,
            quantity: 1
          }
        ],
        ...shared
      }
    },
    {
      endpointSuffix: "/api/v1/checkout/init",
      body: {
        items: [
          {
            name: itemName,
            price: amount,
            unit_price: amount,
            quantity: 1
          }
        ],
        ...shared
      }
    }
  ] as const;
}

async function parseProviderResponseBody(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const parsed = (await response.json().catch(() => null)) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return {};
  }
  const text = await response.text().catch(() => "");
  const normalized = text.trim();
  if (!normalized) {
    return {};
  }
  return {
    message: normalized.slice(0, 500)
  };
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

  const authHeaderVariants: Array<Record<string, string>> = [
    {
      Authorization: `Bearer ${apiKey}`,
      "X-API-Key": apiKey,
      "x-api-key": apiKey,
      "Api-Key": apiKey
    },
    {
      Authorization: apiKey,
      "X-API-Key": apiKey,
      "x-api-key": apiKey,
      "Api-Key": apiKey
    },
    {
      Authorization: `Token ${apiKey}`,
      "X-API-Key": apiKey,
      "x-api-key": apiKey,
      "Api-Key": apiKey
    }
  ];

  let response: Response | null = null;
  let raw: Record<string, unknown> = {};
  let lastNetworkError = "";
  let lastApiError = "";

  const attempts = buildCheckoutAttempts(payload);
  const endpoints = getBaseUrlCandidates();
  for (const base of endpoints) {
    for (const attempt of attempts) {
      const endpoint = `${base}${attempt.endpointSuffix}`;
    for (const authHeaders of authHeaderVariants) {
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(attempt.body)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Network error";
        lastNetworkError = message;
        continue;
      }

      raw = await parseProviderResponseBody(response);
      if (response.ok) {
        break;
      }

      const message = getBodyErrorMessage(raw) ?? `Payment session creation failed (${response.status})`;
      lastApiError = `${response.status}: ${message}`;

      if (response.status !== 401 && response.status !== 403 && response.status !== 404) {
        break;
      }
    }
    if (response?.ok) {
      break;
    }
  }
    if (response?.ok) {
      break;
    }
  }

  if (!response) {
    throw new Error(`VENPAYR_NETWORK_ERROR: ${lastNetworkError || "Unknown network error"}`);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "VENPAYR_API_ERROR: Unauthorized (401). Invalid API credentials for payment provider."
      );
    }
    throw new Error(`VENPAYR_API_ERROR: ${lastApiError || `Payment session creation failed (${response.status})`}`);
  }

  const root = toRecord(raw.data) ?? raw;
  if (raw.success === false || root.success === false) {
    const message =
      getBodyErrorMessage(raw) ?? "Payment session creation failed";
    throw new Error(message);
  }

  const payRef =
    toStringValue(root.pay_ref) ??
    toStringValue(root.payRef) ??
    toStringValue(raw.pay_ref) ??
    toStringValue(raw.payRef) ??
    null;

  const invoiceId =
    toStringValue(root.invoice_id) ??
    toStringValue(root.invoiceId) ??
    toStringValue(raw.invoice_id) ??
    toStringValue(raw.invoiceId) ??
    null;

  const providerPaymentId =
    payRef ??
    invoiceId ??
    toStringValue(root.paymentId) ??
    toStringValue(root.id) ??
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
    toStringValue(root.checkout_url) ??
    toStringValue(root.checkoutUrl) ??
    toStringValue(root.url) ??
    toStringValue(raw.checkout_url) ??
    toStringValue(raw.checkoutUrl) ??
    toStringValue(raw.url) ??
    (payRef ? `https://buyerstore.venpayr.com/invoice/${encodeURIComponent(payRef)}` : null) ??
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
