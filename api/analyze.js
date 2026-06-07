export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    res.status(200).json({ 
      success: true, 
      analysis: "✅ تست موفق! اتصال به سرور برقرار است.\n\nدر نسخه بعدی تحلیل واقعی عکس اضافه خواهد شد." 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}