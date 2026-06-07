import OpenAI from "openai";

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const body = buffer.toString("binary");

    const boundary = req.headers["content-type"].split("boundary=")[1];
    const parts = body.split("--" + boundary);

    let age = "", gender = "", reason = "", imageBase64 = "", imageType = "";

    for (const part of parts) {
      if (part.includes('name="age"')) {
        age = part.split("\r\n\r\n")[1]?.split("\r\n")[0] || "";
      }
      if (part.includes('name="gender"')) {
        gender = part.split("\r\n\r\n")[1]?.split("\r\n")[0] || "";
      }
      if (part.includes('name="reason"')) {
        reason = part.split("\r\n\r\n")[1]?.split("\r\n")[0] || "";
      }
      if (part.includes('name="image"')) {
        const match = part.match(/Content-Type: (.+)\r\n/);
        if (match) imageType = match[1].trim();
        const imgData = part.split("\r\n\r\n")[1];
        if (imgData) {
          imageBase64 = Buffer.from(imgData.split("\r\n--")[0], "binary").toString("base64");
        }
      }
    }

    const openai = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1"
    });

    const response = await openai.chat.completions.create({
      model: "grok-2-vision-1212",
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

    return res.status(200).json({
      success: true,
      analysis: response.choices[0].message.content
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "خطا در تحلیل تصویر: " + err.message
    });
  }
}
