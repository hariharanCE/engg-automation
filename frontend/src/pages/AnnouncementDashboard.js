import React, { useEffect, useMemo, useState } from "react";
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem,
  TextField, Button, CircularProgress, RadioGroup, FormControlLabel, Radio,
  Checkbox, Chip, ListItemText,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from "@mui/material";
import {
  Campaign       as CampaignIcon,
  Send           as SendIcon,
  CheckCircle    as CheckCircleIcon,
  Error          as ErrorIcon,
  InfoOutlined   as InfoOutlinedIcon,
  Groups         as GroupsIcon,
} from "@mui/icons-material";
import axios from "axios";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";

/* Learners are sent in slices so a single request never runs into the
 * serverless time limit, however many batches are selected. */
const SEND_CHUNK = 40;

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

/* The active LoginPage stores under "userSession"; an older flow uses "user". */
function getSessionUser() {
  try {
    const sess = JSON.parse(localStorage.getItem("userSession") || "null");
    if (sess && (sess.role || sess.email)) return sess;
  } catch { /* ignore */ }
  try {
    const u = JSON.parse(localStorage.getItem("user") || "null");
    if (u) return u;
  } catch { /* ignore */ }
  return {};
}

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
  const isWarning = msg.startsWith("⚠️");
  const isError   = !isSuccess && !isWarning;
  const tok  = isSuccess ? TOKENS.success : isWarning ? TOKENS.warning : TOKENS.error;
  const Icon = isSuccess ? CheckCircleIcon : isWarning ? InfoOutlinedIcon : ErrorIcon;
  return (
    <Box sx={{ px: 2.5, py: 1.5, borderRadius: "10px", background: tok.light, border: `1px solid ${tok.fill}44`, display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
      <Icon sx={{ fontSize: 14, color: tok.fill, flexShrink: 0 }} />
      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: tok.text, flex: 1 }}>{msg}</Typography>
      {onClear && <Box onClick={onClear} sx={{ cursor: "pointer", color: tok.text, fontSize: 16, lineHeight: 1, fontWeight: 700 }}>×</Box>}
    </Box>
  );
}

export default function AnnouncementDashboard({ token }) {
  const [batches,         setBatches]         = useState([]);
  const [selectedBatches, setSelectedBatches] = useState([]);   // ← multiple batches
  const [learners,        setLearners]        = useState([]);   // [{ name, email, batch_no }]
  const [subject,         setSubject]         = useState("");
  const [message,         setMessage]         = useState("");
  const [messageType,     setMessageType]     = useState("text");
  const [loadingLearners, setLoadingLearners] = useState(false);
  const [sending,         setSending]         = useState(false);
  const [progress,        setProgress]        = useState(null); // { done, total }
  const [error,           setError]           = useState("");
  const [successMsg,      setSuccessMsg]      = useState("");

  /* Recipient picker dialog */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sel,        setSel]        = useState({});             // { email: true/false }

  const sessionUser = useMemo(getSessionUser, []);

  /* ── Load batches ── */
  useEffect(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    axios.get(`${API_BASE}/api/batches`, { headers })
      .then(res => setBatches(Array.isArray(res.data) ? res.data : []))
      .catch(() => setBatches([]));
  }, [token]);

  const batchOptions = useMemo(() => {
    const names = batches.map(b => (b && b.batch_no) || b).filter(b => typeof b === "string" && b);
    return [...new Set(names)];
  }, [batches]);

  /* ── Load learners of every selected batch ── */
  useEffect(() => {
    if (!selectedBatches.length) { setLearners([]); return; }

    let cancelled = false;
    setLoadingLearners(true);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    Promise.allSettled(
      selectedBatches.map(b =>
        axios.get(`${API_BASE}/apigetlearners`, { params: { batchno: b }, headers })
      )
    )
      .then(results => {
        if (cancelled) return;
        const seen = new Set();
        const all  = [];
        const failedBatches = [];

        results.forEach((r, i) => {
          const batch = selectedBatches[i];
          if (r.status !== "fulfilled") { failedBatches.push(batch); return; }
          (r.value.data || []).forEach(l => {
            const email = (l.email || "").trim();
            if (!email) return;
            const key = email.toLowerCase();
            if (seen.has(key)) return;          // same learner in two batches → one mail
            seen.add(key);
            all.push({ name: l.name || "", email, batch_no: l.batch_no || batch });
          });
        });

        setLearners(all);
        setError(failedBatches.length ? `Failed to load learners for: ${failedBatches.join(", ")}` : "");
      })
      .finally(() => { if (!cancelled) setLoadingLearners(false); });

    return () => { cancelled = true; };
  }, [selectedBatches, token]);

  /* Learners grouped by batch, in the order the batches were picked */
  const groups = useMemo(() => {
    const map = {};
    learners.forEach(l => { (map[l.batch_no] = map[l.batch_no] || []).push(l); });
    return selectedBatches.filter(b => map[b]).map(b => [b, map[b]]);
  }, [learners, selectedBatches]);

  const learnerCount = loadingLearners ? "…" : learners.length;
  const hasLearners  = learners.length > 0;
  const selCount     = learners.filter(l => sel[l.email]).length;

  /* ── Dialog helpers ── */
  const openDialog = () => {
    setError(""); setSuccessMsg("");
    if (!selectedBatches.length) { setError("Select at least one batch"); return; }
    if (!subject.trim())         { setError("Subject required"); return; }
    if (!message.trim())         { setError("Message body required"); return; }
    if (!hasLearners)            { setError("No learners with an email in the selected batches"); return; }

    const all = {};
    learners.forEach(l => { all[l.email] = true; });
    setSel(all);
    setDialogOpen(true);
  };

  const setGroupSel = (list, checked) =>
    setSel(prev => {
      const next = { ...prev };
      list.forEach(l => { next[l.email] = checked; });
      return next;
    });

  /* ── Send ── */
  const onConfirmSend = async () => {
    const chosen = learners.filter(l => sel[l.email]);
    if (!chosen.length) { setError("Select at least one learner"); return; }

    setDialogOpen(false);
    setSending(true); setError(""); setSuccessMsg("");
    setProgress({ done: 0, total: chosen.length });

    let sent = 0, failed = 0, skipped = 0;
    try {
      for (let i = 0; i < chosen.length; i += SEND_CHUNK) {
        const part = chosen.slice(i, i + SEND_CHUNK);
        const res  = await axios.post(`${API_BASE}/api/announcement/send-batches`, {
          subject,
          message,
          messageType,
          role: sessionUser?.role || "",
          recipients: part.map(l => ({ email: l.email, name: l.name, batch_no: l.batch_no })),
        });
        const d = res.data || {};
        sent    += d.sent || 0;
        failed  += d.failed || 0;
        skipped += (d.skipped || []).length;
        setProgress({ done: i + part.length, total: chosen.length });
      }

      if (failed || skipped) {
        setError(`⚠️ Sent ${sent}, failed ${failed}, skipped ${skipped}`);
      } else {
        setSuccessMsg(`✅ Announcement emailed to ${sent} learner${sent !== 1 ? "s" : ""} across ${groups.length} batch${groups.length !== 1 ? "es" : ""}`);
        setSubject(""); setMessage(""); setSelectedBatches([]);
      }
    } catch (err) {
      const reason = err.response?.data?.error || err.message || "Server error";
      setError(`${reason}${sent ? ` — ${sent} learner${sent !== 1 ? "s" : ""} had already received it` : ""}`);
    } finally {
      setSending(false);
      setProgress(null);
    }
  };

  const firstBatch = selectedBatches[0] || "PDFT17";

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
            Send announcements to the learners of one or more batches
          </Typography>
        </Box>

        {/* Batch + learner card */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <SectionHeader icon={<GroupsIcon sx={{ fontSize: 20 }} />} title="Select Batches" subtitle="Choose one or more batches to send to" />
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-end" }}>
              <FormControl size="small" sx={{ minWidth: 300, maxWidth: "100%" }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batches *</InputLabel>
                <Select
                  multiple
                  value={selectedBatches}
                  label="Batches *"
                  onChange={e => {
                    const v = e.target.value;
                    setSelectedBatches(typeof v === "string" ? v.split(",") : v);
                  }}
                  renderValue={picked => (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {picked.map(v => (
                        <Chip key={v} label={v} size="small"
                          sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.accentLight, color: TOKENS.accent }} />
                      ))}
                    </Box>
                  )}
                  MenuProps={{ PaperProps: { style: { maxHeight: 360 } } }}
                  sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, borderRadius: "10px", "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.border }, "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent } }}>
                  {batchOptions.map(b => (
                    <MenuItem key={b} value={b} dense>
                      <Checkbox size="small" checked={selectedBatches.includes(b)} />
                      <ListItemText primary={b} primaryTypographyProps={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {selectedBatches.length > 0 && (
                <Button size="small" onClick={() => setSelectedBatches([])}
                  sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, textTransform: "none", color: TOKENS.textSub }}>
                  Clear
                </Button>
              )}

              {/* Learner count badge */}
              {selectedBatches.length > 0 && (
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

            {/* Per-batch learner counts */}
            {hasLearners && (
              <Box sx={{ mt: 2, display: "flex", gap: 1, flexWrap: "wrap" }}>
                {groups.map(([batch, list]) => (
                  <Chip key={batch} size="small" label={`${batch} · ${list.length}`}
                    sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.surfaceAlt, border: `1px solid ${TOKENS.border}` }} />
                ))}
              </Box>
            )}

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
                placeholder="Important Update — Please Read" sx={inputSx} />
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: TOKENS.textSub, mt: 0.6 }}>
                Each learner's email subject is prefixed with their own batch, e.g. [{firstBatch}] {subject || "Important Update"}
              </Typography>
            </Box>

            {/* Message format */}
            <Box sx={{ mb: 2.5 }}>
              <Typography sx={{ ...labelSx, mb: 1 }}>Format</Typography>
              <RadioGroup row value={messageType} onChange={e => setMessageType(e.target.value)}>
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
              <Typography sx={{ ...labelSx, mb: 1 }}>
                {messageType === "link" ? "Link *" : messageType === "html" ? "Message (HTML) *" : "Message *"}
              </Typography>
              <TextField fullWidth multiline rows={6} value={message} onChange={e => setMessage(e.target.value)}
                placeholder={
                  messageType === "link"
                    ? `Paste the link (and an optional note), e.g.\nhttps://meet.google.com/abc-defg-hij`
                    : messageType === "html"
                    ? `<p>This is an important announcement for batch ${firstBatch}.</p>`
                    : `This is an important announcement for batch ${firstBatch}.\nPlease read carefully.`
                }
                sx={inputSx} />
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: TOKENS.textSub, mt: 0.6 }}>
                Every email opens with "Dear &lt;learner name&gt;, Greetings from ChipEdge Technologies!" and ends with your Training Team sign-off — you only write the message.
              </Typography>
            </Box>

            <StatusBanner msg={error}      onClear={() => setError("")}      />
            <StatusBanner msg={successMsg} onClear={() => setSuccessMsg("")} />

            {/* Review & send */}
            <Button variant="contained" fullWidth onClick={openDialog}
              disabled={sending || loadingLearners || !hasLearners}
              startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <SendIcon sx={{ fontSize: 16 }} />}
              sx={{ mt: 3, fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 14, textTransform: "none", borderRadius: "10px", py: 1.4, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" }, "&:disabled": { opacity: 0.5 } }}>
              {sending
                ? `Sending… ${progress ? `${progress.done} / ${progress.total}` : ""}`
                : hasLearners
                ? `Review & Send to ${learners.length} Learner${learners.length !== 1 ? "s" : ""}`
                : "Select batches first"}
            </Button>

            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: TOKENS.textSub, textAlign: "center", mt: 1.5 }}>
              Each learner gets their own individual email — recipients cannot see one another.
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* ── Recipient picker dialog ── */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800 }}>
          Send announcement
        </DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, mb: 1.5 }}>
            <strong>Subject:</strong> {subject}
          </Typography>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <Button size="small" onClick={() => setGroupSel(learners, true)}>Select all</Button>
            <Button size="small" onClick={() => setGroupSel(learners, false)}>Clear</Button>
            <Typography sx={{ ...labelSx, ml: "auto" }}>{selCount} of {learners.length} selected</Typography>
          </Box>

          <Box sx={{ maxHeight: 340, overflowY: "auto", border: `1px solid ${TOKENS.border}`, borderRadius: "10px" }}>
            {groups.map(([batch, list]) => {
              const ticked = list.filter(l => sel[l.email]).length;
              return (
                <Box key={batch}>
                  <Box sx={{ display: "flex", alignItems: "center", px: 1, py: 0.3, background: TOKENS.surfaceAlt, borderBottom: `1px solid ${TOKENS.border}`, position: "sticky", top: 0, zIndex: 1 }}>
                    <Checkbox size="small"
                      checked={ticked === list.length}
                      indeterminate={ticked > 0 && ticked < list.length}
                      onChange={e => setGroupSel(list, e.target.checked)} />
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 800 }}>{batch}</Typography>
                    <Typography sx={{ ...labelSx, ml: "auto", mr: 1 }}>{ticked}/{list.length}</Typography>
                  </Box>
                  {list.map(l => (
                    <FormControlLabel key={l.email} sx={{ display: "flex", m: 0, pl: 3, pr: 1 }}
                      control={<Checkbox size="small" checked={!!sel[l.email]}
                        onChange={e => setSel(p => ({ ...p, [l.email]: e.target.checked }))} />}
                      label={
                        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                          {l.name || "—"} · <span style={{ color: TOKENS.textSub }}>{l.email}</span>
                        </Typography>
                      } />
                  ))}
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!selCount || sending} onClick={onConfirmSend}>
            Send to {selCount}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}