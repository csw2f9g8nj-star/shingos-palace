(function exposeHolidayPricing(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShingosHolidayPricing = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createHolidayPricing() {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function dateKeyToTimestamp(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return Number.NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function timestampToDateKey(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  function getBoardingNights(dropoffDate, pickupDate) {
    const start = dateKeyToTimestamp(dropoffDate);
    const end = dateKeyToTimestamp(pickupDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

    const nights = [];
    for (let current = start; current < end; current += DAY_MS) {
      nights.push(timestampToDateKey(current));
    }
    return nights;
  }

  function normalizePeriod(period) {
    return {
      id: period?.id || "",
      name: period?.name || "",
      startDate: period?.start_date || period?.startDate || "",
      endDate: period?.end_date || period?.endDate || "",
      tier: period?.tier || "calendar",
      surcharge: Math.max(0, Number(period?.boarding_surcharge ?? period?.surcharge) || 0),
      calendarLabel: period?.calendar_label || period?.calendarLabel || period?.name || "Holiday period",
      active: period?.active !== false,
    };
  }

  function periodContainsDate(period, dateKey) {
    return period.active && period.startDate <= dateKey && period.endDate >= dateKey;
  }

  function calculateBoardingHolidayPricing(dropoffDate, pickupDate, sourcePeriods) {
    const nights = getBoardingNights(dropoffDate, pickupDate);
    const periods = (Array.isArray(sourcePeriods) ? sourcePeriods : [])
      .map(normalizePeriod)
      .filter((period) => period.active && period.startDate && period.endDate);

    const nightly = nights.map((date) => {
      const applicable = periods
        .filter((period) => periodContainsDate(period, date))
        .sort((left, right) => right.surcharge - left.surcharge || left.startDate.localeCompare(right.startDate));
      const selected = applicable[0] || null;
      return {
        date,
        surcharge: selected?.surcharge || 0,
        tier: selected?.tier || "standard",
        name: selected?.name || "",
        calendarLabel: selected?.calendarLabel || "",
        periodId: selected?.id || "",
      };
    });

    const groupMap = new Map();
    nightly.filter((night) => night.surcharge > 0).forEach((night) => {
      const key = `${night.tier}|${night.surcharge}`;
      const group = groupMap.get(key) || {
        tier: night.tier,
        surcharge: night.surcharge,
        nights: 0,
        subtotal: 0,
        labels: [],
      };
      group.nights += 1;
      group.subtotal += night.surcharge;
      if (night.calendarLabel && !group.labels.includes(night.calendarLabel)) group.labels.push(night.calendarLabel);
      groupMap.set(key, group);
    });

    const matchedPeriods = periods.filter((period) => nights.some((date) => periodContainsDate(period, date)));
    const groups = [...groupMap.values()].sort((left, right) => right.surcharge - left.surcharge);

    return {
      nights,
      nightly,
      groups,
      matchedPeriods,
      totalSurcharge: groups.reduce((total, group) => total + group.subtotal, 0),
    };
  }

  return {
    calculateBoardingHolidayPricing,
    getBoardingNights,
  };
});
