export default async function handler(req, res) {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      success: false,
      error: "GEMINI_API_KEY not found"
    });
  }

  return res.status(200).json({
    success: true,
    message: "Gemini key detected"
  });
}