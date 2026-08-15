import { prisma } from "../db.js";
import { getSetting, setSetting } from "./settings.js";

export const TERMS_ACCEPT_FOOTER =
  "اینجانب با پذیرفتن قوانین فوق، از امکانات پیـنگ استفاده می‌کنم.";

export const DEFAULT_TERMS_TEXT = `قوانین پیـنگ

فعالیت شما در ربات و پنل به منزله قبول تمامی قوانین می باشد.

تمامی سرورهای پیـنگ واقع در ایران بوده و کلیه فعالیت‌های این وب‌سایت مطابق با قوانین جمهوری اسلامی ایران می‌باشد. بدیهیست که کاربران نیز موظف به رعایت این قوانین می‌باشند.

سرویس های ما صرفا برای کاهش پینگ بازی های آنلاین و آی پی ثابت برای ترید و همچنین به عنوان تحریم شکن برای وبسایت هایی که آی پی ایران را تحریم کرده اند طراحی شده. و ابزاری برای دور زدن فیلترینگ نمی باشد.

در زمان اینترنت ملی و شرایط بحرانی کشور، پیـنگ تمامی سرور های خود را برای حفظ امنیت ملی از دسترس خارج خواهد کرد. (مهم)

امکان دسترسی از سرور های پیـنگ به سرویس های غیرقانونی و اعم از وبسایت های پورن، قمار و شرط بندی و... وجود ندارد.

مسئولیت هرگونه استفاده نادرست و یا سوء استفاده از سرویس به هر نحو بر عهده کاربر بوده و پیـنگ هیچ‌گونه مسئولیتی در این خصوص ندارد.

کاربر حق ندارد پس از اتمام ترافیک یا مهلت زمانی اکانت خود سهوا یا عمدا از سرویس استفاده کند و در صورت مشاهده سوءاستفاده حق مسدودسازی اکانتِ ایشان بدون اطلاع قبلی برای پیـنگ محفوظ خواهد بود.

استفاده از سرویس پیـنگ مشکلی برای بازی (اعم از بن شدن اکانت بازی و …) پیش نخواهد آورد، اما در صورتی که کاربر همزمان با سرویس پیـنگ از سایر سرویس‌ها مانند DNS و یا فیل/تر/شکن استفاده کند و یا سرور اتصال نرم افزار را مرتبا تغییر دهد مسئولیت مسدود شدن احتمالی اکانت بازی کاربر بر عهده ایشان خواهد بود.

با توجه به احتمال بروز اختلالات زیرساختی شبکه‌ای و اینترنتی خارج از کنترل، پیـنگ هیچ‌گونه تضمینی مبنی بر عدم قطعی، بی‌عیب بودن، نبود اختلال و یا همیشگی بودن کیفیت ایده‌آل در سرویس ارائه نخواهد داد.

استفاده از سرویس جهت ثبت‌نام در سامانه‌های مختلف یا ساخت اکانت‌های متفاوت (مانند ساخت اکانت در شبکه Playstation Sony، ایجاد جیمیل یا سایر ایمیل‌ها به تعداد بالا، دور زدن محدودیت ثبت‌نام برخی از سایت‌های ایرانی که به IP حساسیت دارند و…) ممنوع می‌باشد.

کاربر متعهد می‌شود که از سرویس‌(های) خود برای نفوذ، اختلال، خراب‌کاری و یا به دست آوردن غیرقانونی اطلاعات در شبکه اینترنت به هیچ نحوی استفاده نکند.

مسئولیت حفظ اطلاعات اکانت (شامل آی دی منحصر بفرد و لینک هوشمند) بر عهده کاربر می‌باشد.

موجودی کیف پول مجازی کاربر غیر قابل تبدیل به وجه نقدی می باشد و ارزش مادی ندارد!`;

export async function isTermsEnabled(): Promise<boolean> {
  return (await getSetting("terms_enabled")) === "true";
}

export async function getTermsText(): Promise<string> {
  const raw = (await getSetting("terms_text")).trim();
  return raw || DEFAULT_TERMS_TEXT;
}

export async function setTermsEnabled(on: boolean): Promise<void> {
  await setSetting("terms_enabled", on ? "true" : "false");
}

export async function setTermsText(text: string): Promise<void> {
  const trimmed = text.trim();
  await setSetting("terms_text", trimmed || DEFAULT_TERMS_TEXT);
}

export async function hasAcceptedTerms(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { termsAcceptedAt: true },
  });
  return Boolean(u?.termsAcceptedAt);
}

export async function markTermsAccepted(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { termsAcceptedAt: new Date() },
  });
}

/** Caption/body after accept — keep full rules + footer (no delete). */
export function termsAcceptedMessage(termsText: string): string {
  const body = termsText.trim() || DEFAULT_TERMS_TEXT;
  const combined = `${body}\n\n✅ ${TERMS_ACCEPT_FOOTER}`;
  return combined.length > 4090 ? `${combined.slice(0, 4087)}…` : combined;
}
