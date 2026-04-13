"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AdminLoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username,
          password,
          adminOnly: true
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }
      router.push("/admin");
      router.refresh();
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Login failed";
      setError(message);
      setLoading(false);
    }
  }

  return (
    <div className="glass-panel mx-auto w-full max-w-md rounded-3xl p-6 md:p-8">
      <div className="mb-6 space-y-2 text-center">
        <div className="mb-3 flex justify-center">
          <img
            src="/logo.png"
            alt="AE Empire Accounts"
            className="h-14 w-14 rounded-xl object-cover"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        </div>
        <h1 className="font-[var(--font-space-grotesk)] text-3xl font-bold text-white">
          Admin Access
        </h1>
        <p className="text-sm text-zinc-300">Restricted control center login</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <Input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Admin username"
          autoComplete="username"
          required
        />
        <Input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Admin password"
          autoComplete="current-password"
          type="password"
          required
        />
        {error && (
          <div className="rounded-xl border border-red-300/20 bg-red-950/20 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}
        <Button className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </Button>
      </form>
    </div>
  );
}
