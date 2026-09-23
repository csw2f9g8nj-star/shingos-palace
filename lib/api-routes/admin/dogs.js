const {
  getAdminClient,
  getSupabaseConfig,
  handleApiError,
  normalizeField,
  publicApiError,
  requireAdminUser,
  sendJson,
} = require("../../api-utils/supabase");
const { parseMultipartForm } = require("../../api-utils/forms");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireDogId(value) {
  const dogId = normalizeField(value);
  if (!UUID_PATTERN.test(dogId)) {
    throw publicApiError("We could not find that pet profile.", 400, "invalid_pet_id");
  }
  return dogId;
}

async function getDog(supabase, dogId) {
  const { data, error } = await supabase
    .from("dogs")
    .select("id,owner_id,name,pet_type,archived_at")
    .eq("id", dogId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw publicApiError("We could not find that pet profile.", 404, "pet_not_found");
  return data;
}

async function getDogs(supabase, config) {
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

  return Promise.all(
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
}

async function archiveDog(supabase, admin, dog) {
  if (dog.archived_at) return dog;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dogs")
    .update({ archived_at: now, archived_by: admin.email, updated_at: now })
    .eq("id", dog.id)
    .is("archived_at", null)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data || { ...dog, archived_at: now };
}

async function restoreDog(supabase, dog) {
  if (!dog.archived_at) return dog;

  const { data, error } = await supabase
    .from("dogs")
    .update({ archived_at: null, archived_by: null, updated_at: new Date().toISOString() })
    .eq("id", dog.id)
    .not("archived_at", "is", null)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data || { ...dog, archived_at: null };
}

async function countRows(query) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function getDeletionBlockers(supabase, dogId) {
  const entries = await Promise.all([
    countRows(supabase.from("bookings").select("id", { count: "exact", head: true }).eq("dog_id", dogId)),
    countRows(supabase.from("booking_pets").select("id", { count: "exact", head: true }).eq("dog_id", dogId)),
    countRows(supabase.from("vaccination_records").select("id", { count: "exact", head: true }).eq("dog_id", dogId)),
    countRows(
      supabase
        .from("dog_notes")
        .select("id", { count: "exact", head: true })
        .or(`dog_id.eq.${dogId},related_dog_id.eq.${dogId}`),
    ),
    countRows(
      supabase
        .from("dog_compatibility")
        .select("id", { count: "exact", head: true })
        .or(`dog_one_id.eq.${dogId},dog_two_id.eq.${dogId}`),
    ),
    countRows(supabase.from("club_memberships").select("id", { count: "exact", head: true }).eq("dog_id", dogId)),
    countRows(
      supabase
        .from("club_matches")
        .select("id", { count: "exact", head: true })
        .or(`dog_one_id.eq.${dogId},dog_two_id.eq.${dogId}`),
    ),
    countRows(supabase.from("reviews").select("id", { count: "exact", head: true }).eq("pet_id", dogId)),
  ]);

  const labels = [
    "direct bookings",
    "multi-pet bookings",
    "vaccination records",
    "private notes",
    "compatibility records",
    "Club membership history",
    "Club Match history",
    "reviews",
  ];

  return entries
    .map((count, index) => ({ key: labels[index], count }))
    .filter((entry) => entry.count > 0);
}

async function deleteDog(supabase, dog, confirmationName) {
  if (normalizeField(confirmationName) !== dog.name) {
    throw publicApiError("Type the pet's exact name to confirm permanent deletion.", 400, "pet_name_confirmation_failed");
  }

  const blockers = await getDeletionBlockers(supabase, dog.id);
  if (blockers.length) {
    throw publicApiError(
      "This pet has booking, payment, Club, vaccination, review, note, or safety history and cannot be permanently deleted. Archive the profile instead.",
      409,
      "pet_delete_blocked",
    );
  }

  const { error } = await supabase.from("dogs").delete().eq("id", dog.id);
  if (error?.code === "23503") {
    throw publicApiError(
      "This pet has protected history and cannot be permanently deleted. Archive the profile instead.",
      409,
      "pet_delete_blocked",
    );
  }
  if (error) throw error;
}

module.exports = async function handler(req, res) {
  if (!["GET", "PATCH", "DELETE"].includes(req.method)) {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const config = getSupabaseConfig();
    const admin = await requireAdminUser(req, supabase);

    if (req.method === "GET") {
      sendJson(res, 200, { ok: true, dogs: await getDogs(supabase, config) });
      return;
    }

    const { fields } = await parseMultipartForm(req);
    const dogId = requireDogId(fields.dogId);
    const dog = await getDog(supabase, dogId);

    if (req.method === "PATCH") {
      const action = normalizeField(fields.action);
      if (action === "archive") {
        sendJson(res, 200, { ok: true, dog: await archiveDog(supabase, admin, dog), message: "Pet archived." });
        return;
      }
      if (action === "restore") {
        sendJson(res, 200, { ok: true, dog: await restoreDog(supabase, dog), message: "Pet restored." });
        return;
      }
      throw publicApiError("Pet action not found.", 400, "invalid_pet_action");
    }

    await deleteDog(supabase, dog, fields.confirmationName);
    sendJson(res, 200, { ok: true, message: "Pet permanently deleted." });
  } catch (error) {
    handleApiError(res, error);
  }
};

module.exports.config = { api: { bodyParser: false } };
