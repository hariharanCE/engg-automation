import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  Box,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
  Alert,
  TableContainer,
  TextField,
  Chip,
  IconButton,
  Tooltip,
  Button,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  Paper,
  Skeleton,
  Grid,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";

const API_BASE =
  process.env.REACT_APP_API_URL || "http://192.168.1.2:5000/";

/* ─── Design tokens ──────────────────────────────────────────────────────── */
const T = {
  surface: "#ffffff",
  surfaceAlt: "#eef3ff",
  border: "#c3d3f8",
  accent: "#2563eb",
  accentDark: "#1d4ed8",
  accentLight: "#dbeafe",
  text: "#1e2d5a",
  textSub: "#5b6f9c",
  danger: "#dc2626",
};

const cardSx = {
  background: T.surface,
  borderRadius: "16px",
  border: `1px solid ${T.border}`,
  boxShadow: "0 2px 16px rgba(37,99,235,0.08)",
  overflow: "hidden",
};

const labelSx = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: T.textSub,
};

const fieldSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: "10px",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
    background: T.surfaceAlt,
    "& fieldset": { borderColor: T.border },
    "&:hover fieldset": { borderColor: T.accent },
    "&.Mui-focused fieldset": { borderColor: T.accent },
  },
  "& .MuiInputLabel-root": {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
  },
};

const dialogSx = {
  "& .MuiDialog-paper": {
    borderRadius: "18px",
    fontFamily: "'DM Sans', sans-serif",
    boxShadow: "0 12px 48px rgba(37,99,235,0.18)",
    border: `1px solid ${T.border}`,
  },
};

const LEAVE_STATUS_COLORS = {
  pending: {
    bg: "#fef3c7",
    text: "#b45309",
    border: "#fcd34d",
    label: "Pending",
  },
  assigned: {
    bg: "#dcfce7",
    text: "#15803d",
    border: "#86efac",
    label: "Assigned",
  },
  approved: {
    bg: "#dbeafe",
    text: "#1d4ed8",
    border: "#93c5fd",
    label: "Approved",
  },
  rejected: {
    bg: "#fee2e2",
    text: "#b91c1c",
    border: "#fca5a5",
    label: "Rejected",
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   LeaveApply  — Apply Leave + Leave History (for all roles)
══════════════════════════════════════════════════════════════════════════ */
function LeaveApply({ user, token }) {
  /* ── Form state ── */
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* ── Leave history state ── */
  const [leaveHistory, setLeaveHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  /* ── Edit dialog state ── */
  const [editDialog, setEditDialog] = useState({
    open: false,
    leaveId: null,
    start: "",
    end: "",
    reason: "",
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editErr, setEditErr] = useState("");

  /* ── Delete confirm dialog ── */
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    leaveId: null,
  });
  const [deleteLoading, setDeleteLoading] = useState(false);

  /* ── Section toggle ── */
  const [showForm, setShowForm] = useState(true);

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  /* ── Today (local) as YYYY-MM-DD — used to block past-dated leave ── */
  const todayStr = (() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  /* ─── Fetch leave history for this user ─── */
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
      // Filter only this user's records
      const mine = all.filter(
        (r) =>
          (r.trainer_email || "").toLowerCase().trim() ===
          (user.email || "").toLowerCase().trim()
      );
      // Sort newest first
      mine.sort(
        (a, b) =>
          new Date(b.submitted_at || b.created_at || 0) -
          new Date(a.submitted_at || a.created_at || 0)
      );
      setLeaveHistory(mine);
    } catch (e) {
      console.error("Error loading leave history:", e);
      setHistoryError("Failed to load leave history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [user?.email, token]); // eslint-disable-line

  useEffect(() => {
    fetchLeaveHistory();
  }, [fetchLeaveHistory]);

  /* ─── Submit new leave ─── */
  const submitLeave = async () => {
    setMsg("");
    setErr("");
    setSubmitting(true);

    if (!start || !end) {
      setErr("Please select From and To dates");
      setSubmitting(false);
      return;
    }
    if (new Date(start) > new Date(end)) {
      setErr("End date must be after start date");
      setSubmitting(false);
      return;
    }
    if (start < todayStr) {
      setErr("Cannot apply leave for past dates");
      setSubmitting(false);
      return;
    }

    if (!user?.email) {
      setErr("User session is missing. Please re-login.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await axios.post(
        `${API_BASE}/api/trainer-leaves`,
        {
          trainer_email: user.email,
          trainer_name: user.name || user.email.split("@")[0],
          domain: user.domain || "",
          start_date: start,
          end_date: end,
          reason: reason || "",
          batch_nos: "",
        },
        { headers: authHeaders, timeout: 15000 }
      );

      if (response.data?.success) {
        setMsg("✅ Leave request submitted successfully!");
        setStart("");
        setEnd("");
        setReason("");
        fetchLeaveHistory();
      } else {
        setErr(
          `Server response: ${response.data?.error || response.data?.message || "Unknown error"}`
        );
      }
    } catch (e) {
      console.error("🚨 Submit failed:", e.response?.data || e);
      const serverMsg = e.response?.data?.error || e.response?.data?.message;
      if (e.response?.status === 404)
        setErr("🚫 API endpoint not found.");
      else if (e.response?.status === 400)
        setErr(`Validation error: ${serverMsg || "Check your input"}`);
      else if (e.code === "ECONNABORTED")
        setErr("⏰ Request timeout. Please try again.");
      else if (e.response?.status === 500)
        setErr(`Server error: ${serverMsg || "Please contact admin"}`);
      else
        setErr(`Failed: ${serverMsg || e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── Open edit dialog ─── */
  const openEdit = (leave) => {
    setEditErr("");
    setEditDialog({
      open: true,
      leaveId: leave.id,
      start: leave.start_date || "",
      end: leave.end_date || "",
      reason: leave.reason || "",
    });
  };

  /* ─── Submit edit ─── */
  const submitEdit = async () => {
    setEditErr("");
    setEditSubmitting(true);
    if (!editDialog.start || !editDialog.end) {
      setEditErr("Please select both dates");
      setEditSubmitting(false);
      return;
    }
    if (new Date(editDialog.start) > new Date(editDialog.end)) {
      setEditErr("End date must be after start date");
      setEditSubmitting(false);
      return;
    }
    try {
      const res = await axios.put(
        `${API_BASE}/api/trainer-leaves/${editDialog.leaveId}`,
        {
          start_date: editDialog.start,
          end_date: editDialog.end,
          reason: editDialog.reason,
        },
        { headers: authHeaders, timeout: 10000 }
      );
      if (res.data?.success) {
        setEditDialog({
          open: false,
          leaveId: null,
          start: "",
          end: "",
          reason: "",
        });
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

  /* ─── Delete / cancel leave ─── */
  const confirmDelete = async () => {
    setDeleteLoading(true);
    try {
      await axios.delete(
        `${API_BASE}/api/trainer-leaves/${deleteDialog.leaveId}`,
        { headers: authHeaders, timeout: 10000 }
      );
      setDeleteDialog({ open: false, leaveId: null });
      fetchLeaveHistory();
    } catch (e) {
      console.error("Delete leave error:", e);
    } finally {
      setDeleteLoading(false);
    }
  };

  /* ─── Helpers ─── */
  const fmtDate = (d) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return d;
    }
  };

  const getLeaveStatusChip = (status) => {
    const key = (status || "pending").toLowerCase();
    const s = LEAVE_STATUS_COLORS[key] || LEAVE_STATUS_COLORS.pending;
    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          px: 1.2,
          py: 0.3,
          borderRadius: "20px",
          background: s.bg,
          border: `1px solid ${s.border}`,
        }}
      >
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: s.text,
            flexShrink: 0,
          }}
        />
        <Typography
          sx={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            color: s.text,
          }}
        >
          {s.label}
        </Typography>
      </Box>
    );
  };

  /* ══ RENDER ══════════════════════════════════════════════════════════════ */
  return (
    <Box>
      {/* ── Apply Leave Card ─────────────────────────────────────────── */}
      <Box sx={{ ...cardSx, mb: 2.5 }}>
        {/* Collapsible header */}
        <Box
          onClick={() => setShowForm((v) => !v)}
          sx={{
            px: 3,
            py: 2,
            cursor: "pointer",
            background: `linear-gradient(135deg, ${T.accent}12 0%, ${T.accentLight} 100%)`,
            borderBottom: showForm ? `1px solid ${T.border}` : "none",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            transition: "background 0.2s",
            "&:hover": {
              background: `linear-gradient(135deg, ${T.accent}22 0%, ${T.accentLight} 100%)`,
            },
          }}
        >
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: "11px",
              background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 3px 10px ${T.accent}33`,
              flexShrink: 0,
            }}
          >
            <AddCircleOutlineIcon sx={{ color: "#fff", fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography
              sx={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 800,
                fontSize: 16,
                color: T.text,
                letterSpacing: "-0.02em",
              }}
            >
              Notify Leave
            </Typography>
            <Typography
              sx={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                color: T.textSub,
              }}
            >
              Submit a new leave request
            </Typography>
          </Box>
          <Box
            sx={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 18,
              color: T.textSub,
              transition: "transform 0.2s",
              transform: showForm ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ▾
          </Box>
        </Box>

        {showForm && (
          <Box sx={{ p: 3 }}>
            {/* Date range */}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="From Date *"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: todayStr }}
                  disabled={submitting}
                  required
                  error={!start || (start && start < todayStr)}
                  helperText={
                    !start
                      ? "Required"
                      : start < todayStr
                      ? "Cannot apply leave for past dates"
                      : ""
                  }
                  sx={fieldSx}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="To Date *"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: start || todayStr }}
                  disabled={submitting}
                  required
                  error={
                    !end ||
                    (start && new Date(start) > new Date(end)) ||
                    end < todayStr
                  }
                  helperText={
                    !end
                      ? "Required"
                      : start && new Date(start) > new Date(end)
                      ? "End date must be after start date"
                      : end < todayStr
                      ? "Cannot apply leave for past dates"
                      : ""
                  }
                  sx={fieldSx}
                />
              </Grid>
            </Grid>

            {/* Duration preview */}
            {start && end && new Date(start) <= new Date(end) && (
              <Box
                sx={{
                  mb: 2,
                  px: 2,
                  py: 1,
                  borderRadius: "10px",
                  background: T.accentLight,
                  border: `1px solid ${T.accent}44`,
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Typography
                  sx={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 13,
                    color: T.accent,
                    fontWeight: 600,
                  }}
                >
                  📅 Duration:{" "}
                  <strong>
                    {Math.round(
                      (new Date(end) - new Date(start)) /
                        (1000 * 60 * 60 * 24)
                    ) + 1}{" "}
                    day(s)
                  </strong>
                </Typography>
              </Box>
            )}

            {/* Reason */}
            <TextField
              label="Reason (Optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              fullWidth
              multiline
              rows={3}
              disabled={submitting}
              placeholder="Provide a reason for your leave request…"
              sx={{ mb: 2.5, ...fieldSx }}
            />

            {/* Submit */}
            <Button
              onClick={submitLeave}
              variant="contained"
              disabled={submitting || !start || !end}
              startIcon={
                submitting ? (
                  <CircularProgress size={18} color="inherit" />
                ) : null
              }
              fullWidth
              sx={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 700,
                fontSize: 14,
                borderRadius: "10px",
                py: 1.4,
                textTransform: "none",
                background: `linear-gradient(135deg, ${T.accent} 0%, ${T.accentDark} 100%)`,
                boxShadow: `0 4px 14px ${T.accent}44`,
                "&:hover": {
                  background: `linear-gradient(135deg, ${T.accentDark} 0%, ${T.accent} 100%)`,
                },
                "&.Mui-disabled": {
                  background: T.border,
                  color: T.textSub,
                  boxShadow: "none",
                },
              }}
            >
              {submitting ? "Submitting…" : "Submit Leave Request"}
            </Button>

            {msg && (
              <Alert
                severity="success"
                sx={{
                  mt: 2,
                  borderRadius: "10px",
                  fontFamily: "'DM Sans', sans-serif",
                }}
                onClose={() => setMsg("")}
              >
                {msg}
              </Alert>
            )}
            {err && (
              <Alert
                severity="error"
                sx={{
                  mt: 2,
                  borderRadius: "10px",
                  fontFamily: "'DM Sans', sans-serif",
                }}
                onClose={() => setErr("")}
              >
                {err}
              </Alert>
            )}
          </Box>
        )}
      </Box>

      {/* ── Leave History Card ────────────────────────────────────────── */}
      <Box sx={{ ...cardSx }}>
        {/* Header */}
        <Box
          sx={{
            px: 3,
            py: 2,
            background:
              "linear-gradient(135deg, #7c3aed12 0%, #ede9fe 100%)",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: "11px",
              background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 3px 10px #7c3aed33",
              flexShrink: 0,
            }}
          >
            <CalendarMonthIcon sx={{ color: "#fff", fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography
              sx={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 800,
                fontSize: 16,
                color: T.text,
                letterSpacing: "-0.02em",
              }}
            >
              My Leave History
              {leaveHistory.length > 0 && (
                <Box
                  component="span"
                  sx={{
                    ml: 1.2,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: T.accent,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 800,
                    verticalAlign: "middle",
                  }}
                >
                  {leaveHistory.length}
                </Box>
              )}
            </Typography>
            <Typography
              sx={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                color: T.textSub,
              }}
            >
              All your submitted leave requests
            </Typography>
          </Box>
          <Tooltip title="Refresh">
            <IconButton
              size="small"
              onClick={fetchLeaveHistory}
              disabled={historyLoading}
              sx={{
                color: T.accent,
                background: T.accentLight,
                borderRadius: "8px",
                "&:hover": { background: T.accent, color: "#fff" },
              }}
            >
              <Typography sx={{ fontSize: 16, lineHeight: 1 }}>↻</Typography>
            </IconButton>
          </Tooltip>
        </Box>

        {/* Body */}
        <Box sx={{ p: 2 }}>
          {/* Loading skeletons */}
          {historyLoading && (
            <Box sx={{ px: 1 }}>
              {[1, 2, 3].map((i) => (
                <Box
                  key={i}
                  sx={{
                    display: "flex",
                    gap: 2,
                    mb: 1.5,
                    alignItems: "center",
                  }}
                >
                  <Skeleton
                    variant="rounded"
                    width={90}
                    height={36}
                    sx={{ borderRadius: "8px" }}
                  />
                  <Skeleton
                    variant="rounded"
                    width={90}
                    height={36}
                    sx={{ borderRadius: "8px" }}
                  />
                  <Skeleton
                    variant="rounded"
                    width={60}
                    height={24}
                    sx={{ borderRadius: "20px" }}
                  />
                  <Skeleton
                    variant="rounded"
                    width={120}
                    height={36}
                    sx={{ borderRadius: "8px" }}
                  />
                  <Skeleton
                    variant="rounded"
                    width={70}
                    height={24}
                    sx={{ borderRadius: "20px" }}
                  />
                  <Skeleton
                    variant="rounded"
                    width={60}
                    height={30}
                    sx={{ borderRadius: "8px", ml: "auto" }}
                  />
                </Box>
              ))}
            </Box>
          )}

          {!historyLoading && historyError && (
            <Alert
              severity="error"
              sx={{
                borderRadius: "10px",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {historyError}
            </Alert>
          )}

          {!historyLoading && !historyError && leaveHistory.length === 0 && (
            <Box sx={{ py: 5, textAlign: "center" }}>
              <EventBusyIcon
                sx={{ fontSize: 44, color: T.border, mb: 1 }}
              />
              <Typography
                sx={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14,
                  color: T.textSub,
                }}
              >
                No leave requests found.
              </Typography>
              <Typography
                sx={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12,
                  color: T.border,
                }}
              >
                Submit a leave request above to see it here.
              </Typography>
            </Box>
          )}

          {!historyLoading && leaveHistory.length > 0 && (
            <TableContainer
              component={Paper}
              elevation={0}
              sx={{
                borderRadius: "12px",
                border: `1px solid ${T.border}`,
                overflow: "hidden",
              }}
            >
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ background: T.surfaceAlt }}>
                    {[
                      "From",
                      "To",
                      "Duration",
                      "Reason",
                      "Status",
                      "Actions",
                    ].map((h) => (
                      <TableCell
                        key={h}
                        sx={{
                          ...labelSx,
                          py: 1.3,
                          borderBottom: `2px solid ${T.border}`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {leaveHistory.map((leave) => {
                    const canEdit = !["assigned", "approved"].includes(
                      (leave.status || "").toLowerCase()
                    );
                    const s = leave.start_date;
                    const e2 = leave.end_date;
                    let durationDays = null;
                    try {
                      durationDays =
                        Math.round(
                          (new Date(e2) - new Date(s)) /
                            (1000 * 60 * 60 * 24)
                        ) + 1;
                    } catch {
                      /* */
                    }
                    return (
                      <TableRow
                        key={leave.id}
                        sx={{
                          "&:nth-of-type(even)": {
                            background: T.surfaceAlt,
                          },
                          "&:hover": {
                            background: T.accentLight,
                            transition: "background 0.15s",
                          },
                        }}
                      >
                        {/* From */}
                        <TableCell
                          sx={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 12,
                            color: T.textSub,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtDate(s)}
                        </TableCell>
                        {/* To */}
                        <TableCell
                          sx={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 12,
                            color: T.textSub,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtDate(e2)}
                        </TableCell>
                        {/* Duration */}
                        <TableCell>
                          {durationDays != null && (
                            <Chip
                              label={`${durationDays}d`}
                              size="small"
                              sx={{
                                fontFamily: "'DM Sans', sans-serif",
                                fontWeight: 700,
                                fontSize: 11,
                                height: 22,
                                background: T.accentLight,
                                color: T.accent,
                                border: `1px solid ${T.accent}44`,
                              }}
                            />
                          )}
                        </TableCell>
                        {/* Reason */}
                        <TableCell sx={{ maxWidth: 200 }}>
                          <Tooltip
                            title={leave.reason || "No reason provided"}
                          >
                            <Typography
                              sx={{
                                fontFamily: "'DM Sans', sans-serif",
                                fontSize: 12,
                                color: T.textSub,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 190,
                              }}
                            >
                              {leave.reason || (
                                <em style={{ color: T.border }}>—</em>
                              )}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                        {/* Status */}
                        <TableCell>
                          {getLeaveStatusChip(leave.status)}
                        </TableCell>
                        {/* Actions */}
                        <TableCell>
                          <Box sx={{ display: "flex", gap: 0.5 }}>
                            <Tooltip
                              title={
                                canEdit
                                  ? "Edit leave dates"
                                  : "Cannot edit — already processed"
                              }
                            >
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={!canEdit}
                                  onClick={() => openEdit(leave)}
                                  sx={{
                                    color: T.accent,
                                    background: T.accentLight,
                                    borderRadius: "7px",
                                    p: 0.6,
                                    "&:hover": {
                                      background: T.accent,
                                      color: "#fff",
                                    },
                                    "&.Mui-disabled": { opacity: 0.35 },
                                    transition: "all 0.18s",
                                  }}
                                >
                                  <EditIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip
                              title={
                                canEdit
                                  ? "Cancel / delete this leave"
                                  : "Cannot delete — already processed"
                              }
                            >
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={!canEdit}
                                  onClick={() =>
                                    setDeleteDialog({
                                      open: true,
                                      leaveId: leave.id,
                                    })
                                  }
                                  sx={{
                                    color: T.danger,
                                    background: "#fee2e2",
                                    borderRadius: "7px",
                                    p: 0.6,
                                    "&:hover": {
                                      background: T.danger,
                                      color: "#fff",
                                    },
                                    "&.Mui-disabled": { opacity: 0.35 },
                                    transition: "all 0.18s",
                                  }}
                                >
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

      {/* ── Edit Leave Dialog ──────────────────────────────────────────── */}
      <Dialog
        open={editDialog.open}
        onClose={() => setEditDialog({ ...editDialog, open: false })}
        maxWidth="xs"
        fullWidth
        sx={dialogSx}
      >
        <DialogTitle
          sx={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 800,
            color: T.text,
            fontSize: 17,
            pb: 1,
          }}
        >
          Edit Leave Request
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label="From Date *"
                  type="date"
                  value={editDialog.start}
                  onChange={(e) =>
                    setEditDialog({ ...editDialog, start: e.target.value })
                  }
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  disabled={editSubmitting}
                  required
                  sx={fieldSx}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="To Date *"
                  type="date"
                  value={editDialog.end}
                  onChange={(e) =>
                    setEditDialog({ ...editDialog, end: e.target.value })
                  }
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  disabled={editSubmitting}
                  required
                  error={
                    editDialog.start &&
                    editDialog.end &&
                    new Date(editDialog.start) > new Date(editDialog.end)
                  }
                  helperText={
                    editDialog.start &&
                    editDialog.end &&
                    new Date(editDialog.start) > new Date(editDialog.end)
                      ? "End date must be after start date"
                      : ""
                  }
                  sx={fieldSx}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Reason"
                  value={editDialog.reason}
                  onChange={(e) =>
                    setEditDialog({ ...editDialog, reason: e.target.value })
                  }
                  fullWidth
                  multiline
                  rows={3}
                  disabled={editSubmitting}
                  sx={fieldSx}
                />
              </Grid>
            </Grid>
            {editErr && (
              <Alert
                severity="error"
                sx={{
                  mt: 1.5,
                  borderRadius: "10px",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {editErr}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={() =>
              setEditDialog({
                open: false,
                leaveId: null,
                start: "",
                end: "",
                reason: "",
              })
            }
            sx={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 600,
              textTransform: "none",
              borderRadius: "8px",
              color: T.textSub,
              border: `1px solid ${T.border}`,
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={submitEdit}
            variant="contained"
            disabled={
              editSubmitting || !editDialog.start || !editDialog.end
            }
            startIcon={
              editSubmitting ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <EditIcon sx={{ fontSize: 16 }} />
              )
            }
            sx={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              textTransform: "none",
              borderRadius: "8px",
              background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`,
              boxShadow: `0 3px 10px ${T.accent}44`,
              "&.Mui-disabled": {
                background: T.border,
                color: T.textSub,
                boxShadow: "none",
              },
            }}
          >
            {editSubmitting ? "Saving…" : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirm Dialog ─────────────────────────────────────── */}
      <Dialog
        open={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, leaveId: null })}
        maxWidth="xs"
        sx={dialogSx}
      >
        <DialogTitle
          sx={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 800,
            color: T.text,
            fontSize: 17,
          }}
        >
          Cancel Leave Request?
        </DialogTitle>
        <DialogContent>
          <DialogContentText
            sx={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              color: T.textSub,
            }}
          >
            This will permanently delete the leave request. This action
            cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={() => setDeleteDialog({ open: false, leaveId: null })}
            sx={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 600,
              textTransform: "none",
              borderRadius: "8px",
              color: T.textSub,
              border: `1px solid ${T.border}`,
            }}
          >
            Keep
          </Button>
          <Button
            onClick={confirmDelete}
            variant="contained"
            disabled={deleteLoading}
            startIcon={
              deleteLoading ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <DeleteIcon sx={{ fontSize: 16 }} />
              )
            }
            sx={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              textTransform: "none",
              borderRadius: "8px",
              background: `linear-gradient(135deg, ${T.danger}, #b91c1c)`,
              boxShadow: "0 3px 10px #dc262644",
              "&.Mui-disabled": {
                background: T.border,
                color: T.textSub,
              },
            }}
          >
            {deleteLoading ? "Deleting…" : "Yes, Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default LeaveApply;