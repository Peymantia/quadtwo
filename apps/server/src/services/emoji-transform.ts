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

/** LRM — keep leading emoji/icon on the visual start across RTL mobile clients. */
const LRM = "\u200E";
const DIR_MARKS = /^[\u200E\u200F\u2066\u2067\u2068\u2069]+/u;

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

function stripDirMarks(text: string): string {
  return text.replace(DIR_MARKS, "");
}

/** Force LTR embedding so emoji/icon stays at the start of the label on mobile RTL. */
function withLeadingLrm(text: string): string {
  const t = stripDirMarks(text);
  return t ? `${LRM}${t}` : t;
}

function matchLeadingGlyph(text: string): { glyph: string; id: string; rest: string } | null {
  const bare = stripDirMarks(text);
  for (const row of UNIVERSAL_BY_LENGTH) {
    if (bare.startsWith(row.glyph)) {
      const rest = bare.slice(row.glyph.length).replace(/^\s+/, "");
      if (!rest) return null;
      const id = resolvePremiumId(row.glyph, rest) || row.id;
      return { glyph: row.glyph, id, rest };
    }
  }
  return null;
}

/** Emoji after label (e.g. «قبلی ◀️» / «بعدی ▶️») — still maps to Premium button icon. */
function matchTrailingGlyph(text: string): { glyph: string; id: string; rest: string } | null {
  const bare = stripDirMarks(text);
  for (const row of UNIVERSAL_BY_LENGTH) {
    if (bare.endsWith(row.glyph)) {
      const rest = bare.slice(0, -row.glyph.length).replace(/\s+$/, "");
      if (!rest) return null;
      const id = resolvePremiumId(row.glyph, rest) || row.id;
      return { glyph: row.glyph, id, rest };
    }
  }
  return null;
}

function transformButtonPremium(btn: Record<string, unknown>): Record<string, unknown> {
  if (typeof btn.text !== "string") return btn;
  if (btn.icon_custom_emoji_id) {
    return { ...btn, text: withLeadingLrm(String(btn.text)) };
  }
  const hit = matchLeadingGlyph(btn.text) || matchTrailingGlyph(btn.text);
  if (!hit) return { ...btn, text: withLeadingLrm(btn.text) };
  // Premium icon + LRM so clients keep icon at the start of the label.
  return {
    ...btn,
    text: withLeadingLrm(hit.rest),
    icon_custom_emoji_id: hit.id,
  };
}

/** Universal style: only stabilize direction (keep unicode emoji in text). */
function transformButtonDirection(btn: Record<string, unknown>): Record<string, unknown> {
  if (typeof btn.text !== "string") return btn;
  return { ...btn, text: withLeadingLrm(btn.text) };
}

function mapKeyboardButtons(
  markup: unknown,
  mapBtn: (btn: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  if (!markup || typeof markup !== "object") return markup;
  const m = markup as Record<string, unknown>;

  if (Array.isArray(m.keyboard)) {
    return {
      ...m,
      keyboard: (m.keyboard as unknown[][]).map((row) =>
        Array.isArray(row)
          ? row.map((b) => (b && typeof b === "object" ? mapBtn(b as Record<string, unknown>) : b))
          : row,
      ),
    };
  }

  if (Array.isArray(m.inline_keyboard)) {
    return {
      ...m,
      inline_keyboard: (m.inline_keyboard as unknown[][]).map((row) =>
        Array.isArray(row)
          ? row.map((b) => (b && typeof b === "object" ? mapBtn(b as Record<string, unknown>) : b))
          : row,
      ),
    };
  }

  return markup;
}

function transformReplyMarkupPremium(markup: unknown): unknown {
  return mapKeyboardButtons(markup, transformButtonPremium);
}

function stabilizeReplyMarkupDirection(markup: unknown): unknown {
  return mapKeyboardButtons(markup, transformButtonDirection);
}

/** For raw fetch sendMessage (outside grammy) — premium button icons. */
export async function applyPremiumReplyMarkup(markup: unknown): Promise<unknown> {
  if ((await getEmojiStyle()) !== "premium") return stabilizeReplyMarkupDirection(markup);
  return transformReplyMarkupPremium(markup);
}

/** Always apply Premium icons/entities (ignores emoji_style) — e.g. pinned Mini App banner. */
export function forcePremiumTextAndMarkup(
  text: string,
  markup?: unknown,
): { text: string; entities: TgEntity[]; reply_markup?: unknown } {
  return {
    text,
    entities: attachPremiumTextEntities(text),
    reply_markup: markup != null ? transformReplyMarkupPremium(markup) : undefined,
  };
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
  let next = { ...payload };

  // Always stabilize button emoji/icon to the start (desktop + mobile RTL).
  if (next.reply_markup) {
    next = {
      ...next,
      reply_markup:
        style === "premium"
          ? transformReplyMarkupPremium(next.reply_markup)
          : stabilizeReplyMarkupDirection(next.reply_markup),
    };
  }

  if (style !== "premium") return next;

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
