import type { Api } from "grammy";
import { getSetting, setSetting } from "./settings.js";
import {
  PREMIUM_IDS,
  UNIVERSAL_BY_LENGTH,
  isEmojiStyle,
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
      return { glyph: row.glyph, id: row.id, rest };
    }
  }
  return null;
}

function transformButton(btn: Record<string, unknown>): Record<string, unknown> {
  if (typeof btn.text !== "string") return btn;
  if (btn.icon_custom_emoji_id) return btn;
  const hit = matchLeadingGlyph(btn.text);
  if (!hit) return btn;
  return {
    ...btn,
    text: hit.rest,
    icon_custom_emoji_id: hit.id,
  };
}

function transformReplyMarkup(markup: unknown): unknown {
  if (!markup || typeof markup !== "object") return markup;
  const m = markup as Record<string, unknown>;

  if (Array.isArray(m.keyboard)) {
    return {
      ...m,
      keyboard: (m.keyboard as unknown[][]).map((row) =>
        Array.isArray(row)
          ? row.map((b) => (b && typeof b === "object" ? transformButton(b as Record<string, unknown>) : b))
          : row,
      ),
    };
  }

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
    const id = PREMIUM_IDS[row.key] || row.id;
    if (!id) continue;
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(row.glyph, from);
      if (idx < 0) break;
      const len = row.glyph.length;
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
