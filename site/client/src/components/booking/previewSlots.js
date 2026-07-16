/**
 * buildPreviewSlots — synthesize a couple of weeks of bookable slots from a
 * link's weekly hours so the admin editor preview looks live without hitting
 * the slots API. weeklyHours: [{ dayOfWeek 0-6, start "HH:MM", end "HH:MM" }].
 */
export const buildPreviewSlots = (weeklyHours = [], durationMinutes = 30, horizonDays = 21) => {
  const out = [];
  const toMin = (s) => { const [h, m] = String(s || '').split(':').map(Number); return h * 60 + (m || 0); };
  const now = new Date();
  for (let offset = 1; offset <= horizonDays; offset += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const windows = weeklyHours.filter((w) => Number(w.dayOfWeek) === d.getDay());
    for (const win of windows) {
      const startMin = toMin(win.start);
      const endMin = toMin(win.end);
      for (let m = startMin; m + durationMinutes <= endMin; m += durationMinutes) {
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60);
        const e = new Date(s.getTime() + durationMinutes * 60000);
        out.push({ start: s.toISOString(), end: e.toISOString() });
      }
    }
  }
  return out;
};
