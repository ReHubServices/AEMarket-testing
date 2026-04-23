import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { StoreData } from "@/lib/types";

function resolveStoreDir() {
  const configured = process.env.STORE_DIR?.trim();
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    const runtimeTmp = process.env.TMPDIR?.trim() || process.env.TEMP?.trim() || "/tmp";
    return path.join(runtimeTmp, "ae-empire-store");
  }

  return path.join(process.cwd(), "data");
}

const STORE_DIR = resolveStoreDir();
const STORE_PATH = path.join(STORE_DIR, "store.json");
const DATABASE_URL =
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_URL?.trim() ||
  process.env.NEON_DATABASE_URL?.trim() ||
  "";

function resolveDefaultMarkupPercent() {
  const raw = Number(process.env.DEFAULT_MARKUP_PERCENT ?? "150");
  if (!Number.isFinite(raw)) {
    return 150;
  }
  return Math.min(500, Math.max(0, raw));
}

const DEFAULT_MARKUP_PERCENT = resolveDefaultMarkupPercent();

const defaultStore: StoreData = {
  users: [],
  orders: [],
  transactions: [],
  settings: {
    markupPercent: DEFAULT_MARKUP_PERCENT,
    homeTitle: "Welcome to AE EMPIRE",
    homeSubtitle:
      "Premium digital account marketplace with secure balance payments and instant automated delivery.",
    announcementText: "",
    announcementEnabled: false
  }
};

let queue: Promise<unknown> = Promise.resolve();
let sqlClient: ReturnType<typeof neon> | null = null;
let databaseReady: Promise<void> | null = null;

function runExclusive<T>(task: () => Promise<T>) {
  const next = queue.then(task, task);
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function hasDatabase() {
  return Boolean(DATABASE_URL);
}

function getSql() {
  if (!hasDatabase()) {
    return null;
  }
  if (!sqlClient) {
    sqlClient = neon(DATABASE_URL);
  }
  return sqlClient;
}

function normalizeStore(raw: unknown): StoreData {
  if (!raw || typeof raw !== "object") {
    return structuredClone(defaultStore);
  }

  const data = raw as Partial<StoreData>;
  const rawSettings =
    data.settings && typeof data.settings === "object"
      ? (data.settings as Record<string, unknown>)
      : null;
  const hasLegacyDefaultMarkup = Number((rawSettings as Record<string, unknown> | null)?.markupPercent) === 50;
  const parsedMarkup =
    typeof data.settings?.markupPercent === "number" && Number.isFinite(data.settings.markupPercent)
      ? data.settings.markupPercent
      : defaultStore.settings.markupPercent;
  const markup = hasLegacyDefaultMarkup ? DEFAULT_MARKUP_PERCENT : parsedMarkup;
  const homeTitle =
    typeof data.settings?.homeTitle === "string" && data.settings.homeTitle.trim()
      ? data.settings.homeTitle.trim().slice(0, 120)
      : defaultStore.settings.homeTitle;
  const homeSubtitle =
    typeof data.settings?.homeSubtitle === "string" && data.settings.homeSubtitle.trim()
      ? data.settings.homeSubtitle.trim().slice(0, 400)
      : defaultStore.settings.homeSubtitle;
  const announcementText =
    typeof data.settings?.announcementText === "string"
      ? data.settings.announcementText.trim().slice(0, 1200)
      : defaultStore.settings.announcementText;
  const announcementEnabled =
    typeof data.settings?.announcementEnabled === "boolean"
      ? data.settings.announcementEnabled
      : defaultStore.settings.announcementEnabled;

  return {
    users: Array.isArray(data.users) ? data.users : [],
    orders: Array.isArray(data.orders) ? data.orders : [],
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    settings: {
      markupPercent: markup,
      homeTitle,
      homeSubtitle,
      announcementText,
      announcementEnabled
    }
  };
}

async function ensureDatabaseStore() {
  if (!hasDatabase()) {
    return;
  }

  if (!databaseReady) {
    databaseReady = (async () => {
      const sql = getSql();
      if (!sql) {
        return;
      }

      await sql`
        CREATE TABLE IF NOT EXISTS ae_store_state (
          id INTEGER PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      const bootstrapData = await loadStoreFromFileUnsafe();

      await sql`
        INSERT INTO ae_store_state (id, data, updated_at)
        VALUES (1, ${JSON.stringify(bootstrapData)}::jsonb, NOW())
        ON CONFLICT (id) DO NOTHING
      `;
    })();
  }

  await databaseReady;
}

async function loadStoreFromDatabaseUnsafe() {
  const sql = getSql();
  if (!sql) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }

  await ensureDatabaseStore();
  const rows = (await sql`
    SELECT data
    FROM ae_store_state
    WHERE id = 1
    LIMIT 1
  `) as Array<{ data: unknown }>;

  return normalizeStore(rows[0]?.data);
}

async function saveStoreToDatabaseUnsafe(data: StoreData) {
  const sql = getSql();
  if (!sql) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }

  await ensureDatabaseStore();
  await sql`
    INSERT INTO ae_store_state (id, data, updated_at)
    VALUES (1, ${JSON.stringify(data)}::jsonb, NOW())
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
  `;
}

async function ensureStoreFile() {
  await mkdir(STORE_DIR, { recursive: true });
  try {
    await readFile(STORE_PATH, "utf8");
  } catch {
    await writeFile(STORE_PATH, JSON.stringify(defaultStore, null, 2), "utf8");
  }
}

async function loadStoreFromFileUnsafe() {
  await ensureStoreFile();
  const raw = await readFile(STORE_PATH, "utf8");
  return normalizeStore(JSON.parse(raw) as StoreData);
}

async function saveStoreToFileUnsafe(data: StoreData) {
  await writeFile(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function readStore() {
  return runExclusive(async () => {
    const store = hasDatabase()
      ? await loadStoreFromDatabaseUnsafe()
      : await loadStoreFromFileUnsafe();
    return structuredClone(store);
  });
}

export async function updateStore<T>(mutator: (store: StoreData) => Promise<T> | T) {
  return runExclusive(async () => {
    const store = hasDatabase()
      ? await loadStoreFromDatabaseUnsafe()
      : await loadStoreFromFileUnsafe();

    const result = await mutator(store);

    if (hasDatabase()) {
      await saveStoreToDatabaseUnsafe(store);
    } else {
      await saveStoreToFileUnsafe(store);
    }

    return result;
  });
}
