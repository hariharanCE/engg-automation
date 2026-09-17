import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem,
  Table, TableHead, TableBody, TableCell, TableRow, TableContainer,
  Chip, CircularProgress, Button,
} from "@mui/material";
import {
  DownloadOutlined as DownloadIcon,
  TrendingDown     as DelayedIcon,
  TrendingUp       as EarlyIcon,
  CheckCircle      as OnTimeIcon,
  Assignment       as TotalIcon,
} from "@mui/icons-material";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const API_BASE = process.env.REACT_APP_API_URL || "http://192.168.1.2:5000/";

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

function SummaryCard({ icon, label, value, sub, tokens }) {
  return (
    <Box sx={{ flex: "1 1 180px", ...cardSx, p: 0 }}>
      <Box sx={{ px: 3, py: 2.5, background: `${tokens.fill}12`, borderBottom: `3px solid ${tokens.fill}` }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <Box sx={{ color: tokens.fill }}>{icon}</Box>
          <Typography sx={{ ...labelSx, fontSize: 10, color: tokens.text }}>{label}</Typography>
        </Box>
        <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 34, fontWeight: 800, color: tokens.fill, lineHeight: 1 }}>{value}</Typography>
        {sub && <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: tokens.text, mt: 0.5 }}>{sub}</Typography>}
      </Box>
    </Box>
  );
}

export default function DateChangeReport({ user, token }) {
  const [batches,      setBatches]      = useState([]);
  const [selectedBatch,setSelectedBatch]= useState("");
  const [reportData,   setReportData]   = useState([]);
  const [batchSummary, setBatchSummary] = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  useEffect(() => {
    async function loadBatches() {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get(`${API_BASE}/api/batches`, { headers });
        if (Array.isArray(res.data)) setBatches(res.data);
      } catch { setError("Error loading batches"); }
    }
    loadBatches();
  }, [token]);

  useEffect(() => {
    if (selectedBatch) loadReport();
    else { setReportData([]); setBatchSummary(null); }

    async function loadReport() {
      setLoading(true); setError("");
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const reportRes = await axios.get(`${API_BASE}/api/date-change-report/${selectedBatch}?status=completed`, { headers });
        const processed = (reportRes.data || []).map(row => {
          const pd = row.planned_date ? new Date(row.planned_date) : null;
          const ad = row.actual_date  ? new Date(row.actual_date)  : null;
          const diff = pd && ad && !isNaN(pd) && !isNaN(ad) ? Math.floor((ad - pd) / 86400000) : null;
          return { ...row, date_difference: diff, is_on_time: row.topic_status === "Completed" && diff === 0 };
        });
        const completed = processed.filter(r => r.topic_status === "Completed");
        setBatchSummary({
          total_completed: completed.length,
          ontime_count:  completed.filter(r => r.is_on_time).length,
          delayed_count: completed.filter(r => r.date_difference > 0).length,
          early_count:   completed.filter(r => r.date_difference < 0).length,
          avg_difference: completed.length > 0 ? (completed.reduce((s, r) => s + (r.date_difference || 0), 0) / completed.length).toFixed(1) : 0,
          max_delay: Math.max(...completed.map(r => r.date_difference || 0), 0),
          max_early: Math.min(...completed.map(r => r.date_difference || 0), 0),
        });
        setReportData(processed);
      } catch { setError("Error loading report data"); }
      finally { setLoading(false); }
    }
  }, [selectedBatch, token]);

  const downloadPDF = () => {
    const doc = new jsPDF("l", "mm", "a4");
    const ts = new Date().toLocaleString("en-IN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    doc.setFontSize(18); doc.setTextColor(40); doc.text("Date Change Report", 14, 20);
    doc.setFontSize(11); doc.setTextColor(100);
    doc.text(`Batch: ${selectedBatch}`, 14, 28); doc.text(`Generated: ${ts}`, 14, 34);
    if (batchSummary) {
      doc.setFontSize(10); doc.setTextColor(100);
      doc.text(`Total: ${batchSummary.total_completed}  Delayed: ${batchSummary.delayed_count}  Early: ${batchSummary.early_count}  On Time: ${batchSummary.ontime_count}`, 14, 44);
    }
    autoTable(doc, {
      startY: 52,
      head: [["Module","Topic","Trainer","Planned","Actual","Diff","Status","Changed By","Changed At","Remarks"]],
      body: reportData.filter(r => r.topic_status === "Completed").map(r => [
        r.module_name || "N/A", r.topic_name || "N/A", r.trainer_name || "N/A",
        r.planned_date ? new Date(r.planned_date).toLocaleDateString("en-IN") : "N/A",
        r.actual_date  ? new Date(r.actual_date).toLocaleDateString("en-IN")  : "N/A",
        r.date_difference !== null ? r.date_difference > 0 ? `+${r.date_difference}d` : r.date_difference < 0 ? `${r.date_difference}d` : "On time" : "Pending",
        r.topic_status || "N/A", r.changed_by || "System",
        r.changed_at ? new Date(r.changed_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "Initial",
        r.remarks || "-",
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [61, 90, 254], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 249, 252] },
    });
    doc.save(`DateChangeReport_${selectedBatch}_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <Box sx={{ maxWidth: 1600, mx: "auto" }}>

        {/* Header */}
        <Box sx={{ mb: 4, display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
          <Box>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
              Date Change Report
            </Typography>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
              On Time = Completed + No Date Change
            </Typography>
          </Box>
          {selectedBatch && reportData.length > 0 && (
            <Button variant="contained" startIcon={<DownloadIcon sx={{ fontSize: 16 }} />} onClick={downloadPDF}
              sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}>
              Download PDF
            </Button>
          )}
        </Box>

        {/* Filter */}
        <Box sx={{ ...cardSx, p: 3, mb: 3 }}>
          <Typography sx={{ ...labelSx, mb: 2 }}>Filter</Typography>
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Select Batch</InputLabel>
            <Select value={selectedBatch} label="Select Batch" onChange={e => setSelectedBatch(e.target.value)} sx={inputSx}>
              <MenuItem value=""><em>Select Batch</em></MenuItem>
              {batches.map(b => (
                <MenuItem key={b.batch_no} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                  {b.batch_no}{b.start_date ? ` (${b.start_date})` : ""}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>Loading report data…</Typography>
          </Box>
        )}

        {/* Summary cards */}
        {!loading && batchSummary && (
          <>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
              <SummaryCard icon={<DelayedIcon sx={{ fontSize: 18 }} />} label="Delayed"    value={batchSummary.delayed_count}    sub={batchSummary.max_delay > 0 ? `Max: ${batchSummary.max_delay}d` : undefined} tokens={TOKENS.error} />
              <SummaryCard icon={<EarlyIcon   sx={{ fontSize: 18 }} />} label="Early"      value={batchSummary.early_count}      sub={batchSummary.max_early < 0 ? `Max: ${Math.abs(batchSummary.max_early)}d` : undefined} tokens={TOKENS.success} />
              <SummaryCard icon={<OnTimeIcon  sx={{ fontSize: 18 }} />} label="On Time"    value={batchSummary.ontime_count}     sub="Completed as planned" tokens={{ fill: TOKENS.accent, light: TOKENS.accentLight, text: "#1e3a8a" }} />
              <SummaryCard icon={<TotalIcon   sx={{ fontSize: 18 }} />} label="Total"      value={batchSummary.total_completed}  sub={`${batchSummary.avg_difference}d avg diff`} tokens={TOKENS.warning} />
            </Box>

            {/* Detail table */}
            <Box sx={cardSx}>
              <Box sx={{ px: 3, py: 2.5, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text }}>Detailed Report</Typography>
                <Chip label={`Batch ${selectedBatch}`} size="small" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.accentLight, color: TOKENS.accent, border: `1px solid ${TOKENS.accent}33` }} />
              </Box>
              <TableContainer sx={{ maxHeight: 520 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {["Module","Topic","Trainer","Planned","Actual","Difference","Status","Changed By","Changed At","Remarks"].map(h => (
                        <TableCell key={h} sx={tableHeadSx}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {reportData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} align="center" sx={{ py: 6 }}>
                          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>No completed topics found</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      reportData.map((row, idx) => {
                        const diff = row.date_difference;
                        const diffColor = diff === 0 ? TOKENS.success : diff > 2 ? TOKENS.error : diff > 0 ? TOKENS.warning : TOKENS.success;
                        return (
                          <TableRow key={idx} sx={{ "&:nth-of-type(even)": { background: TOKENS.surfaceAlt }, "&:hover": { background: `${TOKENS.accent}06` } }}>
                            <TableCell sx={{ ...tableCellSx, fontWeight: 600 }}>{row.module_name || "N/A"}</TableCell>
                            <TableCell sx={tableCellSx}>{row.topic_name}</TableCell>
                            <TableCell sx={{ ...tableCellSx, color: TOKENS.textSub }}>{row.trainer_name || "N/A"}</TableCell>
                            <TableCell sx={{ ...tableCellSx, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                              {row.planned_date ? new Date(row.planned_date).toLocaleDateString("en-IN") : "N/A"}
                            </TableCell>
                            <TableCell sx={{ ...tableCellSx, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                              {row.actual_date ? new Date(row.actual_date).toLocaleDateString("en-IN") : "Pending"}
                            </TableCell>
                            <TableCell align="center" sx={tableCellSx}>
                              {diff !== null ? (
                                <Box sx={{ display: "inline-flex", px: 1.2, py: 0.3, borderRadius: "20px", background: `${diffColor.fill}18`, border: `1px solid ${diffColor.fill}44` }}>
                                  <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 700, color: diffColor.fill }}>
                                    {diff > 0 ? `+${diff}d` : diff < 0 ? `${diff}d` : "✅ On time"}
                                  </Typography>
                                </Box>
                              ) : (
                                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.textSub }}>Pending</Typography>
                              )}
                            </TableCell>
                            <TableCell sx={tableCellSx}>
                              <Box sx={{ display: "inline-flex", px: 1.2, py: 0.3, borderRadius: "20px",
                                background: row.topic_status === "Completed" ? TOKENS.success.light : TOKENS.surfaceAlt,
                                border: `1px solid ${row.topic_status === "Completed" ? TOKENS.success.fill : TOKENS.border}44` }}>
                                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700,
                                  color: row.topic_status === "Completed" ? TOKENS.success.text : TOKENS.textSub }}>
                                  {row.topic_status || "N/A"}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell sx={{ ...tableCellSx, fontSize: 12, color: TOKENS.textSub }}>{row.changed_by || "System"}</TableCell>
                            <TableCell sx={{ ...tableCellSx, fontFamily: "'DM Mono', monospace", fontSize: 11, color: TOKENS.textSub }}>
                              {row.changed_at ? new Date(row.changed_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "Initial"}
                            </TableCell>
                            <TableCell sx={{ ...tableCellSx, color: TOKENS.textSub, fontStyle: row.remarks ? "normal" : "italic" }}>{row.remarks || "—"}</TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </>
        )}

        {!loading && selectedBatch && !batchSummary && reportData.length === 0 && (
          <Box sx={{ ...cardSx, py: 8, textAlign: "center" }}>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>No completed topics yet for this batch</Typography>
          </Box>
        )}

        {!selectedBatch && !loading && (
          <Box sx={{ ...cardSx, py: 10, textAlign: "center" }}>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 600, color: TOKENS.textSub }}>Select a batch to view the report</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}