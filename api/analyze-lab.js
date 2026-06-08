import OpenAI from "openai";

export const config = {
api: { bodyParser: false }
};

export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({
success: false,
error: "Method not allowed"
});
}

try {
const chunks = [];

```
for await (const chunk of req) {
  chunks.push(chunk);
}

const buffer = Buffer.concat(chunks);
const body = buffer.toString("binary");

const boundary =
  req.headers["content-type"]?.split("boundary=")[1];

if (!boundary) {
  return res.status(400).json({
    success: false,
    error: "Boundary not found"
  });
}

const parts = body.split("--" + boundary);

let age = "";
let gender = "";
let reason = "";

const images = [];

for (const part of parts) {

  if (part.includes('name="age"')) {
    age =
      part.split("\r\n\r\n")[1]?.split("\r\n")[0] || "";
  }

  if (part.includes('name="gender"')) {
    gender =
      part.split("\r\n\r\n")[1]?.split("\r\n")[0] || "";
  }

  if (part.includes('name="reason"')) {
    reason =
      part.split("\r\n\r\n")[1]?.split("\r\n")[0] || "";
  }

  if (part.includes('name="images"')) {

    const match =
      part.match(/Content-Type: (.+)\r\n/);

    const imageType =
      match?.[1]?.trim();

    const imgData =
      part.split("\r\n\r\n")[1];

    if (imgData && imageType) {

      const imageBase64 =
        Buffer.from(
          imgData.split("\r\n--")[0],
          "binary"
        ).toString("base64");

      images.push({
        type: "image_url",
        image_url: {
          url: `data:${imageType};base64,${imageBase64}`
        }
      });
    }
  }
}

if (!images.length) {
  return res.status(400).json({
    success: false,
    error: "هیچ تصویری دریافت نشد"
  });
}

const openai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "https://api.x.ai/v1"
});

const response =
  await openai.chat.completions.create({
    model: "grok-4.1",

    messages: [
      {
        role: "user",
        content: [
          ...images,
          {
            type: "text",
            text: `تو یک دستیار پزشکی هستی.
```

سن: ${age}
جنسیت: ${gender}
علت آزمایش: ${reason}

ممکن است آزمایش در چند صفحه ارسال شده باشد.

تمام صفحات را با هم بررسی کن و:

1- مقادیر غیرطبیعی را مشخص کن
2- معنی هر مورد را ساده توضیح بده
3- هشدارهای مهم را بنویس
4- پیشنهاد اقدام بعدی بده

پاسخ را کاملاً فارسی و قابل فهم بنویس.`
}
]
}
],

```
    max_tokens: 2000
  });

return res.status(200).json({
  success: true,
  analysis:
    response.choices?.[0]?.message?.content ||
    "پاسخی دریافت نشد"
});
```

} catch (err) {

```
console.error(err);

return res.status(500).json({
  success: false,
  error:
    "خطا در تحلیل تصویر: " + err.message
});
```

}
}
