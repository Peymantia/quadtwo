<p align="center">
  <img src="https://img.shields.io/badge/Telegram-Bot-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram Bot" />
  <img src="https://img.shields.io/badge/3x--ui-Integrated-00C853?style=for-the-badge" alt="3x-ui" />
  <img src="https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/License-Private-6c757d?style=for-the-badge" alt="License" />
</p>

<h1 align="center">⚡ Quadtwo</h1>

<p align="center">
  <b>ربات فروش VPN روی تلگرام</b><br/>
  متصل به چند پنل <a href="https://github.com/MHSanaei/3x-ui">3x-ui</a> · خرید خودکار · کیف پول · نمایندگی · کنترل سنتر ادمین
</p>

<p align="center">
  <a href="#-نصب-یکخطی">نصب</a> ·
  <a href="#-امکانات">امکانات</a> ·
  <a href="#-مدیریت-سرور">CLI</a> ·
  <a href="#-توسعه-لوکال">توسعه</a>
</p>

---

## ✨ امکانات

### 🛒 خرید و فروش
| | |
|:--|:--|
| 💎 **سرویس VIP بین الملل** | حجم و مدت با اسلایدر seekbar در وب · ویزارد در ربات |
| 🇮🇷 **نت ملی** | دسته جدا · اسلایدر ماه/IP در صورت نیاز قفل می‌شود |
| 💎 **نامحدود** | حجم ثابت نامحدود · اسلایدر حجم غیرفعال |
| 🏷️ **دسته‌های فروش** | ادمین هر دسته را فعال/غیرفعال می‌کند |
| ⏳ **مدت خرید** | پشتیبانی چندماهه (قابل محدود از کنترل سنتر) |

### 📱 تجربه کاربر
| | |
|:--|:--|
| ⌨️ **منوی چسبان** | Reply Keyboard رنگی پایین چت |
| 📦 **سرویس‌های من** | لیست دکمه‌ای دو ستونه + جستجوی سریع |
| 🔗 **لینک ساب + QR** | لینک واقعی پنل (نه URL جعلی) |
| ♻️ **تمدید** | ریست ترافیک · Start after first use · هر ماه ۳۱ روز · ربات و داشبورد وب |
| 🔄 **چرخش لینک** | تغییر Sub ID / UUID کانفیگ |
| 🔴🟢 **فعال/غیرفعال موقت** | تعلیق اکانت در پنل با یک دکمه |
| 🧪 **سرویس تست** | یک‌بار رایگان (قابل تنظیم) |
| 💰 **کیف پول** | شارژ و پرداخت از موجودی |
| 🤝 **درخواست نمایندگی** | فلو کامل با تأیید ادمین |

### 🖥 چندپنلی 3x-ui
| | |
|:--|:--|
| 🌐 **چند سرور** | هر پنل با نام، URL، توکن و inbound جدا |
| 🧭 **مسیریابی دسته** | مثلاً VIP بین الملل → سرور A · نت ملی → سرور B |
| ⚖️ **تقسیم بار** | اگر چند پنل برای یک دسته باشد، با وزن انتخاب می‌شود |
| 📎 **Sub base** | لینک ساب از تنظیمات همان پنل |
| 🔌 **تست اتصال** | از داخل کنترل سنتر |

### 🌐 داشبورد وب
| | |
|:--|:--|
| 🖥 **dash.anthropics.ir** | پنل گرافیکی ادمین / همکار / ریسلر / کاربر |
| 🔐 **ورود** | رمز عبور + کد یکبار مصرف از ربات |
| 🎚 **خرید با اسلایدر** | حجم · مدت · محدودیت کاربر · قیمت لحظه‌ای |
| ♻️ **تمدید در وب** | از تب اشتراک‌ها · کیف پول یا کارت‌به‌کارت |
| ⚙️ **ناوبری خلوت** | تنظیمات بالا · کیف پول بابل وسط · بدون خروج در پایین |

### 🎛 کنترل سنتر ادمین
- 💰 قیمت‌گذاری ماتریکس یا نرخ (گیگ × ماه)
- 👑 مدیریت ادمین‌ها و تنزل نقش
- 📢 کانال اجباری · 🆘 پشتیبانی · 💳 کارت بانکی
- 🔔 اعلان انقضا / حجم / حذف
- 📊 گزارش فروش · 🔍 جستجو · 📜 لاگ عملیات
- 💾 پشتیبان خودکار دیتابیس به ادمین
- 🖥 مدیریت سرورهای پنل
- 📥 **ورود از اکسل** — تنظیمات، قیمت‌ها، کانال‌ها، پیام‌های تبلیغ و پنل‌ها یکجا (`samples/quadtwo-import-sample.xlsx`)

---

## 🚀 نصب یک‌خطی

> مناسب Ubuntu / Debian و توزیع‌های مشابه — با دسترسی **root**

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Peymantia/quadtwo/main/install.sh)
```

اسکریپت Node.js، کلون در `/opt/quadtwo`، دیتابیس SQLite و سرویس `systemd` را آماده می‌کند.

### ✅ قبل از نصب آماده کنید

| مورد | توضیح |
|:--|:--|
| 🤖 `BOT_TOKEN` | از [@BotFather](https://t.me/BotFather) |
| 👤 Admin ID | شناسه عددی تلگرام ادمین |
| 🖥 3x-ui URL | ترجیحاً `http://127.0.0.1:PORT/basepath/` |
| 🔑 API Token | پنل → Settings → Security |
| 📡 Inbound IDs | مثلاً `1` یا `1,2,3` |

### 🏁 بعد از نصب

در تلگرام `/start` بزنید و تنظیمات اولیه را انجام دهید:

```text
/setcard 6037-xxxx-xxxx-xxxx|نام صاحب حساب
/setsupport @username
```

سپس در کنترل سنتر:
1. 📥 **ورود از .env** برای ثبت پنل فعلی  
2. در صورت نیاز ➕ سرور دوم (مثلاً نت ملی)  
3. دسته‌های هر سرور را تنظیم کنید  

---

## 🛠 مدیریت سرور

```bash
quadtwo status          # وضعیت سرویس
quadtwo logs            # لاگ زنده
quadtwo restart         # ری‌استارت
quadtwo env             # ویرایش .env
quadtwo update          # به‌روزرسانی از GitHub
quadtwo set-token       # عوض کردن ربات / rebrand
quadtwo set-admin       # عوض کردن ادمین تلگرام
```

### 🔁 عوض کردن توکن ربات (rebrand)

```bash
quadtwo set-token
# یا
quadtwo set-token 123456789:AAH...new-token
```

توکن اعتبارسنجی می‌شود، `.env` به‌روز و سرویس ری‌استارت می‌شود. **دیتابیس حفظ می‌ماند** — کاربران فقط باید به ربات جدید `/start` بزنند.

### 👑 عوض کردن ادمین

```bash
quadtwo set-admin
# یا
quadtwo set-admin 123456789
# چند ادمین:
quadtwo set-admin 111111111,222222222
```

`ADMIN_TELEGRAM_IDS` در `.env` عوض می‌شود، ادمین‌های قدیمی دیتابیس به کاربر عادی تنزل می‌یابند، و `extra_admin_ids` پاک می‌شود. از اکانت جدید `/start` بزنید.
### 🗑 حذف

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Peymantia/quadtwo/main/install.sh) --uninstall
```

---

## 🧭 منوی اصلی ربات

```text
🛒 خرید سرویس جدید
📦 سرویس‌های من     |  ♻️ تمدید سرویس
👤 حساب من          |  💰 کیف پول من
🧪 سرویس تست        |  💡 آموزش استفاده
🤝 درخواست نمایندگی |  🆘 پشتیبانی
🚀 داشبورد وب / کد ورود داشبورد
🎛 کنترل سنتر ادمین |  💼 مشخصات نماینده   ← فقط ادمین
```

---

## 💻 توسعه لوکال

```bash
cp .env.example .env
npm install
npm run db:push -w @quadtwo/server
npm run dev -w @quadtwo/server
# ترمینال دیگر:
npm run dev -w @quadtwo/web
```

اگر از ایران به `api.telegram.org` وصل نمی‌شوید، روی VPS اجرا کنید یا `TELEGRAM_PROXY` بگذارید.

### 🌐 داشبورد وب (`dash.anthropics.ir`)

راهنمای کامل نصب: [`deploy/README.md`](deploy/README.md)

1. در Cloudflare رکورد **A** برای `dash` → IP سرور (Proxy روشن، SSL = Full).
2. Nginx: [`deploy/nginx-dash.anthropics.ir.conf`](deploy/nginx-dash.anthropics.ir.conf)
3. `.env`: `DASH_DOMAIN` و `NEXT_PUBLIC_API_URL`
4. سرویس‌ها: `quadtwo` (API :4000) و `quadtwo-web` (Next :3000)
5. ورود با **رمز** یا **OTP** از ربات (دکمه «کد ورود داشبورد»)

نقش‌ها: ادمین · همکار (`partner`) · ریسلر (`wholesale`) · کاربر

### 📁 ساختار پروژه

```text
apps/server       # API + ربات (Hono · grammY · Prisma/SQLite)
apps/web          # داشبورد وب Piing (Next.js)
packages/shared   # تایپ‌های مشترک
deploy/           # نمونه Nginx برای dash.*
install.sh        # نصب‌کننده و CLI روی سرور
docs/             # معماری و رودمپ
```

---

## 📚 مستندات

| فایل | محتوا |
|:--|:--|
| [`deploy/README.md`](deploy/README.md) | نصب وب‌پنل dash.* |
| [`docs/PROJECT.md`](docs/PROJECT.md) | شرح محصول |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | معماری فنی |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | نقشه راه |
| [`docs/MINIAPP-CLOUDFLARE.md`](docs/MINIAPP-CLOUDFLARE.md) | تانل Mini App |

---

<p align="center">
  <sub>ساخته‌شده برای فروش حرفه‌ای VPN روی تلگرام · قدرت‌گرفته از 3x-ui</sub>
</p>
