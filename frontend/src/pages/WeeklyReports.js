// WeeklyReports.js
import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  CircularProgress, Button,
} from "@mui/material";
import {
  FileDownloadOutlined as DownloadIcon,
  CalendarViewWeek    as WeekIcon,
} from "@mui/icons-material";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

/* ─── Design tokens ──────────────────────────────────────────────────────── */
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
};

const inputSx = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 13,
  borderRadius: "10px",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.border },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent },
  "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent },
};

function DiffBadge({ diff }) {
  const isOnTime  = diff === 0;
  const isDelayed = diff > 0;
  const isEarly   = diff < 0;
  const tok = isOnTime ? TOKENS.success : isDelayed && diff > 2 ? TOKENS.error : isDelayed ? TOKENS.warning : TOKENS.success;
  return (
    <Box sx={{ display: "inline-flex", px: 1.2, py: 0.3, borderRadius: "20px", background: `${tok.fill}18`, border: `1px solid ${tok.fill}44` }}>
      <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 700, color: tok.fill }}>
        {isDelayed ? `+${diff}` : isEarly ? `${diff}` : "0"}
      </Typography>
    </Box>
  );
}

function StatusBadge({ status }) {
  const isComplete   = status === "Completed";
  const isInProgress = status === "In Progress";
  const tok = isComplete ? TOKENS.success : isInProgress ? { fill: TOKENS.accent, light: TOKENS.accentLight, text: "#1e3a8a" } : { fill: TOKENS.textSub, light: TOKENS.surfaceAlt, text: TOKENS.textSub };
  return (
    <Box sx={{ display: "inline-flex", px: 1.2, py: 0.3, borderRadius: "20px", background: tok.light, border: `1px solid ${tok.fill}44` }}>
      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, color: tok.text }}>
        {isComplete ? "Done" : isInProgress ? "In Progress" : "N/A"}
      </Typography>
    </Box>
  );
}

export default function WeeklyReports({ user, token }) {
  const [batches,       setBatches]       = useState([]);
  const [selectedBatch, setSelectedBatch] = useState("");
  const [weeks,         setWeeks]         = useState([]);
  const [selectedWeek,  setSelectedWeek]  = useState("");
  const [rows,          setRows]          = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [downloading,   setDownloading]   = useState(false);
  const [error,         setError]         = useState("");

  const welcomeName = user?.name || "User";

  useEffect(() => {
    async function loadBatches() {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get(`${API_BASE}/api/batches`, { headers });
        setBatches(Array.isArray(res.data) ? res.data : []);
      } catch { setError("Error loading batches"); }
    }
    loadBatches();
  }, [token]);

  useEffect(() => {
    if (!selectedBatch) { setWeeks([]); setSelectedWeek(""); setRows([]); return; }
    async function loadWeeks() {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get(`${API_BASE}/api/weeks/${selectedBatch}`, { headers });
        const sorted = [...(Array.isArray(res.data) ? res.data : [])].sort((a, b) => Number(a) - Number(b));
        setWeeks(sorted);
        setSelectedWeek(sorted[0] || "");
      } catch { setError("Error loading weeks"); setWeeks([]); setSelectedWeek(""); setRows([]); }
    }
    loadWeeks();
  }, [selectedBatch, token]);

  useEffect(() => {
    if (!selectedBatch || !selectedWeek) { setRows([]); return; }
    async function loadWeeklyReport() {
      setLoading(true); setError("");
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get(`${API_BASE}/api/weekly-date-report/${selectedBatch}`, { headers, params: { week_no: selectedWeek } });
        setRows(Array.isArray(res.data) ? res.data : []);
      } catch { setError("Error loading weekly report"); setRows([]); }
      finally { setLoading(false); }
    }
    loadWeeklyReport();
  }, [selectedBatch, selectedWeek, token]);

  const generateFileTimestamp = () =>
    new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .replace(/[,]/g, "").replace(/:/g, "-");

  const handleDownloadPDF = async () => {
    if (!selectedBatch || !selectedWeek) { alert("Please select a batch and week first"); return; }
    setDownloading(true);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await axios.get(`${API_BASE}/api/weekly-date-report/${selectedBatch}/pdf`, { headers, params: { week_no: selectedWeek }, responseType: "blob" });
      const url  = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Weekly_Report_${selectedBatch}_Week${selectedWeek}_${generateFileTimestamp()}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch { alert("Error downloading PDF"); }
    finally { setDownloading(false); }
  };

  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <Box sx={{ maxWidth: 1600, mx: "auto" }}>

        {/* Header */}
        <Box sx={{ mb: 4, display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
          <Box>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
              Weekly Reports — CMS
            </Typography>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
              Hello <strong style={{ color: TOKENS.accent }}>{welcomeName}</strong>, view date change stats week-wise per batch
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={downloading ? <CircularProgress size={14} color="inherit" /> : <DownloadIcon sx={{ fontSize: 16 }} />}
            onClick={handleDownloadPDF}
            disabled={!selectedBatch || !selectedWeek || downloading || loading}
            sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", background: TOKENS.accent, "&:hover": { background: "#2a3fd4" }, "&:disabled": { opacity: 0.5 } }}
          >
            {downloading ? "Downloading…" : "Download PDF"}
          </Button>
        </Box>

        {/* Filters */}
        <Box sx={{ ...cardSx, p: 3, mb: 3 }}>
          <Typography sx={{ ...labelSx, mb: 2 }}>Filter</Typography>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batch</InputLabel>
              <Select value={selectedBatch} label="Batch" onChange={e => setSelectedBatch(e.target.value)} sx={inputSx}>
                <MenuItem value=""><em>Select Batch</em></MenuItem>
                {batches.map(b => (
                  <MenuItem key={b.batch_no} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                    {b.batch_no}{b.start_date ? ` (${b.start_date})` : ""}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }} disabled={!weeks.length}>
              <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Week No</InputLabel>
              <Select value={selectedWeek} label="Week No" onChange={e => setSelectedWeek(e.target.value)} sx={inputSx}>
                {weeks.length === 0 && <MenuItem value=""><em>No weeks</em></MenuItem>}
                {weeks.map(w => (
                  <MenuItem key={w} value={w} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Week {w}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          {error && (
            <Box sx={{ mt: 2, px: 2.5, py: 1.5, borderRadius: "10px", background: TOKENS.error.light, border: `1px solid ${TOKENS.error.fill}44` }}>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: TOKENS.error.text }}>{error}</Typography>
            </Box>
          )}
        </Box>

        {/* Loading */}
        {loading && (
          <Box sx={{ ...cardSx, py: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <CircularProgress size={32} sx={{ color: TOKENS.accent }} />
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>Loading weekly report…</Typography>
          </Box>
        )}

        {/* Results table */}
        {!loading && selectedBatch && selectedWeek && (
          <Box sx={cardSx}>
            {/* Card header */}
            <Box sx={{ px: 3, py: 2.5, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <WeekIcon sx={{ fontSize: 20, color: TOKENS.accent }} />
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text }}>
                Week {selectedWeek} — Date Changes
              </Typography>
              <Box sx={{ px: 1.5, py: 0.4, borderRadius: "20px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: TOKENS.accent }}>Batch: {selectedBatch}</Typography>
              </Box>
              {rows.length > 0 && (
                <Box sx={{ ml: "auto", px: 1.5, py: 0.4, borderRadius: "20px", background: TOKENS.surfaceAlt, border: `1px solid ${TOKENS.border}` }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: TOKENS.textSub }}>{rows.length} records</Typography>
                </Box>
              )}
            </Box>

            <TableContainer sx={{ maxHeight: 600 }}>
              <Table stickyHeader size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ ...tableHeadSx, width: "10%" }}>Module</TableCell>
                    <TableCell sx={{ ...tableHeadSx, width: "18%" }}>Topic</TableCell>
                    <TableCell align="center" sx={{ ...tableHeadSx, width: "12%" }}>Planned</TableCell>
                    <TableCell align="center" sx={{ ...tableHeadSx, width: "12%" }}>Actual</TableCell>
                    <TableCell align="center" sx={{ ...tableHeadSx, width: "10%" }}>Diff</TableCell>
                    <TableCell align="center" sx={{ ...tableHeadSx, width: "12%" }}>Status</TableCell>
                    <TableCell align="center" sx={{ ...tableHeadSx, width: "14%" }}>Changed By</TableCell>
                    <TableCell align="center" sx={{ ...tableHeadSx, width: "12%" }}>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>
                          No date changes recorded for this batch and week.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row, idx) => (
                      <TableRow key={row.id || idx} sx={{ "&:nth-of-type(even)": { background: TOKENS.surfaceAlt }, "&:hover": { background: `${TOKENS.accent}06` } }}>
                        <TableCell sx={{ ...tableCellSx, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.module_name || "N/A"}
                        </TableCell>
                        <TableCell sx={{ ...tableCellSx, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.topic_name}
                        </TableCell>
                        <TableCell align="center" sx={{ ...tableCellSx, fontFamily: "'DM Mono', monospace", fontSize: 12, color: TOKENS.textSub }}>
                          {new Date(row.planned_date).toLocaleDateString("en-IN")}
                        </TableCell>
                        <TableCell align="center" sx={{ ...tableCellSx, fontFamily: "'DM Mono', monospace", fontSize: 12, color: TOKENS.textSub }}>
                          {new Date(row.actual_date).toLocaleDateString("en-IN")}
                        </TableCell>
                        <TableCell align="center" sx={tableCellSx}>
                          <DiffBadge diff={row.date_difference} />
                        </TableCell>
                        <TableCell align="center" sx={tableCellSx}>
                          <StatusBadge status={row.topic_status} />
                        </TableCell>
                        <TableCell align="center" sx={{ ...tableCellSx, fontSize: 12, color: TOKENS.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.changed_by ? row.changed_by.split("@")[0] : "N/A"}
                        </TableCell>
                        <TableCell align="center" sx={{ ...tableCellSx, fontFamily: "'DM Mono', monospace", fontSize: 11, color: TOKENS.textSub }}>
                          {row.changed_at ? new Date(row.changed_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }).split(",")[0] : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {!loading && (!selectedBatch || !selectedWeek) && (
          <Box sx={{ ...cardSx, py: 10, textAlign: "center" }}>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 600, color: TOKENS.textSub }}>
              Select a batch and week to view date-change details
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}