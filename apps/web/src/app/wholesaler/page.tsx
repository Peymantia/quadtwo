"use client";

import { AgentPanel } from "../../components/AgentPanel";

/** عمده‌فروش — خرید فقط از پلن‌های ثابت تعریف‌شده توسط ادمین */
export default function WholesalerPage() {
  return <AgentPanel title="پنل عمده‌فروش" allowed={["reseller", "admin"]} />;
}
