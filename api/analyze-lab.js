import OpenAI from "openai";
import Busboy from "busboy";

export const config = {
  api: { bodyParser: false }
};

const SUPABASE_URL = "https://dhciuxijsagtskrrtxua.supabase.co";
const SUPABASE_KEY = "sb_publishable_iFvEeEdG6dEvdYrqOhAVew_WmGr4276";
const AVALAI_KEY = "aa-FvZAsrqj1W3oho7UDcqjfymOGUKnip0CnRT9xtgLRFnfkens";

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const fields = {};
    let imageBuffer = null;
    let imageType = "image/jpeg";

    busboy.on("field", (name, val) => {
      fields[name] = val;
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];
      if (info && info.mimeType) imageType = info.mimeType;

      file.on("data", (chunk) => chunks.push(chunk));
      file.on("end", () => {
        imageBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on("finish", () => {
      resolve({ fields, imageBuffer, imageType });
    });

    busboy.on("error", reject);

    req.pipe(busboy);
  });
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { fields, imageBuffer, imageType } = await parseForm(req);

    if (!imageBuffer) {
      return res.status(400).json({ success: false, error: "تصویری ارسال نشده است" });
    }

    const age = fields.age || "";
    const gender = fields.gender || "";
    const reason = fields.reason || "";
    const userId = fields.user_id || null;

    if (!userId) {
      return res.status(400).json({ success: false, error: "ابتدا باید وارد حساب کاربری خود شوید" });
    }

    const imageBase64 = imageBuffer.toString("base64");
    const imageDataUrl = `data:${imageType};base64,${imageBase64}`;

    const openai = new OpenAI({
      apiKey: AVALAI_KEY,
      baseURL: "https://api.avalai.ir/v1"
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl
              }
            },
            {
              type: "text",
              text: `تو یک دستیار پزشکی متخصص و باتجربه هستی که آزمایش‌های پزشکی را برای بیماران به زبان ساده اما کاملاً دقیق و جامع تفسیر می‌کنی. این عکس یک برگه آزمایش پزشکی است.

اطلاعات بیمار:
سن: ${age}
جنسیت: ${gender}
علت انجام آزمایش: ${reason}

وظیفه تو این است که با دقت کامل تمام مقادیر موجود در عکس آزمایش را بررسی کنی و یک تفسیر کامل، دقیق و قابل فهم برای بیمار بنویسی. سرسری از کنار هیچ مقداری رد نشو.

پاسخ خود را دقیقاً به فرمت JSON زیر بده، بدون هیچ متن اضافه قبل یا بعد از آن، و بدون استفاده از backtick یا markdown:

{
  "status": "normal" یا "warning" یا "danger",
  "status_reason": "یک یا دو جمله که دلیل دقیق این وضعیت را با ذکر نام آزمایش و مقدار آن توضیح می‌دهد",
  "full_text": "یک متن کامل، طولانی و بسیار جامع به فارسی که شامل بخش‌های زیر باشد و حتماً با همین ساختار و شماره‌گذاری نوشته شود"
}

محتوای full_text باید دقیقاً شامل این بخش‌ها باشد:

۱. خلاصه کلی وضعیت سلامت
یک پاراگراف که در آن وضعیت کلی بیمار را بر اساس مجموع نتایج توضیح می‌دهی، با توجه به سن، جنسیت و علت آزمایش.

۲. بررسی تک‌تک مقادیر آزمایش
برای هر آیتمی که در عکس آزمایش وجود دارد (حتی اگر کاملاً نرمال باشد)، یک خط جداگانه با این فرمت بنویس:
- نام آزمایش: مقدار اندازه‌گیری شده — محدوده نرمال — وضعیت (نرمال / بالاتر از حد / پایین‌تر از حد) — توضیح کوتاه یک خطی درباره معنای این مقدار برای بدن
این بخش باید کامل باشد و هیچ آیتمی از قلم نیفتد، حتی اگر ده‌ها مورد در آزمایش وجود داشته باشد.

۳. توضیح تفصیلی موارد غیرنرمال
برای هر مقداری که از محدوده نرمال خارج است، یک پاراگراف جداگانه بنویس که در آن توضیح بدهی:
این مقدار غیرنرمال معمولاً به چه دلایلی ممکن است رخ بدهد، چه ارتباطی با سایر اندام‌ها و سیستم‌های بدن دارد، و چرا اهمیت دارد. اگر هیچ مقدار غیرنرمالی وجود ندارد، این بخش را با یک جمله مثبت توضیح بده.

۴. هشدارهای مهم پزشکی
اگر هر نوع ترکیبی از مقادیر وجود دارد که نیاز به توجه فوری یا نسبتاً فوری دارد، اینجا به‌طور واضح و با لحن جدی (اما بدون ایجاد ترس بی‌مورد) ذکر کن. اگر هشدار خاصی نیست، بنویس که در حال حاضر هشدار فوری وجود ندارد.

۵. پیشنهادات و اقدامات بعدی
لیستی از اقدامات عملی و مشخص بنویس: آیا نیاز به مراجعه به پزشک متخصص است (و کدام تخصص)، چه آزمایش‌های تکمیلی ممکن است لازم باشد، چه تغییرات سبک زندگی یا تغذیه‌ای می‌تواند کمک‌کننده باشد، و در چه بازه زمانی توصیه می‌شود آزمایش تکرار شود.

۶. نکته پایانی
یک جمله گرم و دلگرم‌کننده برای بیمار، که تاکید کند این تفسیر جنبه آموزشی دارد و تشخیص نهایی بر عهده پزشک است.

قوانین تعیین status:
- "danger": اگر مقداری به‌طور خطرناک از حد نرمال خارج باشد و نیاز به توجه فوری پزشکی دارد (مثل قند خون بسیار بالا یا بسیار پایین، کم‌خونی شدید، اختلال جدی در عملکرد کبد یا کلیه، علائم عفونت شدید)
- "warning": اگر یک یا چند مقدار کمی خارج از محدوده نرمال باشد ولی فوری و خطرناک نباشد
- "normal": اگر همه مقادیر در محدوده طبیعی باشند

متن full_text باید کامل، حرفه‌ای، دلسوزانه و قابل فهم برای یک فرد عادی (نه پزشک) باشد. از اصطلاحات پیچیده پزشکی بدون توضیح استفاده نکن. حداقل باید ۳۰۰ تا ۵۰۰ کلمه باشد.`
            }
          ]
        }
      ],
      max_tokens: 4000
    });

    const rawText = response.choices[0].message.content;
    const parsed = extractJson(rawText);

    let status = "normal";
    let fullText = rawText;

    if (parsed) {
      status = parsed.status || "normal";
      fullText = parsed.full_text || rawText;
    }

    let saveError = null;

    try {
      const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/test_results`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          user_id: userId,
          age: age,
          gender: gender,
          reason: reason,
          analysis: fullText,
          status: status,
          image_url: null,
          image_base64: imageDataUrl
        })
      });

      if (!saveRes.ok) {
        const errText = await saveRes.text();
        saveError = `Status ${saveRes.status}: ${errText}`;
      }
    } catch (e) {
      saveError = e.message;
    }

    return res.status(200).json({
      success: true,
      analysis: fullText,
      status: status,
      status_reason: parsed ? parsed.status_reason : "",
      debug_save_error: saveError
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "خطا در تحلیل تصویر: " + err.message
    });
  }
}
