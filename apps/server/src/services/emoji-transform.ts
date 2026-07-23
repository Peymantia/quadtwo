import type { Api } from "grammy";
import { getSetting, setSetting } from "./settings.js";
import {
  PREMIUM_IDS,
  UNIVERSAL_BY_LENGTH,
  isEmojiStyle,
  resolvePremiumId,
  type EmojiStyle,
} from "./emoji-pack.js";

let cached: { style: EmojiStyle; at: number } | null = null;
const CACHE_MS = 5_000;

export async function getEmojiStyle(): Promise<EmojiStyle> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.style;
  const raw = await getSetting("emoji_style");
  const style: EmojiStyle = isEmojiStyle(raw) ? raw : "universal";
  cached = { style, at: now };
  return style;
}

export async function setEmojiStyle(style: EmojiStyle) {
  await setSetting("emoji_style", style);
  cached = { style, at: Date.now() };
}

export function clearEmojiStyleCache() {
  cached = null;
}

type TgEntity = {
  type: string;
  offset: number;
  length: number;
  custom_emoji_id?: string;
  [k: string]: unknown;
};

function matchLeadingGlyph(text: string): { glyph: string; id: string; rest: string } | null {
  for (const row of UNIVERSAL_BY_LENGTH) {
    if (text.startsWith(row.glyph)) {
      const rest = text.slice(row.glyph.length).replace(/^\s+/, "");
      if (!rest) return null;
      const id = resolvePremiumId(row.glyph, rest) || row.id;
      return { glyph: row.glyph, id, rest };
    }
  }
  return null;
}

function isInlineKeyboardButton(btn: Record<string, unknown>): boolean {
  return (
    "callback_data" in btn ||
    "url" in btn ||
    "web_app" in btn ||
    "login_url" in btn ||
    "switch_inline_query" in btn ||
    "switch_inline_query_current_chat" in btn ||
    "switch_inline_query_chosen_chat" in btn ||
    "copy_text" in btn ||
    "callback_game" in btn ||
    "pay" in btn
  );
}

function transformButton(btn: Record<string, unknown>): Record<string, unknown> {
  if (typeof btn.text !== "string") return btn;
  if (btn.icon_custom_emoji_id) return btn;
  // Reply-keyboard presses send `text` verbatim — never rewrite it (breaks bot.hears)
  // and never use icon_custom_emoji_id there (RTL puts icon at the label end on mobile).
  if (!isInlineKeyboardButton(btn)) return btn;

  const hit = matchLeadingGlyph(btn.text);
  if (!hit) return btn;
  // Inline only: keep leading unicode (RTL-correct start) — do not strip / replace with icon.
  // Premium custom icons on inline buttons are inconsistent across mobile vs desktop RTL.
  return btn;
}

function transformReplyMarkup(markup: unknown): unknown {
  if (!markup || typeof markup !== "object") return markup;
  const m = markup as Record<string, unknown>;

  // Sticky reply keyboard: leave labels untouched so presses match hearsBtn / BTN.
  if (Array.isArray(m.keyboard)) return markup;

  if (Array.isArray(m.inline_keyboard)) {
    return {
      ...m,
      inline_keyboard: (m.inline_keyboard as unknown[][]).map((row) =>
        Array.isArray(row)
          ? row.map((b) => (b && typeof b === "object" ? transformButton(b as Record<string, unknown>) : b))
          : row,
      ),
    };
  }

  return markup;
}

/** Attach custom_emoji entities for known Universal glyphs (UTF-16 offsets). */
export function attachPremiumTextEntities(text: string, existing?: TgEntity[]): TgEntity[] {
  const entities: TgEntity[] = existing ? [...existing] : [];
  const occupied = new Set<number>();
  for (const e of entities) {
    for (let i = e.offset; i < e.offset + e.length; i++) occupied.add(i);
  }

  for (const row of UNIVERSAL_BY_LENGTH) {
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(row.glyph, from);
      if (idx < 0) break;
      const len = row.glyph.length;
      const after = text.slice(idx + len);
      const id = resolvePremiumId(row.glyph, after) || PREMIUM_IDS[row.key] || row.id;
      if (!id) {
        from = idx + len;
        continue;
      }
      let free = true;
      for (let i = idx; i < idx + len; i++) {
        if (occupied.has(i)) {
          free = false;
          break;
        }
      }
      if (free) {
        entities.push({
          type: "custom_emoji",
          offset: idx,
          length: len,
          custom_emoji_id: id,
        });
        for (let i = idx; i < idx + len; i++) occupied.add(i);
      }
      from = idx + len;
    }
  }

  return entities.sort((a, b) => a.offset - b.offset);
}

type Payload = Record<string, unknown>;

async function transformPayload(method: string, payload: Payload): Promise<Payload> {
  const style = await getEmojiStyle();
  if (style !== "premium") return payload;

  let next = { ...payload };

  if (next.reply_markup) {
    next = { ...next, reply_markup: transformReplyMarkup(next.reply_markup) };
  }

  if ((method === "sendMessage" || method === "editMessageText") && typeof next.text === "string") {
    if (!next.parse_mode) {
      const entities = attachPremiumTextEntities(next.text, next.entities as TgEntity[] | undefined);
      if (entities.length) next = { ...next, entities };
    }
  }

  if (
    method === "editMessageCaption" ||
    method === "sendPhoto" ||
    method === "sendDocument" ||
    method === "sendVideo"
  ) {
    if (typeof next.caption === "string" && !next.parse_mode) {
      const entities = attachPremiumTextEntities(
        next.caption,
        next.caption_entities as TgEntity[] | undefined,
      );
      if (entities.length) next = { ...next, caption_entities: entities };
    }
  }

  return next;
}

/** Install API transformer so Universal glyphs become Premium icons/entities when enabled. */
export function installEmojiApiTransform(api: Api) {
  api.config.use(async (prev, method, payload, signal) => {
    try {
      const next = await transformPayload(method, { ...(payload as object) } as Payload);
      return await prev(method, next as typeof payload, signal);
    } catch {
      return await prev(method, payload, signal);
    }
  });
}
