import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { isInactiveLearnerStatus } from "../utils/learnerStatus";

// A learner is "locked" (greyed, non-markable) when Disabled, or inactive
// (Dropout / Batch Movement).
const isLearnerLocked = (l) => l?.status === "Disabled" || isInactiveLearnerStatus(l?.status);
import {
  Box,
  Typography,
  Grid,
  Select,
  MenuItem,
  FormControl,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Chip,
  Fade,
} from "@mui/material";

/* Returns YYYY-MM-DD for today in the *local* timezone (not UTC).
 * `new Date().toISOString().slice(0,10)` returns UTC date which can shift
 * by a day for users in IST near midnight. */
function getLocalToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* Read the logged-in user from whichever localStorage key the active login flow used. */
function getStoredUser() {
  try {
    const sess = JSON.parse(localStorage.getItem("userSession") || "null");
    if (sess && (sess.role || sess.email)) return sess;
  } catch (_) { /* ignore */ }
  try {
    const u = JSON.parse(localStorage.getItem("user") || "null");
    if (u) return u;
  } catch (_) { /* ignore */ }
  return null;
}

const API_BASE       = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";
const sessionsPerDay = 3;

/* A day counts as "present" when the learner attended ≥ 2 of the 3 sessions.
 * This mirrors the calculation in AttendanceReport.js so the overall % shown
 * here matches the report exactly. */
const MIN_SESSIONS_FOR_DAY_PRESENT = 2;

const isPresentStatus = (s) => {
  const v = (s || "").toString().trim().toUpperCase();
  return v === "P" || v === "PRESENT";
};

/* Compute each learner's overall (day-wise) attendance % from the batch-wide
 * rows returned by /api/learner-attendance — the same source and math the
 * Attendance Report uses: present teaching days / teaching days elapsed today.
 * Returns { byEmail: { <lowercased email>: { dayPct, daysPresent } },
 *           totalDaysTillToday }. */
function computeOverallAttendance(attendanceRows, plannerDates) {
  const today              = getLocalToday();
  const distinctDates      = [...new Set((plannerDates || []).filter(Boolean))];
  const totalDaysTillToday = distinctDates.filter((d) => d <= today).length;

  // Group attendance by learner → date → set of present sessions.
  const byLearner = {};
  (attendanceRows || []).forEach((row, i) => {
    if (!row.learner_email || row.date > today) return;
    const email = row.learner_email.trim().toLowerCase();
    if (!byLearner[email]) byLearner[email] = {};
    if (!byLearner[email][row.date]) byLearner[email][row.date] = new Set();
    if (isPresentStatus(row.status)) {
      // Dedupe by session id; fall back to a unique token when absent.
      const sess = (row.session ?? "").toString().trim() || `__${i}`;
      byLearner[email][row.date].add(sess);
    }
  });

  const byEmail = {};
  Object.entries(byLearner).forEach(([email, dates]) => {
    let daysPresent = 0;
    Object.values(dates).forEach((set) => {
      if (Math.min(set.size, sessionsPerDay) >= MIN_SESSIONS_FOR_DAY_PRESENT) daysPresent += 1;
    });
    const dayPct = totalDaysTillToday > 0 ? (daysPresent / totalDaysTillToday) * 100 : 0;
    byEmail[email] = { dayPct, daysPresent };
  });

  return { byEmail, totalDaysTillToday };
}

/* ── Overall attendance % badge (green ≥ 75, amber ≥ 50, red below) ── */
function PctBadge({ pct }) {
  const c = pct >= 75
    ? { fill: "#15803d", bg: "#dcfce7", bd: "#86efac" }
    : pct >= 50
      ? { fill: "#b45309", bg: "#fef3c7", bd: "#fcd34d" }
      : { fill: "#b91c1c", bg: "#fee2e2", bd: "#fca5a5" };
  return (
    <Box sx={{ display: "inline-flex", px: 1.2, py: 0.4, borderRadius: "12px", background: c.bg, border: `1px solid ${c.bd}` }}>
      <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 800, color: c.fill }}>
        {pct.toFixed(1)}%
      </Typography>
    </Box>
  );
}

/* ─── Design tokens ──────────────────────────────────────────────────────── */
const T = {
  surface:     "#ffffff",
  surfaceAlt:  "#eef3ff",
  border:      "#c3d3f8",
  accent:      "#2563eb",
  accentDark:  "#1d4ed8",
  accentLight: "#dbeafe",
  text:        "#1e2d5a",
  textSub:     "#5b6f9c",
};

const cardSx = {
  background:   T.surface,
  borderRadius: "16px",
  border:       `1px solid ${T.border}`,
  boxShadow:    "0 2px 16px rgba(37,99,235,0.08)",
  overflow:     "hidden",
};

const labelSx = {
  fontFamily:    "'DM Sans', sans-serif",
  fontSize:      10,
  fontWeight:    700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color:         T.textSub,
};

const selectSx = {
  borderRadius: "10px",
  fontFamily:   "'DM Sans', sans-serif",
  fontSize:     13,
  background:   T.surfaceAlt,
  "& fieldset":            { borderColor: T.border },
  "&:hover fieldset":       { borderColor: T.accent },
  "&.Mui-focused fieldset": { borderColor: T.accent },
};

/* ─── Session status display config ─────────────────────────────────────── */
const SESSION_CFG = {
  P:  { label: "P",  bg: "#dcfce7", text: "#15803d", border: "#86efac", hov: "#16a34a" },
  A:  { label: "A",  bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5", hov: "#dc2626" },
  L:  { label: "L",  bg: "#fef3c7", text: "#b45309", border: "#fcd34d", hov: "#d97706" },
  NA: { label: "NA", bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db", hov: "#6b7280" },
};

export default function AttendanceDashboard({ token, user }) {
  /* ── Role gating ── Admin/Coordinator can mark attendance for past dates;
   *    everyone else is locked to today's date. */
  const storedUser  = useMemo(() => user || getStoredUser(), [user]);
  const roleLower   = useMemo(
    () => ((storedUser?.role || "")).toString().trim().toLowerCase(),
    [storedUser]
  );
  const canMarkPastDates = useMemo(
    () => roleLower === "admin" || roleLower === "coordinator" || roleLower === "corrdinator",
    [roleLower]
  );

  /* ── Bulk marking is available only to Admin / Manager / Coordinator ── */
  const canBulkMark = useMemo(
    () =>
      ["admin", "manager", "management", "coordinator", "corrdinator"].includes(
        roleLower
      ),
    [roleLower]
  );

  const todayLocal = useMemo(() => getLocalToday(), []);

  const [domains,         setDomains]         = useState([]);
  const [domain,          setDomain]          = useState("");
  const [batches,         setBatches]         = useState([]);
  const [batchNo,         setBatchNo]         = useState("");
  const [learners,        setLearners]        = useState([]);
  /* `todayDate` is the date currently being marked (kept name to minimise diff).
   * For non-admin/coord roles this is always today; admin/coord can change it
   * to any past date within the course range. */
  const [todayDate,       setTodayDate]       = useState("");
  const [courseStartDate, setCourseStartDate] = useState("");
  const [courseEndDate,   setCourseEndDate]   = useState("");

  /* attendance[learnerEmail][todayDate][session] = { status: "", savedStatus: "" }
   * - status:      current (possibly unsaved) value shown in UI
   * - savedStatus: last value confirmed saved to server (used to show "saved" indicator)
   */
  const [attendance,  setAttendance]  = useState({});
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [message,     setMessage]     = useState("");

  /* Overall (cumulative) attendance % per learner, keyed by lowercased email.
   * Shown in the table so trainers see each learner's standing while marking.
   * Same source & math as the Attendance Report. */
  const [overallPct,  setOverallPct]  = useState({ byEmail: {}, totalDaysTillToday: 0 });

  /* Track which learners have unsaved changes (to show a dirty indicator) */
  const [dirtyEmails, setDirtyEmails] = useState(new Set());

  /* ── Bulk-mark controls (Admin / Manager / Coordinator only) ── */
  const [bulkFrom,   setBulkFrom]   = useState("");
  const [bulkTo,     setBulkTo]     = useState("");
  const [bulkStatus, setBulkStatus] = useState("P");
  const [bulkSaving, setBulkSaving] = useState(false);

  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  /* ── Load overall attendance % for the whole batch (same endpoint & math as
   *    the Attendance Report). Runs on batch change and after every save so the
   *    figure stays current as attendance is marked. ── */
  const loadOverallAttendance = useCallback(async () => {
    if (!batchNo) { setOverallPct({ byEmail: {}, totalDaysTillToday: 0 }); return; }
    try {
      const res = await axios.get(`${API_BASE}/api/learner-attendance`, {
        params:  { batch_no: batchNo },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const { attendance, planner_dates } = res.data || {};
      const plannerArr = (planner_dates || []).map((d) => (typeof d === "string" ? d : d.date));
      setOverallPct(computeOverallAttendance(attendance || [], plannerArr));
    } catch (e) {
      console.error("Failed to load overall attendance", e);
      setOverallPct({ byEmail: {}, totalDaysTillToday: 0 });
    }
  }, [batchNo, token]);

  useEffect(() => { loadOverallAttendance(); }, [loadOverallAttendance]);

  /* ── Load domains ── */
  useEffect(() => {
    axios.get(`${API_BASE}/api/get_domains`).then((res) => setDomains(res.data || []));
  }, []);

  /* ── Load batches when domain changes ── */
  useEffect(() => {
    if (!domain) {
      setBatches([]); setBatchNo(""); setLearners([]); setTodayDate("");
      setCourseStartDate(""); setCourseEndDate(""); setAttendance({});
      setDirtyEmails(new Set());
      return;
    }
    axios
      .get(`${API_BASE}/api/get_batches_by_domain`, { params: { domain } })
      .then((res) => setBatches(res.data || []));
  }, [domain]);

  /* ── Load learners + course dates when batch changes ── */
  useEffect(() => {
    if (!batchNo) {
      setLearners([]); setTodayDate(""); setCourseStartDate("");
      setCourseEndDate(""); setAttendance({}); setDirtyEmails(new Set());
      return;
    }

    async function fetchBatchDetails() {
      setLoading(true);
      setMessage("");
      setDirtyEmails(new Set());

      try {
        const today = todayLocal;
        /* Default the marking date to today; the date-change effect below will
         * fetch attendance once todayDate is set. */
        setTodayDate(today);

        /* Fetch learners and course dates independently — a freshly uploaded
         * batch may have no course_planner_data rows yet, in which case the
         * dates endpoint 404s. That must not prevent learners from loading. */
        const [learnersResult, datesResult] = await Promise.allSettled([
          axios.get(`${API_BASE}/api/get_learners`,    { params: { batch_no: batchNo } }),
          axios.get(`${API_BASE}/api/get_batch_dates`, { params: { batch_no: batchNo } }),
        ]);

        if (learnersResult.status === "fulfilled") {
          // Keep inactive learners (Dropout / Batch Movement) in the list — they
          // are shown greyed & locked rather than removed.
          setLearners(learnersResult.value.data || []);
        } else {
          console.error(learnersResult.reason);
          setLearners([]);
          setMessage("Failed to load learners");
        }

        if (datesResult.status === "fulfilled") {
          const { start_date, end_date } = datesResult.value.data || {};
          setCourseStartDate(start_date || "");
          setCourseEndDate(end_date || "");
        } else {
          setCourseStartDate("");
          setCourseEndDate("");
          if (datesResult.reason?.response?.status === 404) {
            setMessage("Course planner not uploaded for this batch yet — you can still mark attendance, but date-range validation is disabled.");
          } else {
            console.error(datesResult.reason);
          }
        }
      } catch (e) {
        console.error(e);
        setMessage("Failed to load batch data");
        setLearners([]); setTodayDate(""); setCourseStartDate(""); setCourseEndDate("");
        setAttendance({});
      }

      setLoading(false);
    }

    fetchBatchDetails();
  }, [batchNo, todayLocal]);

  /* ── Fetch saved attendance whenever the marking date changes ── */
  useEffect(() => {
    if (!batchNo || !todayDate || learners.length === 0) return;

    async function fetchForDate() {
      const today = todayDate;

      /* Validate against course duration */
      if (courseStartDate && courseEndDate && (today < courseStartDate || today > courseEndDate)) {
        setMessage(`Selected date is outside the course duration (${courseStartDate} → ${courseEndDate}).`);
        setAttendance({});
        return;
      }

      setMessage("");
      setDirtyEmails(new Set());

      let serverAttendance = {};
      try {
        const attRes = await axios.get(`${API_BASE}/api/get_batch_attendance`, {
          params: { batch_no: batchNo, date: today },
        });
        serverAttendance = attRes.data || {};
      } catch (_) {
        /* allow marking with blank state if endpoint fails */
      }

      /* Tolerant read of either server response shape (per-session or per-day). */
      const readSavedStatus = (email, session) => {
        const dateNode = serverAttendance[email]?.[today];
        if (!dateNode) return "";
        const sessionCell = dateNode[session];
        if (sessionCell && typeof sessionCell === "object" && sessionCell.status) return sessionCell.status;
        if (typeof sessionCell === "string" && sessionCell) return sessionCell;
        if (typeof dateNode.status === "string" && dateNode.status) return dateNode.status;
        return "";
      };

      const newAttendance = {};
      learners.forEach((learner) => {
        newAttendance[learner.email] = { [today]: {} };
        for (let session = 1; session <= sessionsPerDay; session++) {
          if (isLearnerLocked(learner)) {
            newAttendance[learner.email][today][session] = {
              status:      "NA",
              savedStatus: "NA",
              locked:      true,
            };
            continue;
          }
          const savedVal = readSavedStatus(learner.email, session);
          newAttendance[learner.email][today][session] = {
            status:      savedVal,
            savedStatus: savedVal,
            locked:      false,
          };
        }
      });

      setAttendance(newAttendance);
    }

    fetchForDate();
  }, [batchNo, todayDate, learners, courseStartDate, courseEndDate]);

  /* ── Mark P / A / L — always editable, track dirty state ── */
  function markAttendance(learnerEmail, session, status) {
    setAttendance((prev) => {
      const prevCell = prev[learnerEmail]?.[todayDate]?.[session] || {};
      return {
        ...prev,
        [learnerEmail]: {
          ...prev[learnerEmail],
          [todayDate]: {
            ...prev[learnerEmail]?.[todayDate],
            [session]: {
              ...prevCell,
              status,
              locked: false,
            },
          },
        },
      };
    });

    /* Mark this learner as having unsaved changes */
    setDirtyEmails((prev) => {
      const next = new Set(prev);
      next.add(learnerEmail);
      return next;
    });

    /* Clear any stale success/error message when user starts editing */
    if (message) setMessage("");
  }

  /* ── Save attendance ── */
  async function saveAttendance() {
    setSaving(true);
    setMessage("");

    try {
      const saveObj = {};
      Object.keys(attendance).forEach((email) => {
        saveObj[email] = { [todayDate]: {} };
        for (let session = 1; session <= sessionsPerDay; session++) {
          saveObj[email][todayDate][session] =
            attendance[email]?.[todayDate]?.[session]?.status || "";
        }
      });

      await axios.post(
        `${API_BASE}/api/save_attendance_ui`,
        {
          batch_no:          batchNo,
          attendance:        saveObj,
          course_start_date: courseStartDate,
          course_end_date:   courseEndDate,
        },
        { headers: authHeaders() }
      );

      /* ── After successful save: update savedStatus for all cells so
       *    the dirty indicator clears, but keep everything editable ── */
      setAttendance((prev) => {
        const updated = { ...prev };
        Object.keys(updated).forEach((email) => {
          if (updated[email]?.[todayDate]) {
            updated[email] = {
              ...updated[email],
              [todayDate]: Object.fromEntries(
                Object.entries(updated[email][todayDate]).map(([sess, cell]) => [
                  sess,
                  { ...cell, savedStatus: cell.status },
                ])
              ),
            };
          }
        });
        return updated;
      });

      setDirtyEmails(new Set());
      loadOverallAttendance();   // refresh each learner's overall % with the just-saved marks
      setMessage("✅ Attendance saved successfully. You can continue editing if needed.");
    } catch (err) {
      console.error(err);
      setMessage("❌ Failed to save attendance. Please try again.");
    }

    setSaving(false);
  }

  /* ── Bulk mark: set the same status for every active learner across a
   *    From→To date range. Reuses the existing /api/save_attendance_ui
   *    endpoint (one request per day), so nothing about single-day marking
   *    changes. Admin / Manager / Coordinator only. ── */
  async function bulkMarkAttendance() {
    if (!batchNo) { setMessage("Select a domain and batch first."); return; }
    if (!bulkFrom || !bulkTo) { setMessage("Please fill both From and To dates."); return; }
    if (bulkTo < bulkFrom) { setMessage("❌ 'To' date cannot be before 'From' date."); return; }
    if (bulkTo > todayLocal) { setMessage("❌ Future dates are not allowed."); return; }
    if (courseStartDate && bulkFrom < courseStartDate) {
      setMessage(`❌ 'From' date is before the course start (${courseStartDate}).`); return;
    }
    if (courseEndDate && bulkTo > courseEndDate) {
      setMessage(`❌ 'To' date is after the course end (${courseEndDate}).`); return;
    }

    const activeLearners = learners.filter((l) => !isLearnerLocked(l));
    if (activeLearners.length === 0) { setMessage("No active learners to mark."); return; }

    /* Build the inclusive list of dates from bulkFrom → bulkTo. */
    const dates = [];
    for (let d = new Date(`${bulkFrom}T00:00:00`); ; d.setDate(d.getDate() + 1)) {
      const y   = d.getFullYear();
      const m   = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const iso = `${y}-${m}-${day}`;
      dates.push(iso);
      if (iso >= bulkTo) break;
    }

    setBulkSaving(true);
    setMessage("");
    try {
      for (const date of dates) {
        const saveObj = {};
        activeLearners.forEach((l) => {
          saveObj[l.email] = { [date]: {} };
          for (let session = 1; session <= sessionsPerDay; session++) {
            saveObj[l.email][date][session] = bulkStatus;
          }
        });
        await axios.post(
          `${API_BASE}/api/save_attendance_ui`,
          {
            batch_no:          batchNo,
            attendance:        saveObj,
            course_start_date: courseStartDate,
            course_end_date:   courseEndDate,
          },
          { headers: authHeaders() }
        );
      }

      const label = bulkStatus === "P" ? "Present" : bulkStatus === "A" ? "Absent" : "Leave";

      /* If the date currently on screen is inside the range, reflect the
       * change in the grid immediately (without refetching). */
      if (todayDate && todayDate >= bulkFrom && todayDate <= bulkTo) {
        setAttendance((prev) => {
          const updated = { ...prev };
          activeLearners.forEach((l) => {
            const day = { ...(updated[l.email]?.[todayDate] || {}) };
            for (let s = 1; s <= sessionsPerDay; s++) {
              day[s] = { ...(day[s] || {}), status: bulkStatus, savedStatus: bulkStatus, locked: false };
            }
            updated[l.email] = { ...updated[l.email], [todayDate]: day };
          });
          return updated;
        });
        setDirtyEmails(new Set());
      }

      loadOverallAttendance();   // refresh overall % after the bulk update
      setMessage(`✅ Marked ${label} for ${activeLearners.length} learner(s) across ${dates.length} day(s).`);
    } catch (err) {
      console.error(err);
      setMessage("❌ Failed to bulk mark attendance. Please try again.");
    }
    setBulkSaving(false);
  }

  /* ── Session cell renderer ── */
  function renderSessionCell(learner, session) {
    const cell = attendance[learner.email]?.[todayDate]?.[session] || {
      status: "", savedStatus: "", locked: false,
    };

    /* Disabled learner → static NA badge */
    if (cell.locked) {
      const cfg = SESSION_CFG[cell.status] || SESSION_CFG.NA;
      return (
        <Box sx={{ display: "inline-flex", alignItems: "center", px: 1.5, py: 0.4, borderRadius: "20px", background: cfg.bg, border: `1px solid ${cfg.border}` }}>
          <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 800, color: cfg.text }}>
            {cfg.label}
          </Typography>
        </Box>
      );
    }

    /* All other learners → always show three clickable P / A / L tiles.
     * Saved cells get a thicker border + a "✓ saved" sub-label for clear visibility. */
    const cellIsSaved = !!cell.savedStatus && cell.savedStatus !== "NA";

    return (
      <Box sx={{ display: "flex", gap: 0.6, justifyContent: "center", alignItems: "center" }}>
        {["P", "A", "L"].map((key) => {
          const cfg        = SESSION_CFG[key];
          const isSelected = cell.status === key;
          const isSaved    = cell.savedStatus === key;

          return (
            <Box key={key} sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.3 }}>
              <Box
                onClick={() => markAttendance(learner.email, session, key)}
                sx={{
                  position:     "relative",
                  width:        32,
                  height:       32,
                  borderRadius: "8px",
                  background:   isSelected ? cfg.hov : cfg.bg,
                  display:      "flex",
                  alignItems:   "center",
                  justifyContent: "center",
                  cursor:       "pointer",
                  fontFamily:   "'DM Mono', monospace",
                  fontSize:     12,
                  fontWeight:   800,
                  color:        isSelected ? "#fff" : cfg.text,
                  border:       isSaved
                    ? `2.5px solid ${cfg.hov}`
                    : `1.5px solid ${isSelected ? cfg.hov : cfg.border}`,
                  transition:   "all 0.15s",
                  userSelect:   "none",
                  transform:    isSelected ? "scale(1.1)" : "scale(1)",
                  boxShadow:    isSelected ? `0 2px 8px ${cfg.hov}66` : "none",
                  "&:hover": {
                    background: cfg.hov,
                    color:      "#fff",
                    transform:  "scale(1.12)",
                    boxShadow:  `0 2px 8px ${cfg.hov}66`,
                  },
                }}
              >
                {key}
                {isSaved && (
                  <Box
                    sx={{
                      position:     "absolute",
                      top:          -5,
                      right:        -5,
                      width:        14,
                      height:       14,
                      borderRadius: "50%",
                      background:   "#16a34a",
                      color:        "#fff",
                      fontSize:     9,
                      fontWeight:   900,
                      display:      "flex",
                      alignItems:   "center",
                      justifyContent: "center",
                      border:       "2px solid #fff",
                      lineHeight:   1,
                    }}
                  >
                    ✓
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
        {cellIsSaved && (
          <Typography
            sx={{
              ml: 0.5,
              fontFamily: "'DM Sans', sans-serif",
              fontSize:   9,
              fontWeight: 700,
              color:      "#15803d",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            saved
          </Typography>
        )}
      </Box>
    );
  }

  /* Per-learner saved-sessions count for "Saved" column */
  function getSavedCount(learnerEmail) {
    const sessions = attendance[learnerEmail]?.[todayDate] || {};
    let n = 0;
    for (let s = 1; s <= sessionsPerDay; s++) {
      const v = sessions[s]?.savedStatus;
      if (v && v !== "" && v !== "NA") n += 1;
    }
    return n;
  }

  /* ── Per-learner daily status (majority across sessions) ──
   * Returns "P" | "A" | "L" | "" — empty when nothing actionable was marked
   * or when no status holds a strict plurality. */
  function getDailyStatus(learnerEmail) {
    const sessions = attendance[learnerEmail]?.[todayDate] || {};
    const counts = { P: 0, A: 0, L: 0 };
    for (let s = 1; s <= sessionsPerDay; s++) {
      const v = sessions[s]?.status;
      if (v === "P" || v === "A" || v === "L") counts[v] += 1;
    }
    if (counts.P === 0 && counts.A === 0 && counts.L === 0) return "";
    let winner = "";
    let max = 0;
    let tied = false;
    for (const k of ["P", "A", "L"]) {
      if (counts[k] > max) { winner = k; max = counts[k]; tied = false; }
      else if (counts[k] === max && max > 0) { tied = true; }
    }
    return tied ? "" : winner;
  }

  /* ── Summary stats (counted per learner per day, not per session) ── */
  const totalSessions = learners.filter((l) => !isLearnerLocked(l)).length * sessionsPerDay;

  const markedCount = Object.values(attendance).reduce((sum, dates) =>
    sum + Object.values(dates).reduce((s2, sessions) =>
      s2 + Object.values(sessions).filter((c) => c.status !== "" && c.status !== "NA").length, 0), 0);

  let presentCount = 0;
  let absentCount  = 0;
  learners.forEach((l) => {
    if (isLearnerLocked(l)) return;
    const daily = getDailyStatus(l.email);
    if (daily === "P") presentCount += 1;
    else if (daily === "A") absentCount += 1;
  });

  const savedCount = Object.values(attendance).reduce((sum, dates) =>
    sum + Object.values(dates).reduce((s2, sessions) =>
      s2 + Object.values(sessions).filter((c) => c.savedStatus !== "" && c.savedStatus !== "NA").length, 0), 0);
  const hasDirtyChanges = dirtyEmails.size > 0;

  /* ════════════════════ RENDER ════════════════════ */
  return (
    <Box sx={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* ── Header / filter card ── */}
      <Box sx={{ ...cardSx, p: { xs: 2.5, md: 3 }, mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2.5 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: "12px", background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: `0 3px 12px ${T.accent}44` }}>
            📋
          </Box>
          <Box>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 18, color: T.text, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
              Attendance Dashboard
            </Typography>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: T.textSub }}>
              {courseStartDate && courseEndDate
                ? `Course: ${courseStartDate} → ${courseEndDate} · Marking for today only`
                : "Select a domain and batch to begin"}
            </Typography>
          </Box>
        </Box>

        {/* Domain + Batch selectors */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <Typography sx={{ ...labelSx, mb: 0.8 }}>Domain</Typography>
            <FormControl fullWidth size="small">
              <Select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                displayEmpty
                sx={selectSx}
                MenuProps={{ PaperProps: { sx: { borderRadius: "12px", maxHeight: 280 } } }}
              >
                <MenuItem value="" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.textSub }}>
                  <em>Select domain…</em>
                </MenuItem>
                {domains.map((d) => (
                  <MenuItem key={d} value={d} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{d}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography sx={{ ...labelSx, mb: 0.8 }}>Batch No</Typography>
            <FormControl fullWidth size="small" disabled={!domain}>
              <Select
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                displayEmpty
                sx={selectSx}
                MenuProps={{ PaperProps: { sx: { borderRadius: "12px", maxHeight: 280 } } }}
              >
                <MenuItem value="" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.textSub }}>
                  <em>Select batch…</em>
                </MenuItem>
                {batches.map((b) => (
                  <MenuItem key={b} value={b} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{b}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {/* Date + summary badges */}
        {todayDate && (
          <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
            {canMarkPastDates ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TextField
                  type="date"
                  size="small"
                  value={todayDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    if (v > todayLocal) {
                      setMessage("Future dates are not allowed.");
                      return;
                    }
                    setTodayDate(v);
                  }}
                  inputProps={{
                    max: todayLocal,
                    min: courseStartDate || undefined,
                  }}
                  sx={{
                    "& .MuiInputBase-root": {
                      borderRadius: "10px",
                      fontFamily:   "'DM Mono', monospace",
                      fontSize:     13,
                      fontWeight:   700,
                      background:   T.accentLight,
                      color:        T.accent,
                    },
                    "& fieldset":             { borderColor: `${T.accent}44` },
                    "&:hover fieldset":       { borderColor: T.accent },
                    "&.Mui-focused fieldset": { borderColor: T.accent },
                  }}
                />
                {todayDate !== todayLocal && (
                  <Button
                    size="small"
                    onClick={() => setTodayDate(todayLocal)}
                    sx={{ textTransform: "none", fontSize: 11, fontFamily: "'DM Sans', sans-serif", color: T.accent }}
                  >
                    Reset to today
                  </Button>
                )}
                <Box sx={{
                  px: 1.2, py: 0.4, borderRadius: "8px",
                  background: "#fef3c7", border: "1px solid #fcd34d",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 800,
                  color: "#92400e", letterSpacing: "0.05em",
                }}>
                  {(roleLower || "user").toUpperCase()} · CAN EDIT PAST DATES
                </Box>
              </Box>
            ) : (
              <Box sx={{ px: 2, py: 0.8, borderRadius: "10px", background: T.accentLight, border: `1px solid ${T.accent}44` }}>
                <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: T.accent }}>
                  📅 {todayDate} · today only
                </Typography>
              </Box>
            )}
            {learners.length > 0 && (
              <>
                <Box sx={{ px: 2, py: 0.8, borderRadius: "10px", background: "#dcfce7", border: "1px solid #86efac" }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: "#15803d" }}>
                    {presentCount} Present
                  </Typography>
                </Box>
                <Box sx={{ px: 2, py: 0.8, borderRadius: "10px", background: "#fee2e2", border: "1px solid #fca5a5" }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>
                    {absentCount} Absent
                  </Typography>
                </Box>
                <Box sx={{ px: 2, py: 0.8, borderRadius: "10px", background: T.surfaceAlt, border: `1px solid ${T.border}` }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: T.textSub }}>
                    {markedCount}/{totalSessions} sessions marked
                  </Typography>
                </Box>
                {savedCount > 0 && (
                  <Box sx={{ px: 2, py: 0.8, borderRadius: "10px", background: "#f0fdf4", border: "1px solid #86efac" }}>
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: "#15803d" }}>
                      ✓ {savedCount} sessions saved
                    </Typography>
                  </Box>
                )}
                {hasDirtyChanges && (
                  <Box sx={{ px: 2, py: 0.8, borderRadius: "10px", background: "#fef3c7", border: "1px solid #fcd34d" }}>
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: "#b45309" }}>
                      ⚠ Unsaved changes
                    </Typography>
                  </Box>
                )}
              </>
            )}
          </Box>
        )}
      </Box>

      {/* ── Bulk-mark card (Admin / Manager / Coordinator only) ── */}
      {canBulkMark && batchNo && learners.length > 0 && (
        <Box sx={{ ...cardSx, p: { xs: 2.5, md: 3 }, mb: 2.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: "12px", background: `linear-gradient(135deg, #d97706, #b45309)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 3px 12px #d9770644" }}>
              ⚡
            </Box>
            <Box>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 16, color: T.text, lineHeight: 1.1 }}>
                Bulk Mark Attendance
              </Typography>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: T.textSub }}>
                Set the same status for all active learners in {batchNo} across a date range.
              </Typography>
            </Box>
          </Box>

          <Grid container spacing={2} alignItems="flex-end">
            <Grid item xs={12} sm={6} md={3}>
              <Typography sx={{ ...labelSx, mb: 0.8 }}>From Date</Typography>
              <TextField
                type="date"
                size="small"
                fullWidth
                value={bulkFrom}
                onChange={(e) => setBulkFrom(e.target.value)}
                inputProps={{ max: todayLocal, min: courseStartDate || undefined }}
                sx={{ "& .MuiInputBase-root": { borderRadius: "10px", fontFamily: "'DM Mono', monospace", fontSize: 13, background: T.surfaceAlt }, "& fieldset": { borderColor: T.border } }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography sx={{ ...labelSx, mb: 0.8 }}>To Date</Typography>
              <TextField
                type="date"
                size="small"
                fullWidth
                value={bulkTo}
                onChange={(e) => setBulkTo(e.target.value)}
                inputProps={{ max: todayLocal, min: bulkFrom || courseStartDate || undefined }}
                sx={{ "& .MuiInputBase-root": { borderRadius: "10px", fontFamily: "'DM Mono', monospace", fontSize: 13, background: T.surfaceAlt }, "& fieldset": { borderColor: T.border } }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography sx={{ ...labelSx, mb: 0.8 }}>Attendance</Typography>
              <FormControl fullWidth size="small">
                <Select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value)}
                  sx={selectSx}
                  MenuProps={{ PaperProps: { sx: { borderRadius: "12px" } } }}
                >
                  <MenuItem value="P" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Present</MenuItem>
                  <MenuItem value="A" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Absent</MenuItem>
                  <MenuItem value="L" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Leave</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Button
                variant="contained"
                fullWidth
                onClick={bulkMarkAttendance}
                disabled={bulkSaving || !bulkFrom || !bulkTo}
                sx={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 800,
                  fontSize: 14,
                  borderRadius: "12px",
                  py: 1.2,
                  textTransform: "none",
                  background: `linear-gradient(135deg, #d97706 0%, #b45309 100%)`,
                  boxShadow: "0 4px 16px #d9770644",
                  "&:hover": { background: `linear-gradient(135deg, #b45309 0%, #d97706 100%)` },
                  "&.Mui-disabled": { background: T.border, color: T.textSub, boxShadow: "none" },
                }}
              >
                {bulkSaving ? <CircularProgress size={20} color="inherit" /> : "Mark"}
              </Button>
            </Grid>
          </Grid>
        </Box>
      )}

      {/* ── Loading ── */}
      {loading && (
        <Box sx={{ ...cardSx, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 8, gap: 2, mb: 2.5 }}>
          <CircularProgress size={36} sx={{ color: T.accent }} />
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.textSub }}>
            Loading batch data…
          </Typography>
        </Box>
      )}

      {/* ── Attendance table ── */}
      {!loading && learners.length > 0 && todayDate && (
        <Box sx={{ ...cardSx, mb: 2.5 }}>
          {/* Table header strip */}
          <Box sx={{ px: 2.5, py: 1.5, background: `linear-gradient(135deg, ${T.accent}14, ${T.accentLight})`, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box sx={{ width: 4, height: 20, borderRadius: "2px", background: T.accent }} />
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 14, color: T.text }}>
              Learner Attendance — {todayDate}
            </Typography>
            <Chip
              label={`${learners.length} learner${learners.length !== 1 ? "s" : ""}`}
              size="small"
              sx={{ ml: "auto", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 10, height: 20, background: T.accent, color: "#fff" }}
            />
          </Box>

          {/* Legend */}
          <Box sx={{ px: 2.5, py: 1.2, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", background: T.surfaceAlt }}>
            <Typography sx={{ ...labelSx, fontSize: 9 }}>Legend:</Typography>
            {[
              { key: "P", desc: "Present" },
              { key: "A", desc: "Absent" },
              { key: "L", desc: "Leave" },
            ].map(({ key, desc }) => {
              const cfg = SESSION_CFG[key];
              return (
                <Box key={key} sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
                  <Box sx={{ width: 20, height: 20, borderRadius: "5px", background: cfg.hov, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 800, color: "#fff" }}>{key}</Typography>
                  </Box>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: T.textSub }}>{desc}</Typography>
                </Box>
              );
            })}
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
              <Box sx={{
                width: 14, height: 14, borderRadius: "50%",
                background: "#16a34a", color: "#fff",
                fontSize: 9, fontWeight: 900,
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "2px solid #fff", boxShadow: "0 0 0 1px #16a34a",
              }}>✓</Box>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: T.textSub }}>
                Green check + thicker border = saved in DB
              </Typography>
            </Box>
          </Box>

          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {[
                    "#",
                    "Learner Name",
                    "Email",
                    "Overall %",
                    ...Array.from({ length: sessionsPerDay }, (_, i) => `Session ${i + 1}`),
                    "Saved",
                  ].map((h) => (
                    <TableCell
                      key={h}
                      align={["Learner Name", "Email", "#"].includes(h) ? "left" : "center"}
                      sx={{ ...labelSx, background: T.surfaceAlt, borderBottom: `2px solid ${T.border}`, py: 1.3, whiteSpace: "nowrap" }}
                    >
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {learners.map((learner, idx) => {
                  const isDirty       = dirtyEmails.has(learner.email);
                  const isDisabled    = isLearnerLocked(learner);
                  const isInactive    = isInactiveLearnerStatus(learner.status);
                  const savedSessions = isDisabled ? 0 : getSavedCount(learner.email);
                  const fullySaved    = !isDisabled && savedSessions === sessionsPerDay;

                  /* Overall (cumulative) attendance % — null when there are no
                   * teaching days elapsed yet (nothing meaningful to show). */
                  const emailKey    = (learner.email || "").trim().toLowerCase();
                  const ov          = overallPct.byEmail[emailKey];
                  const overallVal  = ov ? ov.dayPct : (overallPct.totalDaysTillToday > 0 ? 0 : null);
                  const daysPresent = ov ? ov.daysPresent : 0;
                  return (
                    <TableRow
                      key={learner.email}
                      sx={{
                        ...(isInactive ? { opacity: 0.5 } : {}),
                        "&:nth-of-type(even)": { background: T.surfaceAlt },
                        "&:hover":             { background: T.accentLight, transition: "background 0.15s" },
                        ...(isDirty
                          ? { borderLeft: `3px solid #f59e0b` }
                          : fullySaved
                            ? { borderLeft: `3px solid #16a34a`, background: "#f0fdf4 !important" }
                            : savedSessions > 0
                              ? { borderLeft: `3px solid #86efac` }
                              : {}),
                      }}
                    >
                      <TableCell sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: T.textSub, width: 36 }}>
                        {idx + 1}
                      </TableCell>
                      <TableCell sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, color: T.text, whiteSpace: "nowrap" }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
                          {learner.name}
                          {isDirty && (
                            <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} title="Unsaved changes" />
                          )}
                          {fullySaved && (
                            <Box sx={{
                              px: 0.8, py: 0.2, borderRadius: "8px",
                              background: "#dcfce7", border: "1px solid #86efac",
                              fontFamily: "'DM Sans', sans-serif", fontSize: 9, fontWeight: 800,
                              color: "#15803d", letterSpacing: "0.05em",
                            }}>
                              ALL SAVED
                            </Box>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: T.textSub, maxWidth: 220, wordBreak: "break-all" }}>
                        {learner.email}
                      </TableCell>
                      <TableCell align="center" sx={{ py: 1 }}>
                        {isDisabled || overallVal === null ? (
                          <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: T.textSub }}>—</Typography>
                        ) : (
                          <Box
                            title={`${daysPresent}/${overallPct.totalDaysTillToday} teaching days present (≥ 2 of 3 sessions = present)`}
                            sx={{ display: "inline-flex" }}
                          >
                            <PctBadge pct={overallVal} />
                          </Box>
                        )}
                      </TableCell>
                      {Array.from({ length: sessionsPerDay }, (_, i) => (
                        <TableCell key={`cell_${learner.email}_${i + 1}`} align="center" sx={{ py: 1 }}>
                          {renderSessionCell(learner, i + 1)}
                        </TableCell>
                      ))}
                      <TableCell align="center" sx={{ py: 1 }}>
                        {isDisabled ? (
                          <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: T.textSub }}>—</Typography>
                        ) : (
                          <Box
                            sx={{
                              display:      "inline-flex",
                              alignItems:   "center",
                              gap:          0.5,
                              px:           1.2,
                              py:           0.4,
                              borderRadius: "12px",
                              background:   savedSessions === 0
                                ? "#f3f4f6"
                                : fullySaved
                                  ? "#16a34a"
                                  : "#dcfce7",
                              border: `1px solid ${
                                savedSessions === 0 ? "#d1d5db" : fullySaved ? "#15803d" : "#86efac"
                              }`,
                              color: savedSessions === 0
                                ? "#6b7280"
                                : fullySaved
                                  ? "#fff"
                                  : "#15803d",
                              fontFamily: "'DM Mono', monospace",
                              fontSize:   11,
                              fontWeight: 800,
                            }}
                          >
                            {savedSessions}/{sessionsPerDay}
                          </Box>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </Box>
      )}

      {/* ── Save button ── */}
      {!loading && (
        <Button
          variant="contained"
          fullWidth
          onClick={saveAttendance}
          disabled={saving || !todayDate || learners.length === 0}
          sx={{
            fontFamily:    "'DM Sans', sans-serif",
            fontWeight:    800,
            fontSize:      14,
            borderRadius:  "12px",
            py:            1.6,
            textTransform: "none",
            background:    hasDirtyChanges
              ? `linear-gradient(135deg, #d97706 0%, #b45309 100%)`
              : `linear-gradient(135deg, ${T.accent} 0%, ${T.accentDark} 100%)`,
            boxShadow:     hasDirtyChanges
              ? "0 4px 16px #f59e0b44"
              : `0 4px 16px ${T.accent}44`,
            mb: 2,
            "&:hover": {
              background: hasDirtyChanges
                ? `linear-gradient(135deg, #b45309 0%, #d97706 100%)`
                : `linear-gradient(135deg, ${T.accentDark} 0%, ${T.accent} 100%)`,
            },
            "&.Mui-disabled": { background: T.border, color: T.textSub, boxShadow: "none" },
          }}
        >
          {saving
            ? <CircularProgress size={20} color="inherit" />
            : hasDirtyChanges
              ? "💾 Save Changes"
              : "💾 Save Today's Attendance"}
        </Button>
      )}

      {/* ── Status message ── */}
      <Fade in={!!message}>
        <Box>
          {message && (
            <Alert
              severity={message.startsWith("✅") ? "success" : message.startsWith("❌") ? "error" : "info"}
              sx={{ borderRadius: "10px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}
            >
              {message}
            </Alert>
          )}
        </Box>
      </Fade>
    </Box>
  );
}