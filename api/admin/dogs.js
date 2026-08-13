const {
  getAdminClient,
  getSupabaseConfig,
  handleApiError,
  requireAdminUser,
  sendJson,
} = require("../_utils/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const config = getSupabaseConfig();
    await requireAdminUser(req, supabase);

    const { data: dogs, error } = await supabase
      .from("dogs")
      .select(`
        *,
        owner:owners(*),
        bookings(*),
        vaccination_records(*),
        dog_notes:dog_notes!dog_notes_dog_id_fkey(*),
        compatibility_as_first:dog_compatibility!dog_compatibility_dog_one_id_fkey(*),
        compatibility_as_second:dog_compatibility!dog_compatibility_dog_two_id_fkey(*)
      `)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const enrichedDogs = await Promise.all(
      (dogs || []).map(async (dog) => {
        const records = await Promise.all(
          (dog.vaccination_records || []).map(async (record) => {
            const { data } = await supabase.storage
              .from(record.storage_bucket || config.bucket)
              .createSignedUrl(record.storage_path, 60 * 10);
            return { ...record, signed_url: data?.signedUrl || "" };
          }),
        );

        return { ...dog, vaccination_records: records };
      }),
    );

    sendJson(res, 200, { ok: true, dogs: enrichedDogs });
  } catch (error) {
    handleApiError(res, error);
  }
};
