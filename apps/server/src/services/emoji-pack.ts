/** Emoji pack: Universal (Unicode) vs Premium (Telegram custom_emoji_id). */

export type EmojiStyle = "universal" | "premium";

export type EmojiKey =
  | "buy"
  | "renew"
  | "my_services"
  | "wallet"
  | "account"
  | "guide"
  | "support"
  | "test"
  | "web_dashboard"
  | "dash_otp"
  | "config_lookup"
  | "partner_request"
  | "all_configs"
  | "agent_panel"
  | "control_center"
  | "hide_keyboard"
  | "referral"
  | "national"
  | "admin"
  | "pin"
  | "vip_diamond"
  | "unlimited"
  | "golden_star"
  | "phone_device"
  | "laptop"
  | "robot_android"
  | "windows"
  | "hourglass"
  | "label_tag"
  | "dice_random"
  | "write_custom"
  | "ok_check"
  | "cancel_x"
  | "warning"
  | "search"
  | "note"
  | "trash_delete"
  | "edit_pencil"
  | "plus_add"
  | "refresh"
  | "link"
  | "key"
  | "card"
  | "bell_notif"
  | "chart_report"
  | "scroll_log"
  | "book_guide"
  | "megaphone"
  | "speaker_channel"
  | "inbox_import"
  | "outbox_send"
  | "floppy_backup"
  | "desktop_server"
  | "antenna_inbounds"
  | "plug_test"
  | "gear_settings"
  | "balance_weight"
  | "lock_closed"
  | "lock_open"
  | "calendar"
  | "ruler_threshold"
  | "alarm_clock"
  | "folder"
  | "page_doc"
  | "paperclip"
  | "eye_view"
  | "pause"
  | "play"
  | "ban_off"
  | "cross_mark"
  | "prev_page"
  | "next_page"
  | "status_on_green"
  | "status_off_red"
  | "status_idle_white"
  | "status_off_black"
  | "heart"
  | "phone_support"
  | "ok_light"
  | "show_menu"
  | "sub_note"
  | "qr_code"
  | "iphone"
  | "download"
  | "sales_cats"
  | "broadcast"
  | "panels"
  | "import_excel"
  | "agent_name"
  | "dash_web"
  | "login_id";

/** Current bot Unicode glyphs (Universal style). */
export const UNIVERSAL: Record<EmojiKey, string> = {
  buy: "🛒",
  renew: "♻️",
  my_services: "📦",
  wallet: "💰",
  account: "👤",
  guide: "💡",
  support: "🆘",
  test: "🧪",
  web_dashboard: "🌐",
  dash_otp: "🔐",
  config_lookup: "🔎",
  partner_request: "🤝",
  all_configs: "📋",
  agent_panel: "💼",
  control_center: "🎛",
  hide_keyboard: "⬇️",
  referral: "👥",
  national: "🇮🇷",
  admin: "👑",
  pin: "📌",
  vip_diamond: "💎",
  unlimited: "♾️",
  golden_star: "⭐",
  phone_device: "📱",
  laptop: "💻",
  robot_android: "🤖",
  windows: "🪟",
  hourglass: "⏳",
  label_tag: "🏷",
  dice_random: "🎲",
  write_custom: "✍️",
  ok_check: "✅",
  cancel_x: "❌",
  warning: "⚠️",
  search: "🔍",
  note: "📝",
  trash_delete: "🗑",
  edit_pencil: "✏️",
  plus_add: "➕",
  refresh: "🔄",
  link: "🔗",
  key: "🔑",
  card: "💳",
  bell_notif: "🔔",
  chart_report: "📊",
  scroll_log: "📜",
  book_guide: "📖",
  megaphone: "📣",
  speaker_channel: "📢",
  inbox_import: "📥",
  outbox_send: "📤",
  floppy_backup: "💾",
  desktop_server: "🖥",
  antenna_inbounds: "📡",
  plug_test: "🔌",
  gear_settings: "⚙️",
  balance_weight: "⚖️",
  lock_closed: "🔒",
  lock_open: "🔓",
  calendar: "📅",
  ruler_threshold: "📏",
  alarm_clock: "⏰",
  folder: "📁",
  page_doc: "📄",
  paperclip: "📎",
  eye_view: "👁",
  pause: "⏸",
  play: "▶️",
  ban_off: "🚫",
  cross_mark: "✖️",
  prev_page: "◀️",
  next_page: "▶️",
  status_on_green: "🟢",
  status_off_red: "🔴",
  status_idle_white: "⚪",
  status_off_black: "⚫",
  heart: "❤️",
  phone_support: "☎️",
  ok_light: "✓",
  show_menu: "📌",
  sub_note: "📝",
  qr_code: "📱",
  iphone: "📱",
  download: "⬇️",
  sales_cats: "🏷",
  broadcast: "📣",
  panels: "🖥",
  import_excel: "📥",
  agent_name: "🏷",
  dash_web: "🌐",
  login_id: "👤",
};

/**
 * Premium custom_emoji_id values (Telegram).
 * Later duplicates in the user list override earlier ones.
 */
export const PREMIUM_IDS: Record<EmojiKey, string> = {
  buy: "5406683434124859552",
  renew: "5391079723449209646",
  my_services: "6008334538986492961",
  wallet: "5931424340573688741",
  account: "5334756265358798915",
  guide: "5422439311196834318",
  support: "5238025132177369293",
  test: "5337080053119336309",
  web_dashboard: "5447410659077661506",
  dash_otp: "5303479226882603449",
  config_lookup: "6318752565865482087",
  partner_request: "5352795355635276043",
  all_configs: "5386367538735104399",
  agent_panel: "5231012545799666522",
  control_center: "5361741454685256344",
  hide_keyboard: "5193202823411546657",
  referral: "5256143829672672750",
  national: "5978883437136713238",
  admin: "5217822164362739968",
  pin: "5397782960512444700",
  vip_diamond: "5427168083074628963",
  unlimited: "6298717844804733009",
  golden_star: "5438496463044752972",
  phone_device: "5395316940614937989",
  laptop: "6298684666182371615",
  robot_android: "5280727586819809102",
  windows: "6298333093044422573",
  hourglass: "5413704112220949842",
  label_tag: "5456136765607783041",
  dice_random: "5972061723400605896",
  write_custom: "5458382591121964689",
  ok_check: "5206607081334906820",
  cancel_x: "5210952531676504517",
  warning: "5447644880824181073",
  search: "6318752565865482087",
  note: "6323602795123443087",
  trash_delete: "5445267414562389170",
  edit_pencil: "5395444784611480792",
  plus_add: "5397916757333654639",
  refresh: "5375338737028841420",
  link: "5271604874419647061",
  key: "5460731873808362174",
  card: "5445353829304387411",
  bell_notif: "5458603043203327669",
  chart_report: "5435958519624916850",
  scroll_log: "6323602795123443087",
  book_guide: "6017001941903611014",
  megaphone: "5388632425314140043",
  speaker_channel: "5458603043203327669",
  inbox_import: "5253742260054409879",
  outbox_send: "5253742260054409879",
  floppy_backup: "5890849007139296140",
  desktop_server: "5193177581888755275",
  antenna_inbounds: "5764775314521593432",
  plug_test: "5384503132086625813",
  gear_settings: "5341715473882955310",
  balance_weight: "5956281773036932682",
  lock_closed: "5251203410396458957",
  lock_open: "5251203410396458957",
  calendar: "5413879192267805083",
  ruler_threshold: "5188481279963715781",
  alarm_clock: "5413704112220949842",
  folder: "5445305218864537904",
  page_doc: "6323602795123443087",
  paperclip: "5305265301917549162",
  eye_view: "6298788673110410889",
  pause: "5422532808339904185",
  play: "5379703922745159290",
  ban_off: "6296341890371422476",
  cross_mark: "5411311111062446835",
  prev_page: "5255703720078879038",
  next_page: "5253767677670862169",
  status_on_green: "6296367896398399651",
  status_off_red: "6298671811345254603",
  status_idle_white: "6256052494384760637",
  status_off_black: "5343888624255509405",
  heart: "5429277624981538430",
  phone_support: "5443038326535759644",
  ok_light: "6255902733170116708",
  show_menu: "5974098293813152457",
  sub_note: "5460865451586250451",
  qr_code: "5422814644093868925",
  iphone: "6296514655430903710",
  download: "5406745015365943482",
  sales_cats: "5837018635830302155",
  broadcast: "5458603043203327669",
  panels: "5456312597273923475",
  import_excel: "5321221045292638119",
  agent_name: "5461117441612462242",
  dash_web: "5447410659077661506",
  /** OTP message: login id line (shares 👤 with account; matched by label) */
  login_id: "5987557724886405444",
};

/** When several keys share a glyph, pick ID from surrounding label text. */
export function resolvePremiumId(glyph: string, afterText: string): string | undefined {
  const after = afterText.slice(0, 48);
  if (glyph === "👤") {
    if (after.includes("شناسه")) return PREMIUM_IDS.login_id;
    return PREMIUM_IDS.account;
  }
  if (glyph === "🔐") {
    if (after.includes("رمز")) return PREMIUM_IDS.key;
    return PREMIUM_IDS.dash_otp;
  }
  if (glyph === "📌") {
    if (after.includes("نمایش منو")) return PREMIUM_IDS.show_menu;
    return PREMIUM_IDS.pin;
  }
  if (glyph === "⬇️") {
    if (after.includes("تمام")) return PREMIUM_IDS.hide_keyboard;
    if (after.includes("دانلود")) return PREMIUM_IDS.download;
    return PREMIUM_IDS.download;
  }
  if (glyph === "📱") {
    if (/^\s*QR/i.test(after)) return PREMIUM_IDS.qr_code;
    if (after.includes("آیفون") || after.includes("iOS") || after.includes("iPhone")) return PREMIUM_IDS.iphone;
    return PREMIUM_IDS.phone_device;
  }
  if (glyph === "📥") {
    if (after.includes("اکسل")) return PREMIUM_IDS.import_excel;
    return PREMIUM_IDS.inbox_import;
  }
  if (glyph === "🖥") {
    if (after.includes("سرور") || after.includes("پنل")) return PREMIUM_IDS.panels;
    return PREMIUM_IDS.desktop_server;
  }
  if (glyph === "▶️") {
    if (after.includes("بعدی")) return PREMIUM_IDS.next_page;
    return PREMIUM_IDS.play;
  }
  if (glyph === "◀️") {
    return PREMIUM_IDS.prev_page;
  }
  const row = UNIVERSAL_BY_LENGTH.find((r) => r.glyph === glyph);
  return row?.id;
}

/** Prefer longer glyphs first so flags / ZWJ sequences match before shorter parts. */
export const UNIVERSAL_BY_LENGTH: Array<{ key: EmojiKey; glyph: string; id: string }> = (
  Object.keys(UNIVERSAL) as EmojiKey[]
)
  .map((key) => ({ key, glyph: UNIVERSAL[key], id: PREMIUM_IDS[key] }))
  .filter((row, i, arr) => arr.findIndex((x) => x.glyph === row.glyph) === i) // unique glyphs for scanning
  .sort((a, b) => b.glyph.length - a.glyph.length);

export function isEmojiStyle(v: unknown): v is EmojiStyle {
  return v === "universal" || v === "premium";
}

export function e(key: EmojiKey): string {
  return UNIVERSAL[key];
}
