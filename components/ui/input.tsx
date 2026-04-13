import * as React from "react";
import { cn } from "@/lib/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-12 w-full rounded-xl border border-white/15 bg-black/35 px-4 text-sm text-white placeholder:text-zinc-400 transition focus-visible:outline-none focus-visible:shadow-focus",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
