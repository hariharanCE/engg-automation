import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  Box,
  Typography,
  MenuItem,
  FormControl,
  Select,
  Table,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
  Alert,
  Fade,
  TableContainer,
  TextField,
  Snackbar,
  Chip,
  Grid,
  IconButton,
  Tooltip,
  Tabs,
  Tab,
  Button,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  Paper,
  Skeleton,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import { green, orange, red, grey } from "@mui/material/colors";
import ManagerLeaveDashboard from "./ManagerLeaveDashboard";
import TrainerAssignmentDashboard from "./TrainerAssignmentDashboard";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";

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
  success:     "#16a34a",
  warning:     "#d97706",
  danger:      "#dc2626",
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

const STATUS_COLORS = {
  Completed:     { bg: "#dcfce7", text: "#15803d", border: "#86efac" },
  "In Progress": { bg: "#fef3c7", text: "#b45309", border: "#fcd34d" },
  Planned:       { bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5" },
};

const LEAVE_STATUS_COLORS = {
  pending:  { bg: "#fef3c7", text: "#b45309", border: "#fcd34d",  label: "Pending"  },
  assigned: { bg: "#dcfce7", text: "#15803d", border: "#86efac",  label: "Assigned" },
  approved: { bg: "#dbeafe", text: "#1d4ed8", border: "#93c5fd",  label: "Approved" },
  rejected: { bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5",  label: "Rejected" },
};

const fieldSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: "10px",
    fontFamily:   "'DM Sans', sans-serif",
    fontSize:     13,
    background:   T.surfaceAlt,
    "& fieldset":               { borderColor: T.border },
    "&:hover fieldset":          { borderColor: T.accent },
    "&.Mui-focused fieldset":    { borderColor: T.accent },
  },
  "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 },
};

const dialogSx = {
  "& .MuiDialog-paper": {
    borderRadius: "18px",
    fontFamily:   "'DM Sans', sans-serif",
    boxShadow:    "0 12px 48px rgba(37,99,235,0.18)",
    border:       `1px solid ${T.border}`,
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   TrainerUnavailabilityForm  — Apply Leave + Leave History
══════════════════════════════════════════════════════════════════════════ */
function TrainerUnavailabilityForm({ user, token }) {
  const [domain,           setDomain]           = useState("");
  const [start,            setStart]            = useState("");
  const [end,              setEnd]              = useState("");
  const [reason,           setReason]           = useState("");
  const [trainerBatches,   setTrainerBatches]   = useState([]);
  const [selectedBatchNos, setSelectedBatchNos] = useState([]);
  const [msg,              setMsg]              = useState("");
  const [err,              setErr]              = useState("");
  const [loading,          setLoading]          = useState(false);
  const [submitting,       setSubmitting]        = useState(false);

  const [leaveHistory,   setLeaveHistory]   = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError,   setHistoryError]   = useState("");

  const [editDialog, setEditDialog] = useState({ open: false, leaveId: null, start: "", end: "", reason: "" });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editErr,        setEditErr]        = useState("");

  const [deleteDialog,  setDeleteDialog]  = useState({ open: false, leaveId: null });
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [showForm, setShowForm] = useState(true);

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  /* Today (local) as YYYY-MM-DD — used to block past-dated leave */
  const todayStr = (() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  const fetchBatches = useCallback(async () => {
    if (!user?.email) return;
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/api/trainer-batches`, {
        params: { trainer_email: user.email },
        headers: authHeaders,
        timeout: 10000,
      });
      const list = Array.isArray(res.data) ? res.data : [];
      setTrainerBatches(list);
      if (list.length === 1) {
        setSelectedBatchNos([list[0].batch_no || list[0].batchno]);
        setDomain(list[0].domain || "");
      }
    } catch (e) {
      console.error("Error loading trainer batches:", e);
      setErr("Failed to load batches. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [user?.email, token]); // eslint-disable-line

  const fetchLeaveHistory = useCallback(async () => {
    if (!user?.email) return;
    try {
      setHistoryLoading(true);
      setHistoryError("");
      const res = await axios.get(`${API_BASE}/api/trainer-unavailability`, {
        headers: authHeaders,
        timeout: 10000,
      });
      const all = Array.isArray(res.data) ? res.data : [];
      const mine = all.filter(r =>
        (r.trainer_email || "").toLowerCase().trim() === (user.email || "").toLowerCase().trim()
      );
      mine.sort((a, b) => new Date(b.submitted_at || b.created_at || 0) - new Date(a.submitted_at || a.created_at || 0));
      setLeaveHistory(mine);
    } catch (e) {
      console.error("Error loading leave history:", e);
      setHistoryError("Failed to load leave history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [user?.email, token]); // eslint-disable-line

  useEffect(() => { fetchBatches();      }, [fetchBatches]);
  useEffect(() => { fetchLeaveHistory(); }, [fetchLeaveHistory]);

  useEffect(() => {
    if (selectedBatchNos.length === 0) return;
    const selected     = trainerBatches.filter(b => selectedBatchNos.includes(b.batch_no || b.batchno));
    const uniqueDomains = Array.from(new Set(selected.map(b => b.domain || "")));
    if (uniqueDomains.length === 1) setDomain(uniqueDomains[0]);
  }, [selectedBatchNos, trainerBatches]);

  const handleBatchChange = (event) => {
    const value = event.target.value;
    setSelectedBatchNos(typeof value === "string" ? value.split(",") : value);
  };

  const submitUnavailability = async () => {
    setMsg(""); setErr(""); setSubmitting(true);
    if (!start || !end)                              { setErr("Please select From and To dates");     setSubmitting(false); return; }
    if (new Date(start) > new Date(end))              { setErr("End date must be after start date");   setSubmitting(false); return; }
    if (start < todayStr)                             { setErr("Cannot apply leave for past dates");   setSubmitting(false); return; }
    if (!domain)                                      { setErr("Domain is required");                  setSubmitting(false); return; }

    try {
      const response = await axios.post(
        `${API_BASE}/api/trainer-leaves`,
        { trainer_email: user.email, trainer_name: user.name, domain, start_date: start, end_date: end, reason, batch_nos: selectedBatchNos.join(",") },
        { headers: authHeaders, timeout: 15000 }
      );
      if (response.data?.success) {
        setMsg("✅ Leave request submitted successfully!");
        setStart(""); setEnd(""); setReason(""); setSelectedBatchNos([]); setDomain("");
        fetchBatches(); fetchLeaveHistory();
      } else {
        setErr(`Server response: ${response.data?.message || "Unknown error"}`);
      }
    } catch (e) {
      console.error("Submit failed:", e.response?.data || e);
      if (e.response?.status === 404)       setErr("API endpoint not found.");
      else if (e.response?.status === 400)  setErr(`Validation error: ${e.response.data?.error || "Check your input"}`);
      else if (e.code === "ECONNABORTED")   setErr("Request timeout. Please try again.");
      else if (e.response?.status === 500)  setErr(`Server error: ${e.response.data?.error || "Please contact admin"}`);
      else                                  setErr(`Failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (leave) => {
    setEditErr("");
    setEditDialog({ open: true, leaveId: leave.id, start: leave.start_date || "", end: leave.end_date || "", reason: leave.reason || "" });
  };

  const submitEdit = async () => {
    setEditErr(""); setEditSubmitting(true);
    if (!editDialog.start || !editDialog.end)                               { setEditErr("Please select both dates");          setEditSubmitting(false); return; }
    if (new Date(editDialog.start) > new Date(editDialog.end))              { setEditErr("End date must be after start date"); setEditSubmitting(false); return; }
    try {
      const res = await axios.put(
        `${API_BASE}/api/trainer-leaves/${editDialog.leaveId}`,
        { start_date: editDialog.start, end_date: editDialog.end, reason: editDialog.reason },
        { headers: authHeaders, timeout: 10000 }
      );
      if (res.data?.success) {
        setEditDialog({ open: false, leaveId: null, start: "", end: "", reason: "" });
        fetchLeaveHistory();
      } else {
        setEditErr(res.data?.error || "Update failed");
      }
    } catch (e) {
      setEditErr(e.response?.data?.error || e.message || "Update failed");
    } finally {
      setEditSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    setDeleteLoading(true);
    try {
      await axios.delete(`${API_BASE}/api/trainer-leaves/${deleteDialog.leaveId}`, { headers: authHeaders, timeout: 10000 });
      setDeleteDialog({ open: false, leaveId: null });
      fetchLeaveHistory();
    } catch (e) { console.error("Delete leave error:", e); }
    finally { setDeleteLoading(false); }
  };

  const fmtDate = (d) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return d; }
  };

  const getLeaveStatusChip = (status) => {
    const key = (status || "pending").toLowerCase();
    const s   = LEAVE_STATUS_COLORS[key] || LEAVE_STATUS_COLORS.pending;
    return (
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1.2, py: 0.3, borderRadius: "20px", background: s.bg, border: `1px solid ${s.border}` }}>
        <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: s.text, flexShrink: 0 }} />
        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, color: s.text }}>{s.label}</Typography>
      </Box>
    );
  };

  return (
    <Box>
      {/* Apply Leave Card */}
      <Box sx={{ ...cardSx, mb: 2.5 }}>
        <Box onClick={() => setShowForm(v => !v)} sx={{ px: 3, py: 2, cursor: "pointer", background: `linear-gradient(135deg, ${T.accent}12 0%, ${T.accentLight} 100%)`, borderBottom: showForm ? `1px solid ${T.border}` : "none", display: "flex", alignItems: "center", gap: 1.5, transition: "background 0.2s", "&:hover": { background: `linear-gradient(135deg, ${T.accent}22 0%, ${T.accentLight} 100%)` } }}>
          <Box sx={{ width: 38, height: 38, borderRadius: "11px", background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 3px 10px ${T.accent}33`, flexShrink: 0 }}>
            <AddCircleOutlineIcon sx={{ color: "#fff", fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 16, color: T.text, letterSpacing: "-0.02em" }}>Apply Leave</Typography>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: T.textSub }}>Submit a new unavailability / leave request</Typography>
          </Box>
          <Box sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: T.textSub, transition: "transform 0.2s", transform: showForm ? "rotate(180deg)" : "rotate(0deg)" }}>▾</Box>
        </Box>

        {showForm && (
          <Box sx={{ p: 3 }}>
            {loading && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.5, px: 2, borderRadius: "10px", background: T.accentLight, border: `1px solid ${T.accent}44`, mb: 2 }}>
                <CircularProgress size={18} sx={{ color: T.accent }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.accent, fontWeight: 600 }}>Loading your batches…</Typography>
              </Box>
            )}

            <TextField select label="Select Batch(es)" value={selectedBatchNos} onChange={handleBatchChange} fullWidth disabled={loading || submitting}
              SelectProps={{ multiple: true, renderValue: (selected) => selected.length > 0 ? selected.join(", ") : "No batch selected" }}
              sx={{ mb: 2, ...fieldSx }} helperText={selectedBatchNos.length === 0 ? "Select batches you want to apply leave for" : ""}>
              {trainerBatches.map(b => {
                const bn = b.batch_no || b.batchno;
                return <MenuItem key={bn} value={bn} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{bn}{b.domain ? ` (${b.domain})` : ""}</MenuItem>;
              })}
              {trainerBatches.length === 0 && !loading && <MenuItem disabled sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>No batches found</MenuItem>}
            </TextField>

            <TextField label="Domain *" value={domain} onChange={e => setDomain(e.target.value)} fullWidth disabled={loading || submitting} required error={!domain && selectedBatchNos.length > 0} helperText={!domain && selectedBatchNos.length > 0 ? "Domain is required" : ""} sx={{ mb: 2, ...fieldSx }} />

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6}>
                <TextField label="From Date *" type="date" value={start} onChange={e => setStart(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} inputProps={{ min: todayStr }} disabled={loading || submitting} required error={!start || (start && start < todayStr)} helperText={!start ? "Required" : start < todayStr ? "Cannot apply leave for past dates" : ""} sx={fieldSx} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="To Date *" type="date" value={end} onChange={e => setEnd(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} inputProps={{ min: start || todayStr }} disabled={loading || submitting} required error={!end || (start && new Date(start) > new Date(end)) || end < todayStr} helperText={!end ? "Required" : (start && new Date(start) > new Date(end)) ? "End date must be after start date" : end < todayStr ? "Cannot apply leave for past dates" : ""} sx={fieldSx} />
              </Grid>
            </Grid>

            <TextField label="Reason (Optional)" value={reason} onChange={e => setReason(e.target.value)} fullWidth multiline rows={2} disabled={loading || submitting} sx={{ mb: 2.5, ...fieldSx }} />

            <Button onClick={submitUnavailability} variant="contained" disabled={loading || submitting} startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : null} fullWidth
              sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 14, borderRadius: "10px", py: 1.4, textTransform: "none", background: `linear-gradient(135deg, ${T.accent} 0%, ${T.accentDark} 100%)`, boxShadow: `0 4px 14px ${T.accent}44`, "&:hover": { background: `linear-gradient(135deg, ${T.accentDark} 0%, ${T.accent} 100%)` }, "&.Mui-disabled": { background: T.border, color: T.textSub, boxShadow: "none" } }}>
              {submitting ? "Submitting…" : "Submit Leave Request"}
            </Button>

            {msg && <Alert severity="success" sx={{ mt: 2, borderRadius: "10px", fontFamily: "'DM Sans', sans-serif" }} onClose={() => setMsg("")}>{msg}</Alert>}
            {err && <Alert severity="error"   sx={{ mt: 2, borderRadius: "10px", fontFamily: "'DM Sans', sans-serif" }} onClose={() => setErr("")}>{err}</Alert>}
          </Box>
        )}
      </Box>

      {/* Leave History Card */}
      <Box sx={{ ...cardSx }}>
        <Box sx={{ px: 3, py: 2, background: "linear-gradient(135deg, #7c3aed12 0%, #ede9fe 100%)", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ width: 38, height: 38, borderRadius: "11px", background: "linear-gradient(135deg, #7c3aed, #6d28d9)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 3px 10px #7c3aed33", flexShrink: 0 }}>
            <CalendarMonthIcon sx={{ color: "#fff", fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 16, color: T.text, letterSpacing: "-0.02em" }}>
              My Leave History
              {leaveHistory.length > 0 && (
                <Box component="span" sx={{ ml: 1.2, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", background: T.accent, color: "#fff", fontSize: 11, fontWeight: 800, verticalAlign: "middle" }}>
                  {leaveHistory.length}
                </Box>
              )}
            </Typography>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: T.textSub }}>All your submitted leave requests</Typography>
          </Box>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={fetchLeaveHistory} disabled={historyLoading} sx={{ color: T.accent, background: T.accentLight, borderRadius: "8px", "&:hover": { background: T.accent, color: "#fff" } }}>
              <Typography sx={{ fontSize: 16, lineHeight: 1 }}>↻</Typography>
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ p: 2 }}>
          {historyLoading && (
            <Box sx={{ px: 1 }}>
              {[1, 2, 3].map(i => (
                <Box key={i} sx={{ display: "flex", gap: 2, mb: 1.5, alignItems: "center" }}>
                  <Skeleton variant="rounded" width={80}  height={36} sx={{ borderRadius: "8px" }} />
                  <Skeleton variant="rounded" width={80}  height={36} sx={{ borderRadius: "8px" }} />
                  <Skeleton variant="rounded" width={100} height={36} sx={{ borderRadius: "8px" }} />
                  <Skeleton variant="rounded" width={70}  height={24} sx={{ borderRadius: "20px" }} />
                  <Skeleton variant="rounded" width={60}  height={30} sx={{ borderRadius: "8px", ml: "auto" }} />
                </Box>
              ))}
            </Box>
          )}

          {!historyLoading && historyError && <Alert severity="error" sx={{ borderRadius: "10px", fontFamily: "'DM Sans', sans-serif" }}>{historyError}</Alert>}

          {!historyLoading && !historyError && leaveHistory.length === 0 && (
            <Box sx={{ py: 5, textAlign: "center" }}>
              <EventBusyIcon sx={{ fontSize: 44, color: T.border, mb: 1 }} />
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.textSub }}>No leave requests found.</Typography>
            </Box>
          )}

          {!historyLoading && leaveHistory.length > 0 && (
            <TableContainer component={Paper} elevation={0} sx={{ borderRadius: "12px", border: `1px solid ${T.border}`, overflow: "hidden" }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ background: T.surfaceAlt }}>
                    {["Batch(es)", "Domain", "From", "To", "Duration", "Reason", "Status", "Actions"].map(h => (
                      <TableCell key={h} sx={{ ...labelSx, py: 1.3, borderBottom: `2px solid ${T.border}`, whiteSpace: "nowrap" }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {leaveHistory.map(leave => {
                    const canEdit  = !["assigned", "approved"].includes((leave.status || "").toLowerCase());
                    const s        = leave.start_date;
                    const e2       = leave.end_date;
                    let durationDays = null;
                    try { durationDays = Math.round((new Date(e2) - new Date(s)) / (1000 * 60 * 60 * 24)) + 1; } catch { /* */ }

                    return (
                      <TableRow key={leave.id} sx={{ "&:nth-of-type(even)": { background: T.surfaceAlt }, "&:hover": { background: T.accentLight, transition: "background 0.15s" } }}>
                        <TableCell sx={{ maxWidth: 130 }}>
                          <Tooltip title={leave.batch_nos || "—"}>
                            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: T.accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
                              {leave.batch_nos || "—"}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                        <TableCell sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: T.text }}>{leave.domain || "—"}</TableCell>
                        <TableCell sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: T.textSub, whiteSpace: "nowrap" }}>{fmtDate(s)}</TableCell>
                        <TableCell sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: T.textSub, whiteSpace: "nowrap" }}>{fmtDate(e2)}</TableCell>
                        <TableCell>
                          {durationDays != null && (
                            <Chip label={`${durationDays}d`} size="small" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, height: 22, background: T.accentLight, color: T.accent, border: `1px solid ${T.accent}44` }} />
                          )}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 150 }}>
                          <Tooltip title={leave.reason || "No reason provided"}>
                            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                              {leave.reason || <em style={{ color: T.border }}>—</em>}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                        <TableCell>{getLeaveStatusChip(leave.status)}</TableCell>
                        <TableCell>
                          <Box sx={{ display: "flex", gap: 0.5 }}>
                            <Tooltip title={canEdit ? "Edit leave dates" : "Cannot edit — already processed"}>
                              <span>
                                <IconButton size="small" disabled={!canEdit} onClick={() => openEdit(leave)}
                                  sx={{ color: T.accent, background: T.accentLight, borderRadius: "7px", p: 0.6, "&:hover": { background: T.accent, color: "#fff" }, "&.Mui-disabled": { opacity: 0.35 }, transition: "all 0.18s" }}>
                                  <EditIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={canEdit ? "Cancel / delete this leave" : "Cannot delete — already processed"}>
                              <span>
                                <IconButton size="small" disabled={!canEdit} onClick={() => setDeleteDialog({ open: true, leaveId: leave.id })}
                                  sx={{ color: T.danger, background: "#fee2e2", borderRadius: "7px", p: 0.6, "&:hover": { background: T.danger, color: "#fff" }, "&.Mui-disabled": { opacity: 0.35 }, transition: "all 0.18s" }}>
                                  <DeleteIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Box>

      {/* Edit Dialog */}
      <Dialog open={editDialog.open} onClose={() => setEditDialog({ ...editDialog, open: false })} maxWidth="xs" fullWidth sx={dialogSx}>
        <DialogTitle sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, color: T.text, fontSize: 17, pb: 1 }}>Edit Leave Request</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}><TextField label="From Date *" type="date" value={editDialog.start} onChange={e => setEditDialog({ ...editDialog, start: e.target.value })} fullWidth InputLabelProps={{ shrink: true }} disabled={editSubmitting} required sx={fieldSx} /></Grid>
              <Grid item xs={12}><TextField label="To Date *" type="date" value={editDialog.end} onChange={e => setEditDialog({ ...editDialog, end: e.target.value })} fullWidth InputLabelProps={{ shrink: true }} disabled={editSubmitting} required error={editDialog.start && editDialog.end && new Date(editDialog.start) > new Date(editDialog.end)} helperText={editDialog.start && editDialog.end && new Date(editDialog.start) > new Date(editDialog.end) ? "End date must be after start date" : ""} sx={fieldSx} /></Grid>
              <Grid item xs={12}><TextField label="Reason" value={editDialog.reason} onChange={e => setEditDialog({ ...editDialog, reason: e.target.value })} fullWidth multiline rows={2} disabled={editSubmitting} sx={fieldSx} /></Grid>
            </Grid>
            {editErr && <Alert severity="error" sx={{ mt: 1.5, borderRadius: "10px", fontFamily: "'DM Sans', sans-serif" }}>{editErr}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setEditDialog({ open: false, leaveId: null, start: "", end: "", reason: "" })} sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, textTransform: "none", borderRadius: "8px", color: T.textSub, border: `1px solid ${T.border}` }}>Cancel</Button>
          <Button onClick={submitEdit} variant="contained" disabled={editSubmitting || !editDialog.start || !editDialog.end} startIcon={editSubmitting ? <CircularProgress size={16} color="inherit" /> : <EditIcon sx={{ fontSize: 16 }} />}
            sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, textTransform: "none", borderRadius: "8px", background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`, boxShadow: `0 3px 10px ${T.accent}44`, "&.Mui-disabled": { background: T.border, color: T.textSub, boxShadow: "none" } }}>
            {editSubmitting ? "Saving…" : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, leaveId: null })} maxWidth="xs" sx={dialogSx}>
        <DialogTitle sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, color: T.text, fontSize: 17 }}>Cancel Leave Request?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.textSub }}>
            This will permanently delete the leave request. This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setDeleteDialog({ open: false, leaveId: null })} sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, textTransform: "none", borderRadius: "8px", color: T.textSub, border: `1px solid ${T.border}` }}>Keep</Button>
          <Button onClick={confirmDelete} variant="contained" disabled={deleteLoading} startIcon={deleteLoading ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon sx={{ fontSize: 16 }} />}
            sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, textTransform: "none", borderRadius: "8px", background: `linear-gradient(135deg, ${T.danger}, #b91c1c)`, boxShadow: "0 3px 10px #dc262644", "&.Mui-disabled": { background: T.border, color: T.textSub } }}>
            {deleteLoading ? "Deleting…" : "Yes, Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TrainerDashboard  (main export)
══════════════════════════════════════════════════════════════════════════ */
function TrainerDashboard({ user, token }) {
  // FIX: store as objects { batch_no, start_date }
  const [batches,         setBatches]         = useState([]);
  const [loadingBatches,  setLoadingBatches]  = useState(true);
  const [selectedBatch,   setSelectedBatch]   = useState("");
  const [weeks,           setWeeks]           = useState([]);
  const [selectedWeek,    setSelectedWeek]    = useState("");
  const [topics,          setTopics]          = useState([]);
  const [remarksMap,      setRemarksMap]      = useState({});
  const [actualDatesMap,  setActualDatesMap]  = useState({});
  const [message,         setMessage]         = useState("");

  const [snackbarOpen,     setSnackbarOpen]     = useState(false);
  const [snackbarMessage,  setSnackbarMessage]  = useState("");
  const [snackbarSeverity, setSnackbarSeverity] = useState("info");

  const [remarksSnackbarOpen,     setRemarksSnackbarOpen]     = useState(false);
  const [remarksSnackbarMessage,  setRemarksSnackbarMessage]  = useState("");
  const [remarksSnackbarSeverity, setRemarksSnackbarSeverity] = useState("warning");

  const [pendingStatusChanges, setPendingStatusChanges] = useState({});
  const [tab,                  setTab]                  = useState(0);
  const [allBatchTopics,       setAllBatchTopics]       = useState([]);
  const [firstIncompleteWeek,  setFirstIncompleteWeek]  = useState(null);
  const [blockedTopics,        setBlockedTopics]        = useState({});
  const [isBatchOwner,         setIsBatchOwner]         = useState(false);

  const [dateChangeDialog,  setDateChangeDialog]  = useState({ open: false, topicId: null, newDate: null, plannedDate: null });
  const [saveChangesDialog, setSaveChangesDialog] = useState({ open: false, topicId: null, newDate: null, remarks: null });
  const [savingTopicId,     setSavingTopicId]     = useState(null);

  const lowerRole        = (user?.role || "").toLowerCase();
  const isTrainer        = lowerRole === "trainer";
  const isManagerOrAdmin = lowerRole === "manager" || lowerRole === "admin";
  const trainerTabLabel  = isTrainer ? "Apply Leave" : "Trainer Management";
  const roleTitle        = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Trainer";
  const welcomeName      = user?.name || "Trainer";

  const showSnackbar = (msg, severity = "info") => {
    setSnackbarMessage(msg || ""); setSnackbarSeverity(severity); setSnackbarOpen(true);
  };
  const showRemarksSnackbar = (msg, severity = "warning") => {
    setRemarksSnackbarMessage(msg || ""); setRemarksSnackbarSeverity(severity); setRemarksSnackbarOpen(true);
  };

  /* ── FIX: Robust batch loading ── */
  useEffect(() => {
    const fetchBatches = async () => {
      setLoadingBatches(true);
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get(`${API_BASE}/api/batches`, { headers });

        if (!Array.isArray(res.data)) {
          console.warn("/api/batches returned non-array:", res.data);
          setBatches([]);
          return;
        }

        // Normalize: each item may be a string or an object with batch_no
        const normalized = res.data
          .map(b => {
            if (typeof b === "string") return { batch_no: b, start_date: "" };
            if (b && typeof b === "object" && b.batch_no) return b;
            return null;
          })
          .filter(Boolean)
          .sort((a, b) => (a.batch_no || "").localeCompare(b.batch_no || ""));

        console.log(`TrainerDashboard: loaded ${normalized.length} batches`);
        setBatches(normalized);

        if (normalized.length === 0) {
          setMessage("No batches found");
        }
      } catch (err) {
        console.error("Failed to load batches:", err);
        setMessage("Error loading batches");
        setBatches([]);
      } finally {
        setLoadingBatches(false);
      }
    };
    fetchBatches();
  }, [token]);

  /* ── Load weeks + all topics when batch changes ── */
  useEffect(() => {
    if (!selectedBatch) {
      setWeeks([]); setSelectedWeek(""); setTopics([]); setAllBatchTopics([]); setFirstIncompleteWeek(null); setBlockedTopics({});
      return;
    }
    (async () => {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const resWeeks = await axios.get(`${API_BASE}/api/weeks/${selectedBatch}`, { headers });
        if (Array.isArray(resWeeks.data) && resWeeks.data.length > 0) {
          const sorted = [...resWeeks.data].sort((a, b) => Number(a) - Number(b));
          setWeeks(sorted); setSelectedWeek(sorted[0]);
        } else {
          setWeeks([]); setSelectedWeek(""); setTopics([]); setMessage("No weeks found for selected batch");
        }
        const resAll = await axios.get(`${API_BASE}/api/topics/${selectedBatch}`, { headers });
        const all = Array.isArray(resAll.data) ? resAll.data : [];
        setAllBatchTopics(all);
        if (all.length > 0) {
          const ws = {};
          all.forEach(t => {
            const w = Number(t.week_no ?? t.weekno);
            if (!ws[w]) ws[w] = { hasNotCompleted: false };
            if ((t.topic_status ?? t.topicstatus) !== "Completed") ws[w].hasNotCompleted = true;
          });
          const cands = Object.keys(ws).map(Number).filter(w => ws[w].hasNotCompleted);
          setFirstIncompleteWeek(cands.length > 0 ? Math.min(...cands) : null);
        } else { setFirstIncompleteWeek(null); }
      } catch {
        setWeeks([]); setSelectedWeek(""); setTopics([]); setAllBatchTopics([]); setMessage("Error loading weeks/topics"); setFirstIncompleteWeek(null);
      }
    })();
  }, [selectedBatch, token]);

  /* ── Batch owner check ── */
  useEffect(() => {
    const check = async () => {
      if (!selectedBatch || !token || (lowerRole !== "manager" && lowerRole !== "admin")) { setIsBatchOwner(false); return; }
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const res = await axios.get(`${API_BASE}/api/course_planner_data?batch_no=${selectedBatch}`, { headers });
        const first = Array.isArray(res.data) ? res.data[0] : null;
        setIsBatchOwner(!!first && first.batch_owner === user?.email);
      } catch { setIsBatchOwner(false); }
    };
    check();
  }, [selectedBatch, token, user?.email, lowerRole]);

  /* ── Load topics for selected week ── */
  useEffect(() => {
    if (!selectedBatch || !selectedWeek) { setTopics([]); return; }
    (async () => {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get(`${API_BASE}/api/topics/${selectedBatch}`, {
          headers, params: { week_no: selectedWeek },
        });
        if (Array.isArray(res.data)) {
          const sorted = [...res.data].sort((a, b) => {
            const diff = new Date(a.date) - new Date(b.date);
            return diff !== 0 ? diff : (a.module_name || "").localeCompare(b.module_name || "");
          });
          setTopics(sorted);
          const newR = {}, newD = {};
          sorted.forEach(t => { newR[t.id] = t.remarks || ""; newD[t.id] = t.actual_date || t.actualdate || t.date || ""; });
          setRemarksMap(newR); setActualDatesMap(newD);
          setPendingStatusChanges({}); setBlockedTopics({}); setMessage("");
        } else { setTopics([]); setMessage("No topics"); }
      } catch { setTopics([]); setMessage("Error loading topics"); }
    })();
  }, [selectedBatch, selectedWeek, token]);

  /* ── Helpers ── */
  const getStatusForTopic = (id, confirmed) => pendingStatusChanges[id] ?? confirmed;
  const isActionFrozen    = (t) => (t.topic_status ?? t.topicstatus) === "Completed";
  const canEditWeek       = (wNo) => { const w = Number(wNo); if (!w) return false; if (firstIncompleteWeek == null) return true; return w === firstIncompleteWeek; };
  const isBlocked         = (id) => !!blockedTopics[id];

  const topicsByDate = topics.reduce((acc, t) => { const k = t.date || "No Date"; if (!acc[k]) acc[k] = []; acc[k].push(t); return acc; }, {});
  const sortedDates  = Object.keys(topicsByDate).sort((a, b) => new Date(a) - new Date(b));

  const handleActualDateChange = (topicId, newDate, plannedDate) => {
    setDateChangeDialog({ open: true, topicId, newDate, plannedDate });
  };

  const confirmDateChange = () => {
    const { topicId, newDate, plannedDate } = dateChangeDialog;
    setActualDatesMap(prev => ({ ...prev, [topicId]: newDate }));
    const crossesPlanned = new Date(newDate) > new Date(plannedDate);
    setDateChangeDialog({ open: false, topicId: null, newDate: null, plannedDate: null });
    if (crossesPlanned) setSaveChangesDialog({ open: true, topicId, newDate, remarks: remarksMap[topicId] || "" });
    else                saveActualDate(topicId, newDate);
  };

  const confirmSaveChanges = async () => {
    const { topicId, newDate, remarks } = saveChangesDialog;
    setSavingTopicId(topicId);
    await saveActualDate(topicId, newDate);
    if (remarks?.trim()) await handleRemarksSave(topicId, remarks);
    setSaveChangesDialog({ open: false, topicId: null, newDate: null, remarks: null });
    setSavingTopicId(null);
  };

  const saveActualDate = async (topicId, actualDate) => {
    try {
      const topic    = topics.find(t => t.id === topicId);
      if (!topic?.date || !actualDate) return;
      const daysDiff = Math.round((new Date(actualDate) - new Date(topic.date)) / (1000 * 60 * 60 * 24));
      const headers  = token ? { Authorization: `Bearer ${token}` } : {};
      const res      = await axios.post(
        `${API_BASE}/api/update-actual-date`,
        { topic_id: topicId, actual_date: actualDate, changed_by: user?.email || user?.name || "Trainer" },
        { headers }
      );
      if (res.data?.success) {
        setTopics(prev => prev.map(t => t.id === topicId ? { ...t, actual_date: actualDate, date_difference: daysDiff } : t));
        if (daysDiff > 2)      showSnackbar(`✅ Date saved! Exceeding by ${daysDiff} days`, "warning");
        else if (daysDiff > 0) showSnackbar(`✅ Date saved! ${daysDiff} day(s) late`, "warning");
        else if (daysDiff < 0) showSnackbar(`✅ Date saved! ${Math.abs(daysDiff)} day(s) early`, "success");
        else                   showSnackbar("✅ Date saved! On time", "success");
      } else throw new Error("Save failed");
    } catch {
      showSnackbar("❌ Failed to save date", "error");
      const topic = topics.find(t => t.id === topicId);
      setActualDatesMap(prev => ({ ...prev, [topicId]: topic?.actual_date || topic?.actualdate || topic?.date || "" }));
    }
  };

  const handlePendingStatusChange = (topicId, value) => {
    setPendingStatusChanges(prev => ({ ...prev, [topicId]: value }));
  };

  const handleStatusConfirm = async (topicId) => {
    const newStatus = pendingStatusChanges[topicId];
    if (!newStatus) { setMessage("No status change to confirm."); return; }
    const topic      = topics.find(t => t.id === topicId);
    const planned    = topic?.date;
    const actual     = actualDatesMap[topicId] || topic?.actual_date || topic?.actualdate || planned;
    let daysDiff = 0;
    if (planned && actual) daysDiff = Math.round((new Date(actual) - new Date(planned)) / (1000 * 60 * 60 * 24));
    if (daysDiff !== 0 && !(remarksMap[topicId] || "").trim()) {
      setBlockedTopics(prev => ({ ...prev, [topicId]: true }));
      showRemarksSnackbar("Without entering remarks, status changes are locked. Please add remarks first.", "warning");
      return;
    }
    await performStatusUpdate(topicId, newStatus);
  };

  const performStatusUpdate = async (topicId, newStatus) => {
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, _pending: true } : t));
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.post(`${API_BASE}/api/update-topic-status`, { topic_id: topicId, status: newStatus }, { headers });
      if (res.data && (res.data.success || res.status === 200)) {
        setTopics(prev => prev.map(t => t.id === topicId ? { ...t, topic_status: newStatus, _pending: false } : t));
        setPendingStatusChanges(prev => { const c = { ...prev }; delete c[topicId]; return c; });
        setMessage("✅ Status updated");
        const nextAll = allBatchTopics.map(t => t.id === topicId ? { ...t, topic_status: newStatus } : t);
        setAllBatchTopics(nextAll);
        const ws = {};
        nextAll.forEach(t => { const w = Number(t.week_no ?? t.weekno); if (!ws[w]) ws[w] = { hasNotCompleted: false }; if ((t.topic_status ?? t.topicstatus) !== "Completed") ws[w].hasNotCompleted = true; });
        const cands = Object.keys(ws).map(Number).filter(w => ws[w].hasNotCompleted);
        setFirstIncompleteWeek(cands.length > 0 ? Math.min(...cands) : null);
      } else throw new Error(res.data?.error || "Update failed");
    } catch {
      setMessage("❌ Error updating status");
      setTopics(prev => prev.map(t => t.id === topicId ? { ...t, _pending: false } : t));
    }
  };

  const handleRemarksSave = async (topicId, value) => {
    const trimmed = (value || "").trim();
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.post(`${API_BASE}/api/update-remarks`, { topic_id: topicId, remarks: trimmed }, { headers });
      if (res.data?.success) {
        setBlockedTopics(prev => { const c = { ...prev }; delete c[topicId]; return c; });
        showSnackbar("✅ Remarks saved", "success");
      }
    } catch { /* silent */ }
  };

  const getDateCellStyle = (daysDiff) => {
    if (daysDiff == null || daysDiff === 0) return { color: grey[700] };
    if (daysDiff > 2)  return { color: red[700],    fontWeight: "bold" };
    if (daysDiff > 0)  return { color: orange[700], fontWeight: "bold" };
    if (daysDiff < 0)  return { color: green[700],  fontWeight: "bold" };
    return { color: grey[700] };
  };

  /* ── RENDER ── */
  return (
    <Box sx={{ fontFamily: "'DM Sans', sans-serif" }}>

      {/* Tabs bar */}
      <Box sx={{ ...cardSx, px: { xs: 2, md: 3 }, pt: 2, pb: 0, mb: 2.5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}
          sx={{ "& .MuiTabs-indicator": { height: 3, borderRadius: "3px 3px 0 0", background: `linear-gradient(90deg, ${T.accent}, ${T.accentDark})` }, "& .MuiTab-root": { fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, color: T.textSub, textTransform: "none", minHeight: 46, px: 2.5 }, "& .Mui-selected": { color: `${T.accent} !important`, fontWeight: "800 !important" } }}>
          <Tab label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.7 }}><span>📊</span><span>Progress</span></Box>} />
          <Tab label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.7 }}><span>{isTrainer ? "📅" : "👥"}</span><span>{trainerTabLabel}</span></Box>} />
        </Tabs>
      </Box>

      {/* Date change confirmation dialog */}
      <Dialog open={dateChangeDialog.open} onClose={() => setDateChangeDialog({ ...dateChangeDialog, open: false })} sx={dialogSx}>
        <DialogTitle sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, color: T.text, fontSize: 17, pb: 1 }}>Confirm Date Change</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.textSub }}>
            Change actual date from{" "}
            <Box component="strong" sx={{ color: T.text }}>{topics.find(t => t.id === dateChangeDialog.topicId)?.actual_date || "N/A"}</Box>{" "}
            to <Box component="strong" sx={{ color: T.text }}>{dateChangeDialog.newDate}</Box>?
          </DialogContentText>
          {(() => {
            const diff = Math.round((new Date(dateChangeDialog.newDate) - new Date(dateChangeDialog.plannedDate)) / (1000 * 60 * 60 * 24));
            return diff > 0 ? (
              <Box sx={{ mt: 1.5, p: 1.5, borderRadius: "10px", background: "#fef3c7", border: "1px solid #fcd34d" }}>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#b45309", fontWeight: 600 }}>
                  ⚠️ This date is <strong>{diff} day(s)</strong> after the planned date. Remarks will be required.
                </Typography>
              </Box>
            ) : null;
          })()}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setDateChangeDialog({ ...dateChangeDialog, open: false })} sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, textTransform: "none", borderRadius: "8px", color: T.textSub, border: `1px solid ${T.border}` }}>Cancel</Button>
          <Button onClick={confirmDateChange} variant="contained" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, textTransform: "none", borderRadius: "8px", background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`, boxShadow: `0 3px 10px ${T.accent}44` }}>Confirm</Button>
        </DialogActions>
      </Dialog>

      {/* Save changes dialog */}
      <Dialog open={saveChangesDialog.open} onClose={() => setSaveChangesDialog({ ...saveChangesDialog, open: false })} sx={dialogSx}>
        <DialogTitle sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, color: T.text, fontSize: 17, pb: 1 }}>Save Changes</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.textSub }}>
            Date changed to <Box component="strong" sx={{ color: T.text }}>{saveChangesDialog.newDate}</Box> (after planned date).
          </DialogContentText>
          <Box sx={{ mt: 1.5, mb: 2, p: 1.5, borderRadius: "10px", background: "#fef3c7", border: "1px solid #fcd34d" }}>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#b45309", fontWeight: 600 }}>
              📝 Remarks are <strong>MANDATORY</strong> when actual date is after planned date.
            </Typography>
          </Box>
          <TextField autoFocus margin="dense" label="Remarks *" type="text" fullWidth variant="outlined"
            value={saveChangesDialog.remarks || ""}
            onChange={e => setSaveChangesDialog({ ...saveChangesDialog, remarks: e.target.value })}
            sx={{ mt: 1, ...fieldSx }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setSaveChangesDialog({ ...saveChangesDialog, open: false })} sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, textTransform: "none", borderRadius: "8px", color: T.textSub, border: `1px solid ${T.border}` }}>Cancel</Button>
          <Button onClick={confirmSaveChanges} variant="contained"
            disabled={!saveChangesDialog.remarks?.trim() || savingTopicId === saveChangesDialog.topicId}
            sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, textTransform: "none", borderRadius: "8px", background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`, boxShadow: `0 3px 10px ${T.accent}44`, "&.Mui-disabled": { background: T.border, color: T.textSub, boxShadow: "none" } }}>
            {savingTopicId === saveChangesDialog.topicId ? <CircularProgress size={18} color="inherit" /> : "Save Both"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── PROGRESS TAB ── */}
      {tab === 0 && (
        <Box sx={{ ...cardSx, p: { xs: 2, md: 3 } }}>

          {/* Welcome strip */}
          <Box sx={{ mb: 3, p: 2.5, borderRadius: "12px", background: `linear-gradient(135deg, ${T.accent}14 0%, ${T.accentLight} 100%)`, border: `1px solid ${T.accent}33`, display: "flex", alignItems: "center", gap: 2 }}>
            <Box>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 17, color: T.text, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{roleTitle} Dashboard</Typography>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.textSub, mt: 0.3 }}>
                Welcome, <Box component="span" sx={{ color: T.accent, fontWeight: 700 }}>{welcomeName}</Box>
              </Typography>
            </Box>
          </Box>

          {/* Batch + Week selectors */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={5}>
              <Typography sx={{ ...labelSx, mb: 0.8 }}>Batch</Typography>
              <FormControl fullWidth size="small">
                <Select
                  value={selectedBatch}
                  onChange={e => setSelectedBatch(e.target.value)}
                  displayEmpty
                  disabled={loadingBatches}
                  sx={{ borderRadius: "10px", fontFamily: "'DM Sans', sans-serif", fontSize: 13, background: T.surfaceAlt, "& fieldset": { borderColor: T.border }, "&:hover fieldset": { borderColor: T.accent }, "&.Mui-focused fieldset": { borderColor: T.accent } }}
                  MenuProps={{ PaperProps: { sx: { maxHeight: 300, borderRadius: "12px" } } }}
                >
                  <MenuItem value="" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.textSub }}>
                    <em>{loadingBatches ? "Loading batches…" : "Select a batch…"}</em>
                  </MenuItem>
                  {batches.map((b, i) => {
                    const bn = b.batch_no || b.batchno;
                    const sd = b.start_date || b.startdate;
                    return (
                      <MenuItem key={`${bn}-${i}`} value={bn} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                        {bn}{sd ? ` (${sd})` : ""}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
              {!loadingBatches && batches.length > 0 && (
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: T.textSub, mt: 0.3 }}>
                  {batches.length} batch{batches.length !== 1 ? "es" : ""} available
                </Typography>
              )}
            </Grid>

            {weeks.length > 0 && (
              <Grid item xs={12} sm={6} md={3}>
                <Typography sx={{ ...labelSx, mb: 0.8 }}>Week</Typography>
                <FormControl fullWidth size="small">
                  <Select value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)}
                    sx={{ borderRadius: "10px", fontFamily: "'DM Sans', sans-serif", fontSize: 13, background: T.surfaceAlt, "& fieldset": { borderColor: T.border }, "&:hover fieldset": { borderColor: T.accent }, "&.Mui-focused fieldset": { borderColor: T.accent } }}
                    MenuProps={{ PaperProps: { sx: { maxHeight: 250, borderRadius: "12px" } } }}>
                    {weeks.map(w => <MenuItem key={w} value={w} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Week {w}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}
          </Grid>

          {/* Empty state */}
          {Object.keys(topicsByDate).length === 0 && (
            <Box sx={{ py: 6, textAlign: "center" }}>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.textSub }}>
                {selectedBatch ? "No topics to display." : "Select a batch to view topics."}
              </Typography>
            </Box>
          )}

          {/* Topics grouped by date */}
          {sortedDates.map(dateKey => {
            const dateTopics   = topicsByDate[dateKey] || [];
            const weekForBlock = dateTopics[0]?.week_no ?? dateTopics[0]?.weekno ?? selectedWeek;
            const weekEditable = canEditWeek(weekForBlock);

            return (
              <Box key={dateKey} sx={{ mb: 3, border: `1px solid ${T.border}`, borderRadius: "14px", overflow: "hidden" }}>
                <Box sx={{ px: 2.5, py: 1.5, background: `linear-gradient(135deg, ${T.accent}14, ${T.accentLight})`, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Box sx={{ width: 4, height: 20, borderRadius: "2px", background: T.accent, flexShrink: 0 }} />
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 14, color: T.text, letterSpacing: "-0.01em" }}>{dateKey}</Typography>
                  <Chip label={`${dateTopics.length} topic${dateTopics.length !== 1 ? "s" : ""}`} size="small" sx={{ ml: "auto", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 10, height: 20, background: T.accent, color: "#fff" }} />
                </Box>

                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {["Topic", "Planned Date", "Actual Date", "Difference", "Status", "Action", "Remarks"].map(h => (
                          <TableCell key={h} align={h === "Topic" ? "left" : "center"}
                            sx={{ ...labelSx, background: T.surfaceAlt, borderBottom: `2px solid ${T.border}`, py: 1.2, whiteSpace: "nowrap" }}>
                            {h}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {dateTopics.map(t => {
                        const daysDiff        = t.date_difference ?? t.datedifference ?? 0;
                        const confirmedStatus = t.topic_status ?? t.topicstatus;
                        const currentStatus   = getStatusForTopic(t.id, confirmedStatus);
                        const frozen          = isActionFrozen(t);
                        const blocked         = isBlocked(t.id);
                        const editable        = weekEditable && !frozen && !blocked;
                        const sc              = STATUS_COLORS[confirmedStatus] || { bg: grey[100], text: grey[700], border: grey[300] };

                        return (
                          <TableRow key={t.id} sx={{ "&:nth-of-type(even)": { background: T.surfaceAlt }, "&:hover": { background: T.accentLight, transition: "background 0.15s" } }}>
                            <TableCell sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13, color: T.accent, minWidth: 160 }}>
                              {t.topic_name || t.topicname || `Topic ${t.id}`}
                            </TableCell>
                            <TableCell align="center" sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: T.textSub, whiteSpace: "nowrap" }}>{t.date}</TableCell>
                            <TableCell align="center">
                              <TextField type="date" size="small"
                                value={actualDatesMap[t.id] || ""}
                                onChange={e => handleActualDateChange(t.id, e.target.value, t.date)}
                                InputProps={{ style: { ...getDateCellStyle(daysDiff), fontFamily: "'DM Mono', monospace", fontSize: 12 } }}
                                sx={{ maxWidth: 148, "& .MuiOutlinedInput-root": { borderRadius: "8px", background: T.surfaceAlt, "& fieldset": { borderColor: T.border }, "&:hover fieldset": { borderColor: T.accent }, "&.Mui-focused fieldset": { borderColor: T.accent } } }}
                                helperText={daysDiff !== 0 ? (daysDiff > 0 ? `Delayed ${daysDiff}d` : `Early ${Math.abs(daysDiff)}d`) : "On time"}
                                FormHelperTextProps={{ sx: { fontFamily: "'DM Sans', sans-serif", fontStyle: "italic", fontSize: 10, color: grey[500], mt: 0.3 } }}
                                disabled={!editable}
                              />
                            </TableCell>
                            <TableCell align="center">
                              {daysDiff !== 0 ? (
                                <Chip label={daysDiff > 0 ? `+${daysDiff}d` : `${daysDiff}d`} size="small"
                                  sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, bgcolor: daysDiff > 2 ? "#fee2e2" : daysDiff > 0 ? "#fef3c7" : "#dcfce7", color: daysDiff > 2 ? "#b91c1c" : daysDiff > 0 ? "#b45309" : "#15803d", border: `1px solid ${daysDiff > 2 ? "#fca5a5" : daysDiff > 0 ? "#fcd34d" : "#86efac"}` }} />
                              ) : (
                                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, color: "#15803d" }}>On time</Typography>
                              )}
                            </TableCell>
                            <TableCell align="center">
                              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1.2, py: 0.3, borderRadius: "20px", background: sc.bg, border: `1px solid ${sc.border}` }}>
                                <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: sc.text }} />
                                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, color: sc.text }}>{confirmedStatus}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell align="center" sx={{ opacity: editable ? 1 : 0.5, pointerEvents: editable ? "auto" : "none" }}>
                              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 0.5 }}>
                                <Tooltip title={!weekEditable ? "Complete current week before editing" : frozen ? "Completed topics cannot be changed" : blocked ? "Add remarks to unlock actions" : "Change Status"}>
                                  <span>
                                    <FormControl size="small">
                                      <Select value={currentStatus} disabled={!editable || !!t._pending}
                                        onChange={e => handlePendingStatusChange(t.id, e.target.value)}
                                        sx={{ borderRadius: "8px", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, minWidth: 132, background: editable ? T.accentLight : T.surfaceAlt, color: editable ? T.accent : T.textSub, "& fieldset": { borderColor: T.border }, "&:hover fieldset": { borderColor: T.accent } }}
                                        MenuProps={{ PaperProps: { sx: { borderRadius: "12px" } } }}>
                                        <MenuItem value="Planned"     sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12 }}>Planned</MenuItem>
                                        <MenuItem value="In Progress" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12 }}>In Progress</MenuItem>
                                        <MenuItem value="Completed"   sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12 }}>Completed</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </span>
                                </Tooltip>
                                {pendingStatusChanges[t.id] && pendingStatusChanges[t.id] !== confirmedStatus && !t._pending && (
                                  <Tooltip title="Confirm Status Change">
                                    <IconButton size="small" onClick={() => handleStatusConfirm(t.id)} disabled={t._pending}
                                      sx={{ color: T.accent, background: T.accentLight, borderRadius: "8px", "&:hover": { background: T.accent, color: "#fff" }, transition: "all 0.2s" }}>
                                      <CheckIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Box>
                            </TableCell>
                            <TableCell align="center">
                              <TextField size="small"
                                value={remarksMap[t.id] || ""}
                                onChange={e => setRemarksMap(prev => ({ ...prev, [t.id]: e.target.value }))}
                                onBlur={() => handleRemarksSave(t.id, remarksMap[t.id])}
                                placeholder="Add remarks…" variant="outlined"
                                sx={{ "& .MuiOutlinedInput-root": { borderRadius: "8px", fontFamily: "'DM Sans', sans-serif", fontSize: 12, background: T.surfaceAlt, "& fieldset": { borderColor: T.border }, "&:hover fieldset": { borderColor: T.accent }, "&.Mui-focused fieldset": { borderColor: T.accent } } }}
                                inputProps={{ style: { fontSize: 12, fontFamily: "'DM Sans', sans-serif" } }}
                                disabled={!weekEditable || frozen}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            );
          })}

          {message && (
            <Fade in={!!message}>
              <Box mt={1}>
                <Alert severity={message.startsWith("✅") ? "success" : message.startsWith("❌") ? "error" : "warning"} sx={{ borderRadius: "10px", fontFamily: "'DM Sans', sans-serif" }}>
                  {message}
                </Alert>
              </Box>
            </Fade>
          )}
        </Box>
      )}

      {/* ── LEAVE / MANAGEMENT TAB ── */}
      {tab === 1 && (
        <Box>
          {isTrainer        && <TrainerUnavailabilityForm user={user} token={token} />}
          {isManagerOrAdmin && isBatchOwner  && <TrainerAssignmentDashboard user={user} token={token} batchNo={selectedBatch} />}
          {isManagerOrAdmin && !isBatchOwner && <ManagerLeaveDashboard user={user} token={token} />}
          {!isTrainer && !isManagerOrAdmin && (
            <Alert severity="warning" sx={{ borderRadius: "10px", fontFamily: "'DM Sans', sans-serif" }}>
              Trainer Management is only available to trainers, managers, or admins.
            </Alert>
          )}
        </Box>
      )}

      {/* Snackbars */}
      <Snackbar open={remarksSnackbarOpen} autoHideDuration={6000} onClose={() => setRemarksSnackbarOpen(false)} anchorOrigin={{ vertical: "top", horizontal: "center" }}>
        <Alert onClose={() => setRemarksSnackbarOpen(false)} severity={remarksSnackbarSeverity} sx={{ width: "100%", fontFamily: "'DM Sans', sans-serif", borderRadius: "10px", fontWeight: 600 }}>{remarksSnackbarMessage}</Alert>
      </Snackbar>
      <Snackbar open={snackbarOpen} autoHideDuration={6000} onClose={() => setSnackbarOpen(false)} anchorOrigin={{ vertical: "top", horizontal: "center" }}>
        <Alert onClose={() => setSnackbarOpen(false)} severity={snackbarSeverity} sx={{ width: "100%", fontFamily: "'DM Sans', sans-serif", borderRadius: "10px", fontWeight: 600 }}>{snackbarMessage}</Alert>
      </Snackbar>
    </Box>
  );
}

export default TrainerDashboard;