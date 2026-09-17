// src/pages/TrainerAssignmentDashboard.js
import React, { useEffect, useState, useCallback } from "react";
import {
  Box, Typography, Table, TableHead, TableBody, TableCell, TableRow,
  TableContainer, Chip, Button, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions,
  MenuItem, Select, FormControl, InputLabel, Checkbox, FormControlLabel,
  Collapse, Snackbar, Alert as MuiAlert, Fade,
} from "@mui/material";
import {
  CheckCircle      as CheckCircleIcon,
  Error            as ErrorIcon,
  InfoOutlined     as InfoIcon,
  PersonSearch     as PersonSearchIcon,
  AssignmentTurnedIn as AssignIcon,
  Refresh          as RefreshIcon,
  EventBusy        as EventBusyIcon,
} from "@mui/icons-material";

const API_BASE = "http://192.168.1.2:5000/";

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
  borderBottom:  `2px solid ${TOKENS.border}`,
  py:            1.4,
  background:    TOKENS.surfaceAlt,
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

/* ─── Status chip ────────────────────────────────────────────────────────── */
function StatusChip({ status }) {
  const map = {
    assigned: { bg: TOKENS.success.light, color: TOKENS.success.text, border: TOKENS.success.fill },
    rejected: { bg: TOKENS.error.light,   color: TOKENS.error.text,   border: TOKENS.error.fill   },
    pending:  { bg: TOKENS.warning.light, color: TOKENS.warning.text, border: TOKENS.warning.fill },
  };
  const s = map[status?.toLowerCase()] || map.pending;
  return (
    <Chip label={(status || "PENDING").toUpperCase()} size="small"
      sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11,
            background: s.bg, color: s.color, border: `1px solid ${s.border}44` }} />
  );
}

/* ─── Section header ────────────────────────────────────────────────────── */
function SectionHeader({ icon, title, subtitle, right }) {
  return (
    <Box sx={{
      px: 3, py: 2.5,
      background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`,
      borderBottom: `1px solid ${TOKENS.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap",
    }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box sx={{ color: TOKENS.accent, display: "flex" }}>{icon}</Box>
        <Box>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.02em" }}>
            {title}
          </Typography>
          {subtitle && <Typography sx={{ ...labelSx, fontSize: 10, mt: 0.2 }}>{subtitle}</Typography>}
        </Box>
      </Box>
      {right && <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>{right}</Box>}
    </Box>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
function TrainerAssignmentDashboard() {
  const [toast, setToast] = useState({ open: false, message: "", severity: "info" });
  const showToast = (message, severity = "info") => setToast({ open: true, message, severity });
  const closeToast = () => setToast({ open: false, message: "", severity: "info" });

  const [leaves,             setLeaves]             = useState([]);
  const [loading,            setLoading]            = useState(true);
  const [status,             setStatus]             = useState("Connecting to database...");
  const [selectedLeave,      setSelectedLeave]      = useState(null);
  const [topics,             setTopics]             = useState([]);
  const [availableTrainers,  setAvailableTrainers]  = useState([]);
  const [assignDialogOpen,   setAssignDialogOpen]   = useState(false);
  const [selectedTrainer,    setSelectedTrainer]    = useState("");
  const [selectedTopics,     setSelectedTopics]     = useState([]);
  const [availabilityLoading,setAvailabilityLoading]= useState(false);

  const fetchUnavailability = useCallback(async () => {
    setStatus("Querying trainer_unavailability table...");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/trainer-unavailability`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setLeaves(data);
        setStatus(`✅ SUCCESS: Loaded ${data.length} records`);
        showToast(`Loaded ${data.length} trainer records`, "success");
      } else {
        setLeaves([]);
        setStatus("⚠️ No data found");
        showToast("No data found", "warning");
      }
    } catch (err) {
      setStatus(`❌ Failed: ${err.message}`);
      showToast(`Failed: ${err.message}`, "error");
      setLeaves([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTopics = useCallback(async (leaveId) => {
    try {
      const res = await fetch(`${API_BASE}/api/unavailability-topics/${leaveId}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTopics(data.topics || []);
      setSelectedTopics(data.topics || []);
    } catch {
      setTopics([]);
      showToast("Failed to load topics", "warning");
    }
  }, []);

  const fetchAvailableTrainers = useCallback(async (leave) => {
    setAvailabilityLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/available-trainers-by-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainer_email: leave.trainer_email,
          domain: leave.domain,
          start_date: leave.start_date,
          end_date: leave.end_date,
          start_time: leave.start_time || "13:30:00",
          end_time: leave.end_time || "19:30:00",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.trainers?.length > 0) {
        setAvailableTrainers(data.trainers);
        showToast(`${data.trainers.length} available trainers found`, "success");
      } else {
        setAvailableTrainers([]);
        showToast("Consult the Manager - No available trainers", "warning");
      }
    } catch {
      setAvailableTrainers([]);
      showToast("No available trainers found", "warning");
    } finally {
      setAvailabilityLoading(false);
    }
  }, []);

  const assignTopics = useCallback(async () => {
    if (!selectedLeave || !selectedTrainer || selectedTopics.length === 0) {
      showToast("Please select trainer and at least one topic", "warning");
      return;
    }
    setAvailabilityLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/assign-topics-to-trainer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          unavailability_id: selectedLeave.id,
          trainer_email: selectedTrainer,
          topic_ids: selectedTopics.map(t => t.id),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success) {
        showToast(`✅ Assigned ${selectedTopics.length} topics successfully!`, "success");
        setAssignDialogOpen(false);
        setSelectedTrainer("");
        setSelectedTopics([]);
        fetchUnavailability();
      } else {
        showToast("Failed to assign topics", "error");
      }
    } catch (err) {
      showToast(`Assign failed: ${err.message}`, "error");
    } finally {
      setAvailabilityLoading(false);
    }
  }, [selectedLeave, selectedTrainer, selectedTopics, fetchUnavailability]);

  const handleRowClick = async (leave) => {
    if (leave.status === "assigned") { showToast("This trainer is already assigned", "info"); return; }
    setSelectedTrainer(""); setSelectedTopics([]); setTopics([]); setAvailableTrainers([]);
    setSelectedLeave(leave);
    setAssignDialogOpen(true);
    await fetchTopics(leave.id);
    await fetchAvailableTrainers(leave);
  };

  const closeDialog = () => {
    setAssignDialogOpen(false);
    setSelectedLeave(null);
    setSelectedTrainer("");
    setSelectedTopics([]);
    setTopics([]);
    setAvailableTrainers([]);
  };

  useEffect(() => { fetchUnavailability(); }, [fetchUnavailability]);

  const isSuccess = status.includes("✅");
  const isError   = status.includes("❌");

  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <Box sx={{ maxWidth: 1400, mx: "auto" }}>

        {/* ── Page Header ── */}
        <Box sx={{ mb: 4, display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
          <Box>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
              Trainer Assignment
            </Typography>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
              Manage trainer unavailability and reassign topics
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon sx={{ fontSize: 16 }} />}
            onClick={fetchUnavailability}
            disabled={loading}
            sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", borderColor: TOKENS.border, color: TOKENS.textSub, textTransform: "none", px: 2, height: 38, "&:hover": { borderColor: TOKENS.accent, color: TOKENS.accent, background: TOKENS.accentLight } }}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </Box>

        {/* ── Status Banner ── */}
        <Box sx={{ ...cardSx, mb: 3, px: 3, py: 2, display: "flex", alignItems: "center", gap: 1.5,
          background: isSuccess ? TOKENS.success.light : isError ? TOKENS.error.light : "#eff6ff",
          border: `1px solid ${isSuccess ? TOKENS.success.fill : isError ? TOKENS.error.fill : TOKENS.accent}44`,
        }}>
          {isSuccess
            ? <CheckCircleIcon sx={{ fontSize: 16, color: TOKENS.success.fill }} />
            : isError
            ? <ErrorIcon sx={{ fontSize: 16, color: TOKENS.error.fill }} />
            : <InfoIcon sx={{ fontSize: 16, color: TOKENS.accent }} />}
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600,
            color: isSuccess ? TOKENS.success.text : isError ? TOKENS.error.text : TOKENS.accent }}>
            {status}
          </Typography>
          {leaves.length > 0 && (
            <Typography sx={{ ...labelSx, ml: "auto", fontSize: 10 }}>
              Last updated: {new Date().toLocaleTimeString()}
            </Typography>
          )}
        </Box>

        {/* ── Main Table ── */}
        <Box sx={cardSx}>
          <SectionHeader
            icon={<EventBusyIcon sx={{ fontSize: 20 }} />}
            title="Trainer Unavailability Records"
            subtitle={leaves.length ? `${leaves.length} records` : "No records loaded"}
            right={
              leaves.length > 0 && (
                <Box sx={{ px: 2, py: 0.8, borderRadius: "10px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: TOKENS.accent }}>
                    {leaves.length} records
                  </Typography>
                </Box>
              )
            }
          />
          <TableContainer sx={{ maxHeight: 560 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {["Trainer Name", "Email", "Domain", "Date Range", "Status", "Action"].map(h => (
                    <TableCell key={h} sx={tableHeadSx}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                      <CircularProgress size={28} sx={{ color: TOKENS.accent, mb: 1.5, display: "block", mx: "auto" }} />
                      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>
                        Loading trainer records…
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : leaves.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
                        No trainer unavailability records found
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  leaves.map(leave => (
                    <TableRow key={leave.id} hover
                      onClick={() => handleRowClick(leave)}
                      sx={{
                        cursor: leave.status === "assigned" ? "default" : "pointer",
                        "&:nth-of-type(even)": { background: TOKENS.surfaceAlt },
                        "&:hover": { background: `${TOKENS.accent}08` },
                        transition: "background 0.15s",
                      }}
                    >
                      <TableCell sx={{ ...tableCellSx, fontWeight: 700 }}>{leave.trainer_name || "Unknown"}</TableCell>
                      <TableCell sx={{ ...tableCellSx, color: TOKENS.textSub, fontSize: 12 }}>{leave.trainer_email || "No email"}</TableCell>
                      <TableCell sx={tableCellSx}>
                        <Chip label={leave.domain || "N/A"} size="small"
                          sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.accentLight, color: TOKENS.accent, border: `1px solid ${TOKENS.accent}33` }} />
                      </TableCell>
                      <TableCell sx={tableCellSx}>
                        <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 600, color: TOKENS.text }}>{leave.start_date || "N/A"}</Typography>
                        <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: TOKENS.textSub }}>→ {leave.end_date || "N/A"}</Typography>
                      </TableCell>
                      <TableCell sx={tableCellSx}><StatusChip status={leave.status} /></TableCell>
                      <TableCell sx={tableCellSx}>
                        <Button variant="contained" size="small"
                          disabled={leave.status === "assigned"}
                          onClick={e => { e.stopPropagation(); handleRowClick(leave); }}
                          sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, textTransform: "none", borderRadius: "8px", px: 2,
                            background: leave.status === "assigned" ? TOKENS.surfaceAlt : TOKENS.accent,
                            color: leave.status === "assigned" ? TOKENS.textSub : "#fff",
                            "&:hover": { background: leave.status === "assigned" ? TOKENS.surfaceAlt : "#2a3fd4" },
                          }}>
                          {leave.status === "assigned" ? "Assigned ✓" : "Assign Topics"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        {/* ── Debug strip ── */}
        <Collapse in={leaves.length > 0}>
          <Box sx={{ mt: 2, px: 3, py: 1.5, borderRadius: "10px", background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
            <Typography sx={{ ...labelSx, fontSize: 10 }}>Debug</Typography>
            {[
              { l: "Records", v: leaves.length },
              { l: "Available", v: availableTrainers.length },
              { l: "Topics", v: topics.length },
              { l: "Selected", v: selectedLeave?.trainer_email || "None" },
            ].map(item => (
              <Box key={item.l} sx={{ px: 1.5, py: 0.4, borderRadius: "6px", background: TOKENS.surfaceAlt, border: `1px solid ${TOKENS.border}` }}>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: TOKENS.textSub }}>
                  {item.l}: <strong style={{ color: TOKENS.text }}>{item.v}</strong>
                </Typography>
              </Box>
            ))}
          </Box>
        </Collapse>
      </Box>

      {/* ── Assign Dialog ── */}
      <Dialog open={assignDialogOpen} onClose={closeDialog} maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: "16px", overflow: "hidden", height: "75vh" } }}>
        <DialogTitle sx={{ p: 0 }}>
          <Box sx={{ px: 3, py: 2.5, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
            <AssignIcon sx={{ fontSize: 20, color: TOKENS.accent }} />
            <Box>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text }}>
                Assign Topics
              </Typography>
              <Typography sx={{ ...labelSx, fontSize: 10 }}>
                {selectedLeave?.trainer_name} · {selectedLeave?.domain}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ p: 3, overflowY: "auto" }}>
          {/* Leave details chips */}
          {selectedLeave && (
            <Box sx={{ mb: 3 }}>
              <Typography sx={{ ...labelSx, mb: 1.5 }}>Unavailability Details</Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
                {[
                  { l: `Domain: ${selectedLeave.domain}`, color: TOKENS.accent },
                  { l: `${selectedLeave.start_date} → ${selectedLeave.end_date}`, color: TOKENS.textSub },
                  { l: "1:30 PM – 7:30 PM", color: "#7c3aed" },
                ].map(c => (
                  <Box key={c.l} sx={{ px: 2, py: 0.6, borderRadius: "20px", background: `${c.color}18`, border: `1px solid ${c.color}33` }}>
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: c.color }}>{c.l}</Typography>
                  </Box>
                ))}
              </Box>
              <Box sx={{ px: 2.5, py: 1.5, borderRadius: "10px", background: "#eff6ff", border: `1px solid ${TOKENS.accent}33`, display: "flex", alignItems: "center", gap: 1 }}>
                <InfoIcon sx={{ fontSize: 14, color: TOKENS.accent }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.accent }}>
                  Looking for available trainers in same domain & time slot (1:30 PM–7:30 PM)
                </Typography>
              </Box>
            </Box>
          )}

          {/* Trainer selector */}
          <Box sx={{ mb: 3 }}>
            <Typography sx={{ ...labelSx, mb: 1 }}>Select Available Trainer</Typography>
            <FormControl fullWidth size="small">
              <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Available Trainers</InputLabel>
              <Select value={selectedTrainer} label="Available Trainers"
                onChange={e => setSelectedTrainer(e.target.value)} sx={inputSx}>
                {availableTrainers.length === 0 ? (
                  <MenuItem disabled sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>
                    {availabilityLoading ? "Checking availability…" : "Consult the Manager for further process"}
                  </MenuItem>
                ) : (
                  availableTrainers.map(t => (
                    <MenuItem key={t.email} value={t.email} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                      {t.name} ({t.email}) — {t.batch_no}
                    </MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
          </Box>

          {/* Topics checklist */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
              <Typography sx={{ ...labelSx }}>Topics to Reassign</Typography>
              <Box sx={{ px: 1.5, py: 0.3, borderRadius: "20px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, color: TOKENS.accent }}>
                  {selectedTopics.length} / {topics.length} selected
                </Typography>
              </Box>
            </Box>
            <Box sx={{ maxHeight: 240, overflow: "auto", border: `1px solid ${TOKENS.border}`, borderRadius: "10px", background: TOKENS.surfaceAlt }}>
              {topics.length === 0 ? (
                <Box sx={{ p: 3, textAlign: "center" }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>
                    No topics found for this trainer
                  </Typography>
                </Box>
              ) : (
                topics.map(topic => (
                  <Box key={topic.id} sx={{ px: 2, py: 1.2, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: 1.5, "&:last-child": { borderBottom: "none" }, "&:hover": { background: `${TOKENS.accent}06` } }}>
                    <Checkbox size="small"
                      checked={selectedTopics.some(t => t.id === topic.id)}
                      onChange={e => {
                        if (e.target.checked) setSelectedTopics([...selectedTopics, topic]);
                        else setSelectedTopics(selectedTopics.filter(t => t.id !== topic.id));
                      }}
                      sx={{ color: TOKENS.accent, "&.Mui-checked": { color: TOKENS.accent }, p: 0 }}
                    />
                    <Box>
                      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: TOKENS.text }}>{topic.topic_name}</Typography>
                      <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: TOKENS.textSub }}>{topic.date}</Typography>
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${TOKENS.border}`, gap: 1 }}>
          <Button onClick={closeDialog}
            sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", borderColor: TOKENS.border, color: TOKENS.textSub }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={assignTopics}
            disabled={availabilityLoading || !selectedTrainer || selectedTopics.length === 0}
            startIcon={availabilityLoading ? <CircularProgress size={14} color="inherit" /> : <AssignIcon sx={{ fontSize: 16 }} />}
            sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", background: TOKENS.accent, "&:hover": { background: "#2a3fd4" }, "&:disabled": { opacity: 0.5 } }}>
            {availabilityLoading ? "Assigning…" : `Assign ${selectedTopics.length} Topics`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Toast ── */}
      <Snackbar open={toast.open} autoHideDuration={4000} onClose={closeToast}
        anchorOrigin={{ vertical: "top", horizontal: "right" }} TransitionComponent={Fade}>
        <MuiAlert onClose={closeToast} severity={toast.severity} elevation={6} variant="filled" sx={{ width: "100%", fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
          {toast.message}
        </MuiAlert>
      </Snackbar>
    </Box>
  );
}

export default TrainerAssignmentDashboard;