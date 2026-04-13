import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { StoreData } from "@/lib/types";

const STORE_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "store.json");

const defaultStore: StoreData = {
  users: [],
  orders: [],
  transactions: [],
  settings: {
    markupPercent: 50
  }
};

let queue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(task: () => Promise<T>) {
  const next = queue.then(task, task);
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function ensureStoreFile() {
  await mkdir(STORE_DIR, { recursive: true });
  try {
    await readFile(STORE_PATH, "utf8");
  } catch {
    await writeFile(STORE_PATH, JSON.stringify(defaultStore, null, 2), "utf8");
  }
}

async function loadStoreUnsafe() {
  await ensureStoreFile();
  const raw = await readFile(STORE_PATH, "utf8");
  return JSON.parse(raw) as StoreData;
}

async function saveStoreUnsafe(data: StoreData) {
  await writeFile(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function readStore() {
  return runExclusive(async () => {
    const store = await loadStoreUnsafe();
    return structuredClone(store);
  });
}

export async function updateStore<T>(mutator: (store: StoreData) => Promise<T> | T) {
  return runExclusive(async () => {
    const store = await loadStoreUnsafe();
    const result = await mutator(store);
    await saveStoreUnsafe(store);
    return result;
  });
}
