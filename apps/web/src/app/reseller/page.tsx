"use client";

import { AgentPanel } from "../../components/AgentPanel";

export default function ResellerPage() {
  return <AgentPanel title="پنل همکار ویژه" allowed={["wholesale", "admin"]} />;
}
