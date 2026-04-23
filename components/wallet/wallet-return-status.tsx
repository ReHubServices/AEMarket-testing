"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type VerifyResponse = {
  status?: string;
  balance?: number;
  error?: string;
};

function readFirstParam(
  params: URLSearchParams,
  keys: string[]
) {
  for (const key of keys) {
    const value = params.get(key)?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

export function WalletReturnStatus() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<"idle" | "verifying" | "success" | "pending" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState<number | null>(null);

  const walletFlag = useMemo(() => {
    const value = readFirstParam(searchParams, ["wallet"]);
    return value === "1" || value.toLowerCase() === "true";
  }, [searchParams]);

  const payRef = useMemo(
    () => readFirstParam(searchParams, ["pay_ref", "payRef", "payment_ref", "ref"]),
    [searchParams]
  );
  const transactionIdFromUrl = useMemo(
    () => readFirstParam(searchParams, ["transactionId", "transaction_id", "tx"]),
    [searchParams]
  );

  useEffect(() => {
    if (!walletFlag) {
      setPhase("idle");
      setMessage("");
      setBalance(null);
      return;
    }

    const pendingTransactionId =
      (typeof window !== "undefined"
        ? window.sessionStorage.getItem("wallet_pending_transaction_id")
        : "") || "";

    if (!payRef) {
      setPhase("pending");
      setMessage("Payment return detected. Waiting for payment confirmation.");
      return;
    }

    let cancelled = false;
    const run = async () => {
      setPhase("verifying");
      setMessage("Verifying payment...");
      try {
        const response = await fetch("/api/wallet/topup/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            payRef,
            transactionId: transactionIdFromUrl || pendingTransactionId || undefined
          })
        });

        const payload = (await response.json().catch(() => ({}))) as VerifyResponse;
        if (cancelled) {
          return;
        }

        if (response.ok) {
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem("wallet_pending_transaction_id");
          }
          if (typeof payload.balance === "number" && Number.isFinite(payload.balance)) {
            setBalance(payload.balance);
          }
          setPhase("success");
          if (payload.status === "already_processed") {
            setMessage("Payment is already processed.");
          } else {
            setMessage("Wallet funded successfully.");
          }
          router.refresh();
          return;
        }

        if (response.status === 409) {
          setPhase("pending");
          setMessage(payload.error || "Payment is still processing. Please wait.");
          return;
        }

        setPhase("error");
        setMessage(payload.error || "Unable to verify payment right now.");
      } catch {
        if (!cancelled) {
          setPhase("error");
          setMessage("Unable to verify payment right now.");
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [walletFlag, payRef, transactionIdFromUrl, router]);

  if (phase === "idle") {
    return null;
  }

  const baseClass =
    "glass-panel rounded-2xl p-4 text-sm";
  if (phase === "success") {
    return (
      <section className={`${baseClass} border border-emerald-300/25 bg-emerald-950/20 text-emerald-100`}>
        <p>{message}</p>
        {balance != null && <p className="mt-1 text-emerald-200">Current balance: {formatPrice(balance)}</p>}
      </section>
    );
  }

  if (phase === "pending" || phase === "verifying") {
    return (
      <section className={`${baseClass} border border-white/15 bg-black/35 text-zinc-200`}>
        <p>{message}</p>
      </section>
    );
  }

  return (
    <section className={`${baseClass} border border-red-300/20 bg-red-950/20 text-red-100`}>
      <p>{message}</p>
    </section>
  );
}
