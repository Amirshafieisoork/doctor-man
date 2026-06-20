const SUPABASE_URL = "https://dhciuxijsagtskrrtxua.supabase.co";
const SUPABASE_KEY = "sb_publishable_iFvEeEdG6dEvdYrqOhAVew_WmGr4276";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/plans?select=*&order=display_order.asc`,
      {
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch plans");
    }

    const plans = await response.json();

    return res.status(200).json({ success: true, plans });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
