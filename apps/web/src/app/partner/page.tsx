"use client";

import { AgentPanel } from "../../components/AgentPanel";

export default function PartnerPage() {
  return <AgentPanel title="پنل همکار" allowed={["partner", "admin"]} />;
}
