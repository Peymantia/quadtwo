import { Bot } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { env } from "../config/env.js";

export function createTelegramBot() {
  const proxy = process.env.TELEGRAM_PROXY?.trim() || process.env.HTTPS_PROXY?.trim();

  if (proxy && !/^https?:\/\//i.test(proxy)) {
    // allow host:port form
    process.env.TELEGRAM_PROXY = `http://${proxy}`;
  }

  const proxyUrl = process.env.TELEGRAM_PROXY?.trim();
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  return new Bot(env.BOT_TOKEN, {
    client: agent
      ? {
          baseFetchConfig: {
            agent,
            compress: true,
          },
        }
      : undefined,
  });
}
