import { Fragment } from "react";
import { cn } from "@/lib/utils";

const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

function normalizeHref(raw: string) {
  const value = raw.trim();
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (/^www\./i.test(value)) {
    return `https://${value}`;
  }
  return "";
}

type LinkifiedTextProps = {
  text: string;
  className?: string;
};

export function LinkifiedText({ text, className }: LinkifiedTextProps) {
  const source = String(text ?? "");
  const parts = source.split(URL_PATTERN);

  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {parts.map((part, index) => {
        const href = normalizeHref(part);
        if (!href) {
          return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
        }
        return (
          <a
            key={`${part}-${index}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="break-all text-emerald-300 underline underline-offset-2 transition hover:text-emerald-200"
          >
            {part}
          </a>
        );
      })}
    </span>
  );
}
