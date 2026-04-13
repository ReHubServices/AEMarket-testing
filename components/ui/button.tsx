import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "ghost";
};

export function Button({ className, variant = "solid", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50",
        variant === "solid" &&
          "bg-white text-black hover:bg-zinc-200 active:scale-[0.99]",
        variant === "ghost" &&
          "border border-white/15 bg-white/5 text-white hover:border-white/30 hover:bg-white/10",
        className
      )}
      {...props}
    />
  );
}
