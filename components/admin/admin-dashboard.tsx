"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Input } from "@/components/ui/input";
import { AppSettings, OrderRecord, TransactionRecord, UserRecord } from "@/lib/types";

type AdminDashboardProps = {
  stats: {
    users: number;
    orders: number;
    transactions: number;
    volume: number;
  };
  settings: AppSettings;
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

export function AdminDashboard({
  stats,
  settings,
  users,
  orders,
  transactions
}: AdminDashboardProps) {
  const router = useRouter();
  const [markupPercent, setMarkupPercent] = useState(String(settings.markupPercent));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [fundInputs, setFundInputs] = useState<Record<string, string>>({});
  const [fundingKey, setFundingKey] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

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

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="glass-panel rounded-3xl p-5 md:p-6">
          <h3 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
            Users
          </h3>
          <div className="mt-4 max-h-[420px] space-y-3 overflow-auto pr-1">
            {users.map((user) => {
              const key = `user:${user.id}`;
              return (
                <div
                  key={user.id}
                  className="rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm"
                >
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                    <div>
                      <p className="font-medium text-white">{user.username}</p>
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
          </div>
        </div>

        <div className="glass-panel rounded-3xl p-5 md:p-6">
          <h3 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
            Orders
          </h3>
          <div className="mt-4 max-h-[420px] space-y-3 overflow-auto pr-1">
            {orders.map((order) => {
              const key = `order:${order.id}`;
              return (
                <div
                  key={order.id}
                  className="rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm"
                >
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                    <div>
                      <p className="font-medium text-white">{order.title}</p>
                      <p className="text-zinc-400">
                        {order.status} - {order.userId}
                      </p>
                      <p className="break-all text-zinc-300">
                        {formatPrice(order.finalPrice, order.currency)} - {order.id}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="h-9 w-full border border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/20 sm:w-auto"
                      disabled={deletingKey === key}
                      onClick={() => requestDelete("order", order.id, `order ${order.id}`)}
                    >
                      {deletingKey === key ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                </div>
              );
            })}
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
