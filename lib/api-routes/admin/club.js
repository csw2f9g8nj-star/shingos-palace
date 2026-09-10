const {
  getAdminClient,
  handleApiError,
  normalizeField,
  publicApiError,
  requireAdminUser,
  sendJson,
} = require("../../api-utils/supabase");
const { parseMultipartForm } = require("../../api-utils/forms");

function orderDogPair(firstDogId, secondDogId) {
  return [firstDogId, secondDogId].sort();
}

function isActiveField(value) {
  return ["1", "true", "on", "active"].includes(normalizeField(value).toLowerCase());
}

async function requireExistingDog(supabase, dogId) {
  const { data: dog, error } = await supabase
    .from("dogs")
    .select("id,name,pet_type")
    .eq("id", dogId)
    .single();

  if (error || !dog) {
    throw publicApiError("We could not find that pet profile.", 404, "club_dog_not_found");
  }
  if (dog.pet_type !== "dog") {
    throw publicApiError("Only dogs can be added to Shingo's Palace Club.", 400, "club_dog_required");
  }

  return dog;
}

async function requireActiveMembers(supabase, dogIds) {
  const { data, error } = await supabase
    .from("club_memberships")
    .select("dog_id")
    .in("dog_id", dogIds)
    .eq("is_active", true);

  if (error) throw error;
  if ((data || []).length !== dogIds.length) {
    throw publicApiError("Both dogs must be active Club members before they can be matched.", 400, "inactive_club_member");
  }
}

async function getClubData(supabase) {
  const [{ data: memberships, error: membershipsError }, { data: matches, error: matchesError }] = await Promise.all([
    supabase.from("club_memberships").select("*").order("joined_at", { ascending: true }),
    supabase.from("club_matches").select("*").order("created_at", { ascending: true }),
  ]);

  if (membershipsError) throw membershipsError;
  if (matchesError) throw matchesError;

  return { memberships: memberships || [], matches: matches || [] };
}

async function saveMembership(supabase, admin, fields) {
  const dogId = normalizeField(fields.dogId);
  const isActive = isActiveField(fields.isActive);
  if (!dogId) throw publicApiError("Please select a dog.", 400, "missing_club_dog");

  await requireExistingDog(supabase, dogId);

  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await supabase
    .from("club_memberships")
    .select("id,is_active")
    .eq("dog_id", dogId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const payload = {
    dog_id: dogId,
    is_active: isActive,
    deactivated_at: isActive ? null : now,
    updated_at: now,
    updated_by: admin.email,
  };

  if (!existing) {
    payload.created_by = admin.email;
  }

  const { data, error } = await supabase
    .from("club_memberships")
    .upsert(payload, { onConflict: "dog_id" })
    .select()
    .single();
  if (error) throw error;

  return data;
}

async function saveMatch(supabase, admin, fields) {
  const firstDogId = normalizeField(fields.dogOneId);
  const secondDogId = normalizeField(fields.dogTwoId);
  const notes = normalizeField(fields.notes);

  if (!firstDogId || !secondDogId || firstDogId === secondDogId) {
    throw publicApiError("Please select two different Club dogs.", 400, "invalid_club_match_pair");
  }

  const [dogOneId, dogTwoId] = orderDogPair(firstDogId, secondDogId);
  await Promise.all([requireExistingDog(supabase, dogOneId), requireExistingDog(supabase, dogTwoId)]);
  await requireActiveMembers(supabase, [dogOneId, dogTwoId]);

  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await supabase
    .from("club_matches")
    .select("id")
    .eq("dog_one_id", dogOneId)
    .eq("dog_two_id", dogTwoId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const payload = {
    dog_one_id: dogOneId,
    dog_two_id: dogTwoId,
    notes,
    is_active: true,
    deactivated_at: null,
    updated_at: now,
    updated_by: admin.email,
  };
  if (!existing) payload.created_by = admin.email;

  const { data, error } = await supabase
    .from("club_matches")
    .upsert(payload, { onConflict: "dog_one_id,dog_two_id" })
    .select()
    .single();
  if (error) throw error;

  return data;
}

async function deactivateMatch(supabase, admin, fields) {
  const matchId = normalizeField(fields.matchId);
  if (!matchId) throw publicApiError("Club Match ID is required.", 400, "missing_club_match");

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("club_matches")
    .update({
      is_active: false,
      deactivated_at: now,
      updated_at: now,
      updated_by: admin.email,
    })
    .eq("id", matchId)
    .select()
    .single();

  if (error || !data) {
    throw publicApiError("We could not find that Club Match.", 404, "club_match_not_found");
  }

  return data;
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const admin = await requireAdminUser(req, supabase);

    if (req.method === "GET") {
      sendJson(res, 200, { ok: true, ...(await getClubData(supabase)) });
      return;
    }

    const { fields } = await parseMultipartForm(req);
    const action = normalizeField(fields.action);

    if (action === "membership") {
      const membership = await saveMembership(supabase, admin, fields);
      sendJson(res, 200, { ok: true, membership });
      return;
    }

    if (action === "match" && req.method === "POST") {
      const match = await saveMatch(supabase, admin, fields);
      sendJson(res, 200, { ok: true, match });
      return;
    }

    if (action === "match" && req.method === "PATCH") {
      const match = await deactivateMatch(supabase, admin, fields);
      sendJson(res, 200, { ok: true, match });
      return;
    }

    throw publicApiError("Club action not found.", 400, "invalid_club_action");
  } catch (error) {
    handleApiError(res, error);
  }
};

module.exports.config = { api: { bodyParser: false } };

