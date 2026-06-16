import OpenAI from "openai";
import Busboy from "busboy";

export const config = {
  api: { bodyParser: false }
};

const SUPABASE_URL = "https://dhciuxijsagtskrrtxua.supabase.co";
const SUPABASE_KEY = "sb_publishable_iFvEeEdG6dEvdYrqOhAVew_WmGr4276";

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
    const imageBase64 = imageBuffer.toString("base64");

    const openai = new OpenAI({
      apiKey: "aa-FvZAsrqj1W3oho7UDcqjfymOGUKnip0CnRT9xtgLRFnfkens",
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
                url: `data:${imageType};base64,${imageBase64}`
              }
            },
            {
              type: "text",
              text: `تو یک دستیار پزشکی هستی. این عکس آزمایش خون یک بیمار است.
سن: ${age}
جنسیت: ${gender}
علت آزمایش: ${reason}

لطفاً:
۱. مقادیر غیرنرمال را مشخص کن
۲. توضیح ساده بده هر مقدار یعنی چی
۳. هشدارهای مهم را بنویس
۴. پیشنهاد اقدام بعدی بده

به فارسی و ساده توضیح بده.`
            }
          ]
        }
      ],
      max_tokens: 1500
    });

    const analysis = response.choices[0].message.content;

    // Save result to Supabase
    if (userId) {
      try {
} catch (saveErr) {
  console.error("Failed to save result:", saveErr);
  return res.status(200).json({
    success: true,
    analysis: analysis + "\n\n[DEBUG SAVE ERROR: " + saveErr.message + "]"
  });
}
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
            analysis: analysis
          })
        });
      } catch (saveErr) {
        console.error("Failed to save result:", saveErr);
      }
    }

    return res.status(200).json({
      success: true,
      analysis: analysis
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "خطا در تحلیل تصویر: " + err.message
    });
  }
}
