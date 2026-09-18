import React, { useEffect, useState, useCallback } from "react";
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem,
  TextField, Button, CircularProgress, RadioGroup, FormControlLabel, Radio,
} from "@mui/material";
import {
  Campaign       as CampaignIcon,
  Send           as SendIcon,
  CheckCircle    as CheckCircleIcon,
  Error          as ErrorIcon,
  Groups         as GroupsIcon,
  UploadFile     as UploadIcon,
} from "@mui/icons-material";
import axios from "axios";

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

const inputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: "10px",
    fontFamily:   "'DM Sans', sans-serif",
    fontSize:     13,
    "& fieldset":        { borderColor: TOKENS.border },
    "&:hover fieldset":  { borderColor: TOKENS.accent },
    "&.Mui-focused fieldset": { borderColor: TOKENS.accent },
  },
  "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 },
};

function SectionHeader({ icon, title, subtitle }) {
  return (
    <Box sx={{ px: 3, py: 2.5, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
      <Box sx={{ color: TOKENS.accent, display: "flex" }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text }}>{title}</Typography>
        {subtitle && <Typography sx={{ ...labelSx, fontSize: 10, mt: 0.2 }}>{subtitle}</Typography>}
      </Box>
    </Box>
  );
}

function StatusBanner({ msg, onClear }) {
  if (!msg) return null;
  const isSuccess = msg.startsWith("✅");
  const isError   = msg.startsWith("❌") || msg.toLowerCase().includes("error") || msg.toLowerCase().includes("failed");
  const tok = isSuccess ? TOKENS.success : isError ? TOKENS.error : TOKENS.warning;
  return (
    <Box sx={{ px: 2.5, py: 1.5, borderRadius: "10px", background: tok.light, border: `1px solid ${tok.fill}44`, display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
      {isSuccess ? <CheckCircleIcon sx={{ fontSize: 14, color: tok.fill, flexShrink: 0 }} /> : isError ? <ErrorIcon sx={{ fontSize: 14, color: tok.fill, flexShrink: 0 }} /> : null}
      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: tok.text, flex: 1 }}>{msg}</Typography>
      {onClear && <Box onClick={onClear} sx={{ cursor: "pointer", color: tok.text, fontSize: 16, lineHeight: 1, fontWeight: 700 }}>×</Box>}
    </Box>
  );
}

export default function AnnouncementDashboard({ token }) {
  const [domains,        setDomains]        = useState([]);
  const [batches,        setBatches]        = useState([]);
  const [selectedBatch,  setSelectedBatch]  = useState("");
  const [learners,       setLearners]       = useState([]);
  const [subject,        setSubject]        = useState("");
  const [message,        setMessage]        = useState("");
  const [messageType,    setMessageType]    = useState("text");
  const [file,           setFile]           = useState(null);
  const [loadingLearners,setLoadingLearners]= useState(false);
  const [sending,        setSending]        = useState(false);
  const [error,          setError]          = useState("");
  const [successMsg,     setSuccessMsg]     = useState("");

  useEffect(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    axios.get(`${API_BASE}/api/domains`, { headers }).then(res => setDomains(Array.isArray(res.data) ? res.data : [])).catch(() => setDomains([]));
    axios.get(`${API_BASE}/api/batches`, { headers }).then(res => setBatches(Array.isArray(res.data) ? res.data : [])).catch(() => setBatches([]));
  }, [token]);

  useEffect(() => {
    if (!selectedBatch) { setLearners([]); return; }
    setLoadingLearners(true);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    axios.get(`${API_BASE}/apigetlearners`, { params: { batchno: selectedBatch }, headers })
      .then(res => setLearners((res.data || []).filter(l => l.email?.trim())))
      .catch(() => { setError("Failed to load learners"); setLearners([]); })
      .finally(() => setLoadingLearners(false));
  }, [selectedBatch, token]);

  const onFileChange = e => {
    const f = e.target.files[0];
    if (f && f.size <= 10 * 1024 * 1024) { setFile(f); setError(""); }
    else setError("File must be < 10MB");
  };

  const onSend = async () => {
    setError(""); setSuccessMsg("");
    if (!subject.trim()) { setError("Subject required"); return; }
    if (!selectedBatch)  { setError("Select a batch"); return; }
    if (!message.trim()) { setError("Message body required"); return; }
    setSending(true);
    try {
      const res = await axios.post(`${API_BASE}/api/announcement/send-direct`, { subject, message, messageType, batch_no: selectedBatch });
      if (res.data.success) {
        setSuccessMsg(`✅ Sent ${res.data.sent} emails (${res.data.failed} failed)`);
        setSubject(""); setMessage(""); setSelectedBatch("");
      } else setError(res.data.error || "Send failed");
    } catch (err) {
      setError(err.response?.data?.error || "Server error");
    } finally { setSending(false); }
  };

  const learnerCount = loadingLearners ? "…" : learners.length;
  const hasLearners  = learners.length > 0;

  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <Box sx={{ maxWidth: 900, mx: "auto" }}>

        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
            Announcement Dashboard
          </Typography>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
            Send batch announcements to all learners from your configured email
          </Typography>
        </Box>

        {/* Batch + learner card */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <SectionHeader icon={<GroupsIcon sx={{ fontSize: 20 }} />} title="Select Batch" subtitle="Choose the batch to send to" />
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-end" }}>
              <FormControl size="small" sx={{ minWidth: 260 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batch *</InputLabel>
                <Select value={selectedBatch} label="Batch *" onChange={e => setSelectedBatch(e.target.value)}
                  sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, borderRadius: "10px", "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.border }, "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent } }}>
                  <MenuItem value=""><em>Select Batch</em></MenuItem>
                  {batches.map(b => (
                    <MenuItem key={b.batch_no || b} value={b.batch_no || b} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                      {b.batch_no || b}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Learner count badge */}
              {selectedBatch && (
                <Box sx={{ px: 2.5, py: 1.2, borderRadius: "12px", background: hasLearners ? TOKENS.success.light : TOKENS.warning.light, border: `1px solid ${hasLearners ? TOKENS.success.fill : TOKENS.warning.fill}44`, display: "flex", alignItems: "center", gap: 1 }}>
                  <GroupsIcon sx={{ fontSize: 16, color: hasLearners ? TOKENS.success.fill : TOKENS.warning.fill }} />
                  <Box>
                    <Typography sx={{ ...labelSx, fontSize: 9, color: hasLearners ? TOKENS.success.text : TOKENS.warning.text }}>Learners</Typography>
                    <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 15, fontWeight: 800, color: hasLearners ? TOKENS.success.fill : TOKENS.warning.fill, lineHeight: 1 }}>
                      {learnerCount}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>

            {/* Sample emails */}
            {hasLearners && (
              <Box sx={{ mt: 2, px: 2, py: 1.5, borderRadius: "10px", background: TOKENS.surfaceAlt, border: `1px solid ${TOKENS.border}` }}>
                <Typography sx={{ ...labelSx, fontSize: 9, mb: 0.5 }}>Sample Recipients</Typography>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.textSub }}>
                  {learners.slice(0, 3).map(l => l.email).join(" · ")}
                  {learners.length > 3 && ` · +${learners.length - 3} more`}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* Compose card */}
        <Box sx={cardSx}>
          <SectionHeader icon={<CampaignIcon sx={{ fontSize: 20 }} />} title="Compose Announcement" subtitle="Draft and send your message" />
          <Box sx={{ p: 3 }}>

            {/* Subject */}
            <Box sx={{ mb: 2.5 }}>
              <Typography sx={{ ...labelSx, mb: 1 }}>Subject *</Typography>
              <TextField fullWidth size="small" value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="Announcement: Batch PDFT17 — Important Update" sx={inputSx} />
            </Box>

            {/* Message format */}
            <Box sx={{ mb: 2.5 }}>
              <Typography sx={{ ...labelSx, mb: 1 }}>Format</Typography>
              <RadioGroup row value={messageType} onChange={e => { setMessageType(e.target.value); setFile(null); }}>
                {[
                  { val: "text", label: "Plain Text" },
                  { val: "html", label: "HTML Email" },
                  { val: "link", label: "Link Only"  },
                ].map(opt => (
                  <FormControlLabel key={opt.val} value={opt.val} control={
                    <Radio size="small" sx={{ color: TOKENS.border, "&.Mui-checked": { color: TOKENS.accent }, p: 0.8 }} />
                  } label={<Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: messageType === opt.val ? TOKENS.accent : TOKENS.textSub, fontWeight: messageType === opt.val ? 700 : 400 }}>{opt.label}</Typography>} />
                ))}
              </RadioGroup>
            </Box>

            {/* Message body */}
            <Box sx={{ mb: 2.5 }}>
              <Typography sx={{ ...labelSx, mb: 1 }}>Message *</Typography>
              <TextField fullWidth multiline rows={6} value={message} onChange={e => setMessage(e.target.value)}
                placeholder={`Dear learners,\nThis is an important announcement for batch ${selectedBatch || "PDFT17"}.\nPlease read carefully.\n\nBest regards,\nTraining Team`}
                sx={inputSx} />
            </Box>

            {/* File upload (if image/file type) */}
            {(messageType === "image" || messageType === "file") && (
              <Box sx={{ mb: 2.5 }}>
                <Typography sx={{ ...labelSx, mb: 1 }}>Attachment</Typography>
                <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2.5, py: 1.5, borderRadius: "10px", border: `2px dashed ${file ? TOKENS.accent : TOKENS.border}`, background: file ? TOKENS.accentLight : TOKENS.surfaceAlt, cursor: "pointer", "&:hover": { border: `2px dashed ${TOKENS.accent}`, background: TOKENS.accentLight } }}>
                  <input type="file" hidden accept={messageType === "image" ? "image/*" : "*/*"} onChange={onFileChange} />
                  <UploadIcon sx={{ fontSize: 18, color: file ? TOKENS.accent : TOKENS.textSub }} />
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: file ? TOKENS.accent : TOKENS.textSub, fontWeight: file ? 600 : 400 }}>
                    {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : "Click to upload file"}
                  </Typography>
                </Box>
              </Box>
            )}

            <StatusBanner msg={error}      onClear={() => setError("")}      />
            <StatusBanner msg={successMsg} onClear={() => setSuccessMsg("")} />

            {/* Send button */}
            <Button variant="contained" fullWidth onClick={onSend}
              disabled={sending || loadingLearners || !hasLearners}
              startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <SendIcon sx={{ fontSize: 16 }} />}
              sx={{ mt: 3, fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 14, textTransform: "none", borderRadius: "10px", py: 1.4, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" }, "&:disabled": { opacity: 0.5 } }}>
              {sending
                ? "Sending…"
                : hasLearners
                ? `Send to ${learners.length} Learners`
                : "Select a batch first"}
            </Button>

            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: TOKENS.textSub, textAlign: "center", mt: 1.5 }}>
              Sends from EMAIL_USER / EMAIL_PASS configured in your .env file
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}