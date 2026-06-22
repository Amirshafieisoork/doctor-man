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

function resizeBase64(base64, maxSize = 800) {
  // Just return as-is since we can't use canvas in Node.js without extra deps
  // The image will be stored as-is
  return base64;
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
              text: `تو یک دستیار پزشکی هستی. این عکس آزمایش خون یا آزمایش پزشکی یک بیمار است.
سن: ${age}
جنسیت: ${gender}
علت آزمایش: ${reason}

پاسخ خود را دقیقاً به فرمت JSON زیر بده، بدون هیچ متن اضافه قبل یا بعد از آن:

{
  "status": "normal" یا "warning" یا "danger",
  "status_reason": "یک جمله کوتاه که دلیل این وضعیت را توضیح می‌دهد",
  "abnormal_values": ["لیست مقادیر غیرنرمال، اگر وجود ندارد آرایه خالی بده"],
  "explanation": "توضیح ساده و کامل هر مقدار غیرنرمال به فارسی",
  "warnings": "هشدارهای مهم به فارسی، اگر وجود ندارد رشته خالی بده",
  "recommendation": "پیشنهاد اقدام بعدی به فارسی",
  "full_text": "یک متن کامل و خوانا شامل تمام بخش‌های بالا با شماره‌گذاری ۱ تا ۴ به فارسی، که مستقیماً به کاربر نمایش داده می‌شود"
}

قوانین تعیین status:
- "danger": اگر مقداری به‌طور خطرناک از حد نرمال خارج باشد و نیاز به توجه فوری پزشکی دارد
- "warning": اگر مقداری کمی خارج از محدوده نرمال باشد ولی فوری و خطرناک نباشد
- "normal": اگر همه مقادیر در محدوده طبیعی باشند

فقط JSON خام برگردان، بدون backtick یا markdown.`
            }
          ]
        }
      ],
      max_tokens: 2000
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
