"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type UserAuthFormProps = {
  mode: "login" | "register";
};

export function UserAuthForm({ mode }: UserAuthFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = { username, password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      window.location.assign(next);
      router.refresh();
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : "Request failed";
      setError(message);
      setLoading(false);
    }
  }

  return (
    <div className="glass-panel mx-auto w-full max-w-md rounded-3xl p-6 md:p-8">
      <div className="mb-6 space-y-2 text-center">
        <div className="mb-3 flex justify-center">
          <img
            src="/Logo.png"
            alt="AE Empire Accounts"
            className="h-14 w-14 rounded-xl object-cover"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        </div>
        <h1 className="font-[var(--font-space-grotesk)] text-3xl font-bold text-white">
          {mode === "login" ? "Welcome Back" : "Create Account"}
        </h1>
        <p className="text-sm text-zinc-300">
          {mode === "login"
            ? "Login to complete purchases and access delivered items."
            : "Register to buy listings and track your orders."}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <Input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          autoComplete="username"
          required
        />
        <Input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          type="password"
          required
        />

        {error && (
          <div className="rounded-xl border border-red-300/20 bg-red-950/20 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        <Button className="w-full" disabled={loading}>
          {loading
            ? "Please wait..."
            : mode === "login"
              ? "Login"
              : "Register"}
        </Button>
      </form>

      <div className="mt-5 text-center text-sm text-zinc-300">
        {mode === "login" ? (
          <>
            Need an account?{" "}
            <Link href="/register" className="text-white underline underline-offset-4">
              Register
            </Link>
          </>
        ) : (
          <>
            Already registered?{" "}
            <Link href="/login" className="text-white underline underline-offset-4">
              Login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
