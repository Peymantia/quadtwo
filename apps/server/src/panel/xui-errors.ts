/**
 * Human-readable errors for 3x-ui / MHSanaei panel API failures.
 */
export function formatXuiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("aborted")
  ) {
    return "اتصال به پنل 3x-ui برقرار نشد. آدرس پنل (XUI_BASE_URL) و دسترسی شبکه سرور را چک کنید.";
  }

  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("token") ||
    lower.includes("auth")
  ) {
    return "توکن API پنل نامعتبر است یا منقضی شده. در پنل: Settings → Security → API Token را تازه کنید و در .env بگذارید (XUI_API_TOKEN).";
  }

  if (lower.includes("inbound") || lower.includes("no inbound")) {
    return "Inbound پیدا نشد یا غیرفعال است. در کنترل سنتر «Inbounds» را روی شناسه‌های فعال پنل تنظیم کنید.";
  }

  if (lower.includes("group") || lower.includes("bulkadd")) {
    return "ساخت یا افزودن به گروه پنل ناموفق بود. نام گروه را در پنل چک کنید یا دستی گروه Telegram بسازید.";
  }

  if (lower.includes("duplicate") || lower.includes("already exist") || lower.includes("email")) {
    return "این نام اکانت در پنل تکراری است. نام دیگری انتخاب کنید.";
  }

  if (lower.includes("xui_base_url") || lower.includes("xui_api_token") || lower.includes("are not set")) {
    return "تنظیمات پنل ناقص است. XUI_BASE_URL و XUI_API_TOKEN را در .env پر کنید.";
  }

  if (lower.includes("هیچ inbound")) {
    return raw;
  }

  // Keep short technical hint for admins
  const short = raw.replace(/^Error:\s*/i, "").slice(0, 180);
  return `خطای پنل 3x-ui: ${short}`;
}

export function wrapXui<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    throw new Error(formatXuiError(err));
  });
}

/** User-facing bot error: keep Persian app messages, clarify panel failures. */
export function friendlyBotError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const cleaned = raw.replace(/^Error:\s*/, "");
  if (
    /^[\u0600-\u06FF]/.test(cleaned) &&
    !/3x-ui|xui_/i.test(cleaned) &&
    !cleaned.includes("هیچ inbound")
  ) {
    return cleaned;
  }
  if (
    /3x-ui|xui_|inbound|token|unauthorized|forbidden|econnrefused|enotfound|fetch failed|bulkadd|group/i.test(
      cleaned,
    ) ||
    cleaned.includes("هیچ inbound")
  ) {
    return formatXuiError(err);
  }
  return cleaned.slice(0, 400);
}
