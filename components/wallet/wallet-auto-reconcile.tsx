"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ReconcileResponse = {
  checked?: number;
  credited?: number;
  balance?: number;
  error?: string;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

export function WalletAutoReconcile() {
  const router = useRouter();
  const [credited, setCredited] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const response = await fetch("/api/wallet/topup/reconcile", {
          method: "POST",
          cache: "no-store"
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json().catch(() => ({}))) as ReconcileResponse;
        if (cancelled) {
          return;
        }
        const creditedCount = Number(payload.credited ?? 0);
        if (creditedCount > 0) {
          setCredited(creditedCount);
          if (typeof payload.balance === "number" && Number.isFinite(payload.balance)) {
            setBalance(payload.balance);
          }
          router.refresh();
        }
      } catch {
        return;
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!credited || credited < 1) {
    return null;
  }

  return (
    <section className="glass-panel rounded-2xl border border-emerald-300/25 bg-emerald-950/20 p-4 text-sm text-emerald-100">
      <p>Confirmed payment received and wallet was updated.</p>
      {balance != null && <p className="mt-1 text-emerald-200">Current balance: {formatPrice(balance)}</p>}
    </section>
  );
}
