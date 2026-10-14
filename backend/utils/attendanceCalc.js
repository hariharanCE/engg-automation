/* ─────────────────────────────────────────────────────────────────────────────
 * Shared attendance calculation — used by BOTH AttendanceDashboard and
 * AttendanceReport so the two screens can never disagree.
 *
 * Rules
 *  1. Teaching days = the unique dates in the batch's course planner
 *     (start date → end date). Each teaching day has SESSIONS_PER_DAY (3) sessions.
 *  2. A learner is PRESENT for a day when attended ≥ 2 of the 3 sessions
 *     (only status P / Present counts; A, L, NA and unmarked do not).
 *     2 present + 1 absent  → day present.   1 present + 2 absent → day absent.
 *  3. Attendance % = days present ÷ days conducted × 100.
 *     "Conducted" = teaching days before today, plus today once attendance has
 *     been saved for it. Days that haven't happened yet are never counted, and
 *     once the course is over this equals the full start→end figure.
 *     (Switch PERCENT_BASIS to "course" to divide by ALL course days instead.)
 *  4. Only attendance on teaching days is counted, so a % can never exceed 100.
 *  5. Colour: ≤ 50% red · 51–70% orange · 71–100% green (rounded to a whole %).
 * ───────────────────────────────────────────────────────────────────────────── */

export const SESSIONS_PER_DAY = 3;
export const MIN_SESSIONS_FOR_DAY_PRESENT = 2;
export const PERCENT_BASIS = "conducted";   // "conducted" | "course"

export const normDate = (d) => String(d || "").slice(0, 10);

/* YYYY-MM-DD for today in the browser's local timezone (not UTC) */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const isPresentStatus = (s) =>
  ["P", "PRESENT"].includes(String(s || "").trim().toUpperCase());

/* ── Colour bands ── */
const RED    = { key: "red",    fill: "#dc2626", bg: "#fee2e2", bd: "#fca5a5" };
const ORANGE = { key: "orange", fill: "#ea580c", bg: "#ffedd5", bd: "#fdba74" };
const GREEN  = { key: "green",  fill: "#16a34a", bg: "#dcfce7", bd: "#86efac" };

export function attendanceColor(pct) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return null;
  const whole = Math.round(Number(pct));      // 50.4 → 50 (red) · 50.6 → 51 (orange) · 70.6 → 71 (green)
  if (whole <= 50) return RED;
  if (whole <= 70) return ORANGE;
  return GREEN;
}

/* ── Main calculation ── */
export function computeAttendance(attendanceRows, plannerDates, opts = {}) {
  const today = normDate(opts.today) || localToday();

  const teachingDays = [...new Set((plannerDates || []).map(normDate).filter(Boolean))].sort();
  const takenDates   = new Set();
  (attendanceRows || []).forEach((r) => { const d = normDate(r.date); if (d) takenDates.add(d); });

  const conductedList = teachingDays.filter((d) => d < today || (d === today && takenDates.has(d)));
  const conductedSet  = new Set(conductedList);

  /* learner → date → set of sessions attended (teaching days already conducted only) */
  const perLearner = {};
  (attendanceRows || []).forEach((r, i) => {
    const d = normDate(r.date);
    if (!r.learner_email || !conductedSet.has(d)) return;
    const email = String(r.learner_email).trim().toLowerCase();
    if (!perLearner[email]) perLearner[email] = {};
    if (!perLearner[email][d]) perLearner[email][d] = new Set();
    if (isPresentStatus(r.status)) {
      perLearner[email][d].add(String(r.session ?? "").trim() || `__${i}`);
    }
  });

  const totalCourseDays = teachingDays.length;
  const conductedDays   = conductedList.length;

  const build = (days) => {
    let daysPresent = 0, sessionsPresent = 0;
    const absentDays = [];
    conductedList.forEach((d) => {
      const c = days && days[d] ? Math.min(days[d].size, SESSIONS_PER_DAY) : 0;
      sessionsPresent += c;
      if (c >= MIN_SESSIONS_FOR_DAY_PRESENT) daysPresent += 1; else absentDays.push(d);
    });
    const dayPct     = conductedDays   > 0 ? (daysPresent / conductedDays) * 100 : null;
    const sessionPct = conductedDays   > 0 ? (sessionsPresent / (conductedDays * SESSIONS_PER_DAY)) * 100 : null;
    const coursePct  = totalCourseDays > 0 ? (daysPresent / totalCourseDays) * 100 : null;
    return {
      daysPresent, sessionsPresent, absentDays, dayPct, sessionPct, coursePct,
      pct: PERCENT_BASIS === "course" ? coursePct : dayPct,
    };
  };

  const byEmail = {};
  Object.entries(perLearner).forEach(([email, days]) => { byEmail[email] = build(days); });

  return {
    today,
    startDate: teachingDays[0] || "",
    endDate:   teachingDays[teachingDays.length - 1] || "",
    totalCourseDays,
    totalCourseSessions: totalCourseDays * SESSIONS_PER_DAY,
    conductedDays,
    conductedSessions:   conductedDays * SESSIONS_PER_DAY,
    unmarkedPastDays:    conductedList.filter((d) => !takenDates.has(d)),
    byEmail,
    emptyStats: build(null),                    // a learner with no rows at all = absent every day
  };
}

/* Stats for one learner (zero-attendance stats when they have no rows) */
export const learnerStats = (summary, email) =>
  summary.byEmail[String(email || "").trim().toLowerCase()] || summary.emptyStats;