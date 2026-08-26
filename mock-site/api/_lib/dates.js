const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function projectWeekCount(startDate, endDate) {
  const start = utcDate(startDate);
  const end = utcDate(endDate);
  if (start === null || end === null || end < start) return null;
  const inclusiveDays = Math.floor((end - start) / DAY_MS) + 1;
  return Math.max(1, Math.ceil(inclusiveDays / 7));
}
