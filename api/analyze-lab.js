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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: imageType,
                    data: imageBase64
                  }
                },
                {
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
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "API error");
    }

    return res.status(200).json({
      success: true,
      analysis: data.candidates[0].content.parts[0].text
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "خطا در تحلیل تصویر: " + err.message
    });
  }
}
