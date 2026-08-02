"use client";

import { AgentPanel } from "../../components/AgentPanel";

/** همکار ویژه (reseller) */
export default function ResellerPage() {
  return <AgentPanel title="پنل همکار ویژه" allowed={["reseller", "admin"]} />;
}
