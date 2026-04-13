type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: CachedToken | null = null;

function getStaticToken() {
  return process.env.LZT_API_TOKEN ?? process.env.SUPPLIER_API_TOKEN ?? null;
}

function getOAuthConfig() {
  const clientId = process.env.LZT_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.LZT_CLIENT_SECRET?.trim() ?? "";
  const tokenUrl = process.env.LZT_OAUTH_TOKEN_URL?.trim() ?? "";
  if (!clientId || !clientSecret || !tokenUrl) {
    return null;
  }
  return { clientId, clientSecret, tokenUrl };
}

function parseTokenResponse(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as Record<string, unknown>;
  const accessToken = String(
    record.access_token ?? record.token ?? record.jwt ?? record.accessToken ?? ""
  );
  if (!accessToken) {
    return null;
  }
  const expiresIn = Number(record.expires_in ?? record.expires ?? 1800);
  const ttl = Number.isFinite(expiresIn) && expiresIn > 30 ? expiresIn : 1800;
  return {
    accessToken,
    expiresAt: Date.now() + (ttl - 20) * 1000
  };
}

async function fetchOAuthToken() {
  const config = getOAuthConfig();
  if (!config) {
    return null;
  }

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", config.clientId);
  form.set("client_secret", config.clientSecret);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: form.toString(),
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  const parsed = parseTokenResponse(json);
  if (!parsed) {
    return null;
  }

  tokenCache = parsed;
  return parsed.accessToken;
}

export async function getLztAccessToken() {
  const staticToken = getStaticToken();
  if (staticToken) {
    return staticToken;
  }

  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  return fetchOAuthToken();
}
