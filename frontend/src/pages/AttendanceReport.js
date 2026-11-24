import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, IconButton, Menu,
} from "@mui/material";
import {
  PeopleAlt      as PeopleIcon,
  EventAvailable as SessionIcon,
  Close          as CloseIcon,
  Person         as PersonIcon,
  Download       as DownloadIcon,
  CalendarMonth  as DayIcon,
} from "@mui/icons-material";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { isInactiveLearnerStatus } from "../utils/learnerStatus";
import {
  SESSIONS_PER_DAY,
  MIN_SESSIONS_FOR_DAY_PRESENT,
  computeAttendance,
  learnerStats,
  attendanceColor,
} from "../utils/attendanceCalc";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";

/* ─── Design tokens (matches CourseProgress) ────────────────────────────── */
const TOKENS = {
  bg:          "#d4e0fd",
  surface:     "#ffffff",
  surfaceAlt:  "#f8f9fc",
  border:      "#e4e8f0",
  accent:      "#3d5afe",
  accentLight: "#e8ecff",
  text:        "#1a1f36",
  textSub:     "#6b7280",
  success:     { fill: "#10b981", light: "#d1fae5", text: "#065f46" },
  warning:     { fill: "#f59e0b", light: "#fef3c7", text: "#92400e" },
  error:       { fill: "#ef4444", light: "#fee2e2", text: "#991b1b" },
};

const cardSx = {
  background:   TOKENS.surface,
  border:       `1px solid ${TOKENS.border}`,
  borderRadius: "16px",
  boxShadow:    "0 2px 12px rgba(0,0,0,0.06)",
  overflow:     "hidden",
};

const labelSx = {
  fontFamily:    "'DM Sans', sans-serif",
  fontSize:      11,
  fontWeight:    700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color:         TOKENS.textSub,
};

const tableHeadSx = {
  fontFamily:    "'DM Sans', sans-serif",
  fontSize:      11,
  fontWeight:    700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color:         TOKENS.textSub,
  background:    TOKENS.surfaceAlt,
  borderBottom:  `2px solid ${TOKENS.border}`,
  py:            1.4,
  whiteSpace:    "nowrap",
};

const tableCellSx = {
  fontFamily:   "'DM Sans', sans-serif",
  fontSize:     13,
  color:        TOKENS.text,
  borderBottom: `1px solid ${TOKENS.border}`,
  py:           1.5,
};

const inputSx = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 13,
  borderRadius: "10px",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.border },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent },
  "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent },
};

/* ─── Attendance percentage badge ────────────────────────────────────────────
 * ≤ 50% red · 51–70% orange · 71–100% green (decided on the whole-number value) */
function PctBadge({ pct, bold }) {
  const c = attendanceColor(pct);
  if (!c) {
    return <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: TOKENS.textSub }}>—</Typography>;
  }
  return (
    <Box sx={{
      display: "inline-flex", px: 1.5, py: bold ? 0.6 : 0.4, borderRadius: "20px",
      background: c.bg, border: `1px solid ${c.bd}`,
    }}>
      <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: bold ? 13 : 12, fontWeight: 800, color: c.fill }}>
        {pct.toFixed(1)}%
      </Typography>
    </Box>
  );
}

/* ─── Detail row inside dialog ───────────────────────────────────────────── */
function DetailRow({ label, value, total }) {
  const pct = total > 0 ? (value / total) * 100 : null;
  return (
    <Box sx={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      px: 2, py: 1.3, borderBottom: `1px solid ${TOKENS.border}`,
      "&:last-child": { borderBottom: "none" },
    }}>
      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>
        {label}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: TOKENS.text }}>
          {value}
          <span style={{ color: TOKENS.textSub, fontWeight: 400 }}> / {total}</span>
        </Typography>
        {pct !== null && <PctBadge pct={pct} />}
      </Box>
    </Box>
  );
}

/* ─── Stat pill ──────────────────────────────────────────────────────────── */
function StatPill({ icon, label, value, sub, accent }) {
  return (
    <Box sx={{
      px: 2.5, py: 1.5, borderRadius: "12px",
      background: accent ? TOKENS.accentLight : TOKENS.surfaceAlt,
      border: `1px solid ${accent ? TOKENS.accent + "44" : TOKENS.border}`,
      display: "flex", alignItems: "center", gap: 1.2,
    }}>
      <Box sx={{ color: accent ? TOKENS.accent : TOKENS.textSub, display: "flex" }}>{icon}</Box>
      <Box>
        <Typography sx={{ ...labelSx, fontSize: 9, color: accent ? TOKENS.accent : TOKENS.textSub }}>
          {label}
        </Typography>
        <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 800, color: accent ? TOKENS.accent : TOKENS.text, lineHeight: 1 }}>
          {value}
          {sub && <span style={{ fontSize: 12, fontWeight: 400, color: TOKENS.textSub }}>{sub}</span>}
        </Typography>
      </Box>
    </Box>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Main component
 * ═══════════════════════════════════════════════════════════════════════════ */
export default function AttendanceReport({ user, token }) {
  const [batches,            setBatches]            = useState([]);
  const [batchNo,            setBatchNo]            = useState("");
  const [attendanceData,     setAttendanceData]     = useState([]);
  const [learnersData,       setLearnersData]       = useState([]);
  const [plannerDates,       setPlannerDates]       = useState([]);
  const [serverToday,        setServerToday]        = useState("");
  const [loading,            setLoading]            = useState(false);
  const [selectedLearner,    setSelectedLearner]    = useState(null);
  const [detailDialogOpen,   setDetailDialogOpen]   = useState(false);
  const [downloadAnchor,     setDownloadAnchor]     = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  /* ── Load batches ── */
  useEffect(() => {
    const fetchBatches = async () => {
      const { data } = await axios.get(`${API_BASE}/api/batches`, { headers });
      const batchList = Array.isArray(data)
        ? data.map(b => String(b.batch_no || b)).filter(Boolean)
        : [];
      const unique = [...new Set(batchList)].sort();
      setBatches(unique);
      if (unique.length > 0) setBatchNo(unique[0]);
    };
    fetchBatches();
  }, [token]);

  /* ── Load attendance + learners ── */
  useEffect(() => {
    if (!batchNo) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const attendanceRes = await axios.get(
          `${API_BASE}/api/learner-attendance`,
          { params: { batch_no: batchNo }, headers }
        );
        const { attendance, planner_dates, today } = attendanceRes.data;
        setAttendanceData(attendance || []);
        setPlannerDates((planner_dates || []).map(d => typeof d === "string" ? d : d.date));
        setServerToday(today || "");
        const learnersRes = await axios.get(`${API_BASE}/api/learners`, { params: { batch_no: batchNo }, headers });
        setLearnersData(learnersRes.data || []);
      } catch (err) {
        console.error(err);
        setAttendanceData([]); setLearnersData([]); setPlannerDates([]); setServerToday("");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [batchNo, token]);

  /* ── Report ──────────────────────────────────────────────────────────────
   * All maths lives in utils/attendanceCalc.js (shared with the Attendance
   * Dashboard):
   *   • Teaching days = unique course-planner dates (start → end), 3 sessions/day.
   *   • A day is PRESENT when ≥ 2 of its 3 sessions were attended (P / Present);
   *     1 session present = the day is absent.
   *   • Attendance % = days present ÷ teaching days conducted so far.
   *   • Only attendance on teaching days counts, so a % can never exceed 100.
   * Every learner of the batch is listed — including learners that have no
   * attendance rows yet (0%). */
  const summary = useMemo(() => {
    const calc = computeAttendance(attendanceData, plannerDates, { today: serverToday });

    const seen = new Set();
    const list = [];

    learnersData.forEach((lr) => {
      const key = (lr.email || "").trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push({
        name:     lr.name || key.split("@")[0],
        email:    lr.email,
        status:   lr.status || "",
        inactive: isInactiveLearnerStatus(lr.status),
        ...learnerStats(calc, key),
      });
    });

    /* anyone with attendance rows who is not in the learners list */
    Object.keys(calc.byEmail).forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        name: key.split("@")[0], email: key, status: "", inactive: false,
        ...calc.byEmail[key],
      });
    });

    list.sort((a, b) => a.name.localeCompare(b.name));
    return { ...calc, learners: list };
  }, [attendanceData, learnersData, plannerDates, serverToday]);

  /* ── Download helpers (xlsx / pdf) ── */
  const fmt = (v) => (v === null || v === undefined ? "" : Number(v.toFixed(1)));

  const buildReportRows = () => summary.learners.map((l, i) => ({
    "#": i + 1,
    "Learner": l.name,
    "Email": l.email,
    "Sessions Present": l.sessionsPresent,
    "Sessions Conducted": summary.conductedSessions,
    "Session %": fmt(l.sessionPct),
    "Days Present": l.daysPresent,
    "Days Conducted": summary.conductedDays,
    "Attendance % (Days)": fmt(l.dayPct),
    "Total Course Days": summary.totalCourseDays,
    "Course % (of all days)": fmt(l.coursePct),
  }));

  const downloadXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(buildReportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `Attendance_${batchNo || "report"}.xlsx`);
    setDownloadAnchor(null);
  };

  const downloadPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`Attendance Report — ${batchNo || ""}`, 14, 16);
    doc.setFontSize(9);
    doc.text(
      `Course: ${summary.startDate || "—"} to ${summary.endDate || "—"}   |   ` +
      `Days conducted: ${summary.conductedDays}/${summary.totalCourseDays}   |   ` +
      `Sessions conducted: ${summary.conductedSessions}/${summary.totalCourseSessions}   |   ` +
      `Present = at least ${MIN_SESSIONS_FOR_DAY_PRESENT} of ${SESSIONS_PER_DAY} sessions`,
      14, 22
    );

    /* colour the two % columns: <=50 red, 51-70 orange, 71-100 green */
    const pctCell = (pct) => {
      const c = attendanceColor(pct);
      if (!c) return "—";
      const rgb = c.key === "red" ? [220, 38, 38] : c.key === "orange" ? [234, 88, 12] : [22, 163, 74];
      return { content: `${pct.toFixed(1)}%`, styles: { textColor: rgb, fontStyle: "bold" } };
    };

    autoTable(doc, {
      startY: 27,
      head: [["#", "Learner", "Email", "Sess. Present", "Sess. Conducted", "Session %", "Days Present", "Days Conducted", "Attendance %", "Course %"]],
      body: summary.learners.map((l, i) => [
        i + 1, l.name, l.email,
        l.sessionsPresent, summary.conductedSessions, pctCell(l.sessionPct),
        l.daysPresent, summary.conductedDays, pctCell(l.dayPct), pctCell(l.coursePct),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [61, 90, 254] },
    });
    doc.save(`Attendance_${batchNo || "report"}.pdf`);
    setDownloadAnchor(null);
  };

  /* ════════════════════════════════════════════════════════════════════════ */
  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <Box sx={{ maxWidth: 1400, mx: "auto" }}>

        {/* ── Page header ── */}
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
            Attendance Report
          </Typography>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
            Click any learner row to view a detailed attendance breakdown
          </Typography>
        </Box>

        {/* ── Filter + stat pills row ── */}
        <Box sx={{ ...cardSx, p: 3, mb: 3 }}>
          <Box sx={{ display: "flex", alignItems: "flex-end", gap: 3, flexWrap: "wrap" }}>
            <Box>
              <Typography sx={{ ...labelSx, mb: 1 }}>Batch</Typography>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Select Batch</InputLabel>
                <Select value={batchNo} label="Select Batch" onChange={e => setBatchNo(e.target.value)} sx={inputSx}>
                  {batches.map(b => (
                    <MenuItem key={b} value={b} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{b}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {batchNo && !loading && (
              <>
                <StatPill
                  icon={<DayIcon sx={{ fontSize: 16 }} />}
                  label="Days Conducted"
                  value={summary.conductedDays}
                  sub={` / ${summary.totalCourseDays}`}
                  accent
                />
                <StatPill
                  icon={<SessionIcon sx={{ fontSize: 16 }} />}
                  label="Sessions Conducted"
                  value={summary.conductedSessions}
                  sub={` / ${summary.totalCourseSessions}`}
                />
                <StatPill
                  icon={<PeopleIcon sx={{ fontSize: 16 }} />}
                  label="Learners"
                  value={summary.learners.length}
                />

                <Box sx={{ ml: "auto" }}>
                  <Button
                    variant="contained"
                    startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
                    onClick={(e) => setDownloadAnchor(e.currentTarget)}
                    disabled={summary.learners.length === 0}
                    sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 2.5, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}
                  >
                    Download
                  </Button>
                  <Menu
                    anchorEl={downloadAnchor}
                    open={Boolean(downloadAnchor)}
                    onClose={() => setDownloadAnchor(null)}
                  >
                    <MenuItem onClick={downloadXlsx} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                      Download as XLSX
                    </MenuItem>
                    <MenuItem onClick={downloadPdf} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                      Download as PDF
                    </MenuItem>
                  </Menu>
                </Box>
              </>
            )}
          </Box>

          {/* How it is calculated + colour legend */}
          {batchNo && !loading && (
            <Box sx={{ mt: 2.5, pt: 2, borderTop: `1px dashed ${TOKENS.border}`, display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.textSub }}>
                <strong>Course:</strong> {summary.startDate || "—"} → {summary.endDate || "—"} ·{" "}
                {summary.totalCourseDays} days × {SESSIONS_PER_DAY} sessions = {summary.totalCourseSessions} sessions ·{" "}
                <strong>Present</strong> = at least {MIN_SESSIONS_FOR_DAY_PRESENT} of {SESSIONS_PER_DAY} sessions
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, ml: { md: "auto" } }}>
                {[
                  { c: attendanceColor(0),  t: "0–50%"    },
                  { c: attendanceColor(60), t: "51–70%"   },
                  { c: attendanceColor(90), t: "71–100%"  },
                ].map(({ c, t }) => (
                  <Box key={t} sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", background: c.fill }} />
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.textSub }}>{t}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Data-quality warning: teaching days that nobody marked */}
          {batchNo && !loading && summary.unmarkedPastDays.length > 0 && (
            <Box sx={{ mt: 2, px: 2, py: 1.2, borderRadius: "10px", background: TOKENS.warning.light, border: `1px solid ${TOKENS.warning.fill}55` }}>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: TOKENS.warning.text }}>
                ⚠ Attendance has not been marked for {summary.unmarkedPastDays.length} teaching day
                {summary.unmarkedPastDays.length !== 1 ? "s" : ""}
                {" "}({summary.unmarkedPastDays.slice(0, 5).join(", ")}{summary.unmarkedPastDays.length > 5 ? " …" : ""}).
                These days are counted as absent for every learner until attendance is marked.
              </Typography>
            </Box>
          )}
        </Box>

        {/* ── Loading state ── */}
        {loading && (
          <Box sx={{ ...cardSx, py: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <CircularProgress size={32} sx={{ color: TOKENS.accent }} />
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>
              Loading attendance data…
            </Typography>
          </Box>
        )}

        {/* ── Learner table ── */}
        {!loading && batchNo && (
          <Box sx={cardSx}>
            <Box sx={{
              px: 3, py: 2.5,
              background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`,
              borderBottom: `1px solid ${TOKENS.border}`,
              display: "flex", alignItems: "center", gap: 1.5,
            }}>
              <PeopleIcon sx={{ fontSize: 20, color: TOKENS.accent }} />
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text }}>
                Learner Attendance — {batchNo}
              </Typography>
              {summary.learners.length > 0 && (
                <Box sx={{ ml: "auto", px: 1.5, py: 0.4, borderRadius: "20px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: TOKENS.accent }}>
                    {summary.learners.length} learners
                  </Typography>
                </Box>
              )}
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ ...tableHeadSx, width: 56 }}>#</TableCell>
                    <TableCell sx={tableHeadSx}>Learner</TableCell>
                    <TableCell sx={tableHeadSx}>Email</TableCell>
                    <TableCell align="center" sx={tableHeadSx}>Sessions</TableCell>
                    <TableCell align="center" sx={tableHeadSx}>Session %</TableCell>
                    <TableCell align="center" sx={tableHeadSx}>Days</TableCell>
                    <TableCell align="center" sx={tableHeadSx}>Attendance %</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.learners.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 7 }}>
                        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>
                          No learners found for this batch.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    summary.learners.map((learner, idx) => (
                        <TableRow
                          key={learner.email}
                          onClick={() => { setSelectedLearner(learner); setDetailDialogOpen(true); }}
                          sx={{
                            cursor: "pointer",
                            ...(learner.inactive ? { opacity: 0.5 } : {}),
                            "&:nth-of-type(even)": { background: TOKENS.surfaceAlt },
                            "&:hover": { background: `${TOKENS.accent}08` },
                            transition: "background 0.15s",
                          }}
                        >
                          <TableCell sx={{ ...tableCellSx, fontFamily: "'DM Mono', monospace", fontSize: 12, color: TOKENS.textSub }}>
                            {idx + 1}
                          </TableCell>
                          <TableCell sx={{ ...tableCellSx, fontWeight: 700 }}>
                            {learner.name}
                            {learner.inactive && (
                              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: TOKENS.textSub }}>({learner.status})</span>
                            )}
                          </TableCell>
                          <TableCell sx={{ ...tableCellSx, fontSize: 12, color: TOKENS.textSub }}>{learner.email}</TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: TOKENS.text }}>
                              {learner.sessionsPresent}
                              <span style={{ color: TOKENS.textSub, fontWeight: 400 }}> / {summary.conductedSessions}</span>
                            </Typography>
                          </TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <PctBadge pct={learner.sessionPct} />
                          </TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: TOKENS.text }}>
                              {learner.daysPresent}
                              <span style={{ color: TOKENS.textSub, fontWeight: 400 }}> / {summary.conductedDays}</span>
                            </Typography>
                          </TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <PctBadge pct={learner.pct} bold />
                          </TableCell>
                        </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {!batchNo && !loading && (
          <Box sx={{ ...cardSx, py: 10, textAlign: "center" }}>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 600, color: TOKENS.textSub }}>
              Select a batch to view attendance
            </Typography>
          </Box>
        )}
      </Box>

      {/* ── Detail Dialog ── */}
      <Dialog
        open={detailDialogOpen}
        onClose={() => setDetailDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: "16px", overflow: "hidden" } }}
      >
        <DialogTitle sx={{ p: 0 }}>
          <Box sx={{
            px: 3, py: 2.5,
            background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`,
            borderBottom: `1px solid ${TOKENS.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <PersonIcon sx={{ fontSize: 20, color: TOKENS.accent }} />
              <Box>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text }}>
                  {selectedLearner?.name}
                </Typography>
                <Typography sx={{ ...labelSx, fontSize: 10, mt: 0.1 }}>Attendance Breakdown</Typography>
              </Box>
            </Box>
            <IconButton size="small" onClick={() => setDetailDialogOpen(false)} sx={{ color: TOKENS.textSub }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ p: 3 }}>
          {selectedLearner && (() => {
            const s = learnerStats(summary, selectedLearner.email);
            return (
              <Box>
                {/* Headline figure */}
                <Box sx={{ mb: 3, px: 2, py: 1.8, borderRadius: "12px", background: TOKENS.surfaceAlt, border: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Box>
                    <Typography sx={{ ...labelSx, fontSize: 10 }}>Attendance %</Typography>
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: TOKENS.textSub, mt: 0.3 }}>
                      {s.daysPresent} days present ÷ {summary.conductedDays} days conducted
                    </Typography>
                  </Box>
                  <PctBadge pct={s.pct} bold />
                </Box>

                <Typography sx={{ ...labelSx, mb: 1.5 }}>Day-wise (present = ≥ {MIN_SESSIONS_FOR_DAY_PRESENT} of {SESSIONS_PER_DAY} sessions)</Typography>
                <Box sx={{ mb: 3, border: `1px solid ${TOKENS.border}`, borderRadius: "10px", overflow: "hidden" }}>
                  <DetailRow label="Days Present (conducted so far)" value={s.daysPresent} total={summary.conductedDays} />
                  <DetailRow label="Days Present (whole course, start → end)" value={s.daysPresent} total={summary.totalCourseDays} />
                </Box>

                <Typography sx={{ ...labelSx, mb: 1.5 }}>Session-wise ({SESSIONS_PER_DAY} sessions / day)</Typography>
                <Box sx={{ mb: 3, border: `1px solid ${TOKENS.border}`, borderRadius: "10px", overflow: "hidden" }}>
                  <DetailRow label="Sessions Present (conducted so far)" value={s.sessionsPresent} total={summary.conductedSessions} />
                  <DetailRow label="Sessions Present (whole course)" value={s.sessionsPresent} total={summary.totalCourseSessions} />
                </Box>

                <Typography sx={{ ...labelSx, mb: 1.2 }}>Days counted as absent ({s.absentDays.length})</Typography>
                <Box sx={{ px: 2, py: 1.3, border: `1px solid ${TOKENS.border}`, borderRadius: "10px", maxHeight: 130, overflowY: "auto" }}>
                  <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: s.absentDays.length ? TOKENS.error.text : TOKENS.success.text, lineHeight: 1.8 }}>
                    {s.absentDays.length ? s.absentDays.join("  ·  ") : "None — present on every conducted day"}
                  </Typography>
                </Box>
              </Box>
            );
          })()}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${TOKENS.border}` }}>
          <Button
            onClick={() => setDetailDialogOpen(false)}
            sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", color: TOKENS.textSub }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}