# DrMan

DrMan is a Persian digital-health ecosystem focused on an understandable lab-analysis entry point, a longitudinal personal/family health record, personalized care guidance, reminders, reviewed health education, doctor discovery and consent-based clinical workflows.

## Runtime architecture
- Static RTL product pages on Vercel
- One Hobby-compatible Vercel serverless entrypoint: `api/router.js`
- Internal handlers in `server/api`
- Supabase PostgreSQL + private Storage
- Signed HttpOnly sessions and server-side authorization
- AvalAI/OpenAI-compatible AI providers
- DigiPay checkout with server verification and database-atomic plan activation

## Main surfaces
- `/` refined lab-analysis landing experience
- `/health` longitudinal health record, trends and care plan
- `/doctors` verified doctor discovery
- `/doctor/:slug` public doctor profile, real availability and verified reviews
- `/doctor-portal` clinician workspace
- `/pricing` subscriptions
- `/learn` reviewed health knowledge hub
- `/account` personal data export and deletion requests
- `/admin` ecosystem management and moderation

## Security rules
Paid plans are activated only by the database finalization function after a verified DigiPay response, or by an explicit audited admin grant. Browser-side state never authorizes plan access. Medical tables are not directly writable from the browser.

## Deployment
Only the Vercel project `drman` should be linked to this repository. Preview deployments are created deliberately at milestones to conserve Hobby build quota. See `.env.example` for external credentials that must be supplied by the corresponding providers.

## توسعه و آزمون محلی

نسخه Node در `.nvmrc` مشخص شده است. برای شروع:

```sh
nvm use
npm ci --ignore-scripts --no-audit --no-fund
# یک فایل .env محلی مطابق نام‌های .env.example تهیه کنید؛ کلیدها را در Git ثبت نکنید.
npm run dev
```

سرور توسعه روی پورت ۳۰۰۰ و آدرس loopback اجرا می‌شود. مقدار `PORT` قابل تغییر است.
این سرور مسیرهای `vercel.json` و Router واقعی API را اجرا می‌کند؛ شبیه‌ساز کامل Vercel و OIDC نیست.
صفحات عمومی بدون کلید سرویس قابل مشاهده‌اند. APIهای نیازمند تنظیمات سرور، پاسخ ۵۰۳ می‌دهند.
برای توسعه محلی `NODE_ENV=development` بگذارید تا cookie روی HTTP محلی قابل استفاده باشد.
در Vercel مقدار production و HTTPS حفظ شود.

```sh
npm run check
npm test
npx playwright install chromium
npm run test:ui
```

اگر Chromium سیستم موجود است، مسیر آن را با `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` مشخص کنید.
آزمون‌های مرورگر روی موبایل و دسکتاپ با داده‌های ساختگیِ جدا از سرویس واقعی اجرا می‌شوند.
آزمون‌های سرور مالکیت پرونده، لغو نوبت، تغییر هم‌زمان وضعیت، نشست، زمان‌بندی، اعتبارسنجی و کش خصوصی را بررسی می‌کنند.
این آزمون‌ها هیچ حساب واقعی، پرداخت، تحلیل AI یا migration ایجاد نمی‌کنند.

## قابلیت‌های تکمیل‌شده در این تغییر

- ویرایش و حذف اطلاعات سلامت از صفحه پرونده، با کنترل مالکیت سرور و ثبت رویداد در audit log.
- لغو نوبت آینده توسط صاحب پرونده و ورود مستقیم به فرم آماده‌سازی ویزیت.
- کنترل انتقال وضعیت نوبت؛ نوبت لغوشده/تمام‌شده دوباره فعال نمی‌شود و ویزیت آینده قابل تکمیل نیست.
- بررسی تداخل بازه نوبت، تاریخ و ساعت معتبر، منطقه زمانی پزشک و لینک امن جلسه.
- پیش‌نمایش بزرگ آزمایش، thumbnail قابل انتخاب و حذف صفحه؛ محدودیت چهار صفحه حفظ شده است.
- تم روشن پیش‌فرض و حالت تیره با ذخیره ترجیح کاربر؛ دسترسی صفحه‌کلید به فرم‌های پرونده.
- اعتبارسنجی اعداد فارسی/عربی، فشار خون، بازه تاریخ‌ها و حفظ فیلدهای ارسال‌نشده هنگام ویرایش جزئی.
- جلوگیری از کش APIها و کارت اضطراری اختصاصی، و رد نشست‌های دستکاری‌شده یا cookie خراب.
- نصب قفل‌شده، سرور توسعه و آزمون‌های خودکار در CI.

محدودیت‌ها و مراحل آزمون آنلاین در [docs/verification.md](docs/verification.md) ثبت شده‌اند.
