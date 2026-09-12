const { calculateBoardingHolidayPricing, getBoardingNights } = require("../../holiday-pricing");
const { publicApiError } = require("./supabase");

const SERVICE_RATES = {
  boarding: 50,
  daycare: 35,
  walking: 18,
};
const ADDITIONAL_DOG_RATE = 35;
const CAT_BOARDING_RATE = 30;
const ADDITIONAL_CAT_RATE = 20;
const DEPOSIT_RATE = 0.25;

function bookingRateForPet(petType, role, service) {
  if (service === "boarding") {
    if (petType === "cat") return role === "additional" ? ADDITIONAL_CAT_RATE : CAT_BOARDING_RATE;
    return role === "additional" ? ADDITIONAL_DOG_RATE : SERVICE_RATES.boarding;
  }
  return SERVICE_RATES[service] || 0;
}

function pricingBreakdownForPets(pets, service, units) {
  const seen = { dog: 0, cat: 0 };
  return pets.map((pet) => {
    seen[pet.petType] += 1;
    const role = seen[pet.petType] === 1 ? "primary" : "additional";
    const rate = bookingRateForPet(pet.petType, role, service);
    return {
      petName: pet.name,
      petType: pet.petType,
      role,
      units,
      rate,
      subtotal: rate * units,
    };
  });
}

function pickupAdjustment(service, departureTime, oneUnitTotal) {
  if (service !== "boarding" || !departureTime) return { amount: 0, extraUnit: 0 };
  const [hours, minutes = "0"] = String(departureTime).split(":").map(Number);
  const totalMinutes = hours * 60 + minutes;
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 12 * 60) return { amount: 0, extraUnit: 0 };
  if (totalMinutes <= 21 * 60) return { amount: 25, extraUnit: 0 };
  return { amount: oneUnitTotal, extraUnit: 1 };
}

async function getActiveHolidayPeriods(supabase) {
  const { data, error } = await supabase
    .from("holiday_pricing")
    .select("id,name,start_date,end_date,tier,boarding_surcharge,calendar_label,active")
    .eq("active", true)
    .order("start_date", { ascending: true });

  if (error) {
    const pricingError = publicApiError(
      "We could not verify holiday pricing. Please try again in a moment.",
      500,
      "holiday_pricing_lookup_failed",
    );
    pricingError.supabaseCode = error.code;
    pricingError.supabaseMessage = error.message;
    throw pricingError;
  }
  if (!data?.length) {
    throw publicApiError(
      "Holiday pricing is temporarily unavailable. Please try again in a moment.",
      503,
      "holiday_pricing_empty",
    );
  }
  return data;
}

async function calculateAuthoritativeBookingPricing({ supabase, pets, service, fields }) {
  const requestedUnits = Math.max(1, Number(fields.units) || 1);
  const boardingNights = service === "boarding" ? getBoardingNights(fields.dropoffDate, fields.pickupDate) : [];
  if (service === "boarding" && !boardingNights.length) {
    throw publicApiError("Please select valid boarding dates.", 400, "invalid_boarding_dates");
  }

  const units = service === "boarding" ? boardingNights.length : requestedUnits;
  const petPricing = pricingBreakdownForPets(pets, service, units);
  const baseTotal = petPricing.reduce((total, item) => total + item.subtotal, 0);
  const oneUnitTotal = pricingBreakdownForPets(pets, service, 1).reduce((total, item) => total + item.subtotal, 0);
  const holidayPeriods = service === "boarding" ? await getActiveHolidayPeriods(supabase) : [];
  const holidayPricing = service === "boarding"
    ? calculateBoardingHolidayPricing(fields.dropoffDate, fields.pickupDate, holidayPeriods)
    : calculateBoardingHolidayPricing("", "", []);
  const pickup = pickupAdjustment(service, fields.departureTime, oneUnitTotal);
  const total = baseTotal + holidayPricing.totalSurcharge + pickup.amount;
  const deposit = Math.ceil(total * DEPOSIT_RATE);
  const remaining = Math.max(0, total - deposit);
  const pricingBreakdown = [
    ...petPricing,
    ...holidayPricing.groups.map((group) => ({
      type: "holiday_surcharge",
      tier: group.tier,
      units: group.nights,
      rate: group.surcharge,
      subtotal: group.subtotal,
      labels: group.labels,
    })),
  ];

  return {
    units,
    pricingBreakdown,
    holidayPricing,
    pickup,
    total,
    deposit,
    remaining,
    formatted: {
      total: `$${total}`,
      deposit: `$${deposit}`,
      remaining: `$${remaining}`,
    },
  };
}

module.exports = {
  calculateAuthoritativeBookingPricing,
  pickupAdjustment,
  pricingBreakdownForPets,
};
