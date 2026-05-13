"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Input } from "@/components/ui/input";
import { AppSettings, CouponRecord, OrderRecord, TransactionRecord, UserRecord } from "@/lib/types";

type AdminDashboardProps = {
  stats: {
    users: number;
    orders: number;
    transactions: number;
    volume: number;
  };
  settings: AppSettings;
  coupons: CouponRecord[];
  users: UserRecord[];
  orders: OrderRecord[];
  transactions: TransactionRecord[];
};

type EntityType = "user" | "order" | "transaction";
type ConfirmAction =
  | {
      kind: "delete";
      entity: EntityType;
      id: string;
      label: string;
    }
  | {
      kind: "funds";
      userId: string;
      username: string;
      amount: number;
    };

function formatPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function normalizeDeliveredLabel(label: string) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanDeliveredLabel(label: string) {
  return label
    .trim()
    .replace(/^item\s+/i, "")
    .replace(/^fortnite\s+/i, "")
    .replace(/^uplay\s+r6\s+/i, "")
    .replace(/\s+/g, " ");
}

function isBuyerUsefulDeliveryField(label: string) {
  const normalized = normalizeDeliveredLabel(label);
  if (!normalized) {
    return false;
  }

  const credentialsOrTopSection = [
    "account username",
    "account password",
    "account email",
    "email password",
    "notes",
    "item login data raw",
    "item login data encoded raw",
    "item login data login",
    "item login data password",
    "item login data encoded password",
    "item email login data password",
    "item email login data encoded password",
    "item login"
  ];
  if (credentialsOrTopSection.includes(normalized)) {
    return false;
  }

  const noisySupplierMetadata =
    /(feedback|encoded|raw|item id|item state|category id|published date|update stat date|refreshed date|edit date|pending deletion date|is sticky|item origin|resale|extended guarantee|guarantee|ask discount|custom title|email provider|email type|domain|title en|provider|can view|can update|can report|can manage|max discount|auto bump|transaction stats|status\b|supplier order|order id|reference|nsb)/i;
  if (noisySupplierMetadata.test(normalized)) {
    return false;
  }

  const usefulSignals =
    /(skin count|pickaxe count|dance count|emote count|glider count|shop skins count|shop pickaxes count|shop dances count|shop gliders count|level|wins|rank|hours|inventory value|troph|robux|friends|followers|following|posts|engagement|operators|gems|cups|fighters|country|region|ban|vac status|prime status|faceit|premier|verified|voice chat|subscription|age)/i;
  return usefulSignals.test(normalized);
}

function getVisibleDeliveredItems(items: Array<{ label: string; value: string }>) {
  const deduped = new Set<string>();
  const output: Array<{ label: string; value: string }> = [];
  for (const item of items) {
    if (!isBuyerUsefulDeliveryField(item.label)) {
      continue;
    }
    const cleanedLabel = cleanDeliveredLabel(item.label);
    const cleanedValue = String(item.value ?? "").trim();
    if (!cleanedLabel || !cleanedValue) {
      continue;
    }
    const key = `${normalizeDeliveredLabel(cleanedLabel)}::${cleanedValue.toLowerCase()}`;
    if (deduped.has(key)) {
      continue;
    }
    deduped.add(key);
    output.push({ label: cleanedLabel, value: cleanedValue });
  }
  return output;
}

function pickFirstNonEmpty(values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function splitLoginRaw(value: string) {
  const raw = value.trim();
  if (!raw || !raw.includes(":")) {
    return { login: "", password: "" };
  }
  const index = raw.indexOf(":");
  const login = raw.slice(0, index).trim();
  const password = raw.slice(index + 1).trim();
  return { login, password };
}

export function AdminDashboard({
  stats,
  settings,
  coupons,
  users,
  orders,
  transactions
}: AdminDashboardProps) {
  const router = useRouter();
  const [markupPercent, setMarkupPercent] = useState(String(settings.markupPercent));
  const [homeTitle, setHomeTitle] = useState(settings.homeTitle ?? "");
  const [homeSubtitle, setHomeSubtitle] = useState(settings.homeSubtitle ?? "");
  const [announcementText, setAnnouncementText] = useState(settings.announcementText ?? "");
  const [announcementEnabled, setAnnouncementEnabled] = useState(
    Boolean(settings.announcementEnabled)
  );
  const [supportAutoReplyText, setSupportAutoReplyText] = useState(
    settings.supportAutoReplyText ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [fundInputs, setFundInputs] = useState<Record<string, string>>({});
  const [fundingKey, setFundingKey] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [orderQuery, setOrderQuery] = useState("");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [couponCodeInput, setCouponCodeInput] = useState("");
  const [couponPercentInput, setCouponPercentInput] = useState("10");
  const [couponLimitInput, setCouponLimitInput] = useState("");
  const [couponExpiryInput, setCouponExpiryInput] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);

  async function onSaveMarkup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const value = Number(markupPercent);
      const response = await fetch("/api/admin/markup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          markupPercent: value
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to save");
      }
      setStatus("Markup updated");
      setSaving(false);
      router.refresh();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Save failed";
      setStatus(message);
      setSaving(false);
    }
  }

  async function onSaveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingContent(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/content", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          homeTitle,
          homeSubtitle,
          announcementText,
          announcementEnabled,
          supportAutoReplyText
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to save content");
      }
      setStatus("Homepage content updated");
      setSavingContent(false);
      router.refresh();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Save failed";
      setStatus(message);
      setSavingContent(false);
    }
  }

  async function executeDelete(entity: EntityType, id: string, label: string) {
    const key = `${entity}:${id}`;
    setDeletingKey(key);
    setStatus(null);

    try {
      const response = await fetch("/api/admin/manage", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entity,
          id
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Delete failed");
      }
      setStatus(`${label} deleted`);
      setDeletingKey(null);
      router.refresh();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Delete failed";
      setStatus(message);
      setDeletingKey(null);
    }
  }

  async function executeAddFunds(userId: string, username: string, amount: number) {
    setFundingKey(userId);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/users/funds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId,
          amount
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to add funds");
      }
      setStatus(`Funds added to ${username}`);
      setFundingKey(null);
      setFundInputs((previous) => ({
        ...previous,
        [userId]: ""
      }));
      router.refresh();
    } catch (fundError) {
      const message = fundError instanceof Error ? fundError.message : "Unable to add funds";
      setStatus(message);
      setFundingKey(null);
    }
  }

  async function createCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCouponBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code: couponCodeInput,
          discountPercent: Number(couponPercentInput),
          usageLimit: couponLimitInput.trim() ? Number(couponLimitInput) : null,
          expiresAt: couponExpiryInput.trim() || null
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to create coupon");
      }
      setCouponCodeInput("");
      setCouponPercentInput("10");
      setCouponLimitInput("");
      setCouponExpiryInput("");
      setStatus("Coupon created");
      router.refresh();
    } catch (couponError) {
      const message = couponError instanceof Error ? couponError.message : "Unable to create coupon";
      setStatus(message);
    } finally {
      setCouponBusy(false);
    }
  }

  async function deleteCoupon(couponId: string) {
    setCouponBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/coupons", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: couponId })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to delete coupon");
      }
      setStatus("Coupon deleted");
      router.refresh();
    } catch (couponError) {
      const message = couponError instanceof Error ? couponError.message : "Unable to delete coupon";
      setStatus(message);
    } finally {
      setCouponBusy(false);
    }
  }

  function requestDelete(entity: EntityType, id: string, label: string) {
    setConfirmAction({
      kind: "delete",
      entity,
      id,
      label
    });
  }

  function requestAddFunds(user: UserRecord) {
    const raw = fundInputs[user.id] ?? "";
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus("Enter a valid amount");
      return;
    }

    setConfirmAction({
      kind: "funds",
      userId: user.id,
      username: user.username,
      amount
    });
  }

  async function onConfirmAction() {
    if (!confirmAction) {
      return;
    }

    setConfirmLoading(true);
    if (confirmAction.kind === "delete") {
      await executeDelete(confirmAction.entity, confirmAction.id, confirmAction.label);
    } else {
      await executeAddFunds(confirmAction.userId, confirmAction.username, confirmAction.amount);
    }
    setConfirmLoading(false);
    setConfirmAction(null);
  }

  const confirmTitle =
    confirmAction?.kind === "delete"
      ? "Delete Record"
      : confirmAction?.kind === "funds"
        ? "Add Funds"
        : "";
  const confirmDescription =
    confirmAction?.kind === "delete"
      ? `Delete ${confirmAction.label}? This action cannot be undone.`
      : confirmAction?.kind === "funds"
        ? `Add ${formatPrice(confirmAction.amount, "USD")} to ${confirmAction.username}?`
        : "";
  const confirmLabel = confirmAction?.kind === "delete" ? "Delete" : "Confirm";
  const normalizedUserQuery = userQuery.trim().toLowerCase();
  const filteredUsers = users.filter((user) =>
    !normalizedUserQuery || user.username.toLowerCase().includes(normalizedUserQuery)
  );
  const usersById = useMemo(() => {
    const map = new Map<string, UserRecord>();
    for (const user of users) {
      map.set(user.id, user);
    }
    return map;
  }, [users]);
  const normalizedOrderQuery = orderQuery.trim().toLowerCase();
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (!normalizedOrderQuery) {
          return true;
        }
        const username = usersById.get(order.userId)?.username?.toLowerCase() ?? "";
        return (
          order.id.toLowerCase().includes(normalizedOrderQuery) ||
          order.title.toLowerCase().includes(normalizedOrderQuery) ||
          order.userId.toLowerCase().includes(normalizedOrderQuery) ||
          username.includes(normalizedOrderQuery)
        );
      }),
    [orders, normalizedOrderQuery, usersById]
  );

  return (
    <main className="space-y-6">
      <section className="glass-panel rounded-3xl p-6 md:p-8">
        <h1 className="font-[var(--font-space-grotesk)] text-2xl font-bold text-white md:text-3xl">
          Admin Control Center
        </h1>
        <p className="mt-2 text-zinc-300">Monitor users, orders, payments, and pricing.</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/15 bg-black/35 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Users</p>
            <p className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-bold text-white">
              {stats.users}
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-black/35 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Orders</p>
            <p className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-bold text-white">
              {stats.orders}
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-black/35 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Transactions</p>
            <p className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-bold text-white">
              {stats.transactions}
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-black/35 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Volume</p>
            <p className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-bold text-white">
              {formatPrice(stats.volume, "USD")}
            </p>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-3xl p-5 md:p-6">
        <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
          Global Markup
        </h2>
        <form onSubmit={onSaveMarkup} className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            type="number"
            min={0}
            max={500}
            step={0.5}
            value={markupPercent}
            onChange={(event) => setMarkupPercent(event.target.value)}
            className="w-full max-w-xs"
          />
          <Button className="w-full md:w-auto" disabled={saving}>
            {saving ? "Saving..." : "Save Markup"}
          </Button>
          {status && <p className="text-sm text-zinc-300 md:self-center">{status}</p>}
        </form>
      </section>

      <section className="glass-panel rounded-3xl p-5 md:p-6">
        <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
          Coupons
        </h2>
        <form onSubmit={createCoupon} className="mt-4 grid gap-2 md:grid-cols-5">
          <Input
            value={couponCodeInput}
            onChange={(event) => setCouponCodeInput(event.target.value.toUpperCase())}
            placeholder="Code (e.g. SAVE10)"
            className="h-9"
            maxLength={32}
          />
          <Input
            type="number"
            min={1}
            max={95}
            value={couponPercentInput}
            onChange={(event) => setCouponPercentInput(event.target.value)}
            placeholder="% off"
            className="h-9"
          />
          <Input
            type="number"
            min={1}
            value={couponLimitInput}
            onChange={(event) => setCouponLimitInput(event.target.value)}
            placeholder="Usage limit (optional)"
            className="h-9"
          />
          <Input
            type="date"
            value={couponExpiryInput}
            onChange={(event) => setCouponExpiryInput(event.target.value)}
            className="h-9"
          />
          <Button type="submit" className="h-9" disabled={couponBusy}>
            {couponBusy ? "Saving..." : "Add Coupon"}
          </Button>
        </form>
        <div className="mt-4 max-h-[220px] space-y-2 overflow-auto pr-1">
          {coupons.map((coupon) => (
            <div
              key={coupon.id}
              className="flex flex-col gap-2 rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm md:flex-row md:items-center md:justify-between"
            >
              <div className="text-zinc-200">
                <p className="font-medium text-white">
                  {coupon.code} - {coupon.discountPercent}% off
                </p>
                <p className="text-xs text-zinc-400">
                  Used {coupon.usedCount}
                  {coupon.usageLimit ? ` / ${coupon.usageLimit}` : ""} |{" "}
                  {coupon.expiresAt ? `Expires ${formatDateTime(coupon.expiresAt)}` : "No expiry"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-white/15 px-2 py-1 text-xs text-zinc-300">
                  {coupon.isActive ? "Active" : "Disabled"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 border border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                  disabled={couponBusy}
                  onClick={() => deleteCoupon(coupon.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {coupons.length === 0 && (
            <div className="rounded-xl border border-white/15 bg-black/35 px-3 py-4 text-sm text-zinc-300">
              No coupons yet.
            </div>
          )}
        </div>
      </section>

      <section className="glass-panel rounded-3xl p-5 md:p-6">
        <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
          Homepage Content
        </h2>
        <form onSubmit={onSaveContent} className="mt-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.14em] text-zinc-400">Title</span>
            <Input
              value={homeTitle}
              onChange={(event) => setHomeTitle(event.target.value)}
              maxLength={120}
              className="w-full"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.14em] text-zinc-400">Subtitle</span>
            <textarea
              value={homeSubtitle}
              onChange={(event) => setHomeSubtitle(event.target.value)}
              maxLength={400}
              rows={3}
              className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.14em] text-zinc-400">Announcement</span>
            <textarea
              value={announcementText}
              onChange={(event) => setAnnouncementText(event.target.value)}
              maxLength={1200}
              rows={4}
              placeholder="Write an announcement shown on the homepage"
              className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30"
            />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={announcementEnabled}
              onChange={(event) => setAnnouncementEnabled(event.target.checked)}
              className="h-4 w-4"
            />
            Show announcement on homepage
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.14em] text-zinc-400">
              Support Auto Reply
            </span>
            <textarea
              value={supportAutoReplyText}
              onChange={(event) => setSupportAutoReplyText(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Default support auto-reply sent when a new ticket is opened"
              className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30"
            />
          </label>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Button className="w-full md:w-auto" disabled={savingContent}>
              {savingContent ? "Saving..." : "Save Content"}
            </Button>
            {status && <p className="text-sm text-zinc-300 md:self-center">{status}</p>}
          </div>
        </form>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="glass-panel rounded-3xl p-5 md:p-6">
          <h3 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
            Users
          </h3>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
              placeholder="Search by username"
              className="h-9 w-full"
            />
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Showing {filteredUsers.length} of {users.length} users
          </p>
          <div className="mt-4 max-h-[420px] space-y-3 overflow-auto pr-1">
            {filteredUsers.map((user) => {
              const key = `user:${user.id}`;
              return (
                <div
                  key={user.id}
                  className="rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm"
                >
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                    <div>
                      <p className="font-medium text-white">{user.username}</p>
                      <p className="break-all text-xs text-zinc-400">{user.id}</p>
                      <p className="text-zinc-400">{user.isAdmin ? "Admin" : "User"}</p>
                      <p className="text-zinc-300">{formatPrice(user.balance, "USD")}</p>
                    </div>
                    <Button
                      variant="ghost"
                      className="h-9 w-full border border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/20 sm:w-auto"
                      disabled={deletingKey === key || user.isAdmin}
                      onClick={() => requestDelete("user", user.id, `user ${user.username}`)}
                    >
                      {deletingKey === key ? "Deleting..." : user.isAdmin ? "Protected" : "Delete"}
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      type="number"
                      min={0.01}
                      step={0.01}
                      placeholder="Amount"
                      value={fundInputs[user.id] ?? ""}
                      onChange={(event) =>
                        setFundInputs((previous) => ({
                          ...previous,
                          [user.id]: event.target.value
                        }))
                      }
                      className="h-9 w-full sm:max-w-[160px]"
                    />
                    <Button
                      type="button"
                      className="h-9 w-full sm:w-[120px]"
                      disabled={fundingKey === user.id}
                      onClick={() => requestAddFunds(user)}
                    >
                      {fundingKey === user.id ? "Adding..." : "Add Funds"}
                    </Button>
                  </div>
                </div>
              );
            })}
            {filteredUsers.length === 0 && (
              <div className="rounded-xl border border-white/15 bg-black/35 px-3 py-4 text-sm text-zinc-300">
                No users match your search.
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-3xl p-5 md:p-6">
          <h3 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
            Orders
          </h3>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={orderQuery}
              onChange={(event) => setOrderQuery(event.target.value)}
              placeholder="Search by username, user ID, title, or order ID"
              className="h-9 w-full"
            />
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Showing {filteredOrders.length} of {orders.length} orders
          </p>
          <div className="mt-4 max-h-[420px] space-y-3 overflow-auto pr-1">
            {filteredOrders.map((order) => {
              const key = `order:${order.id}`;
              const owner = usersById.get(order.userId);
              const ownerName = owner?.username ?? order.userId;
              const expanded = activeOrderId === order.id;
              const visibleDeliveredItems = order.delivery
                ? getVisibleDeliveredItems(order.delivery.deliveredItems)
                : [];
              const deliveredLookup = new Map<string, string>();
              if (order.delivery) {
                for (const item of order.delivery.deliveredItems) {
                  const key = normalizeDeliveredLabel(item.label);
                  const value = String(item.value ?? "").trim();
                  if (!key || !value || deliveredLookup.has(key)) {
                    continue;
                  }
                  deliveredLookup.set(key, value);
                }
              }
              const parsedEmailLoginRaw = splitLoginRaw(
                pickFirstNonEmpty([deliveredLookup.get("item email login data raw")])
              );
              const displayEmailPassword = pickFirstNonEmpty([
                deliveredLookup.get("item email login data password"),
                deliveredLookup.get("item email login data encoded password"),
                deliveredLookup.get("email password"),
                deliveredLookup.get("mail password"),
                parsedEmailLoginRaw.password,
                "Not provided"
              ]);
              return (
                <div
                  key={order.id}
                  className="rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm"
                >
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                    <div>
                      <p className="font-medium text-white">{order.title}</p>
                      <p className="text-zinc-400">
                        {order.status} - {ownerName}
                      </p>
                      <p className="break-all text-zinc-300">
                        {formatPrice(order.finalPrice, order.currency)} - {order.id}
                      </p>
                    </div>
                    <div className="flex w-full gap-2 sm:w-auto">
                      <Button
                        variant="ghost"
                        className="h-9 flex-1 sm:w-auto"
                        onClick={() => setActiveOrderId(expanded ? null : order.id)}
                      >
                        {expanded ? "Hide" : "View"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-9 flex-1 border border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/20 sm:w-auto"
                        disabled={deletingKey === key}
                        onClick={() => requestDelete("order", order.id, `order ${order.id}`)}
                      >
                        {deletingKey === key ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-zinc-400">Username</p>
                          <p className="text-zinc-100">{ownerName}</p>
                        </div>
                        <div>
                          <p className="text-zinc-400">User Reference</p>
                          <p className="break-all text-zinc-100">{owner?.username ? `${owner.username} (${order.userId})` : order.userId}</p>
                        </div>
                        <div>
                          <p className="text-zinc-400">Order ID</p>
                          <p className="break-all text-zinc-100">{order.id}</p>
                        </div>
                        <div>
                          <p className="text-zinc-400">Listing ID</p>
                          <p className="break-all text-zinc-100">{order.listingId}</p>
                        </div>
                        <div>
                          <p className="text-zinc-400">Created</p>
                          <p className="text-zinc-100">{formatDateTime(order.createdAt)}</p>
                        </div>
                        <div>
                          <p className="text-zinc-400">Updated</p>
                          <p className="text-zinc-100">{formatDateTime(order.updatedAt)}</p>
                        </div>
                        <div>
                          <p className="text-zinc-400">Supplier Order</p>
                          <p className="break-all text-zinc-100">{order.supplierOrderId || "Pending"}</p>
                        </div>
                        <div>
                          <p className="text-zinc-400">Failure</p>
                          <p className="text-zinc-100">{order.failureReason || "None"}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-zinc-400">Delivered Data</p>
                        {!order.delivery && (
                          <p className="mt-1 text-zinc-200">Not delivered yet.</p>
                        )}
                        {order.delivery && (
                          <div className="mt-2 space-y-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <p className="text-zinc-400">Account Username</p>
                                <p className="text-zinc-100">{order.delivery.accountUsername}</p>
                              </div>
                              <div>
                                <p className="text-zinc-400">Account Password</p>
                                <p className="text-zinc-100">{order.delivery.accountPassword}</p>
                              </div>
                              <div>
                                <p className="text-zinc-400">Account Email</p>
                                <p className="text-zinc-100">{order.delivery.accountEmail || "Not provided"}</p>
                              </div>
                              <div>
                                <p className="text-zinc-400">Email Password</p>
                                <p className="text-zinc-100">{displayEmailPassword}</p>
                              </div>
                              <div>
                                <p className="text-zinc-400">Notes</p>
                                <p className="text-zinc-100">{order.delivery.notes || "No notes"}</p>
                              </div>
                            </div>
                            <div className="max-h-44 overflow-auto rounded-lg border border-white/10 bg-black/25 p-2">
                              {visibleDeliveredItems.length === 0 && (
                                <p className="text-zinc-300">No delivered item entries.</p>
                              )}
                              {visibleDeliveredItems.map((item, index) => (
                                <div
                                  key={`${item.label}-${item.value}-${index}`}
                                  className="grid grid-cols-[1fr_1fr] gap-2 border-b border-white/10 py-1 last:border-b-0"
                                >
                                  <p className="text-zinc-300">{item.label}</p>
                                  <p className="break-all text-zinc-100">{item.value}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredOrders.length === 0 && (
              <div className="rounded-xl border border-white/15 bg-black/35 px-3 py-4 text-sm text-zinc-300">
                No orders match your search.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-3xl p-5 md:p-6">
        <h3 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
          Transactions
        </h3>
        <div className="mt-4 max-h-[360px] space-y-3 overflow-auto pr-1">
          {transactions.map((transaction) => {
            const key = `transaction:${transaction.id}`;
            return (
              <div
                key={transaction.id}
                className="rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm"
              >
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                  <div>
                    <p className="font-medium text-white">
                      {transaction.type} - {transaction.status}
                    </p>
                    <p className="text-zinc-400">{transaction.orderId || "No order"}</p>
                    <p className="break-all text-zinc-300">
                      {formatPrice(transaction.amount, transaction.currency)} - {transaction.id}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="h-9 w-full border border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/20 sm:w-auto"
                    disabled={deletingKey === key}
                    onClick={() =>
                      requestDelete("transaction", transaction.id, `transaction ${transaction.id}`)
                    }
                  >
                    {deletingKey === key ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <ConfirmModal
        open={Boolean(confirmAction)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        destructive={confirmAction?.kind === "delete"}
        loading={confirmLoading}
        onCancel={() => {
          if (!confirmLoading) {
            setConfirmAction(null);
          }
        }}
        onConfirm={onConfirmAction}
      />
    </main>
  );
}
