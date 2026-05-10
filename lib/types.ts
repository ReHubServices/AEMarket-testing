export type PublicViewer = {
  id: string;
  username: string;
  email: string | null;
  balance: number;
  isAdmin: boolean;
};

export type SessionRole = "user" | "admin";

export type SessionPayload = {
  uid: string;
  role: SessionRole;
  exp: number;
};

export type UserRecord = {
  id: string;
  username: string;
  email: string | null;
  passwordHash: string;
  balance: number;
  isAdmin: boolean;
  createdAt: string;
};

export type DeliveryPayload = {
  accountUsername: string;
  accountPassword: string;
  accountEmail: string | null;
  notes: string | null;
  deliveredItems: Array<{
    label: string;
    value: string;
  }>;
};

export type OrderStatus =
  | "pending_payment"
  | "processing"
  | "completed"
  | "failed"
  | "awaiting_balance";

export type OrderRecord = {
  id: string;
  userId: string;
  listingId: string;
  title: string;
  imageUrl: string;
  game: string;
  category: string;
  basePrice: number;
  finalPrice: number;
  couponCode?: string | null;
  couponDiscountAmount?: number | null;
  currency: string;
  status: OrderStatus;
  transactionId: string;
  supplierOrderId: string | null;
  delivery: DeliveryPayload | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CouponRecord = {
  id: string;
  code: string;
  discountPercent: number;
  isActive: boolean;
  usageLimit: number | null;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TransactionType = "payment_credit" | "purchase_debit" | "refund_credit";
export type TransactionStatus = "pending" | "completed" | "failed";

export type TransactionRecord = {
  id: string;
  userId: string;
  orderId: string | null;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  providerAltPaymentId?: string | null;
  checkoutUrl: string | null;
  details: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  markupPercent: number;
  homeTitle: string;
  homeSubtitle: string;
  announcementText: string;
  announcementEnabled: boolean;
  supportAutoReplyText: string;
};

export type SupportTicketStatus = "open" | "closed";

export type SupportTicketMessage = {
  id: string;
  authorType: "user" | "support";
  authorId: string | null;
  authorName: string;
  text: string;
  createdAt: string;
  automated: boolean;
};

export type SupportTicketRecord = {
  id: string;
  userId: string;
  username: string;
  subject: string;
  status: SupportTicketStatus;
  messages: SupportTicketMessage[];
  createdAt: string;
  updatedAt: string;
};

export type SearchStatRecord = {
  term: string;
  count: number;
  lastSearchedAt: string;
};

export type StoreData = {
  users: UserRecord[];
  orders: OrderRecord[];
  transactions: TransactionRecord[];
  supportTickets: SupportTicketRecord[];
  coupons: CouponRecord[];
  settings: AppSettings;
  searchStats: SearchStatRecord[];
};

export type MarketListingSpec = {
  label: string;
  value: string;
};

export type MarketListing = {
  id: string;
  title: string;
  imageUrl: string;
  price: number;
  basePrice: number;
  currency: string;
  game: string;
  category: string;
  description: string;
  specs: MarketListingSpec[];
};
