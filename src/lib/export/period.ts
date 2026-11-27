/**
 * The first and last day of the previous calendar month, as `2026-10-01` and `2026-10-31`, for
 * the default period of the export (design B4). `today` is the Belgian day (`brusselsDayKey`).
 */
export function previousMonth(today: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
  if (!match) {
    throw new RangeError(`Invalid date: ${today}`);
  }
  let year = Number(match[1]);
  let month = Number(match[2]) - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}
