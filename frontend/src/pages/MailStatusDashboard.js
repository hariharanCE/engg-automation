import React, { useState, useEffect } from "react";
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem,
  TextField, Table, TableHead, TableRow, TableCell, TableBody,
  Fade, Divider, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, IconButton, Collapse, Chip, CircularProgress,
} from "@mui/material";
import {
  Edit            as EditIcon,
  Close           as CloseIcon,
  Send            as SendIcon,
  KeyboardArrowDown as ExpandMoreIcon,
  KeyboardArrowUp   as ExpandLessIcon,
  MailOutline     as MailIcon,
  Reply           as ReplyIcon,
  CheckCircle     as CheckCircleIcon,
  Error           as ErrorIcon,
  InfoOutlined    as InfoIcon,
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

function SectionHeader({ icon, title, subtitle }) {
  return (
    <Box sx={{
      px: 3, py: 2.5,
      background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`,
      borderBottom: `1px solid ${TOKENS.border}`,
      display: "flex", alignItems: "center", gap: 1.5,
    }}>
      <Box sx={{ color: TOKENS.accent, display: "flex" }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.02em" }}>
          {title}
        </Typography>
        {subtitle && <Typography sx={{ ...labelSx, fontSize: 10, mt: 0.2 }}>{subtitle}</Typography>}
      </Box>
    </Box>
  );
}

function StatusChip({ status }) {
  const map = {
    sent:      { bg: TOKENS.success.light, color: TOKENS.success.text, border: TOKENS.success.fill },
    failed:    { bg: TOKENS.error.light,   color: TOKENS.error.text,   border: TOKENS.error.fill   },
    scheduled: { bg: TOKENS.warning.light, color: TOKENS.warning.text, border: TOKENS.warning.fill },
  };
  const s = map[status] || { bg: TOKENS.surfaceAlt, color: TOKENS.textSub, border: TOKENS.border };
  return (
    <Box component="span" sx={{ px: 1.2, py: 0.3, borderRadius: "20px", background: s.bg, border: `1px solid ${s.border}44`, display: "inline-flex", alignItems: "center" }}>
      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, color: s.color }}>{status || "—"}</Typography>
    </Box>
  );
}

export default function MailStatusDashboard({ user }) {
  const [batches,          setBatches]          = useState([]);
  const [selectedBatch,    setSelectedBatch]    = useState("");
  const [recipientEmail,   setRecipientEmail]   = useState("");
  const [rows,             setRows]             = useState([]);
  const [groupedData,      setGroupedData]      = useState([]);
  const [message,          setMessage]          = useState("");
  const [expandedTemplates,setExpandedTemplates]= useState({});

  const [replyBatch,       setReplyBatch]       = useState("");
  const [replyMode,        setReplyMode]        = useState("");
  const [templates,        setTemplates]        = useState([]);
  const [replyTemplate,    setReplyTemplate]    = useState("");
  const [emailBody,        setEmailBody]        = useState("");
  const [sending,          setSending]          = useState(false);
  const [sendMessage,      setSendMessage]      = useState("");

  const [editingEmail,     setEditingEmail]     = useState(null);
  const [editedEmailValue, setEditedEmailValue] = useState("");

  const [emailModalOpen,   setEmailModalOpen]   = useState(false);
  const [selectedEmailContent, setSelectedEmailContent] = useState(null);
  const [editedEmailSubject,   setEditedEmailSubject]   = useState("");
  const [editedEmailBody,      setEditedEmailBody]      = useState("");
  const [resendingEmail,   setResendingEmail]   = useState(false);
  const [resendMessage,    setResendMessage]    = useState("");

  const roleTitle   = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Dashboard";
  const welcomeName = user?.name || "User";

  useEffect(() => {
    fetch(`${API_BASE}/api/batches`).then(r => r.json()).then(d => setBatches(d || [])).catch(() => setBatches([]));
  }, []);

  useEffect(() => {
    if (!replyMode) { setTemplates([]); setReplyTemplate(""); return; }
    fetch(`${API_BASE}/api/templates?mode=${encodeURIComponent(replyMode)}`).then(r => r.json()).then(d => { setTemplates(d || []); setReplyTemplate(""); }).catch(() => { setTemplates([]); setReplyTemplate(""); });
  }, [replyMode]);

  useEffect(() => {
    if (!selectedBatch.trim() && !recipientEmail.trim()) { setRows([]); setGroupedData([]); setMessage(""); return; }
    const params = new URLSearchParams();
    if (selectedBatch.trim()) params.append("batch_no", selectedBatch.trim());
    if (recipientEmail.trim()) params.append("recipient_email", recipientEmail.trim());
    fetch(`${API_BASE}/api/mail-dashboard/list?${params}`)
      .then(r => r.json())
      .then(data => {
        setRows(data || []);
        if (!data?.length) { setMessage("No mails found."); setGroupedData([]); }
        else { setMessage(""); groupDataByTemplate(data); }
      })
      .catch(() => { setMessage("Failed to fetch mail status data."); setGroupedData([]); });
  }, [selectedBatch, recipientEmail]);

  const groupDataByTemplate = (data) => {
    const grouped = {};
    data.forEach(row => {
      const tn = row.template_name || "Unknown Template";
      if (!grouped[tn]) grouped[tn] = { templateName: tn, emails: [], totalCount: 0, sentCount: 0, failedCount: 0, scheduledCount: 0 };
      grouped[tn].emails.push(row);
      grouped[tn].totalCount++;
      if (row.status === "sent") grouped[tn].sentCount++;
      else if (row.status === "failed") grouped[tn].failedCount++;
      else if (row.status === "scheduled") grouped[tn].scheduledCount++;
    });
    setGroupedData(Object.values(grouped));
  };

  const toggleTemplate = tn => setExpandedTemplates(p => ({ ...p, [tn]: !p[tn] }));

  const handleEmailClick = (emailId, currentEmail) => { setEditingEmail(emailId); setEditedEmailValue(currentEmail); };

  const handleSaveEmail = async (emailId) => {
    if (!editedEmailValue.trim()) { alert("Email cannot be empty"); return; }
    const res = await fetch(`${API_BASE}/api/mail/update-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mail_id: emailId, new_email: editedEmailValue.trim() }) });
    const data = await res.json();
    if (data.success) {
      const updated = rows.map(r => (r.id === emailId || r.mail_id === emailId) ? { ...r, recipient_email: editedEmailValue.trim() } : r);
      setRows(updated); groupDataByTemplate(updated); setEditingEmail(null); setMessage("✅ Email updated successfully");
    } else alert("Failed to update email: " + (data.error || "Unknown error"));
  };

  const handleStatusClick = async (row) => {
    if (row.status !== "sent") { alert("You can only view/edit sent emails"); return; }
    const mailId = row.id || row.mail_id || row.email_id;
    if (!mailId) { alert("Error: Mail ID not found"); return; }
    const res = await fetch(`${API_BASE}/api/mail/content?mail_id=${encodeURIComponent(mailId)}`);
    const data = await res.json();
    if (data.success) { setSelectedEmailContent({ ...data.email, id: mailId }); setEditedEmailSubject(data.email.subject || ""); setEditedEmailBody(data.email.body || ""); setEmailModalOpen(true); setResendMessage(""); }
    else alert("Failed to fetch email content: " + (data.error || "Unknown error"));
  };

  const handleResendEmail = async () => {
    if (!editedEmailSubject.trim() || !editedEmailBody.trim()) { setResendMessage("Subject and body cannot be empty"); return; }
    setResendingEmail(true); setResendMessage("");
    const res = await fetch(`${API_BASE}/api/mail/resend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mail_id: selectedEmailContent.id, recipient_email: selectedEmailContent.recipient_email, subject: editedEmailSubject.trim(), body: editedEmailBody.trim() }) });
    const data = await res.json();
    setResendingEmail(false);
    if (data.success) { setResendMessage("✅ Email resent successfully!"); setTimeout(() => setEmailModalOpen(false), 2000); }
    else setResendMessage("❌ Failed to resend: " + (data.error || "Unknown error"));
  };

  const handleSendEmails = () => {
    setSendMessage("");
    if (!replyBatch) { setSendMessage("Please select a batch number."); return; }
    if (!replyMode)  { setSendMessage("Please select a mode."); return; }
    if (!replyTemplate) { setSendMessage("Please select a template name."); return; }
    if (!emailBody.trim()) { setSendMessage("Please enter the email body."); return; }
    setSending(true);
    fetch(`${API_BASE}/api/mail/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch_no: replyBatch, mode: replyMode, template_name: replyTemplate, email_body: emailBody.trim() }) })
      .then(r => r.json())
      .then(data => {
        setSending(false);
        if (data.success) { setSendMessage("Emails sent successfully."); setEmailBody(""); setReplyTemplate(""); setReplyBatch(""); setReplyMode(""); }
        else setSendMessage(data.error || "Failed to send emails.");
      })
      .catch(() => { setSending(false); setSendMessage("Failed to send emails."); });
  };

  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <Box sx={{ maxWidth: 1200, mx: "auto" }}>

        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
            {roleTitle} — Mail Dashboard
          </Typography>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
            Welcome back, <strong style={{ color: TOKENS.accent }}>{welcomeName}</strong>
          </Typography>
        </Box>

        {/* ── Mail Status Section ── */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <SectionHeader icon={<MailIcon sx={{ fontSize: 20 }} />} title="Sent Mail Status" subtitle="Filter by batch or recipient email" />
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batch No</InputLabel>
                <Select value={selectedBatch} label="Batch No" onChange={e => setSelectedBatch(e.target.value)} sx={inputSx}>
                  <MenuItem value="" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}></MenuItem>
                  {batches.map(b => (
                    <MenuItem key={b.batch_no} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                      {b.batch_no}{b.start_date ? ` (${b.start_date})` : ""}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField size="small" label="Recipient Email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                placeholder="Filter by recipient email" sx={{ minWidth: 280, "& .MuiOutlinedInput-root": { ...inputSx, fontFamily: "'DM Sans', sans-serif" }, "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 } }} />
            </Box>

            {/* Grouped table */}
            <Box sx={{ border: `1px solid ${TOKENS.border}`, borderRadius: "10px", overflow: "hidden" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ ...tableHeadSx, width: 40 }} />
                    <TableCell sx={tableHeadSx}>Template Name</TableCell>
                    <TableCell align="center" sx={tableHeadSx}>Total</TableCell>
                    <TableCell align="center" sx={tableHeadSx}>Sent</TableCell>
                    <TableCell align="center" sx={tableHeadSx}>Failed</TableCell>
                    <TableCell align="center" sx={tableHeadSx}>Scheduled</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {groupedData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>
                          No mails found. Select a batch or enter recipient email.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    groupedData.map(group => (
                      <React.Fragment key={group.templateName}>
                        <TableRow onClick={() => toggleTemplate(group.templateName)}
                          sx={{ cursor: "pointer", background: TOKENS.surfaceAlt, "&:hover": { background: `${TOKENS.accent}06` } }}>
                          <TableCell sx={{ tableCellSx, width: 40 }}>
                            <IconButton size="small" sx={{ color: TOKENS.textSub }}>
                              {expandedTemplates[group.templateName] ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                            </IconButton>
                          </TableCell>
                          <TableCell sx={{ ...tableCellSx, fontWeight: 700 }}>{group.templateName}</TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <Box sx={{ display: "inline-flex", px: 1.2, py: 0.3, borderRadius: "20px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                              <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color: TOKENS.accent }}>{group.totalCount}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <Box sx={{ display: "inline-flex", px: 1.2, py: 0.3, borderRadius: "20px", background: TOKENS.success.light, border: `1px solid ${TOKENS.success.fill}44` }}>
                              <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color: TOKENS.success.fill }}>{group.sentCount}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <Box sx={{ display: "inline-flex", px: 1.2, py: 0.3, borderRadius: "20px", background: TOKENS.error.light, border: `1px solid ${TOKENS.error.fill}44` }}>
                              <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color: TOKENS.error.fill }}>{group.failedCount}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell align="center" sx={tableCellSx}>
                            <Box sx={{ display: "inline-flex", px: 1.2, py: 0.3, borderRadius: "20px", background: TOKENS.warning.light, border: `1px solid ${TOKENS.warning.fill}44` }}>
                              <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color: TOKENS.warning.fill }}>{group.scheduledCount}</Typography>
                            </Box>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={6} sx={{ p: 0, border: 0 }}>
                            <Collapse in={expandedTemplates[group.templateName]} timeout="auto" unmountOnExit>
                              <Box sx={{ background: "#fafbff", borderTop: `1px solid ${TOKENS.border}`, borderBottom: `1px solid ${TOKENS.border}` }}>
                                <Table size="small">
                                  <TableHead>
                                    <TableRow>
                                      {["Batch No", "Recipient Email", "Status"].map(h => (
                                        <TableCell key={h} sx={{ ...tableHeadSx, fontSize: 10, background: "#f0f3ff" }}>{h}</TableCell>
                                      ))}
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {group.emails.map((email, idx) => {
                                      const emailId = email.id || email.mail_id || email.email_id;
                                      const isEditing = editingEmail === emailId;
                                      return (
                                        <TableRow key={idx} sx={{ "&:nth-of-type(even)": { background: "#f5f7ff" } }}>
                                          <TableCell sx={{ ...tableCellSx, fontSize: 12, fontFamily: "'DM Mono', monospace", color: TOKENS.textSub }}>{email.batch_no}</TableCell>
                                          <TableCell sx={tableCellSx}>
                                            {isEditing ? (
                                              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                                                <TextField size="small" value={editedEmailValue} onChange={e => setEditedEmailValue(e.target.value)} sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 12 } }} />
                                                <Button size="small" variant="contained" onClick={() => handleSaveEmail(emailId)}
                                                  sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, textTransform: "none", borderRadius: "8px", background: TOKENS.accent }}>Save</Button>
                                                <Button size="small" onClick={() => setEditingEmail(null)}
                                                  sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, textTransform: "none", borderRadius: "8px", color: TOKENS.textSub }}>Cancel</Button>
                                              </Box>
                                            ) : (
                                              <Box onClick={() => handleEmailClick(emailId, email.recipient_email)}
                                                sx={{ cursor: "pointer", color: TOKENS.accent, textDecoration: "underline dotted", textUnderlineOffset: "3px", fontSize: 13, fontFamily: "'DM Sans', sans-serif", "&:hover": { color: "#2a3fd4" } }}>
                                                {email.recipient_email}
                                              </Box>
                                            )}
                                          </TableCell>
                                          <TableCell sx={tableCellSx}>
                                            <Box onClick={() => handleStatusClick(email)}
                                              sx={{ cursor: email.status === "sent" ? "pointer" : "default", display: "inline-block" }}>
                                              <StatusChip status={email.status} />
                                            </Box>
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </Box>

            <Fade in={!!message}>
              <Box sx={{ mt: 2 }}>
                {message && (
                  <Box sx={{ px: 2.5, py: 1.5, borderRadius: "10px",
                    background: message.startsWith("✅") ? TOKENS.success.light : TOKENS.warning.light,
                    border: `1px solid ${message.startsWith("✅") ? TOKENS.success.fill : TOKENS.warning.fill}44`,
                    display: "flex", alignItems: "center", gap: 1 }}>
                    {message.startsWith("✅")
                      ? <CheckCircleIcon sx={{ fontSize: 14, color: TOKENS.success.fill }} />
                      : <InfoIcon sx={{ fontSize: 14, color: TOKENS.warning.fill }} />}
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600,
                      color: message.startsWith("✅") ? TOKENS.success.text : TOKENS.warning.text }}>{message}</Typography>
                  </Box>
                )}
              </Box>
            </Fade>
          </Box>
        </Box>

        {/* ── Reply to Mail Section ── */}
        <Box sx={cardSx}>
          <SectionHeader icon={<ReplyIcon sx={{ fontSize: 20 }} />} title="Reply to Mail" subtitle="Compose and send batch reply emails" />
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batch No</InputLabel>
                <Select value={replyBatch} label="Batch No" onChange={e => setReplyBatch(e.target.value)} sx={inputSx}>
                  <MenuItem value="" />
                  {batches.map(b => (
                    <MenuItem key={b.batch_no} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                      {b.batch_no}{b.start_date ? ` (${b.start_date})` : ""}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Mode</InputLabel>
                <Select value={replyMode} label="Mode" onChange={e => setReplyMode(e.target.value)} sx={inputSx}>
                  <MenuItem value="" />
                  <MenuItem value="Online"  sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Online</MenuItem>
                  <MenuItem value="Offline" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Offline</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Template Name</InputLabel>
                <Select value={replyTemplate} label="Template Name" onChange={e => setReplyTemplate(e.target.value)} disabled={!replyMode || templates.length === 0} sx={inputSx}>
                  <MenuItem value="" />
                  {templates.map(t => (
                    <MenuItem key={t.template_name} value={t.template_name} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{t.template_name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <TextField multiline rows={5} fullWidth label="Email Body" value={emailBody} onChange={e => setEmailBody(e.target.value)}
              placeholder="Enter email body here" sx={{ mb: 3,
                "& .MuiOutlinedInput-root": { borderRadius: "10px", fontFamily: "'DM Sans', sans-serif", fontSize: 13, "& fieldset": { borderColor: TOKENS.border }, "&:hover fieldset": { borderColor: TOKENS.accent }, "&.Mui-focused fieldset": { borderColor: TOKENS.accent } },
                "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 } }} />

            <Button variant="contained" onClick={handleSendEmails} disabled={sending}
              startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <SendIcon sx={{ fontSize: 16 }} />}
              sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", px: 3, py: 1.2, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" }, "&:disabled": { opacity: 0.5 } }}>
              {sending ? "Sending…" : "Send Emails"}
            </Button>

            {sendMessage && (
              <Box sx={{ mt: 2, px: 2.5, py: 1.5, borderRadius: "10px",
                background: sendMessage.includes("successfully") ? TOKENS.success.light : TOKENS.error.light,
                border: `1px solid ${sendMessage.includes("successfully") ? TOKENS.success.fill : TOKENS.error.fill}44`,
                display: "flex", alignItems: "center", gap: 1 }}>
                {sendMessage.includes("successfully")
                  ? <CheckCircleIcon sx={{ fontSize: 14, color: TOKENS.success.fill }} />
                  : <ErrorIcon sx={{ fontSize: 14, color: TOKENS.error.fill }} />}
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600,
                  color: sendMessage.includes("successfully") ? TOKENS.success.text : TOKENS.error.text }}>{sendMessage}</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* ── Email Content Modal ── */}
      <Dialog open={emailModalOpen} onClose={() => setEmailModalOpen(false)} maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: "16px", overflow: "hidden" } }}>
        <DialogTitle sx={{ p: 0 }}>
          <Box sx={{ px: 3, py: 2.5, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <MailIcon sx={{ fontSize: 20, color: TOKENS.accent }} />
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text }}>View / Edit Email</Typography>
            </Box>
            <IconButton size="small" onClick={() => setEmailModalOpen(false)} sx={{ color: TOKENS.textSub }}><CloseIcon fontSize="small" /></IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Box sx={{ mb: 2.5, px: 2, py: 1.5, borderRadius: "10px", background: TOKENS.surfaceAlt, border: `1px solid ${TOKENS.border}` }}>
            <Typography sx={{ ...labelSx, fontSize: 10 }}>To</Typography>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.text, mt: 0.3 }}>
              {selectedEmailContent?.recipient_email}
            </Typography>
          </Box>
          <TextField label="Subject" fullWidth value={editedEmailSubject} onChange={e => setEditedEmailSubject(e.target.value)} sx={{ mb: 2,
            "& .MuiOutlinedInput-root": { borderRadius: "10px", fontFamily: "'DM Sans', sans-serif", fontSize: 13 },
            "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 } }} />
          <TextField label="Email Body" fullWidth multiline rows={10} value={editedEmailBody} onChange={e => setEditedEmailBody(e.target.value)}
            sx={{ "& .MuiOutlinedInput-root": { borderRadius: "10px", fontFamily: "'DM Sans', sans-serif", fontSize: 13 },
                  "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 } }} />
          {resendMessage && (
            <Box sx={{ mt: 2, px: 2.5, py: 1.5, borderRadius: "10px",
              background: resendMessage.startsWith("✅") ? TOKENS.success.light : TOKENS.error.light,
              border: `1px solid ${resendMessage.startsWith("✅") ? TOKENS.success.fill : TOKENS.error.fill}44` }}>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600,
                color: resendMessage.startsWith("✅") ? TOKENS.success.text : TOKENS.error.text }}>{resendMessage}</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${TOKENS.border}`, gap: 1 }}>
          <Button onClick={() => setEmailModalOpen(false)} sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", color: TOKENS.textSub }}>Cancel</Button>
          <Button variant="contained" onClick={handleResendEmail} disabled={resendingEmail}
            startIcon={resendingEmail ? <CircularProgress size={14} color="inherit" /> : <SendIcon sx={{ fontSize: 16 }} />}
            sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, textTransform: "none", borderRadius: "10px", background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}>
            {resendingEmail ? "Sending…" : "Resend Email"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}