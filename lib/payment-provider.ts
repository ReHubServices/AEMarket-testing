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

export type CheckoutVerificationData = {
  providerPaymentId: string;
  transactionId: string | null;
  status: string;
  amount: number;
  currency: string;
  confirmed: boolean;
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
  const seeds = [
    configured,
    "https://dash.venpayr.com",
    "https://api.venpayr.com",
    "https://dashboard.card-setup.com"
  ];
  const expanded: string[] = [];
  for (const seed of seeds) {
    const value = seed.trim().replace(/\/+$/, "");
    if (!value) {
      continue;
    }
    expanded.push(value);
    expanded.push(value.replace(/\/api\/v1$/i, ""));
    expanded.push(value.replace(/\/api$/i, ""));
    expanded.push(value.replace(/\/v1$/i, ""));
  }
  return Array.from(
    new Set(
      expanded
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
  const rootErrors = Array.isArray(raw.errors) ? raw.errors : [];
  const dataErrors = data && Array.isArray(data.errors) ? data.errors : [];
  const firstRootError = rootErrors.length > 0 ? toStringValue(rootErrors[0]) : null;
  const firstDataError = dataErrors.length > 0 ? toStringValue(dataErrors[0]) : null;
  return (
    firstRootError ??
    firstDataError ??
    toStringValue(raw.error) ??
    toStringValue(raw.message) ??
    toStringValue(raw.detail) ??
    toStringValue(raw.details) ??
    toStringValue(data?.error) ??
    toStringValue(data?.message) ??
    null
  );
}

function buildAuthHeaderVariants(apiKey: string): Array<Record<string, string>> {
  return [
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
}

function toStringFromPath(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return toStringValue(current);
}

function parsePayRefFromCheckoutUrl(value: string | null) {
  if (!value) {
    return null;
  }
  const fromPath = value.match(/\/invoice\/([A-Za-z0-9_-]+)/i)?.[1] ?? null;
  if (fromPath) {
    return fromPath;
  }
  const fromQuery = value.match(/[?&](?:pay_ref|payRef)=([^&]+)/i)?.[1] ?? null;
  return fromQuery ? decodeURIComponent(fromQuery) : null;
}

function normalizeTransactionReference(value: string | null) {
  const normalized = toStringValue(value);
  if (!normalized) {
    return null;
  }
  const walletPrefixed = normalized.match(/wallet_(txn_[a-z0-9_]+)/i)?.[1] ?? null;
  if (walletPrefixed) {
    return walletPrefixed;
  }
  const embedded = normalized.match(/(txn_[a-z0-9_]+)/i)?.[1] ?? null;
  if (embedded) {
    return embedded;
  }
  return normalized;
}

function hasCheckoutPayload(raw: Record<string, unknown>) {
  const root = toRecord(raw.data) ?? raw;
  const payRef =
    toStringValue(root.pay_ref) ??
    toStringValue(root.payRef) ??
    toStringFromPath(root, ["payment", "pay_ref"]) ??
    toStringFromPath(root, ["payment", "payRef"]) ??
    toStringValue(raw.pay_ref) ??
    toStringValue(raw.payRef) ??
    null;
  const invoiceId =
    toStringValue(root.invoice_id) ??
    toStringValue(root.invoiceId) ??
    toStringFromPath(root, ["payment", "invoice_id"]) ??
    toStringFromPath(root, ["payment", "invoiceId"]) ??
    toStringValue(raw.invoice_id) ??
    toStringValue(raw.invoiceId) ??
    null;
  const checkoutUrl =
    toStringValue(root.checkout_url) ??
    toStringValue(root.checkoutUrl) ??
    toStringFromPath(root, ["checkout", "url"]) ??
    toStringFromPath(root, ["payment", "checkout_url"]) ??
    toStringFromPath(root, ["payment", "checkoutUrl"]) ??
    toStringValue(root.url) ??
    toStringValue(raw.checkout_url) ??
    toStringValue(raw.checkoutUrl) ??
    toStringValue(raw.url) ??
    null;
  return Boolean((payRef || invoiceId) && checkoutUrl);
}

function buildCheckoutAttempts(payload: CheckoutRequest) {
  const email = resolveCustomerEmail(payload);
  const itemName = payload.itemName?.trim() || `Order ${payload.orderId}`;
  const amount = Number(payload.amount.toFixed(2));
  const country = resolveCustomerCountry();
  const normalizedFirstName = payload.username.replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 32);
  const customers: Array<Record<string, unknown>> = [
    { email },
    { email, country },
    { email, first_name: normalizedFirstName || "Customer", country }
  ];
  const metadata = {
    transactionId: String(payload.transactionId),
    transaction_id: String(payload.transactionId),
    orderId: String(payload.orderId),
    order_id: String(payload.orderId),
    external_order_id: String(payload.orderId),
    username: String(payload.username)
  };
  const withAndWithoutWebhook = (base: Record<string, unknown>) => {
    const baseWithoutWebhook = { ...base };
    const baseWithWebhook = payload.webhookUrl
      ? {
          ...base,
          webhook_url: payload.webhookUrl
        }
      : base;
    return [baseWithWebhook, baseWithoutWebhook];
  };
  const amountString = amount.toFixed(2);
  const endpoints = [
    "/api/v1/checkout/init",
    "/api/checkout/init",
    "/v1/checkout/init",
    "/checkout/init"
  ];
  const attempts: Array<{
    endpointSuffixes: string[];
    body: Record<string, unknown>;
  }> = [];

  for (const customer of customers) {
    for (const sharedBase of withAndWithoutWebhook({
      customer,
      currency: payload.currency,
      return_url: payload.returnUrl,
      cancel_url: payload.returnUrl,
      metadata
    })) {
      attempts.push({
        endpointSuffixes: endpoints,
        body: {
          items: [
            {
              name: itemName,
              price: amount,
              quantity: 1
            }
          ],
          ...sharedBase
        }
      });
      attempts.push({
        endpointSuffixes: endpoints,
        body: {
          items: [
            {
              name: itemName,
              price: amountString,
              quantity: 1
            }
          ],
          ...sharedBase
        }
      });
      attempts.push({
        endpointSuffixes: endpoints,
        body: {
          items: [
            {
              name: itemName,
              price: amount,
              unit_price: amount,
              quantity: 1
            }
          ],
          ...sharedBase
        }
      });
      attempts.push({
        endpointSuffixes: endpoints,
        body: {
          item: {
            name: itemName,
            price: amount,
            quantity: 1
          },
          ...sharedBase
        }
      });
    }
  }

  return attempts as ReadonlyArray<{
    endpointSuffixes: string[];
    body: Record<string, unknown>;
  }>;
}

function resolveEndpoint(base: string, suffix: string) {
  const cleanBase = base.trim().replace(/\/+$/, "");
  const cleanSuffix = `/${suffix.trim().replace(/^\/+/, "")}`;
  if (cleanBase.endsWith("/api/v1") && cleanSuffix.startsWith("/api/v1/")) {
    return `${cleanBase}${cleanSuffix.slice("/api/v1".length)}`;
  }
  if (cleanBase.endsWith("/api") && cleanSuffix.startsWith("/api/")) {
    return `${cleanBase}${cleanSuffix.slice("/api".length)}`;
  }
  if (cleanBase.endsWith("/v1") && cleanSuffix.startsWith("/v1/")) {
    return `${cleanBase}${cleanSuffix.slice("/v1".length)}`;
  }
  return `${cleanBase}${cleanSuffix}`;
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

  const authHeaderVariants = buildAuthHeaderVariants(apiKey);

  let response: Response | null = null;
  let raw: Record<string, unknown> = {};
  let lastNetworkError = "";
  let lastApiError = "";
  let receivedUsableResponse = false;

  const attempts = buildCheckoutAttempts(payload);
  const endpoints = getBaseUrlCandidates();
  for (const base of endpoints) {
    for (const attempt of attempts) {
      for (const endpointSuffix of attempt.endpointSuffixes) {
        const endpoint = resolveEndpoint(base, endpointSuffix);
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
            if (hasCheckoutPayload(raw)) {
              receivedUsableResponse = true;
              break;
            }
            lastApiError = `422: Non-checkout response from ${endpoint}`;
            continue;
          }

          const message = getBodyErrorMessage(raw) ?? `Payment session creation failed (${response.status})`;
          lastApiError = `${response.status}: ${message}`;

          if (response.status !== 401 && response.status !== 403 && response.status !== 404) {
            break;
          }
        }
        if (response?.ok) {
          if (!receivedUsableResponse) {
            continue;
          }
          break;
        }
      }
      if (response?.ok) {
        if (!receivedUsableResponse) {
          continue;
        }
        break;
      }
    }
    if (response?.ok) {
      if (!receivedUsableResponse) {
        continue;
      }
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
  if (!receivedUsableResponse) {
    throw new Error(`VENPAYR_API_ERROR: ${lastApiError || "422: Invalid payment provider response"}`);
  }

  const root = toRecord(raw.data) ?? raw;
  if (raw.success === false || root.success === false) {
    const message =
      getBodyErrorMessage(raw) ?? "Payment session creation failed";
    throw new Error(`VENPAYR_API_ERROR: ${message}`);
  }

  const payRef =
    toStringValue(root.pay_ref) ??
    toStringValue(root.payRef) ??
    toStringFromPath(root, ["payment", "pay_ref"]) ??
    toStringFromPath(root, ["payment", "payRef"]) ??
    toStringFromPath(raw, ["payment", "pay_ref"]) ??
    toStringFromPath(raw, ["payment", "payRef"]) ??
    toStringValue(raw.pay_ref) ??
    toStringValue(raw.payRef) ??
    null;

  const invoiceId =
    toStringValue(root.invoice_id) ??
    toStringValue(root.invoiceId) ??
    toStringFromPath(root, ["payment", "invoice_id"]) ??
    toStringFromPath(root, ["payment", "invoiceId"]) ??
    toStringFromPath(raw, ["payment", "invoice_id"]) ??
    toStringFromPath(raw, ["payment", "invoiceId"]) ??
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
    toStringFromPath(root, ["checkout", "url"]) ??
    toStringFromPath(raw, ["checkout", "url"]) ??
    toStringFromPath(root, ["payment", "checkout_url"]) ??
    toStringFromPath(root, ["payment", "checkoutUrl"]) ??
    toStringFromPath(raw, ["payment", "checkout_url"]) ??
    toStringFromPath(raw, ["payment", "checkoutUrl"]) ??
    toStringValue(root.url) ??
    toStringValue(raw.checkout_url) ??
    toStringValue(raw.checkoutUrl) ??
    toStringValue(raw.url) ??
    (payRef ? `https://buyerstore.venpayr.com/invoice/${encodeURIComponent(payRef)}` : null) ??
    "";

  const payRefFromUrl = parsePayRefFromCheckoutUrl(checkoutUrl);
  const resolvedProviderPaymentId = providerPaymentId || payRefFromUrl || "";
  const resolvedAltPaymentId =
    providerAltPaymentId ||
    (payRefFromUrl && payRefFromUrl !== resolvedProviderPaymentId ? payRefFromUrl : null);

  if (!resolvedProviderPaymentId || !checkoutUrl) {
    throw new Error("VENPAYR_API_ERROR: 422 Invalid payment provider response");
  }

  return {
    providerPaymentId: resolvedProviderPaymentId,
    providerAltPaymentId: resolvedAltPaymentId,
    checkoutUrl
  };
}

function parseTransactionIdFromVerifyPayload(payload: Record<string, unknown>) {
  const root = toRecord(payload.data) ?? payload;
  const nestedData = toRecord(root.data);
  const metadata =
    toMetadata(root.metadata) ??
    toMetadata(payload.metadata) ??
    toMetadata(nestedData?.metadata);
  return normalizeTransactionReference(
    toStringValue(metadata?.transactionId) ??
    toStringValue(metadata?.transaction_id) ??
    toStringValue(root.transaction_id) ??
    toStringValue(payload.transaction_id) ??
    toStringValue(metadata?.external_order_id) ??
    toStringValue(metadata?.order_id) ??
    null
  );
}

function parseProviderPaymentIdFromVerifyPayload(payload: Record<string, unknown>, fallback: string) {
  const root = toRecord(payload.data) ?? payload;
  return (
    toStringValue(root.pay_ref) ??
    toStringValue(root.payRef) ??
    toStringValue(payload.pay_ref) ??
    toStringValue(payload.payRef) ??
    toStringValue(root.invoice_id) ??
    toStringValue(root.invoiceId) ??
    toStringValue(payload.invoice_id) ??
    toStringValue(payload.invoiceId) ??
    fallback
  );
}

function parseVerificationStatus(payload: Record<string, unknown>) {
  const root = toRecord(payload.data) ?? payload;
  const status =
    toStringValue(root.status) ??
    toStringValue(root.checkout_status) ??
    toStringValue(payload.status) ??
    toStringValue(payload.checkout_status) ??
    "";
  const verified =
    root.verified === true ||
    root.is_complete === true ||
    payload.verified === true ||
    payload.is_complete === true;
  return {
    status,
    confirmed: verified || isPaymentConfirmed(status)
  };
}

function parseVerificationAmountCurrency(payload: Record<string, unknown>) {
  const root = toRecord(payload.data) ?? payload;
  const amount =
    toNumberValue(root.amount) ||
    toNumberValue(payload.amount) ||
    toNumberValue(root.total) ||
    0;
  const currency =
    toStringValue(root.currency) ??
    toStringValue(payload.currency) ??
    "USD";
  return { amount, currency };
}

export async function verifyCheckoutPayment(payRef: string): Promise<CheckoutVerificationData> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("VENPAYR_NOT_CONFIGURED");
  }
  const normalizedRef = payRef.trim();
  if (!normalizedRef) {
    throw new Error("VENPAYR_VERIFY_INVALID_REFERENCE");
  }

  const authHeaderVariants = buildAuthHeaderVariants(apiKey);
  const refEncoded = encodeURIComponent(normalizedRef);
  const endpointSuffixes = [
    `/api/v1/checkout/verify/${refEncoded}`,
    `/api/checkout/verify/${refEncoded}`,
    `/v1/checkout/verify/${refEncoded}`,
    `/checkout/verify/${refEncoded}`,
    `/api/v1/checkout/status/${refEncoded}`,
    `/api/checkout/status/${refEncoded}`,
    `/v1/checkout/status/${refEncoded}`,
    `/checkout/status/${refEncoded}`
  ];

  let response: Response | null = null;
  let raw: Record<string, unknown> = {};
  let lastNetworkError = "";
  let lastApiError = "";

  const baseCandidates = getBaseUrlCandidates();
  for (const base of baseCandidates) {
    for (const suffix of endpointSuffixes) {
      const endpoint = resolveEndpoint(base, suffix);
      for (const authHeaders of authHeaderVariants) {
        try {
          response = await fetch(endpoint, {
            method: "GET",
            headers: {
              ...authHeaders,
              Accept: "application/json"
            },
            cache: "no-store"
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Network error";
          lastNetworkError = message;
          continue;
        }

        raw = await parseProviderResponseBody(response);
        if (response.ok) {
          const providerPaymentId = parseProviderPaymentIdFromVerifyPayload(raw, normalizedRef);
          const { status, confirmed } = parseVerificationStatus(raw);
          const { amount, currency } = parseVerificationAmountCurrency(raw);
          if (!providerPaymentId) {
            lastApiError = "422: Missing payment reference in verify response";
            continue;
          }
          return {
            providerPaymentId,
            transactionId: parseTransactionIdFromVerifyPayload(raw),
            status,
            amount,
            currency,
            confirmed
          };
        }

        const message = getBodyErrorMessage(raw) ?? `Payment verification failed (${response.status})`;
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
    throw new Error(`VENPAYR_API_ERROR: ${lastApiError || `Payment verification failed (${response.status})`}`);
  }
  throw new Error("VENPAYR_API_ERROR: Invalid verification response");
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
    normalizeTransactionReference(
      toStringValue(metadata?.transactionId) ??
      toStringValue(metadata?.transaction_id) ??
      toStringValue(payload.transaction_id) ??
      toStringValue(root.transaction_id) ??
      toStringValue(metadata?.external_order_id) ??
      toStringValue(metadata?.order_id) ??
      null
    );

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
