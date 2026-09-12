const { publicApiError } = require("./supabase");

const ALLOWED_SERVICES = new Set(["boarding", "daycare", "walking"]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (!ISO_DATE_PATTERN.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeAvailabilityRequest({ service, startDate, endDate, petCount = 1 }) {
  const normalizedService = String(service || "").trim().toLowerCase();
  const normalizedStart = String(startDate || "").trim();
  const normalizedEnd = String(endDate || normalizedStart).trim();
  const normalizedPetCount = Math.max(1, Number.parseInt(petCount, 10) || 1);

  if (!ALLOWED_SERVICES.has(normalizedService)) {
    throw publicApiError("Please select a valid service.", 400, "invalid_availability_service");
  }
  if (!validDate(normalizedStart) || !validDate(normalizedEnd)) {
    throw publicApiError("Please select valid dates.", 400, "invalid_availability_dates");
  }
  if (
    (normalizedService === "boarding" && normalizedEnd <= normalizedStart) ||
    (normalizedService !== "boarding" && normalizedEnd < normalizedStart)
  ) {
    throw publicApiError("Please select a valid date range.", 400, "invalid_availability_range");
  }

  return {
    service: normalizedService,
    startDate: normalizedStart,
    endDate: normalizedEnd,
    petCount: normalizedPetCount,
  };
}

async function checkServiceAvailability(supabase, request, excludeBookingId = null) {
  const normalized = normalizeAvailabilityRequest(request);
  const { data, error } = await supabase.rpc("check_service_availability", {
    p_service: normalized.service,
    p_start_date: normalized.startDate,
    p_end_date: normalized.endDate,
    p_pet_count: normalized.petCount,
    p_exclude_booking_id: excludeBookingId,
  });

  if (error) {
    const availabilityError = publicApiError(
      "We could not verify availability. Please try again in a moment.",
      503,
      "availability_lookup_failed",
    );
    availabilityError.supabaseCode = error.code;
    availabilityError.supabaseMessage = error.message;
    availabilityError.details = error.details;
    availabilityError.hint = error.hint;
    throw availabilityError;
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.is_available !== "boolean") {
    throw publicApiError(
      "Availability is temporarily unavailable. Please try again in a moment.",
      503,
      "availability_not_configured",
    );
  }

  return {
    available: result.is_available,
    remainingCapacity: Number(result.remaining_capacity) || 0,
    capacity: Number(result.maximum_capacity) || 0,
    occupiedCapacity: Number(result.occupied_capacity) || 0,
    startDate: result.checked_start_date || normalized.startDate,
    endDate: result.checked_end_date || normalized.endDate,
    service: normalized.service,
  };
}

module.exports = {
  checkServiceAvailability,
  normalizeAvailabilityRequest,
};
