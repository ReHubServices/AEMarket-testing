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
  currency: string;
  status: OrderStatus;
  transactionId: string;
  supplierOrderId: string | null;
  delivery: DeliveryPayload | null;
  failureReason: string | null;
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
};

export type StoreData = {
  users: UserRecord[];
  orders: OrderRecord[];
  transactions: TransactionRecord[];
  settings: AppSettings;
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
