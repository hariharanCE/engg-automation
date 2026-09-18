// src/components/MarksExtensionReport.js
import React, { useEffect, useState, useCallback } from "react";
import {
  Box,
  Paper,
  Typography,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Chip,
  Alert,
  CircularProgress,
  Button,
  Tooltip,
  Fade,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import axios from "axios";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CancelOutlinedIcon     from "@mui/icons-material/CancelOutlined";
import HourglassEmptyIcon     from "@mui/icons-material/HourglassEmpty";
import AccessTimeIcon         from "@mui/icons-material/AccessTime";
import InfoOutlinedIcon       from "@mui/icons-material/InfoOutlined";
import RefreshIcon            from "@mui/icons-material/Refresh";

const API_BASE =
  process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

const ASSESSMENT_LABELS = {
  "weekly-assessment":       "Weekly Assessment",
  "intermediate-assessment": "Intermediate Assessment",
  "module-level-assessment": "Module Level Assessment",
  "final-assessment":        "Final Assessment",
  "final-project":           "Final Project",
  "viva":                    "Viva",
  "weekly-quiz":             "Weekly Quiz",
};

/* ─── Design tokens ─────────────────────────────────────────────────────── */
const T = {
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
  purple:      { fill: "#7c3aed", light: "#ede9fe", text: "#4c1d95" },
};

const font = "'DM Sans', sans-serif";
const mono = "'DM Mono', monospace";

const cardSx = {
  background:   T.surface,
  border:       `1px solid ${T.border}`,
  borderRadius: "16px",
  boxShadow:    "0 2px 12px rgba(0,0,0,0.06)",
  overflow:     "hidden",
};

const headCellSx = {
  fontFamily:    font,
  fontSize:      11,
  fontWeight:    700,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color:         T.textSub,
  background:    T.surfaceAlt,
  borderBottom:  `2px solid ${T.border}`,
  whiteSpace:    "nowrap",
  py:            1.5,
};

const bodyCellSx = {
  fontFamily:   font,
  fontSize:     13,
  color:        T.text,
  borderBottom: `1px solid ${T.border}`,
};

/* ─── Status chip ────────────────────────────────────────────────────────── */
function StatusChip({ status }) {
  const map = {
    pending:  { label: "Pending",  bg: T.warning.light, border: T.warning.fill, color: T.warning.text, Icon: HourglassEmptyIcon },
    approved: { label: "Approved", bg: T.success.light, border: T.success.fill, color: T.success.text, Icon: CheckCircleOutlineIcon },
    rejected: { label: "Rejected", bg: T.error.light,   border: T.error.fill,   color: T.error.text,   Icon: CancelOutlinedIcon },
  };
  const cfg = map[status] || { label: status, bg: T.surfaceAlt, border: T.border, color: T.textSub, Icon: InfoOutlinedIcon };
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.6, px: 1.4, py: 0.5, borderRadius: "8px", background: cfg.bg, border: `1px solid ${cfg.border}44` }}>
      <cfg.Icon sx={{ fontSize: 13, color: cfg.border }} />
      <Typography sx={{ fontFamily: font, fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</Typography>
    </Box>
  );
}

/* ─── Decision Confirmation Dialog ───────────────────────────────────────── */
function DecisionDialog({ open, onClose, onConfirm, action, request, confirming }) {
  const [rejectReason, setRejectReason] = useState("");
  const isApprove = action === "approve";

  const handleClose   = () => { setRejectReason(""); onClose(); };
  const handleConfirm = () => onConfirm(request, action, isApprove ? null : rejectReason);

  if (!request) return null;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth
      PaperProps={{ sx: { borderRadius: "20px", fontFamily: font, boxShadow: "0 24px 60px rgba(0,0,0,0.15)" } }}
    >
      <DialogTitle sx={{ pt: 3, px: 3, pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ width: 38, height: 38, borderRadius: "12px", background: isApprove ? T.success.light : T.error.light, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isApprove
              ? <CheckCircleOutlineIcon sx={{ fontSize: 20, color: T.success.fill }} />
              : <CancelOutlinedIcon     sx={{ fontSize: 20, color: T.error.fill   }} />
            }
          </Box>
          <Box>
            <Typography sx={{ fontFamily: font, fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: "-0.02em" }}>
              {isApprove ? "Approve Extension?" : "Reject Request?"}
            </Typography>
            <Typography sx={{ fontFamily: font, fontSize: 12, color: T.textSub, mt: 0.2 }}>
              {isApprove
                ? "Window will reopen for 24 hrs — until next day 11:59 PM"
                : "The trainer will not be able to submit marks"}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 2 }}>
        {/* Request summary */}
        <Box sx={{ p: 2, mb: isApprove ? 0 : 2, borderRadius: "10px", background: T.surfaceAlt, border: `1px solid ${T.border}` }}>
          <Typography sx={{ fontFamily: font, fontSize: 11, fontWeight: 700, color: T.textSub, letterSpacing: "0.07em", textTransform: "uppercase", mb: 0.8 }}>Request Summary</Typography>
          <Typography sx={{ fontFamily: font, fontSize: 13, fontWeight: 700, color: T.text }}>
            {request.batch_no} · {ASSESSMENT_LABELS[request.assessment_type] || request.assessment_type}
          </Typography>
          <Typography sx={{ fontFamily: font, fontSize: 12, color: T.textSub, mt: 0.4 }}>{request.trainer_email}</Typography>
          {request.reason && (
            <Typography sx={{ fontFamily: font, fontSize: 12, color: T.text, mt: 1, fontStyle: "italic", lineHeight: 1.6 }}>
              "{request.reason}"
            </Typography>
          )}
        </Box>

        {!isApprove && (
          <TextField
            label="Rejection reason (optional)" multiline rows={2} fullWidth
            value={rejectReason} onChange={e => setRejectReason(e.target.value)}
            placeholder="Briefly explain why the request is rejected…"
            sx={{ "& .MuiInputBase-root": { fontFamily: font, fontSize: 13, borderRadius: "10px" }, "& .MuiInputLabel-root": { fontFamily: font, fontSize: 13 }, "& .MuiOutlinedInput-notchedOutline": { borderColor: T.border } }}
          />
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, gap: 1.5 }}>
        <Button onClick={handleClose} disabled={confirming}
          sx={{ fontFamily: font, fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", color: T.textSub, px: 2.5 }}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleConfirm} disabled={confirming}
          startIcon={confirming
            ? <CircularProgress size={14} color="inherit" />
            : isApprove ? <CheckCircleOutlineIcon sx={{ fontSize: 16 }} /> : <CancelOutlinedIcon sx={{ fontSize: 16 }} />}
          sx={{ fontFamily: font, fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", px: 3, background: isApprove ? T.success.fill : T.error.fill, "&:hover": { background: isApprove ? "#059669" : "#dc2626" }, "&:disabled": { opacity: 0.5 } }}>
          {confirming ? "Processing…" : isApprove ? "Approve" : "Reject"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
export default function MarksExtensionReport({ user, token }) {
  const [batches,       setBatches]       = useState([]);
  const [selectedBatch, setSelectedBatch] = useState("");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [rows,          setRows]          = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [actionMsg,     setActionMsg]     = useState("");

  /* Decision dialog */
  const [decisionDlg, setDecisionDlg] = useState({ open: false, action: null, request: null });
  const [confirming,  setConfirming]  = useState(false);

  /* Role */
  const userRole   = user?.role || "";
  const canDecide  = userRole === "Admin" || userRole === "Manager";
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  /* ── Load batches ── */
  useEffect(() => {
    axios.get(`${API_BASE}/api/batches`, { headers: authHeaders })
      .then(res => { if (Array.isArray(res.data)) setBatches(res.data); })
      .catch(err => console.error("Error loading batches:", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* ── Load requests ── */
  const loadRequests = useCallback(async () => {
    if (!selectedBatch) { setRows([]); return; }
    setLoading(true); setError("");
    try {
      const res = await axios.get(`${API_BASE}/api/marks/extension-requests`, {
        params:          { batch_no: selectedBatch, status: statusFilter === "all" ? undefined : statusFilter },
        headers:         authHeaders,
        withCredentials: true,
      });
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error loading extension requests:", err);
      setError("Error loading extension request data");
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatch, statusFilter, token]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  /* ── Decide (approve / reject) ── */
  const handleDecide = async (request, action, rejectionReason) => {
    setConfirming(true);
    try {
      const res = await axios.post(
        `${API_BASE}/api/marks/decide-extension`,
        {
          id:               request.id,
          action,
          decided_by:       user?.email || user?.name || "Manager",
          rejection_reason: rejectionReason || null,
        },
        { headers: authHeaders, withCredentials: true }
      );
      if (res.status === 200) {
        const verb = action === "approve" ? "approved" : "rejected";
        setActionMsg(`✅ Request ${verb} successfully.${action === "approve" ? " The trainer's window is open for 24 hours." : ""}`);
        setDecisionDlg({ open: false, action: null, request: null });
        await loadRequests();
      }
    } catch (err) {
      console.error("Decision error:", err);
      setActionMsg(`❌ Failed to ${action} request: ${err.response?.data?.error || "Unknown error"}`);
    } finally {
      setConfirming(false);
      setTimeout(() => setActionMsg(""), 6000);
    }
  };

  /* ── Stats ── */
  const pendingCount  = rows.filter(r => r.status === "pending").length;
  const approvedCount = rows.filter(r => r.status === "approved").length;
  const rejectedCount = rows.filter(r => r.status === "rejected").length;

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—";

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>

      <Box sx={{ fontFamily: font }}>

        {/* ── Header ── */}
        <Box sx={{ mb: 3, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
          <Box>
            <Typography sx={{ fontFamily: font, fontSize: { xs: 20, md: 26 }, fontWeight: 800, color: T.text, letterSpacing: "-0.03em", mb: 0.3 }}>
              Marks Extension Requests
            </Typography>
            <Typography sx={{ fontFamily: font, fontSize: 13, color: T.textSub }}>
              Review and action trainer window-extension requests
            </Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={loadRequests}
            startIcon={<RefreshIcon sx={{ fontSize: 15 }} />}
            sx={{ fontFamily: font, fontWeight: 700, fontSize: 12, textTransform: "none", borderRadius: "10px", borderColor: T.border, color: T.textSub, height: 36, "&:hover": { borderColor: T.accent, color: T.accent, background: T.accentLight } }}>
            Refresh
          </Button>
        </Box>

        {/* ── Filters ── */}
        <Box sx={{ ...cardSx, mb: 3, p: 2.5 }}>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel sx={{ fontFamily: font, fontSize: 13 }}>Batch No</InputLabel>
              <Select value={selectedBatch} label="Batch No"
                onChange={e => setSelectedBatch(e.target.value)}
                sx={{ fontFamily: font, fontSize: 13, borderRadius: "10px" }}>
                <MenuItem value=""><em>All batches</em></MenuItem>
                {batches.map(b => (
                  <MenuItem key={b.batch_no} value={b.batch_no} sx={{ fontFamily: font, fontSize: 13 }}>
                    {b.batch_no}{b.start_date ? ` (${b.start_date})` : ""}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel sx={{ fontFamily: font, fontSize: 13 }}>Status</InputLabel>
              <Select value={statusFilter} label="Status"
                onChange={e => setStatusFilter(e.target.value)}
                sx={{ fontFamily: font, fontSize: 13, borderRadius: "10px" }}>
                {["all", "pending", "approved", "rejected"].map(s => (
                  <MenuItem key={s} value={s} sx={{ fontFamily: font, fontSize: 13, textTransform: "capitalize" }}>
                    {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Stats pills */}
            {selectedBatch && !loading && rows.length > 0 && (
              <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", ml: "auto" }}>
                {pendingCount > 0 && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, px: 1.8, py: 0.8, borderRadius: "10px", background: T.warning.light, border: `1px solid ${T.warning.fill}44` }}>
                    <HourglassEmptyIcon sx={{ fontSize: 13, color: T.warning.fill }} />
                    <Typography sx={{ fontFamily: font, fontSize: 12, fontWeight: 700, color: T.warning.text }}>{pendingCount} pending</Typography>
                  </Box>
                )}
                {approvedCount > 0 && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, px: 1.8, py: 0.8, borderRadius: "10px", background: T.success.light, border: `1px solid ${T.success.fill}44` }}>
                    <CheckCircleOutlineIcon sx={{ fontSize: 13, color: T.success.fill }} />
                    <Typography sx={{ fontFamily: font, fontSize: 12, fontWeight: 700, color: T.success.text }}>{approvedCount} approved</Typography>
                  </Box>
                )}
                {rejectedCount > 0 && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, px: 1.8, py: 0.8, borderRadius: "10px", background: T.error.light, border: `1px solid ${T.error.fill}44` }}>
                    <CancelOutlinedIcon sx={{ fontSize: 13, color: T.error.fill }} />
                    <Typography sx={{ fontFamily: font, fontSize: 12, fontWeight: 700, color: T.error.text }}>{rejectedCount} rejected</Typography>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Box>

        {/* Action result banner */}
        {actionMsg && (
          <Fade in>
            <Box sx={{ mb: 2.5, px: 2.5, py: 1.5, borderRadius: "10px", background: actionMsg.startsWith("✅") ? T.success.light : T.error.light, border: `1px solid ${actionMsg.startsWith("✅") ? T.success.fill : T.error.fill}44`, display: "flex", alignItems: "center", gap: 1.5 }}>
              {actionMsg.startsWith("✅")
                ? <CheckCircleOutlineIcon sx={{ fontSize: 16, color: T.success.fill, flexShrink: 0 }} />
                : <CancelOutlinedIcon     sx={{ fontSize: 16, color: T.error.fill,   flexShrink: 0 }} />
              }
              <Typography sx={{ fontFamily: font, fontSize: 13, fontWeight: 600, color: actionMsg.startsWith("✅") ? T.success.text : T.error.text }}>
                {actionMsg}
              </Typography>
            </Box>
          </Fade>
        )}

        {error && <Alert severity="error" sx={{ mb: 2, borderRadius: "10px", fontFamily: font }}>{error}</Alert>}

        {/* ── Table ── */}
        <Box sx={cardSx}>
          {loading ? (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 8, gap: 2 }}>
              <CircularProgress sx={{ color: T.accent }} size={32} />
              <Typography sx={{ fontFamily: font, fontSize: 13, color: T.textSub }}>Loading requests…</Typography>
            </Box>
          ) : !selectedBatch ? (
            <Box sx={{ textAlign: "center", py: 8 }}>
              <AccessTimeIcon sx={{ fontSize: 44, color: T.border, mb: 1.5 }} />
              <Typography sx={{ fontFamily: font, fontSize: 14, color: T.textSub }}>Select a batch above to view extension requests.</Typography>
            </Box>
          ) : rows.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 8 }}>
              <CheckCircleOutlineIcon sx={{ fontSize: 44, color: T.border, mb: 1.5 }} />
              <Typography sx={{ fontFamily: font, fontSize: 14, color: T.textSub }}>
                No {statusFilter !== "all" ? statusFilter + " " : ""}extension requests for this batch.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ ...headCellSx, pl: 3 }}>#</TableCell>
                    <TableCell sx={headCellSx}>Batch</TableCell>
                    <TableCell sx={headCellSx}>Assessment</TableCell>
                    <TableCell sx={headCellSx}>Week / Module</TableCell>
                    <TableCell sx={headCellSx}>Assess. Date</TableCell>
                    <TableCell sx={headCellSx}>Trainer</TableCell>
                    <TableCell sx={headCellSx}>Reason</TableCell>
                    <TableCell sx={{ ...headCellSx, textAlign: "center" }}>Status</TableCell>
                    <TableCell sx={headCellSx}>Requested At</TableCell>
                    <TableCell sx={headCellSx}>Decided At</TableCell>
                    <TableCell sx={headCellSx}>Decided By</TableCell>
                    <TableCell sx={headCellSx}>Extended Until</TableCell>
                    {canDecide && <TableCell sx={{ ...headCellSx, textAlign: "center" }}>Actions</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r, idx) => (
                    <TableRow key={r.id}
                      sx={{
                        "&:nth-of-type(even)": { background: T.surfaceAlt },
                        "&:hover": { background: T.accentLight + "55", transition: "background 0.15s" },
                        // Pending rows get a left amber accent bar
                        ...(r.status === "pending" ? { borderLeft: `3px solid ${T.warning.fill}` } : {}),
                      }}>
                      <TableCell sx={{ ...bodyCellSx, pl: 3, fontFamily: mono, fontSize: 11, color: T.textSub }}>{idx + 1}</TableCell>
                      <TableCell sx={{ ...bodyCellSx, fontWeight: 700 }}>{r.batch_no}</TableCell>
                      <TableCell sx={bodyCellSx}>{ASSESSMENT_LABELS[r.assessment_type] || r.assessment_type}</TableCell>
                      <TableCell sx={{ ...bodyCellSx, fontFamily: mono, fontSize: 12 }}>{r.week_no ?? "—"}</TableCell>
                      <TableCell sx={{ ...bodyCellSx, fontFamily: mono, fontSize: 12, whiteSpace: "nowrap" }}>{r.assessment_date || "—"}</TableCell>
                      <TableCell sx={{ ...bodyCellSx, fontSize: 12, color: T.textSub }}>{r.trainer_email}</TableCell>
                      <TableCell sx={{ ...bodyCellSx, maxWidth: 200 }}>
                        <Tooltip title={r.reason || ""} placement="top">
                          <Typography sx={{ fontFamily: font, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                            {r.reason || "—"}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ ...bodyCellSx, textAlign: "center" }}>
                        <StatusChip status={r.status} />
                      </TableCell>
                      <TableCell sx={{ ...bodyCellSx, fontSize: 12, color: T.textSub, whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</TableCell>
                      <TableCell sx={{ ...bodyCellSx, fontSize: 12, color: T.textSub, whiteSpace: "nowrap" }}>{fmtDate(r.decided_at)}</TableCell>
                      <TableCell sx={{ ...bodyCellSx, fontSize: 12, color: T.textSub }}>{r.decided_by || "—"}</TableCell>
                      <TableCell sx={{ ...bodyCellSx, fontSize: 12, fontFamily: mono, whiteSpace: "nowrap" }}>
                        {r.extended_until
                          ? <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: T.success.text }}>
                              <AccessTimeIcon sx={{ fontSize: 12 }} />
                              {fmtDate(r.extended_until)}
                            </Box>
                          : <Typography sx={{ fontFamily: font, fontSize: 12, color: T.textSub }}>—</Typography>
                        }
                      </TableCell>

                      {/* Approve / Reject — pending rows only, Admin/Manager only */}
                      {canDecide && (
                        <TableCell sx={{ ...bodyCellSx, textAlign: "center", whiteSpace: "nowrap" }}>
                          {r.status === "pending" ? (
                            <Box sx={{ display: "flex", gap: 1, justifyContent: "center" }}>
                              <Tooltip title="Approve — opens the trainer's window for 24 hrs">
                                <Button variant="contained" size="small"
                                  onClick={() => setDecisionDlg({ open: true, action: "approve", request: r })}
                                  startIcon={<CheckCircleOutlineIcon sx={{ fontSize: 14 }} />}
                                  sx={{ fontFamily: font, fontWeight: 700, fontSize: 11, textTransform: "none", borderRadius: "8px", px: 1.5, background: T.success.fill, "&:hover": { background: "#059669" }, minWidth: 90 }}>
                                  Approve
                                </Button>
                              </Tooltip>
                              <Tooltip title="Reject this request">
                                <Button variant="outlined" size="small"
                                  onClick={() => setDecisionDlg({ open: true, action: "reject", request: r })}
                                  startIcon={<CancelOutlinedIcon sx={{ fontSize: 14 }} />}
                                  sx={{ fontFamily: font, fontWeight: 700, fontSize: 11, textTransform: "none", borderRadius: "8px", px: 1.5, borderColor: T.error.fill, color: T.error.fill, "&:hover": { background: T.error.light, borderColor: T.error.fill }, minWidth: 80 }}>
                                  Reject
                                </Button>
                              </Tooltip>
                            </Box>
                          ) : (
                            <Typography sx={{ fontFamily: font, fontSize: 12, color: T.textSub }}>—</Typography>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Box>
      </Box>

      {/* ── Decision Confirmation Dialog ── */}
      <DecisionDialog
        open={decisionDlg.open}
        onClose={() => setDecisionDlg({ open: false, action: null, request: null })}
        onConfirm={handleDecide}
        action={decisionDlg.action}
        request={decisionDlg.request}
        confirming={confirming}
      />
    </>
  );
}