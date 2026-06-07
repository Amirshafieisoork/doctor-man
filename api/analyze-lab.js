export default async function handler(req, res) {
  return res.status(200).json({
    key: process.env.OPENAI_API_KEY ? "KEY EXISTS" : "KEY IS EMPTY"
  });
}
