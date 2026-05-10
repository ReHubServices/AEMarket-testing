"use client";

import { FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublicViewer, SupportTicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

type SupportCenterProps = {
  viewer: PublicViewer;
  initialTickets: SupportTicketRecord[];
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function SupportCenter({ viewer, initialTickets }: SupportCenterProps) {
  const [tickets, setTickets] = useState<SupportTicketRecord[]>(initialTickets);
  const [activeTicketId, setActiveTicketId] = useState(initialTickets[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replying, setReplying] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeTicket =
    tickets.find((ticket) => ticket.id === activeTicketId) ?? tickets[0] ?? null;

  const sortedTickets = useMemo(
    () => tickets.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tickets]
  );

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          subject,
          message: newMessage
        })
      });
      const payload = (await response.json()) as {
        error?: string;
        ticket?: SupportTicketRecord;
      };
      if (!response.ok || !payload.ticket) {
        throw new Error(payload.error || "Unable to create ticket");
      }
      const next = [payload.ticket, ...tickets.filter((item) => item.id !== payload.ticket?.id)];
      setTickets(next);
      setActiveTicketId(payload.ticket.id);
      setSubject("");
      setNewMessage("");
      setNotice("Ticket opened.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create ticket";
      setNotice(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTicket) {
      return;
    }
    setReplying(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/support/tickets/${encodeURIComponent(activeTicket.id)}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: replyText
        })
      });
      const payload = (await response.json()) as {
        error?: string;
        ticket?: SupportTicketRecord;
      };
      if (!response.ok || !payload.ticket) {
        throw new Error(payload.error || "Unable to send reply");
      }
      setTickets((previous) =>
        previous.map((item) => (item.id === payload.ticket?.id ? payload.ticket : item))
      );
      setReplyText("");
      setNotice("Reply sent.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send reply";
      setNotice(message);
    } finally {
      setReplying(false);
    }
  }

  async function updateStatus(status: "open" | "closed") {
    if (!activeTicket) {
      return;
    }
    setStatusBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/support/tickets/${encodeURIComponent(activeTicket.id)}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });
      const payload = (await response.json()) as {
        error?: string;
        ticket?: SupportTicketRecord;
      };
      if (!response.ok || !payload.ticket) {
        throw new Error(payload.error || "Unable to update status");
      }
      setTickets((previous) =>
        previous.map((item) => (item.id === payload.ticket?.id ? payload.ticket : item))
      );
      setNotice(status === "closed" ? "Ticket closed." : "Ticket reopened.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update status";
      setNotice(message);
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <main className="space-y-6">
      <section className="glass-panel rounded-3xl p-6 md:p-8">
        <h1 className="font-[var(--font-space-grotesk)] text-2xl font-bold text-white md:text-3xl">
          Support Tickets
        </h1>
        <p className="mt-2 text-zinc-300">
          Open a ticket and we will reply in this thread.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="glass-panel rounded-3xl p-5 md:p-6">
          <h2 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
            Open New Ticket
          </h2>
          <form onSubmit={createTicket} className="mt-4 space-y-3">
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Subject"
              maxLength={140}
            />
            <textarea
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
              placeholder="Describe your issue"
              maxLength={3000}
              rows={5}
              className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30"
            />
            <Button className="w-full" disabled={submitting}>
              {submitting ? "Opening..." : "Open Ticket"}
            </Button>
          </form>

          <h3 className="mt-6 font-[var(--font-space-grotesk)] text-base font-semibold text-white">
            Your Tickets
          </h3>
          <div className="mt-3 max-h-[420px] space-y-2 overflow-auto pr-1">
            {sortedTickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setActiveTicketId(ticket.id)}
                className={cn(
                  "w-full rounded-xl border bg-black/35 px-3 py-2 text-left transition",
                  activeTicket?.id === ticket.id
                    ? "border-white/35"
                    : "border-white/15 hover:border-white/25"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-1 text-sm font-semibold text-white">{ticket.subject}</p>
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
                      ticket.status === "open"
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-zinc-500/20 text-zinc-300"
                    )}
                  >
                    {ticket.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">{formatTime(ticket.updatedAt)}</p>
                {viewer.isAdmin && (
                  <p className="mt-1 text-xs text-zinc-300">User: {ticket.username}</p>
                )}
              </button>
            ))}
            {sortedTickets.length === 0 && (
              <div className="rounded-xl border border-white/15 bg-black/35 px-3 py-4 text-sm text-zinc-300">
                No tickets yet.
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-3xl p-5 md:p-6">
          {!activeTicket && (
            <div className="rounded-xl border border-white/15 bg-black/35 px-4 py-6 text-sm text-zinc-300">
              Select a ticket to view the conversation.
            </div>
          )}

          {activeTicket && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
                    {activeTicket.subject}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-400">
                    Ticket {activeTicket.id} - {formatTime(activeTicket.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {viewer.isAdmin && activeTicket.status === "open" && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9"
                      disabled={statusBusy}
                      onClick={() => updateStatus("closed")}
                    >
                      Close Ticket
                    </Button>
                  )}
                  {activeTicket.status === "closed" && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9"
                      disabled={statusBusy}
                      onClick={() => updateStatus("open")}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              </div>

              <div className="max-h-[460px] space-y-3 overflow-auto rounded-2xl border border-white/10 bg-black/20 p-3">
                {activeTicket.messages.map((message) => {
                  const mine =
                    (message.authorType === "support" && viewer.isAdmin) ||
                    (message.authorType === "user" && message.authorId === viewer.id);
                  return (
                    <div
                      key={message.id}
                      className={cn("flex", mine ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-xl border px-3 py-2 text-sm",
                          mine
                            ? "border-white/30 bg-white/10 text-white"
                            : "border-white/15 bg-black/35 text-zinc-100"
                        )}
                      >
                        <p className="text-xs text-zinc-400">
                          {message.authorName} - {formatTime(message.createdAt)}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words">{message.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form onSubmit={sendReply} className="space-y-2">
                <textarea
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  placeholder="Write a reply"
                  maxLength={3000}
                  rows={4}
                  disabled={activeTicket.status === "closed"}
                  className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <Button className="w-full sm:w-auto" disabled={replying || activeTicket.status === "closed"}>
                  {replying ? "Sending..." : "Send Reply"}
                </Button>
              </form>
            </div>
          )}
          {notice && <p className="mt-4 text-sm text-zinc-300">{notice}</p>}
        </div>
      </section>
    </main>
  );
}
