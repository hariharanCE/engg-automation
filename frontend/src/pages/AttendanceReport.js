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

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

// Each teaching day has 3 sessions. A learner is "present" for a day when they
// attended at least 2 of the 3 sessions (1 session present = day absent).
const SESSIONS_PER_DAY = 3;
const MIN_SESSIONS_FOR_DAY_PRESENT = 2;

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

/* ─── Attendance percentage badge ────────────────────────────────────────── */
function PctBadge({ pct }) {
  const tok = pct >= 75 ? TOKENS.success : pct >= 50 ? TOKENS.warning : TOKENS.error;
  return (
    <Box sx={{
      display: "inline-flex", px: 1.5, py: 0.4, borderRadius: "20px",
      background: `${tok.fill}18`, border: `1px solid ${tok.fill}44`,
    }}>
      <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 800, color: tok.fill }}>
        {pct.toFixed(1)}%
      </Typography>
    </Box>
  );
}

/* ─── Detail row inside dialog ───────────────────────────────────────────── */
function DetailRow({ label, value, total }) {
  const pct  = total > 0 ? (value / total) * 100 : 0;
  const tok  = pct >= 75 ? TOKENS.success : pct >= 50 ? TOKENS.warning : TOKENS.error;
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
        {total > 0 && (
          <Box sx={{ px: 1, py: 0.2, borderRadius: "20px", background: `${tok.fill}18`, border: `1px solid ${tok.fill}44` }}>
            <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 700, color: tok.fill }}>
              {pct.toFixed(1)}%
            </Typography>
          </Box>
        )}
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
  const [totalBatchSessions, setTotalBatchSessions] = useState(0);
  const [sessionsTillToday,  setSessionsTillToday]  = useState(0);
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
        const { attendance, total_batch_sessions, sessions_till_today, planner_dates } = attendanceRes.data;
        setAttendanceData(attendance || []);
        setTotalBatchSessions(total_batch_sessions || 0);
        setSessionsTillToday(sessions_till_today || 0);
        setPlannerDates((planner_dates || []).map(d => typeof d === "string" ? d : d.date));
        const learnersRes = await axios.get(`${API_BASE}/api/learners`, { params: { batch_no: batchNo }, headers });
        setLearnersData(learnersRes.data || []);
      } catch (err) {
        console.error(err);
        setAttendanceData([]); setLearnersData([]); setPlannerDates([]);
        setTotalBatchSessions(0); setSessionsTillToday(0);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [batchNo, token]);

  /* ── Report (session-wise + day-wise) ───────────────────────────────────
   * Total days   = unique dates in course_planner_data for the batch.
   * Total sessions = 3 × total days (SESSIONS_PER_DAY).
   * Session-wise: how many of the conducted sessions the learner attended.
   * Day-wise: a day counts as present when ≥ 2 of its 3 sessions were present;
   *           1 session present = that day is absent. */
  const isPresentStatus = (s) => {
    const v = (s || "").toString().trim().toUpperCase();
    return v === "P" || v === "PRESENT";
  };

  const summary = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];

    const distinctDates      = [...new Set(plannerDates.filter(Boolean))];
    const totalBatchDays     = distinctDates.length;
    const totalDaysTillToday = distinctDates.filter(d => d <= today).length;
    const totalSessionsAll   = totalBatchDays * SESSIONS_PER_DAY;
    const totalSessionsTillToday = totalDaysTillToday * SESSIONS_PER_DAY;

    // Group attendance by learner → date → set of present sessions.
    const byLearner = {};
    attendanceData.forEach((row, i) => {
      if (!row.learner_email || row.date > today) return;
      const email = row.learner_email.trim().toLowerCase();
      if (!byLearner[email]) byLearner[email] = { email: row.learner_email, dates: {} };
      const dayMap = byLearner[email].dates;
      if (!dayMap[row.date]) dayMap[row.date] = new Set();
      if (isPresentStatus(row.status)) {
        // Dedupe by session id; fall back to a unique token when absent.
        const sess = (row.session ?? "").toString().trim() || `__${i}`;
        dayMap[row.date].add(sess);
      }
    });

    const learners = Object.values(byLearner).map((l) => {
      let sessionsPresent = 0;
      let daysPresent = 0;
      Object.values(l.dates).forEach((set) => {
        const c = Math.min(set.size, SESSIONS_PER_DAY);
        sessionsPresent += c;
        if (c >= MIN_SESSIONS_FOR_DAY_PRESENT) daysPresent++;
      });
      const lr = learnersData.find(x =>
        x.email?.trim().toLowerCase() === l.email.trim().toLowerCase()
      );
      const name = lr?.name || l.email.split("@")[0];
      const inactive = isInactiveLearnerStatus(lr?.status);
      const sessionPct = totalSessionsTillToday > 0 ? (sessionsPresent / totalSessionsTillToday) * 100 : 0;
      const dayPct     = totalDaysTillToday     > 0 ? (daysPresent     / totalDaysTillToday)     * 100 : 0;
      return { name, email: l.email, sessionsPresent, daysPresent, sessionPct, dayPct, inactive, status: lr?.status || "" };
    }).sort((a, b) => a.name.localeCompare(b.name));

    return {
      learners,
      totalBatchDays, totalDaysTillToday,
      totalSessionsAll, totalSessionsTillToday,
    };
  }, [attendanceData, learnersData, plannerDates]);

  /* ── Per-learner detail (for the dialog) ── */
  const calculateLearnerDetails = (learnerEmail) => {
    const l = summary.learners.find(x => x.email === learnerEmail) || { sessionsPresent: 0, daysPresent: 0 };
    return {
      sessionsPresent:      l.sessionsPresent,
      totalSessionsAll:     summary.totalSessionsAll,
      totalSessionsTillToday: summary.totalSessionsTillToday,
      daysPresent:          l.daysPresent,
      totalBatchDays:       summary.totalBatchDays,
      totalDaysTillToday:   summary.totalDaysTillToday,
    };
  };

  /* ── Download helpers (xlsx / pdf) ── */
  const buildReportRows = () => summary.learners.map((l, i) => ({
    "#": i + 1,
    "Learner": l.name,
    "Email": l.email,
    "Sessions Present": l.sessionsPresent,
    "Total Sessions": summary.totalSessionsTillToday,
    "Session %": Number(l.sessionPct.toFixed(1)),
    "Days Present": l.daysPresent,
    "Total Days": summary.totalDaysTillToday,
    "Day %": Number(l.dayPct.toFixed(1)),
  }));

  const downloadXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(buildReportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `Attendance_${batchNo || "report"}.xlsx`);
    setDownloadAnchor(null);
  };

  const downloadPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(`Attendance Report — ${batchNo || ""}`, 14, 16);
    doc.setFontSize(9);
    doc.text(
      `Days till today: ${summary.totalDaysTillToday}/${summary.totalBatchDays}   ` +
      `Sessions till today: ${summary.totalSessionsTillToday}/${summary.totalSessionsAll}`,
      14, 22
    );
    autoTable(doc, {
      startY: 27,
      head: [["#", "Learner", "Email", "Sess. Present", "Total Sess.", "Session %", "Days Present", "Total Days", "Day %"]],
      body: summary.learners.map((l, i) => [
        i + 1, l.name, l.email,
        l.sessionsPresent, summary.totalSessionsTillToday, `${l.sessionPct.toFixed(1)}%`,
        l.daysPresent, summary.totalDaysTillToday, `${l.dayPct.toFixed(1)}%`,
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
                  value={summary.totalDaysTillToday}
                  sub={` / ${summary.totalBatchDays}`}
                  accent
                />
                <StatPill
                  icon={<SessionIcon sx={{ fontSize: 16 }} />}
                  label="Sessions Conducted"
                  value={summary.totalSessionsTillToday}
                  sub={` / ${summary.totalSessionsAll}`}
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
                    <TableCell align="center" sx={tableHeadSx}>Day %</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.learners.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 7 }}>
                        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>
                          No attendance records found for this batch.
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
                              <span style={{ color: TOKENS.textSub, fontWeight: 400 }}> / {summary.totalSessionsTillToday}</span>
                            </Typography>
                          </TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <PctBadge pct={learner.sessionPct} />
                          </TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: TOKENS.text }}>
                              {learner.daysPresent}
                              <span style={{ color: TOKENS.textSub, fontWeight: 400 }}> / {summary.totalDaysTillToday}</span>
                            </Typography>
                          </TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <PctBadge pct={learner.dayPct} />
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
            const d = calculateLearnerDetails(selectedLearner.email);
            return (
              <Box>
                <Typography sx={{ ...labelSx, mb: 1.5 }}>Session-wise (3 sessions / day)</Typography>
                <Box sx={{ mb: 3, border: `1px solid ${TOKENS.border}`, borderRadius: "10px", overflow: "hidden" }}>
                  <DetailRow label="Total Batch Sessions" value={d.sessionsPresent} total={d.totalSessionsAll} />
                  <DetailRow label="Sessions Present (till today)" value={d.sessionsPresent} total={d.totalSessionsTillToday} />
                </Box>

                <Typography sx={{ ...labelSx, mb: 1.5 }}>Day-wise (present = ≥ 2 of 3 sessions)</Typography>
                <Box sx={{ border: `1px solid ${TOKENS.border}`, borderRadius: "10px", overflow: "hidden" }}>
                  <DetailRow label="Total Batch Days"  value={d.daysPresent} total={d.totalBatchDays} />
                  <DetailRow label="Days Present (till today)" value={d.daysPresent} total={d.totalDaysTillToday} />
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