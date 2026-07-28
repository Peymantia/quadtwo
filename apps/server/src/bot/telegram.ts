import { Bot } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { env } from "../config/env.js";

export function getTelegramProxyUrl(): string | undefined {
  const proxy =
    process.env.TELEGRAM_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim();

  if (proxy && !/^https?:\/\//i.test(proxy)) {
    return `http://${proxy}`;
  }
  return proxy || undefined;
}

export function createTelegramBot(token = env.BOT_TOKEN) {
  const proxyUrl = getTelegramProxyUrl();
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  return new Bot(token, {
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
