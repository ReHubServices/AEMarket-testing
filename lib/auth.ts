import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createId } from "@/lib/ids";
import { readStore, updateStore } from "@/lib/store";
import { PublicViewer, UserRecord } from "@/lib/types";

const scrypt = promisify(scryptCallback);

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function sanitizeEmail(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function validateUsername(value: string) {
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(value)) {
    return false;
  }
  return true;
}

export function validatePassword(value: string) {
  if (value.length < 8 || value.length > 72) {
    return false;
  }
  return true;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) {
    return false;
  }
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== derived.length) {
    return false;
  }
  return timingSafeEqual(actual, derived);
}

export function toPublicViewer(user: UserRecord): PublicViewer {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    balance: user.balance,
    isAdmin: user.isAdmin
  };
}

export async function ensureAdminUser() {
  const adminUsername =
    process.env.ADMIN_USERNAME?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "aeadmin");
  const adminPassword =
    process.env.ADMIN_PASSWORD?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "ChangeMe123!");
  const adminEmail = process.env.ADMIN_EMAIL?.trim() || "admin@ae-empire.local";

  if (process.env.NODE_ENV === "production" && (!adminUsername || !adminPassword)) {
    return;
  }

  const normalized = normalizeUsername(adminUsername);

  if (adminUsername.length < 3 || adminUsername.length > 80 || !validatePassword(adminPassword)) {
    return;
  }

  await updateStore(async (store) => {
    const existingByRole = store.users.find((user) => user.isAdmin);
    if (existingByRole) {
      existingByRole.username = normalized;
      existingByRole.email = sanitizeEmail(adminEmail);
      const samePassword = await verifyPassword(adminPassword, existingByRole.passwordHash);
      if (!samePassword) {
        existingByRole.passwordHash = await hashPassword(adminPassword);
      }
      return;
    }

    const existingByName = store.users.find(
      (user) => normalizeUsername(user.username) === normalized
    );
    if (existingByName) {
      existingByName.isAdmin = true;
      existingByName.username = normalized;
      existingByName.email = sanitizeEmail(adminEmail);
      const samePassword = await verifyPassword(adminPassword, existingByName.passwordHash);
      if (!samePassword) {
        existingByName.passwordHash = await hashPassword(adminPassword);
      }
      return;
    }

    store.users.push({
      id: createId("usr"),
      username: normalized,
      email: sanitizeEmail(adminEmail),
      passwordHash: await hashPassword(adminPassword),
      balance: 0,
      isAdmin: true,
      createdAt: new Date().toISOString()
    });
  });
}

export async function registerUser(input: {
  username: string;
  password: string;
  email?: string;
}) {
  const username = normalizeUsername(input.username);
  const email = sanitizeEmail(input.email);
  const password = input.password;

  if (!validateUsername(username)) {
    throw new Error("Username must be 3-24 chars using letters, numbers, or underscore");
  }
  if (!validatePassword(password)) {
    throw new Error("Password must be 8-72 characters");
  }

  return updateStore(async (store) => {
    const exists = store.users.some(
      (user) => normalizeUsername(user.username) === username
    );
    if (exists) {
      throw new Error("Username already taken");
    }

    const user: UserRecord = {
      id: createId("usr"),
      username,
      email,
      passwordHash: await hashPassword(password),
      balance: 0,
      isAdmin: false,
      createdAt: new Date().toISOString()
    };

    store.users.push(user);
    return toPublicViewer(user);
  });
}

export async function loginUser(input: {
  username: string;
  password: string;
  adminOnly?: boolean;
}) {
  const username = normalizeUsername(input.username);
  const password = input.password;

  const hasAdminUsername = Boolean(process.env.ADMIN_USERNAME?.trim());
  const hasAdminPassword = Boolean(process.env.ADMIN_PASSWORD?.trim());
  if (input.adminOnly && process.env.NODE_ENV === "production") {
    if (!hasAdminUsername || !hasAdminPassword) {
      throw new Error("ADMIN_CREDENTIALS_NOT_CONFIGURED");
    }
    if (
      process.env.ADMIN_USERNAME!.trim().length < 3 ||
      process.env.ADMIN_USERNAME!.trim().length > 80 ||
      !validatePassword(process.env.ADMIN_PASSWORD!.trim())
    ) {
      throw new Error("ADMIN_CREDENTIALS_INVALID");
    }
  }

  await ensureAdminUser();

  const store = await readStore();
  const user = store.users.find((item) => normalizeUsername(item.username) === username);
  if (!user) {
    return null;
  }

  const match = await verifyPassword(password, user.passwordHash);
  if (!match) {
    return null;
  }

  if (input.adminOnly && !user.isAdmin) {
    return null;
  }

  return user;
}

export async function getUserById(userId: string) {
  const store = await readStore();
  return store.users.find((user) => user.id === userId) ?? null;
}
