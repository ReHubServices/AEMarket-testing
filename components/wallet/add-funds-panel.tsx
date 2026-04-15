"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const quickAmounts = [10, 25, 50, 100, 250];

export function AddFundsPanel() {
  const router = useRouter();
  const [amount, setAmount] = useState("50");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericAmount = useMemo(() => Number(amount), [amount]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: numericAmount,
          currency: "USD"
        })
      });
      const payload = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to create top-up");
      }
      if (!payload.checkoutUrl) {
        throw new Error("Checkout URL missing");
      }
      window.location.assign(payload.checkoutUrl);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Top-up failed";
      setError(message);
      setLoading(false);
      router.refresh();
    }
  }

  return (
    <div className="glass-panel mx-auto w-full max-w-xl rounded-3xl p-5 sm:p-6 md:p-8">
      <div className="space-y-2">
        <h1 className="font-[var(--font-space-grotesk)] text-2xl font-bold text-white sm:text-3xl">
          Add Funds
        </h1>
        <p className="text-sm text-zinc-300">
          Top up your wallet once, then buy accounts instantly.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {quickAmounts.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setAmount(String(value))}
            className={`rounded-xl border px-3 py-2 text-sm transition sm:min-w-[84px] ${
              Number(amount) === value
                ? "border-white/35 bg-white/15 text-white"
                : "border-white/15 bg-black/40 text-zinc-300 hover:border-white/30 hover:text-white"
            }`}
          >
            ${value}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-3">
        <Input
          type="number"
          min={3}
          max={10000}
          step={1}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Amount in USD"
        />
        {error && (
          <div className="rounded-xl border border-red-300/20 bg-red-950/20 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}
        <Button className="w-full" disabled={loading}>
          {loading ? "Redirecting..." : `Continue with $${Number.isFinite(numericAmount) ? numericAmount.toFixed(2) : "0.00"}`}
        </Button>
      </form>
    </div>
  );
}
