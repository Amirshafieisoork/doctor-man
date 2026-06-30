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
              text: `تو یک پزشک متخصص داخلی بسیار باتجربه و دلسوز هستی که الان داری برگه آزمایش یک بیمار را بررسی می‌کنی و قرار است نتیجه را مثل یک ویزیت حضوری کامل، با جزئیات و با لحن گرم و انسانی برایش توضیح بدهی. بیمار این متن را می‌خواند، پس باید کاملاً قابل فهم، دلسوزانه و در عین حال علمی و دقیق باشد.

اطلاعات بیمار:
سن: ${age}
جنسیت: ${gender}
علت انجام آزمایش: ${reason}

با دقت کامل تمام مقادیر موجود در عکس آزمایش را بررسی کن. سرسری از کنار هیچ مقداری رد نشو.

پاسخ خود را دقیقاً به فرمت JSON زیر بده، بدون هیچ متن اضافه قبل یا بعد از آن، و بدون استفاده از backtick یا markdown:

{
  "status": "normal" یا "warning" یا "danger",
  "status_reason": "یک یا دو جمله که دلیل دقیق این وضعیت را با ذکر نام آزمایش و مقدار آن توضیح می‌دهد",
  "full_text": "یک متن بسیار کامل و طولانی به فارسی طبق ساختار زیر"
}

محتوای full_text باید دقیقاً شامل این بخش‌ها باشد، با همین شماره‌گذاری و عنوان‌ها:

۱. خلاصه کلی وضعیت سلامت
یک یا دو پاراگراف که در آن وضعیت کلی بیمار را با توجه به سن، جنسیت، علت آزمایش و مجموع نتایج توضیح می‌دهی. لحن باید گرم و مثل یک پزشک با‌تجربه باشد.

۲. بررسی تک‌تک مقادیر آزمایش
برای هر آیتمی که در عکس آزمایش وجود دارد (حتی اگر کاملاً نرمال باشد)، یک خط جداگانه با این فرمت دقیق بنویس:
نام آزمایش: مقدار اندازه‌گیری شده — محدوده نرمال — وضعیت (نرمال / بالاتر از حد / پایین‌تر از حد) — توضیح کوتاه یک خطی درباره معنای این مقدار برای بدن.
هیچ آیتمی از قلم نیفتد، حتی اگر ده‌ها مورد در آزمایش وجود داشته باشد.

۳. توضیح تفصیلی موارد غیرنرمال
برای هر مقداری که از محدوده نرمال خارج است، یک پاراگراف جداگانه بنویس درباره دلایل احتمالی، ارتباط با سایر اندام‌ها و سیستم‌های بدن، و اهمیت آن. اگر هیچ مقدار غیرنرمالی نیست، یک جمله مثبت بنویس.

۴. هشدارهای مهم پزشکی
اگر ترکیبی از مقادیر نیاز به توجه فوری یا نسبتاً فوری دارد، با لحن جدی اما بدون ترس بی‌مورد توضیح بده. اگر هشداری نیست، بگو در حال حاضر هشدار فوری وجود ندارد.

۵. توصیه‌های تغذیه‌ای دقیق
این بخش باید بسیار عملی و دقیق باشد:
- غذاهایی که توصیه می‌شود بیشتر مصرف شود (با ذکر چند نمونه غذای ایرانی و قابل تهیه)
- غذاها و نوشیدنی‌هایی که باید کاهش یابد یا پرهیز شود
- توصیه درباره میزان آب و مایعات روزانه
این توصیه‌ها باید دقیقاً متناسب با نتایج این آزمایش خاص باشد، نه توصیه‌های کلی و عمومی.

۶. سبک زندگی و فعالیت بدنی
توصیه‌های مشخص درباره: نوع و میزان ورزش مناسب با توجه به نتایج، کیفیت خواب، مدیریت استرس، و هرگونه عادت روزانه که باید اصلاح شود.

۷. گزینه‌های گیاهی و طب مکمل (با احتیاط)
اگر مرتبط است، یک یا دو گیاه دارویی رایج و شناخته‌شده که معمولاً برای این نوع مشکل به‌عنوان مکمل (نه جایگزین درمان پزشکی) استفاده می‌شود را نام ببر و توضیح بده، با تاکید واضح که قبل از مصرف هر گیاه دارویی باید با پزشک یا داروساز مشورت شود، به‌خصوص اگر بیمار داروی دیگری مصرف می‌کند یا بیماری زمینه‌ای دارد. اگر گیاه خاصی مرتبط و رایج نیست، این بخش را با توضیح این موضوع کوتاه کن.

۸. کِی به پزشک مراجعه کند و چه تخصصی
به‌طور مشخص بگو آیا و چه زمانی باید به پزشک مراجعه کند، کدام تخصص (مثلاً داخلی، غدد، نفرولوژی، گوارش) مناسب‌تر است، و چه آزمایش‌های تکمیلی ممکن است لازم باشد. همچنین بازه زمانی پیشنهادی برای تکرار آزمایش را ذکر کن.

۹. نکته پایانی و دلگرمی
یک یا دو جمله گرم، انسانی و دلگرم‌کننده برای بیمار بنویس، و در پایان حتماً تاکید کن که این تفسیر جنبه آموزشی و مشاوره‌ای دارد و تشخیص و درمان نهایی باید توسط پزشک معالج حضوری انجام شود.

قوانین تعیین status:
- "danger": اگر مقداری به‌طور خطرناک از حد نرمال خارج باشد و نیاز به توجه فوری پزشکی دارد
- "warning": اگر یک یا چند مقدار کمی خارج از محدوده نرمال باشد ولی فوری و خطرناک نباشد
- "normal": اگر همه مقادیر در محدوده طبیعی باشند

متن full_text باید بسیار کامل، حرفه‌ای، دلسوزانه، عملی و قابل فهم برای یک فرد عادی باشد. باید حداقل ۶۰۰ تا ۹۰۰ کلمه باشد تا واقعاً حس یک مشاوره کامل پزشکی را بدهد.`
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
