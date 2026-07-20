"use client";

import { AgentPanel } from "../../components/AgentPanel";

export default function ResellerPage() {
  return <AgentPanel title="پنل عمده‌فروش" allowed={["wholesale", "admin"]} />;
}
