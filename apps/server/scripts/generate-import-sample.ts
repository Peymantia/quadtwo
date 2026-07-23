/**
 * Generates samples/quadtwo-import-sample.xlsx — fill this and import via control center.
 * Run: npm run sample:excel -w @quadtwo/server
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../../../samples/quadtwo-import-sample.xlsx");

function sheet(rows: unknown[][]) {
  return XLSX.utils.aoa_to_sheet(rows);
}

const help = sheet([
  ["راهنمای ورود یکجای داده به ربات Quadtwo"],
  [""],
  ["۱) این فایل را کپی کنید و برای برند / کمپین تبلیغاتی خود ویرایش کنید."],
  ["۲) در ربات: کنترل سنتر → ورود از اکسل → همین فایل را بفرستید."],
  ["۳) شیت یا ردیف خالی = بدون تغییر (مقدار قبلی ربات حفظ می‌شود)."],
  ["۴) برای پاک کردن یک تنظیم: در ستون value بنویسید - یا CLEAR یا پاک"],
  ["۵) قیمت‌ها: replace_prices=true → همه پلن‌های قبلی پاک و از اکسل ساخته می‌شوند."],
  ["   replace_prices=false → پلن‌های اکسل اضافه می‌شوند و قبلی‌ها می‌مانند."],
  ["۶) کانال‌ها: اگر حداقل یک یوزرنیم باشد، لیست کانال‌ها با همان ردیف‌ها جایگزین می‌شود."],
  ["۷) توکن پنل و BOT_TOKEN را در اکسل نگذارید."],
  [""],
  ["شیت‌ها:"],
  ["تنظیمات", "پیام‌ها، کارت، پشتیبانی، برند، محدودیت کاربر، حالت قیمت…"],
  ["کانال‌ها", "کانال‌های اجباری عضویت"],
  ["قیمت‌ها", "ماتریکس پلن‌ها (VIP بین الملل / ملی / نامحدود)"],
  ["نرخ‌ها", "اگر pricing_mode=rate باشد"],
  ["دسته‌های فروش", "کدام دسته‌ها برای خرید فعال باشند"],
  ["پیام‌های تبلیغ", "متن‌های آماده برای کمپین / استوری / پست"],
  ["لینک‌های آموزش", "دانلود اپ و متن راهنما"],
  ["سرورهای پنل", "اختیاری — URL و inbound (توکن را خالی بگذارید و بعداً در ربات پر کنید)"],
]);

const settings = sheet([
  ["key", "value", "توضیح"],
  ["brand_name", "پیـنگ", "نام برند"],
  ["welcome_text", "سلام به ربات پینگ خوش اومدی 🌸\nما اینجاییم تا شما را بدون هیچ محدویتی به شبکه جهانی متصل کنیم ❤️\n\n✅ کیفیت بالا\n📡 امنیت ارتباط\n🇮🇷 سرویس اینترنت ملی\n☎️ پشتیبانی تا لحظه آخر", "متن خوش‌آمد /start"],
  ["card_number", "6037-0000-0000-0000", "شماره کارت"],
  ["card_holder", "نام صاحب حساب", "نام روی کارت"],
  ["support_username", "support_username", "یوزرنیم پشتیبانی بدون @"],
  ["support_telegram_id", "", "یا آی‌دی عددی پشتیبانی"],
  ["miniapp_url", "", "آدرس Mini App (اختیاری)"],
  ["default_limit_ip", "2", "پیش‌فرض محدودیت دستگاه (۰=نامحدود)"],
  ["pricing_mode", "matrix", "matrix یا rate"],
  ["max_purchase_months", "1", "حداکثر ماه قابل خرید"],
  ["test_service_enabled", "true", "سرویس تست روشن/خاموش"],
  ["xui_inbound_ids", "1,2,3,4,5,6,7,8,9,10", "Inboundهای پیش‌فرض (اگر سرور پنل نباشد)"],
  ["replace_prices", "true", "true=پاک کردن همه قیمت‌های قبلی | false=فقط اضافه کردن | خالی=همان true"],
]);

const channels = sheet([
  ["username", "required", "توضیح"],
  ["YourChannel", "true", "بدون @ — کانال اجباری"],
]);

const prices = sheet([
  ["category", "trafficGb", "months", "priceUser", "pricePartner", "priceWholesale", "isGolden", "title", "active"],
  ["data", 10, 1, 150000, 120000, 100000, false, "", true],
  ["data", 15, 1, 220000, 170000, 140000, false, "", true],
  ["data", 20, 1, 280000, 220000, 180000, false, "", true],
  ["data", 25, 1, 330000, 260000, 210000, false, "", true],
  ["data", 30, 1, 390000, 310000, 250000, false, "", true],
  ["data", 40, 1, 510000, 400000, 320000, false, "", true],
  ["data", 50, 1, 650000, 500000, 400000, false, "", true],
  ["data", 50, 1, 550000, 450000, 380000, true, "پیشنهاد ویژه ۵۰ گیگ", true],
  ["national", 30, 1, 200000, 160000, 130000, false, "نت ملی ۳۰ گیگ", true],
  ["national", 50, 1, 300000, 240000, 200000, false, "نت ملی ۵۰ گیگ", true],
  ["unlimited", "", 1, 1500000, 1200000, 1000000, false, "نامحدود یک‌ماهه", true],
  ["data", 10, 2, 277500, 222000, 185000, false, "", true],
  ["data", 50, 2, 1202500, 925000, 740000, false, "", true],
  ["data", 10, 3, 382500, 306000, 255000, false, "", true],
]);

const rates = sheet([
  ["role", "perGb", "perMonth", "unlimitedPerMonth", "توضیح"],
  ["user", 15000, 30000, 1500000, "مشتری عادی"],
  ["partner", 12000, 25000, 1200000, "همکار"],
  ["wholesale", 10000, 20000, 1000000, "عمده"],
]);

const salesCats = sheet([
  ["category", "enabled", "توضیح"],
  ["data", true, "سرویس VIP بین الملل"],
  ["national", true, "نت ملی"],
  ["unlimited", false, "نامحدود"],
]);

const promo = sheet([
  ["key", "title", "text", "توضیح"],
  [
    "promo_launch",
    "پست لانچ",
    "🚀 فروش ویژه شروع شد!\n\nسرویس پرسرعت · پشتیبانی ۲۴ ساعته\nاز ربات خرید کنید 👇\nhttps://t.me/YourBot",
    "متن آماده برای کانال / گروه",
  ],
  [
    "promo_story",
    "استوری",
    "اینترنت بدون قطعی 🔥\nلینک ربات در بیو",
    "متن کوتاه استوری",
  ],
  [
    "promo_discount",
    "تخفیف",
    "🎁 تا ۴۸ ساعت — ۲۰٪ تخفیف روی پلن‌های ۵۰ گیگ\nفقط از ربات",
    "کمپین تخفیف",
  ],
  [
    "promo_partner",
    "دعوت نماینده",
    "🤝 همکاری فروش VPN\nدرآمد نمایندگی · پنل اختصاصی\nدر ربات «درخواست نمایندگی» را بزنید",
    "جذب همکار",
  ],
]);

const guides = sheet([
  ["key", "value", "توضیح"],
  [
    "guide_text",
    "📖 آموزش اتصال\n\n۱) اپ مناسب را دانلود کنید\n۲) لینک ساب را از «سرویس‌های من» کپی کنید\n۳) Import از لینک ساب\n۴) وصل شوید و لذت ببرید",
    "متن راهنما داخل ربات",
  ],
  ["guide_ios_url", "https://apps.apple.com/app/streisand/id6450534064", "iOS"],
  ["guide_android_url", "https://github.com/2dust/v2rayNG/releases/latest", "Android"],
  ["guide_windows_url", "https://github.com/2dust/v2rayN/releases/latest", "Windows"],
  ["guide_macos_url", "https://apps.apple.com/app/v2box/id6446814690", "macOS"],
  ["guide_url", "", "لینک اضافه (اختیاری)"],
]);

const panels = sheet([
  ["name", "baseUrl", "apiToken", "inboundIds", "subBase", "categories", "weight", "active", "sellEnabled", "توضیح"],
  [
    "سرور اصلی",
    "http://127.0.0.1:2053/",
    "",
    "1,2,3,4,5,6,7,8,9,10",
    "",
    "data,unlimited",
    100,
    true,
    true,
    "توکن را خالی بگذارید و بعداً در ربات وارد کنید؛ یا اینجا پر کنید",
  ],
  [
    "نت ملی",
    "http://127.0.0.1:2054/",
    "",
    "1",
    "https://example.com:65535/info/",
    "national",
    100,
    true,
    true,
    "پنل جدا برای نت ملی",
  ],
]);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, help, "راهنما");
XLSX.utils.book_append_sheet(wb, settings, "تنظیمات");
XLSX.utils.book_append_sheet(wb, channels, "کانال‌ها");
XLSX.utils.book_append_sheet(wb, prices, "قیمت‌ها");
XLSX.utils.book_append_sheet(wb, rates, "نرخ‌ها");
XLSX.utils.book_append_sheet(wb, salesCats, "دسته‌های فروش");
XLSX.utils.book_append_sheet(wb, promo, "پیام‌های تبلیغ");
XLSX.utils.book_append_sheet(wb, guides, "لینک‌های آموزش");
XLSX.utils.book_append_sheet(wb, panels, "سرورهای پنل");

mkdirSync(dirname(outPath), { recursive: true });
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
writeFileSync(outPath, buf);
console.log("wrote", outPath);
