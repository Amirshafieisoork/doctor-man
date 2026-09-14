const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("Supabase server configuration is missing");
}

export default async function handler(req, res) {
  try {
    if (req.method === "PUT") {
      const { id, name, price, test_limit, features, is_popular, display_order } = req.body;

      if (!id) {
        return res.status(400).json({ success: false, error: "شناسه پلن الزامی است" });
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/plans?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          name, price, test_limit, features, is_popular, display_order
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      const updated = await response.json();
      return res.status(200).json({ success: true, plan: updated[0] });
    }

    if (req.method === "POST") {
      const { name, price, test_limit, features, is_popular, display_order } = req.body;

      const response = await fetch(`${SUPABASE_URL}/rest/v1/plans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          name, price, test_limit, features, is_popular, display_order
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      const created = await response.json();
      return res.status(200).json({ success: true, plan: created[0] });
    }

    if (req.method === "DELETE") {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({ success: false, error: "شناسه پلن الزامی است" });
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/plans?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
