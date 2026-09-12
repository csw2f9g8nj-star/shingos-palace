const { getAdminClient, getSupabaseConfig, sendJson } = require("../lib/api-utils/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const config = getSupabaseConfig();
  let holidayPricing = [];
  let holidayPricingAvailable = false;
  let holidayPricingErrorCode = "";
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("holiday_pricing")
      .select("id,name,start_date,end_date,tier,boarding_surcharge,calendar_label,active")
      .eq("active", true)
      .order("start_date", { ascending: true });
    if (error) throw error;
    holidayPricing = data || [];
    if (!holidayPricing.length) {
      const emptyError = new Error("No active holiday pricing rows were returned.");
      emptyError.code = "holiday_pricing_empty";
      throw emptyError;
    }
    holidayPricingAvailable = true;
  } catch (error) {
    holidayPricingErrorCode = error?.code || "holiday_pricing_lookup_failed";
    console.error("[public-config] Holiday pricing lookup failed.", {
      code: error?.code || null,
      message: error?.message || String(error),
      details: error?.details || null,
      hint: error?.hint || null,
    });
  }

  sendJson(res, 200, {
    ok: true,
    supabaseUrl: config.url,
    supabasePublishableKey: config.publishableKey,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    zelleAvailable: Boolean(process.env.ZELLE_PAYMENT_RECIPIENT),
    zellePaymentRecipient: process.env.ZELLE_PAYMENT_RECIPIENT || "",
    zellePaymentInstructions: process.env.ZELLE_PAYMENT_INSTRUCTIONS || "",
    holidayPricing,
    holidayPricingAvailable,
    holidayPricingErrorCode,
  });
};
