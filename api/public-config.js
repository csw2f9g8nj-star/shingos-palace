const { getAdminClient, getSupabaseConfig, sendJson } = require("../lib/api-utils/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const config = getSupabaseConfig();
  let holidayPricing = [];
  let holidayPricingAvailable = false;
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("holiday_pricing")
      .select("id,name,start_date,end_date,tier,boarding_surcharge,calendar_label,active")
      .eq("active", true)
      .order("start_date", { ascending: true });
    if (error) throw error;
    holidayPricing = data || [];
    holidayPricingAvailable = true;
  } catch (error) {
    console.error("Could not load public holiday pricing.", error?.message || error);
  }

  sendJson(res, 200, {
    ok: true,
    supabaseUrl: config.url,
    supabasePublishableKey: config.publishableKey,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    holidayPricing,
    holidayPricingAvailable,
  });
};
