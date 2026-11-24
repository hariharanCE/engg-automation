/* ─────────────────────────────────────────────────────────────────────────────
 * Shared attendance calculator
 * Used by AttendanceDashboard.js and AttendanceReport.js so both show the same %.
 *
 * Rules
 *  - A batch has teaching days (the course-planner dates, between the batch's
 *    start and end date). Only days up to today count as "conducted".
 *  - Each teaching day has 3 sessions.
 *  - A learner is PRESENT for a day when they were present (P) in at least
 *    2 of the 3 sessions; otherwise the whole day counts as absent.
 *  - Attendance % = days present ÷ teaching days conducted × 100.
 * ───────────────────────────────────────────────────────────────────────────── */

export const SESSIONS_PER_DAY = 3;
export const MIN_SESSIONS_FOR_DAY_PRESENT = 2;

/* ── helpers ─────────────────────────────────────────────────────────────── */

function localToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* Normalise a date (string / ISO timestamp / Date) to YYYY-MM-DD, or "". */
function toISODate(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/* Normalise a status to "P" | "A" | "L" | "". */
function normStatus(v) {
  if (v && typeof v === "object") v = v.status;
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "P" || s === "PRESENT") return "P";
  if (s === "A" || s === "ABSENT") return "A";
  if (s === "L" || s === "LEAVE") return "L";
  return "";
}

const emailKey = (e) => String(e ?? "").trim().toLowerCase();

/* ── main calculator ─────────────────────────────────────────────────────── */

/**
 * @param {Array}  rows          attendance rows from /api/learner-attendance
 * @param {Array}  plannerDates  teaching dates of the batch ("YYYY-MM-DD")
 * @param {Object} opts          { today: "YYYY-MM-DD" } (optional)
 * @returns {{ today, conductedDays, dates, learners }}
 */
export function computeAttendance(rows = [], plannerDates = [], opts = {}) {
  const today = toISODate(opts.today) || localToday();

  /* Teaching days conducted so far (unique, sorted, not in the future). */
  const dates = Array.from(
    new Set((plannerDates || []).map(toISODate).filter((d) => d && d <= today))
  ).sort();
  const conducted = new Set(dates);

  /* acc[email][date] = { sessions: {1:"P",2:"A",...}, dayStatus: "" } */
  const acc = {};

  (rows || []).forEach((row) => {
    if (!row) return;
    const email = emailKey(row.email ?? row.learner_email ?? row.learnerEmail);
    const date = toISODate(row.date ?? row.attendance_date ?? row.attendanceDate);
    if (!email || !date || !conducted.has(date)) return;

    acc[email] = acc[email] || {};
    const cell = (acc[email][date] = acc[email][date] || { sessions: {}, dayStatus: "" });

    /* Shape 1: one row per session  →  { session, status } */
    const sn = Number(row.session ?? row.session_no ?? row.session_number ?? row.session_id);
    const status = normStatus(row.status);
    if (sn >= 1 && sn <= SESSIONS_PER_DAY && status) {
      cell.sessions[sn] = status;
    } else if (status) {
      /* Shape 2: one row per day  →  { status } */
      cell.dayStatus = status;
    }

    /* Shape 3: one row per day with a column per session */
    for (let i = 1; i <= SESSIONS_PER_DAY; i++) {
      const s = normStatus(row[`session${i}`] ?? row[`session_${i}`] ?? row[`s${i}`]);
      if (s) cell.sessions[i] = s;
    }
  });

  /* Work out present / absent for every learner on every teaching day. */
  const learners = {};
  Object.keys(acc).forEach((email) => {
    let daysPresent = 0;
    const dayStatus = {};
    dates.forEach((date) => {
      const cell = acc[email][date];
      let present = false;
      if (cell) {
        const pCount = Object.values(cell.sessions).filter((s) => s === "P").length;
        present = pCount >= MIN_SESSIONS_FOR_DAY_PRESENT || cell.dayStatus === "P";
      }
      dayStatus[date] = present ? "P" : "A";
      if (present) daysPresent += 1;
    });
    learners[email] = {
      daysPresent,
      daysAbsent: dates.length - daysPresent,
      dayStatus,
    };
  });

  return { today, conductedDays: dates.length, dates, learners };
}

/**
 * Stats for one learner from the result of computeAttendance().
 * @returns {{ daysPresent, daysAbsent, conductedDays, pct }}  pct is 0–100
 */
export function learnerStats(result, email) {
  const conductedDays = result?.conductedDays || 0;
  const entry = result?.learners?.[emailKey(email)];
  const daysPresent = entry?.daysPresent || 0;
  const pct = conductedDays > 0 ? (daysPresent / conductedDays) * 100 : 0;
  return {
    daysPresent,
    daysAbsent: conductedDays - daysPresent,
    conductedDays,
    pct,
  };
}

/**
 * Badge colours for an attendance %.
 *   ≤ 50%  red · 51–70%  orange · 71–100%  green
 * Returns { bg, bd, fill }, or null when pct isn't a number.
 */
export function attendanceColor(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  if (pct <= 50) return { bg: "#fee2e2", bd: "#fca5a5", fill: "#b91c1c" };
  if (pct <= 70) return { bg: "#ffedd5", bd: "#fdba74", fill: "#c2410c" };
  return { bg: "#dcfce7", bd: "#86efac", fill: "#15803d" };
}