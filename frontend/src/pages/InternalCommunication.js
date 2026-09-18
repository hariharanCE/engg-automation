import React, { useState, useEffect } from "react";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import {
  Box,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormGroup,
  FormControlLabel,
  TextField,
  Fade,
  CircularProgress,
  Chip,
} from "@mui/material";
import EmailIcon         from "@mui/icons-material/Email";
import AnnouncementIcon  from "@mui/icons-material/Announcement";
import FeedbackIcon      from "@mui/icons-material/Feedback";
import UploadFileIcon    from "@mui/icons-material/UploadFile";
import SendIcon          from "@mui/icons-material/Send";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

/* ─── Design tokens (matches CourseProgress) ─────────────────────────────── */
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

const inputSx = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 13,
  borderRadius: "10px",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.border },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent },
  "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent },
};

/* ─── Section Header ─────────────────────────────────────────────────────── */
function SectionHeader({ icon, title, subtitle }) {
  return (
    <Box sx={{ px: 3, py: 2.5, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
      <Box sx={{ color: TOKENS.accent, display: "flex" }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.02em" }}>{title}</Typography>
        {subtitle && <Typography sx={{ ...labelSx, fontSize: 10, mt: 0.2 }}>{subtitle}</Typography>}
      </Box>
    </Box>
  );
}

/* ─── StatusBanner ───────────────────────────────────────────────────────── */
function StatusBanner({ message }) {
  if (!message) return null;
  const isSuccess = message.startsWith("✅");
  const isWarning = message.startsWith("⚠️");
  const colors = isSuccess ? TOKENS.success : isWarning ? TOKENS.warning : TOKENS.error;
  return (
    <Fade in>
      <Box sx={{ mt: 2, px: 2.5, py: 1.5, borderRadius: "10px", background: colors.light, border: `1px solid ${colors.fill}44` }}>
        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: colors.text }}>{message}</Typography>
      </Box>
    </Fade>
  );
}

/* ─── StyledCheckbox group ───────────────────────────────────────────────── */
function RoleCheckboxGroup({ roles, selectedRoles, onChange }) {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {roles.map(role => {
        const checked = selectedRoles.includes(role);
        return (
          <Box
            key={role}
            onClick={() => onChange({ target: { value: role, checked: !checked } })}
            sx={{
              display: "flex", alignItems: "center", gap: 0.8,
              px: 1.8, py: 0.8, borderRadius: "10px", cursor: "pointer",
              border: `1.5px solid ${checked ? TOKENS.accent : TOKENS.border}`,
              background: checked ? TOKENS.accentLight : TOKENS.surfaceAlt,
              transition: "all 0.15s ease",
              "&:hover": { borderColor: TOKENS.accent, background: TOKENS.accentLight },
            }}
          >
            <Box sx={{
              width: 16, height: 16, borderRadius: "4px",
              border: `2px solid ${checked ? TOKENS.accent : TOKENS.border}`,
              background: checked ? TOKENS.accent : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s ease",
            }}>
              {checked && <Box sx={{ width: 8, height: 8, borderRadius: "2px", background: "#fff" }} />}
            </Box>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: checked ? TOKENS.accent : TOKENS.text }}>{role}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
function InternalCommunication({ user }) {
  const [roles, setRoles] = useState([]);
  const [domain, setDomain] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [batches, setBatches] = useState([]);
  const [batchStartDate, setBatchStartDate] = useState("");
  const [message, setMessage] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const [closureBatch, setClosureBatch] = useState("");
  const [closureDate, setClosureDate] = useState("");
  const [closureMessage, setClosureMessage] = useState("");
  const [batchMaxDate, setBatchMaxDate] = useState("");
  const [closureLoading, setClosureLoading] = useState(false);

  const [feedbackBatchNo, setFeedbackBatchNo] = useState("");
  const [feedbackRoles, setFeedbackRoles] = useState([]);
  const [feedbackType, setFeedbackType] = useState("");
  const [feedbackFile, setFeedbackFile] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/batches`)
      .then(res => res.json())
      .then(data => { if (data) setBatches(data); })
      .catch(err => console.error("Failed to load batches:", err));
  }, []);

  const handleRoleChange = (e) => {
    const { value, checked } = e.target;
    setRoles(prev => checked ? [...prev, value.trim()] : prev.filter(r => r !== value.trim()));
  };

  const handleBatchChange = (e) => {
    const selected = e.target.value;
    setBatchNo(selected.trim());
    const batchObj = batches.find(b => b.batch_no === selected);
    if (batchObj?.start_date) {
      setBatchStartDate(dayjs(batchObj.start_date, "DD-MMM-YYYY").format("YYYY-MM-DD"));
    } else {
      setBatchStartDate("");
    }
  };

  const handleSchedule = async () => {
    if (roles.length === 0) { setMessage("⚠️ Please select at least one role"); return; }
    if (!batchNo) { setMessage("⚠️ Please select a Batch No"); return; }
    setScheduleLoading(true);
    const body = { role: roles.length === 1 ? roles[0] : roles, batchNo: batchNo.trim(), startDate: batchStartDate };
    if (roles.includes("Trainer")) body.domain = domain;
    try {
      const res = await fetch(`${API_BASE}/api/internal/schedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await res.json();
      setMessage(res.ok ? result.message || "✅ Scheduled successfully" : "❌ Failed to schedule: " + (result.error || "Unknown error"));
    } catch (err) { setMessage("❌ Failed to schedule: " + err.message); }
    finally { setScheduleLoading(false); }
  };

  useEffect(() => {
    const fetchMaxDate = async () => {
      if (!closureBatch) { setBatchMaxDate(""); setClosureDate(""); return; }
      try {
        const res = await fetch(`${API_BASE}/api/course_planner_data/max-date/${closureBatch}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.max_date) { setBatchMaxDate(data.max_date); if (!closureDate) setClosureDate(data.max_date); }
          else setBatchMaxDate("");
        } else { setBatchMaxDate(""); }
      } catch { setBatchMaxDate(""); }
    };
    fetchMaxDate();
    // eslint-disable-next-line
  }, [closureBatch]);

  const handleClosureDateChange = (e) => {
    const newDate = e.target.value;
    if (batchMaxDate && dayjs(newDate).isBefore(dayjs(batchMaxDate), "day")) {
      alert(`End date must be on or after batch last date: ${dayjs(batchMaxDate).format("YYYY-MM-DD")}`);
      return;
    }
    setClosureDate(newDate);
  };

  const handleClosureAnnounce = async () => {
    if (!closureBatch || !closureDate) { setClosureMessage("⚠️ Please select batch and date"); return; }
    if (batchMaxDate && dayjs(closureDate).isBefore(dayjs(batchMaxDate), "day")) { setClosureMessage(`❌ End date must be on or after batch last date: ${dayjs(batchMaxDate).format("YYYY-MM-DD")}`); return; }
    setClosureLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/course-closure`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch_no: closureBatch, end_date: closureDate }) });
      const result = await res.json();
      setClosureMessage(res.ok ? result.message || "✅ Course closure emails sent successfully" : "❌ Failed to send emails: " + (result.error || "Unknown error"));
    } catch (err) { setClosureMessage("❌ Failed to send emails: " + err.message); }
    finally { setClosureLoading(false); }
  };

  const feedbackRoleOptions = ["IT Admin", "Learning Coordinator", "Trainer", "Management"];

  const handleFeedbackRoleChange = (e) => {
    const { value, checked } = e.target;
    setFeedbackRoles(prev => checked ? Array.from(new Set([...prev, value.trim()])) : prev.filter(r => r !== value.trim()));
  };

  const handleFeedbackFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target.result;
      let workbook;
      if (file.name.endsWith(".csv")) { const arr = new Uint8Array(data); workbook = XLSX.read(arr, { type: "array", raw: true }); }
      else { workbook = XLSX.read(data, { type: "binary" }); }
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      let jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      jsonData = jsonData.map(({ Name, Email, Phone, ...rest }) => rest);
      const newWorksheet = XLSX.utils.json_to_sheet(jsonData);
      workbook.Sheets[sheetName] = newWorksheet;
      const wbout = XLSX.write(workbook, { bookType: file.name.endsWith(".csv") ? "csv" : "xlsx", type: "array" });
      const newFile = new File([new Blob([wbout], { type: file.type })], file.name, { type: file.type });
      setFeedbackFile(newFile);
    };
    if (file.name.endsWith(".csv")) reader.readAsArrayBuffer(file);
    else reader.readAsBinaryString(file);
  };

  const handleSendFeedbackEmail = async () => {
    if (!feedbackBatchNo || feedbackRoles.length === 0 || !feedbackType || !feedbackFile) { setFeedbackMessage("⚠️ Please fill all feedback sharing fields and upload a file."); return; }
    setFeedbackLoading(true);
    const rolesList = feedbackRoles.map(r => r.trim()).filter((v, i, arr) => arr.indexOf(v) === i);
    const formData = new FormData();
    formData.append("batchNo", feedbackBatchNo);
    formData.append("roles", JSON.stringify(rolesList));
    formData.append("feedbackType", feedbackType);
    formData.append("file", feedbackFile);
    try {
      const res = await fetch(`${API_BASE}/api/internal/feedback-share`, { method: "POST", body: formData });
      const result = await res.json();
      setFeedbackMessage(res.ok ? "✅ Feedback mail sent!" : "❌ " + (result.error || "Unknown error"));
    } catch (err) { setFeedbackMessage("❌ Error: " + err.message); }
    finally { setFeedbackLoading(false); }
  };

  const roleTitle = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Dashboard";
  const welcomeName = user?.name ? user.name : "User";

  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>

      <Box sx={{ maxWidth: 960, mx: "auto" }}>
        {/* ── Page Header ── */}
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
            {roleTitle} Dashboard
          </Typography>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
            Welcome back, <strong style={{ color: TOKENS.accent }}>{welcomeName}</strong>
          </Typography>
        </Box>

        {/* ── Section 1: Internal Communication ── */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <SectionHeader icon={<EmailIcon sx={{ fontSize: 20 }} />} title="Internal Communication" subtitle="Schedule emails to staff roles" />
          <Box sx={{ p: 3 }}>
            <Typography sx={{ ...labelSx, mb: 1.5 }}>Select Roles</Typography>
            <RoleCheckboxGroup
              roles={["IT Admin", "Learning Coordinator", "Trainer", "Management"]}
              selectedRoles={roles}
              onChange={handleRoleChange}
            />

            <Box sx={{ display: "flex", gap: 2, mt: 2.5, flexWrap: "wrap" }}>
              {roles.includes("Trainer") && (
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Domain</InputLabel>
                  <Select value={domain} onChange={e => setDomain(e.target.value)} label="Domain" sx={inputSx}>
                    <MenuItem value="">--select--</MenuItem>
                    {["PD", "DV", "DFT"].map(d => <MenuItem key={d} value={d} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{d}</MenuItem>)}
                  </Select>
                </FormControl>
              )}

              <FormControl size="small" sx={{ minWidth: 240 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batch No</InputLabel>
                <Select value={batchNo} onChange={handleBatchChange} label="Batch No" sx={inputSx}>
                  <MenuItem value="">--select--</MenuItem>
                  {batches.map(b => (
                    <MenuItem key={b.batch_no} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{b.batch_no} (Start: {b.start_date})</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {batchStartDate && (
              <Box sx={{ mt: 1.5, display: "inline-flex", alignItems: "center", gap: 1, px: 2, py: 0.8, borderRadius: "8px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                <CalendarTodayIcon sx={{ fontSize: 13, color: TOKENS.accent }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: TOKENS.accent }}>
                  Start Date: {dayjs(batchStartDate).format("DD-MMM-YYYY")}
                </Typography>
              </Box>
            )}

            <Box sx={{ mt: 2.5 }}>
              <Button
                variant="contained"
                onClick={handleSchedule}
                disabled={scheduleLoading}
                startIcon={scheduleLoading ? <CircularProgress size={14} color="inherit" /> : <SendIcon sx={{ fontSize: 15 }} />}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 3, py: 1, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}
              >
                {scheduleLoading ? "Scheduling..." : "Schedule Emails"}
              </Button>
            </Box>

            <StatusBanner message={message} />
          </Box>
        </Box>

        {/* ── Section 2: Course Closure ── */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <SectionHeader icon={<AnnouncementIcon sx={{ fontSize: 20 }} />} title="Course Closure Announcement" subtitle="Notify IT Admin of course completion" />
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start" }}>
              <FormControl size="small" sx={{ minWidth: 240 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batch No</InputLabel>
                <Select value={closureBatch} onChange={e => setClosureBatch(e.target.value)} label="Batch No" sx={inputSx}>
                  <MenuItem value="">--select--</MenuItem>
                  {batches.map(b => (
                    <MenuItem key={b.batch_no} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{b.batch_no}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Box>
                <TextField
                  label="End Date"
                  type="date"
                  value={closureDate}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: batchMaxDate || undefined }}
                  onChange={handleClosureDateChange}
                  sx={{
                    "& .MuiInputBase-root": { ...inputSx, fontFamily: "'DM Sans', sans-serif", fontSize: 13 },
                    "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 },
                  }}
                />
                {batchMaxDate && (
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: TOKENS.textSub, mt: 0.5 }}>
                    Last batch date: <strong style={{ color: TOKENS.text }}>{dayjs(batchMaxDate).format("DD-MMM-YYYY")}</strong>
                  </Typography>
                )}
              </Box>
            </Box>

            <Box sx={{ mt: 2.5 }}>
              <Button
                variant="contained"
                onClick={handleClosureAnnounce}
                disabled={closureLoading}
                startIcon={closureLoading ? <CircularProgress size={14} color="inherit" /> : <SendIcon sx={{ fontSize: 15 }} />}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 3, py: 1, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}
              >
                {closureLoading ? "Sending..." : "Send Closure Emails"}
              </Button>
            </Box>

            <StatusBanner message={closureMessage} />
          </Box>
        </Box>

        {/* ── Section 3: Feedback Sharing ── */}
        <Box sx={{ ...cardSx }}>
          <SectionHeader icon={<FeedbackIcon sx={{ fontSize: 20 }} />} title="Feedback Sharing" subtitle="Distribute feedback reports to selected roles" />
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2.5 }}>
              <FormControl size="small" sx={{ minWidth: 240 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batch No</InputLabel>
                <Select value={feedbackBatchNo} onChange={e => setFeedbackBatchNo(e.target.value.trim())} label="Batch No" sx={inputSx}>
                  <MenuItem value="">--select--</MenuItem>
                  {batches.map(b => (
                    <MenuItem key={b.batch_no} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{b.batch_no}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Feedback Type</InputLabel>
                <Select value={feedbackType} label="Feedback Type" onChange={e => setFeedbackType(e.target.value)} sx={inputSx}>
                  <MenuItem value="">--select--</MenuItem>
                  <MenuItem value="Intermediate Feedback" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Intermediate Feedback</MenuItem>
                  <MenuItem value="Final Feedback" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Final Feedback</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <Typography sx={{ ...labelSx, mb: 1.5 }}>Select Recipient Roles</Typography>
            <RoleCheckboxGroup
              roles={feedbackRoleOptions}
              selectedRoles={feedbackRoles}
              onChange={handleFeedbackRoleChange}
            />

            <Box sx={{ mt: 2.5, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Button
                variant="outlined"
                component="label"
                startIcon={<UploadFileIcon sx={{ fontSize: 16 }} />}
                size="small"
                sx={{
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12,
                  borderRadius: "10px", textTransform: "none", px: 2.5, py: 1,
                  borderColor: feedbackFile ? TOKENS.accent : TOKENS.border,
                  color: feedbackFile ? TOKENS.accent : TOKENS.textSub,
                  background: feedbackFile ? TOKENS.accentLight : "transparent",
                  "&:hover": { borderColor: TOKENS.accent, color: TOKENS.accent, background: TOKENS.accentLight },
                }}
              >
                {feedbackFile ? "File Selected" : "Upload CSV / XLSX"}
                <input type="file" accept=".csv,.xlsx" hidden onChange={handleFeedbackFile} />
              </Button>

              {feedbackFile && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, px: 1.5, py: 0.5, borderRadius: "8px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: TOKENS.accent }} />
                  <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: TOKENS.accent, fontWeight: 600 }}>{feedbackFile.name}</Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ mt: 2.5 }}>
              <Button
                variant="contained"
                onClick={handleSendFeedbackEmail}
                disabled={feedbackLoading}
                startIcon={feedbackLoading ? <CircularProgress size={14} color="inherit" /> : <SendIcon sx={{ fontSize: 15 }} />}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 3, py: 1, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}
              >
                {feedbackLoading ? "Sending..." : "Send Feedback Email"}
              </Button>
            </Box>

            <StatusBanner message={feedbackMessage} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default InternalCommunication;