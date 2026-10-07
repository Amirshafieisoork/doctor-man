import { supabase } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data, error } = await supabase
      .from('plans')
      .select('id,name,slug,price,test_limit,features,is_popular,display_order,duration_days,active')
      .eq('active', true)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return res.status(200).json({ success: true, plans: data || [] });
  } catch (error) {
    console.error('get-plans', error);
    return res.status(500).json({ success: false, error: 'بارگذاری پلن‌ها انجام نشد' });
  }
}
