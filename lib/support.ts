import { createId } from "@/lib/ids";
import { readStore, updateStore } from "@/lib/store";
import { SupportTicketMessage, SupportTicketRecord } from "@/lib/types";

const FALLBACK_SUPPORT_AUTO_REPLY =
  "Thanks for contacting AE support. We received your ticket and will reply as soon as possible.";
const MAX_TICKETS_PER_USER = 2;

function normalizeTicketText(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

export function resolveSupportAutoReplyText(raw: unknown) {
  if (typeof raw !== "string") {
    return FALLBACK_SUPPORT_AUTO_REPLY;
  }
  const normalized = raw.trim();
  return normalized ? normalized.slice(0, 2000) : FALLBACK_SUPPORT_AUTO_REPLY;
}

export async function listUserSupportTickets(userId: string) {
  const store = await readStore();
  return store.supportTickets
    .filter((ticket) => ticket.userId === userId)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listAllSupportTickets() {
  const store = await readStore();
  return store.supportTickets.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createSupportTicket(input: {
  userId: string;
  username: string;
  subject: string;
  message: string;
}) {
  const subject = normalizeTicketText(input.subject, 140);
  const message = normalizeTicketText(input.message, 3000);
  if (!subject) {
    throw new Error("Ticket subject is required");
  }
  if (!message) {
    throw new Error("Ticket message is required");
  }

  const now = new Date().toISOString();
  return updateStore((store) => {
    const openTicketCountForUser = store.supportTickets.filter(
      (ticket) => ticket.userId === input.userId && ticket.status === "open"
    ).length;
    if (openTicketCountForUser >= MAX_TICKETS_PER_USER) {
      throw new Error("Open ticket limit reached (max 2)");
    }

    const autoReply = resolveSupportAutoReplyText(store.settings.supportAutoReplyText);
    const ticketId = createId("tkt");
    const messages: SupportTicketMessage[] = [
      {
        id: createId("tmsg"),
        authorType: "user",
        authorId: input.userId,
        authorName: input.username,
        text: message,
        createdAt: now,
        automated: false
      },
      {
        id: createId("tmsg"),
        authorType: "support",
        authorId: null,
        authorName: "AE Support",
        text: autoReply,
        createdAt: now,
        automated: true
      }
    ];
    const ticket: SupportTicketRecord = {
      id: ticketId,
      userId: input.userId,
      username: input.username,
      subject,
      status: "open",
      messages,
      createdAt: now,
      updatedAt: now
    };
    store.supportTickets.push(ticket);
    return ticket;
  });
}

export async function replyToSupportTicket(input: {
  ticketId: string;
  actorType: "user" | "support";
  actorId: string | null;
  actorName: string;
  text: string;
}) {
  const ticketId = input.ticketId.trim();
  const text = normalizeTicketText(input.text, 3000);
  if (!ticketId) {
    throw new Error("Ticket ID is required");
  }
  if (!text) {
    throw new Error("Reply text is required");
  }

  const now = new Date().toISOString();
  return updateStore((store) => {
    const ticket = store.supportTickets.find((item) => item.id === ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    ticket.messages.push({
      id: createId("tmsg"),
      authorType: input.actorType,
      authorId: input.actorId,
      authorName: input.actorName.trim() || "Support",
      text,
      createdAt: now,
      automated: false
    });
    ticket.status = "open";
    ticket.updatedAt = now;
    return ticket;
  });
}

export async function setSupportTicketStatus(input: {
  ticketId: string;
  status: "open" | "closed";
}) {
  const ticketId = input.ticketId.trim();
  if (!ticketId) {
    throw new Error("Ticket ID is required");
  }
  return updateStore((store) => {
    const ticket = store.supportTickets.find((item) => item.id === ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    ticket.status = input.status;
    ticket.updatedAt = new Date().toISOString();
    return ticket;
  });
}

export async function deleteSupportTicket(ticketIdInput: string) {
  const ticketId = ticketIdInput.trim();
  if (!ticketId) {
    throw new Error("Ticket ID is required");
  }
  return updateStore((store) => {
    const index = store.supportTickets.findIndex((item) => item.id === ticketId);
    if (index < 0) {
      throw new Error("Ticket not found");
    }
    const [deleted] = store.supportTickets.splice(index, 1);
    return deleted;
  });
}
