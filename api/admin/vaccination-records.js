const fs = require("fs/promises");
const {
  getAdminClient,
  getSupabaseConfig,
  handleApiError,
  normalizeField,
  requireAdminUser,
  sanitizePathPart,
  sendJson,
  validateUploadFile,
} = require("../_utils/supabase");
const { parseMultipartForm, toFileArray } = require("../_utils/forms");

async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const config = getSupabaseConfig();
    const admin = await requireAdminUser(req, supabase);
    const { fields, files } = await parseMultipartForm(req);
    const dogId = normalizeField(fields.dogId);
    const ownerId = normalizeField(fields.ownerId);
    const expirationDate = normalizeField(fields.expirationDate) || null;
    const records = toFileArray(files.vaccinationRecords);

    if (!dogId || !ownerId || !records.length) {
      sendJson(res, 400, { ok: false, error: "Dog, owner, and vaccination files are required." });
      return;
    }

    const fileErrors = records.map(validateUploadFile).filter(Boolean);
    if (fileErrors.length) {
      sendJson(res, 400, { ok: false, error: fileErrors[0] });
      return;
    }

    const { data: dog, error: dogError } = await supabase
      .from("dogs")
      .select("id, name, owner:owners(id, email)")
      .eq("id", dogId)
      .eq("owner_id", ownerId)
      .single();
    if (dogError) throw dogError;

    const { data: existingRecords } = await supabase
      .from("vaccination_records")
      .select("version")
      .eq("dog_id", dogId)
      .order("version", { ascending: false })
      .limit(1);
    const nextVersion = Number(existingRecords?.[0]?.version || 0) + 1;

    const uploadedRecords = [];
    for (const [index, file] of records.entries()) {
      const extension = (file.originalFilename || "").split(".").pop()?.toLowerCase() || "upload";
      const path = [
        sanitizePathPart(dog.owner?.email),
        sanitizePathPart(dog.name),
        "admin-updates",
        `${Date.now()}-${index + 1}.${extension}`,
      ].join("/");
      const buffer = await fs.readFile(file.filepath);

      const { error: storageError } = await supabase.storage
        .from(config.bucket)
        .upload(path, buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
      if (storageError) throw storageError;

      const { data: record, error: recordError } = await supabase
        .from("vaccination_records")
        .insert({
          owner_id: ownerId,
          dog_id: dogId,
          storage_bucket: config.bucket,
          storage_path: path,
          original_filename: file.originalFilename,
          mime_type: file.mimetype,
          file_size: file.size,
          document_status: "updated",
          expiration_date: expirationDate,
          version: nextVersion,
          uploaded_by: admin.email,
        })
        .select()
        .single();
      if (recordError) throw recordError;
      uploadedRecords.push(record);
    }

    sendJson(res, 200, {
      ok: true,
      recordsUploaded: uploadedRecords.length,
      records: uploadedRecords,
    });
  } catch (error) {
    handleApiError(res, error);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
