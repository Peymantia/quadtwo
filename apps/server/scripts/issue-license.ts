#!/usr/bin/env npx tsx
/**
 * Issue a signed QuadTwo license key for a buyer.
 *
 * Usage:
 *   npx tsx apps/server/scripts/issue-license.ts --admins 123456789 --host dash.buyer.com
 *   QUADTWO_LICENSE_SECRET=... npx tsx apps/server/scripts/issue-license.ts --admins 111,222 --host dash.x.com
 *
 * Buyer activates with: q2 activate
 */
import { issueLicenseKey } from "../src/services/license.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

const admins = arg("--admins") || arg("-a") || "";
const host = arg("--host") || "";

if (!admins || !host) {
  console.error("Usage: issue-license.ts --admins TELEGRAM_ID[,ID2] --host dash.example.com");
  process.exit(1);
}

try {
  const key = issueLicenseKey(admins, host);
  console.log("");
  console.log("License key (give to buyer):");
  console.log(key);
  console.log("");
  console.log("Buyer runs on VPS:");
  console.log("  q2 activate");
  console.log("  # paste the key when prompted");
  console.log("");
  console.log("Bound to:");
  console.log(`  admins: ${admins}`);
  console.log(`  host:   ${host}`);
  console.log("");
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
}
