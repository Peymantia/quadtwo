export type UserRole = "user" | "partner" | "admin";

export type OrderStatus =
  | "pending_payment"
  | "awaiting_review"
  | "paid"
  | "provisioning"
  | "completed"
  | "rejected"
  | "cancelled";

export type PaymentMethod = "card_to_card" | "wallet" | "online_soon" | "crypto_soon";

export interface PlanDto {
  id: string;
  title: string;
  trafficGb: number | null;
  durationDays: number;
  priceUser: number;
  pricePartner: number;
  sortOrder: number;
  active: boolean;
}

export interface SubscriptionDto {
  id: string;
  code: string;
  title: string | null;
  trafficGb: number | null;
  expiresAt: string;
  subUrl: string | null;
  status: "active" | "expired" | "disabled";
}
