import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Fade,
  CircularProgress,
  Chip,
} from '@mui/material';
import Papa from 'papaparse';
import axios from 'axios';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import EmailIcon from '@mui/icons-material/Email';
import RefreshIcon from '@mui/icons-material/Refresh';
import SchoolIcon from '@mui/icons-material/School';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";

/* ─── Design tokens ─────────────────────────────────────────────────────── */
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

/* ─── Validation helpers ─────────────────────────────────────────────────── */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateEmail(email) { return !!email && emailRegex.test(email); }
function validatePhone(phone) {
  if (!phone) return false;
  const n = String(phone).replace(/[\s\-\(\)]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(n)) return true;
  if (/^[6-9]\d{9}$/.test(n)) return true;
  if (/^[2-9]\d{9}$/.test(n)) return true;
  if (/^\d{7,15}$/.test(n)) return true;
  return false;
}

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

/* ─── ResendFailedEmails ─────────────────────────────────────────────────── */
function ResendFailedEmails({ batchNo }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleResend = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/resend-failed-emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_no: batchNo }),
      });
      const data = await res.json();
      if (res.ok) setMessage(data.message || "✅ Resent failed emails successfully");
      else setMessage("❌ Failed to resend: " + (data.error || "Unknown error"));
    } catch (err) {
      setMessage("❌ Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const isSuccess = message.startsWith("✅");

  return (
    <Box sx={{ mt: 2 }}>
      <Button
        variant="outlined"
        disabled={!batchNo || loading}
        startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 16 }} />}
        onClick={handleResend}
        size="small"
        sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", borderColor: TOKENS.border, color: TOKENS.textSub, textTransform: "none", px: 2, "&:hover": { borderColor: TOKENS.accent, color: TOKENS.accent, background: TOKENS.accentLight } }}
      >
        Resend Failed Emails
      </Button>
      {message && (
        <Fade in>
          <Box sx={{ mt: 1, px: 2, py: 1, borderRadius: "8px", background: isSuccess ? TOKENS.success.light : TOKENS.error.light, border: `1px solid ${isSuccess ? TOKENS.success.fill : TOKENS.error.fill}44`, display: "inline-flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: isSuccess ? TOKENS.success.text : TOKENS.error.text }}>{message}</Typography>
          </Box>
        </Fade>
      )}
    </Box>
  );
}

/* ─── DataTable ──────────────────────────────────────────────────────────── */
function DataTable({ headers, rows, renderRow }) {
  return (
    <Box sx={{ maxHeight: 300, overflow: "auto", borderRadius: "10px", border: `1px solid ${TOKENS.border}`, mt: 2 }}>
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontFamily: "'DM Sans', sans-serif" }}>
        <Box component="thead" sx={{ position: "sticky", top: 0, zIndex: 1 }}>
          <Box component="tr">
            {headers.map(h => (
              <Box component="th" key={h} sx={{ ...labelSx, background: TOKENS.surfaceAlt, borderBottom: `2px solid ${TOKENS.border}`, p: "8px 12px", whiteSpace: "nowrap", textAlign: "left" }}>{h}</Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">{rows.map((row, idx) => renderRow(row, idx))}</Box>
      </Box>
    </Box>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
export default function HomeDashboard({ user }) {
  const [learnersFile, setLearnersFile] = useState(null);
  const [uploadMsg, setUploadMsg] = useState("");
  const [learnerRows, setLearnerRows] = useState([]);
  const [showLearnerPreview, setShowLearnerPreview] = useState(false);

  const [plannerFile, setPlannerFile] = useState(null);
  const [plannerMsg, setPlannerMsg] = useState("");
  const [plannerRows, setPlannerRows] = useState([]);
  const [showPlannerPreview, setShowPlannerPreview] = useState(false);

  // FIX: Store batches as array of objects { batch_no, start_date }
  const [batches, setBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(true);

  const [selectedBatch, setSelectedBatch] = useState("");
  const [mode, setMode] = useState("Online");
  const [batchType, setBatchType] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [offsetValue, setOffsetValue] = useState("");
  const [classRoom, setClassRoom] = useState("");
  const [mockInterviewOffset, setMockInterviewOffset] = useState("7");

  // Editable email templates loaded once batch/mode (+ batch type) are chosen.
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesMsg, setTemplatesMsg] = useState("");

  /* ── FIX: Robust batch loading ── */
  useEffect(() => {
    const fetchBatches = async () => {
      setLoadingBatches(true);
      try {
        const res = await fetch(`${API_BASE}/api/batches`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!Array.isArray(data)) {
          console.warn("/api/batches returned non-array:", data);
          setBatches([]);
          return;
        }

        // Normalize: each item may be a string, or an object with batch_no
        const normalized = data
          .map(b => {
            if (typeof b === "string") return { batch_no: b, start_date: "" };
            if (b && typeof b === "object" && b.batch_no) return b;
            return null;
          })
          .filter(Boolean)
          // Sort by batch_no for consistent ordering
          .sort((a, b) => (a.batch_no || "").localeCompare(b.batch_no || ""));

        console.log(`Loaded ${normalized.length} batches:`, normalized.map(b => b.batch_no));
        setBatches(normalized);
      } catch (err) {
        console.error("Failed to fetch batches:", err);
        setMessage("❌ Failed to fetch batches");
        setBatches([]);
      } finally {
        setLoadingBatches(false);
      }
    };
    fetchBatches();
  }, []);

  /* ── Auto-fill mode/classroom from planner meta when batch changes ── */
  useEffect(() => {
    const fetchPlannerMeta = async () => {
      if (!selectedBatch) return;
      try {
        const res = await fetch(`${API_BASE}/api/course-planner-meta/${encodeURIComponent(selectedBatch)}`);
        if (!res.ok) { setMode("Online"); setBatchType(""); setClassRoom(""); return; }
        const data = await res.json();
        if (data.mode) setMode(data.mode);
        if (data.classroom_name) setClassRoom(data.classroom_name);
        if (data.mode?.toLowerCase() === "offline" && data.batch_type) setBatchType(data.batch_type);
        else if (data.mode?.toLowerCase() !== "offline") setBatchType("");
      } catch (err) {
        console.error("Error fetching planner meta:", err);
      }
    };
    fetchPlannerMeta();
  }, [selectedBatch]);

  /* ── Load editable email templates once batch + mode (+ batch type) set ── */
  useEffect(() => {
    const canLoad = selectedBatch && mode && (mode !== "Offline" || batchType);
    if (!canLoad) { setTemplates([]); setTemplatesMsg(""); return; }

    let ignore = false;
    const loadTemplates = async () => {
      setLoadingTemplates(true); setTemplatesMsg("");
      try {
        const params = new URLSearchParams({ mode });
        if (mode === "Offline") params.set("batch_type", batchType);
        const res = await fetch(`${API_BASE}/api/email-templates?${params.toString()}`);
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) {
          setTemplates([]);
          setTemplatesMsg(`❌ ${data.error || "Failed to load templates"}`);
          return;
        }
        const list = Array.isArray(data) ? data : [];
        setTemplates(list);
        if (list.length === 0) setTemplatesMsg("⚠️ No templates found for this mode/batch type");
      } catch (err) {
        if (!ignore) { setTemplates([]); setTemplatesMsg(`❌ ${err.message}`); }
      } finally {
        if (!ignore) setLoadingTemplates(false);
      }
    };
    loadTemplates();
    return () => { ignore = true; };
  }, [selectedBatch, mode, batchType]);

  const updateTemplateField = (idx, field, value) => {
    setTemplates(prev => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  };

  const handleUploadLearners = () => {
    setUploadMsg("");
    if (!learnersFile) { alert('Please choose CSV file'); return; }
    Papa.parse(learnersFile, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        const parsed = results.data.map((r, index) => {
          const row = {
            name:     r.name     || r.Name     || r['Learner Name'] || '',
            email:    r.email    || r.Email    || '',
            phone:    r.phone    || r.Phone    || '',
            batch_no: r.batch_no || r.Batch    || r.batch           || '',
            status:   r.status   || r.Status   || '',
            __rowIndex: index + 2,
          };
          const errors = [];
          if (!row.name)                    errors.push("Name required");
          if (!row.batch_no)                errors.push("Batch no required");
          if (!validateEmail(row.email))    errors.push("Invalid email");
          if (!validatePhone(row.phone))    errors.push("Invalid phone");
          return { ...row, __errors: errors, __duplicate: null };
        });
        setLearnerRows(parsed);
        const validRows = parsed.filter(r => !r.__errors || r.__errors.length === 0);
        if (validRows.length === 0) { setUploadMsg("❌ All rows have validation errors; fix and reupload"); return; }
        try {
          const res = await axios.post(`${API_BASE}/upload-learners`, { learners: validRows });
          const data = res.data || {};
          setUploadMsg(data.message || "✅ Uploaded successfully");
          const alreadyInDb      = data.alreadyInDb      || [];
          const inFileDuplicates = data.inFileDuplicates  || [];
          const key = (l) => `${(l.name||'').trim().toLowerCase()}|${(l.email||'').trim().toLowerCase()}|${(l.batch_no||'').trim()}`;
          const alreadySet   = new Set(alreadyInDb.map(key));
          const inFileSet    = new Set(inFileDuplicates.map(key));
          setLearnerRows(prev => prev.map(r => {
            const k = key(r);
            if (alreadySet.has(k)) return { ...r, __duplicate: "Already in database" };
            if (inFileSet.has(k))  return { ...r, __duplicate: "Duplicate in file" };
            return r;
          }));
        } catch (err) { setUploadMsg('❌ Upload failed: ' + (err.response?.data?.error || err.message)); }
      },
      error: (err) => setUploadMsg('CSV parse error: ' + err.message)
    });
  };

  const handlePlannerFileChange = (e) => {
    const file = e.target.files[0];
    setPlannerFile(file); setPlannerMsg(""); setPlannerRows([]); setShowPlannerPreview(false);
  };

  const handleUploadPlanner = () => {
    if (!plannerFile) { alert("Please choose CSV file"); return; }
    Papa.parse(plannerFile, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        const json = results.data.map((r, index) => ({
          classroom_name: r.classroom_name || r.classroom || "",
          batch_no:       r.batch_no       || r.Batch     || r.batch || "",
          domain:         r.domain         || "",
          mode:           r.mode           || "",
          week_no:        r.week_no        || r.week      || "",
          date:           r.date           || r.Date      || "",
          start_time:     r.start_time     || r["start time"] || r.StartTime || "",
          end_time:       r.end_time       || "",
          module_name:    r.module_name    || "",
          module_topic:   r.module_topic   || "",
          topic_name:     r.topic_name     || "",
          trainer_name:   r.trainer_name   || "",
          trainer_email:  r.trainer_email  || "",
          topic_status:   r.topic_status   || "",
          remarks:        r.remarks        || "",
          batch_type:     r.batch_type     || "",
          actual_date:    r.actual_date    || "",
          date_difference:  r.date_difference  || "",
          date_changed_by:  r.date_changed_by  || "",
          date_changed_at:  r.date_changed_at  || "",
          __rowIndex: index + 2,
        }));
        setPlannerRows(json);
        try {
          const res = await axios.post(`${API_BASE}/upload-course-planner`, { courses: json.map(({ __rowIndex, ...rest }) => rest) });
          const data = res.data || {};
          if (data.alreadyPresent) setPlannerMsg(`⚠️ Planner for ${data.batch_no} is already in database`);
          else setPlannerMsg(data.message || "✅ Uploaded successfully");
        } catch (err) { setPlannerMsg("❌ Upload failed: " + (err.response?.data?.error || err.message)); }
      },
      error: (err) => setPlannerMsg("CSV parse error: " + err.message),
    });
  };

  const handleSchedule = async () => {
    if (!selectedBatch || !mode) { setMessage("⚠️ Please select batch and mode"); return; }
    setLoading(true); setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/schedule-email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_no:              selectedBatch,
          mode,
          batch_type:            mode === "Offline" ? batchType : null,
          class_room:            classRoom,
          mock_interview_offset: Number(mockInterviewOffset) || 7,
          // Send the (possibly edited) templates so the scheduled mails use them.
          templates: templates.map(t => ({
            id:            t.id,
            template_name: t.template_name,
            subject:       t.subject,
            body_html:     t.body_html,
            offset_days:   t.offset_days,
            send_time:     t.send_time,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) setMessage(`❌ Failed: ${data.error || "Unknown error"}`);
      else setMessage(`✅ Scheduled ${data.scheduled} emails and ${data.mock_interview_reminders_scheduled || 0} mock interview reminders for ${data.batch_no} (Start: ${data.start_date})`);
    } catch (err) { setMessage(`❌ Network error: ${err.message}`); }
    finally { setLoading(false); }
  };

  const handleUpdateOffsets = async () => {
    if (!selectedBatch || !mode || (mode === "Offline" && !batchType)) { setMessage("⚠️ Select batch, mode, and batch type (if offline) before updating offsets"); return; }
    if (offsetValue === "" || isNaN(Number(offsetValue))) { setMessage("⚠️ Please enter a valid offset value (number)"); return; }
    setLoading(true); setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/update-offsets`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_no: selectedBatch, mode, batch_type: mode === "Offline" ? batchType : null, base_offset: Number(offsetValue) }),
      });
      const data = await res.json();
      if (!res.ok) setMessage(`❌ Offset update failed: ${data.error || "Unknown error"}`);
      else setMessage(`✅ Updated offset for ${data.updatedCount} templates successfully`);
    } catch (err) { setMessage(`❌ Offset update error: ${err.message}`); }
    finally { setLoading(false); }
  };

  const getRoleTitle = (role) => {
    if (!role) return "Dashboard";
    return role.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const roleTitle   = getRoleTitle(user?.role);
  const welcomeName = user?.name ? user.name : "User";
  const msgIsSuccess = message.startsWith("✅");
  const msgIsWarning = message.startsWith("⚠️");

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

        {/* ── Upload Row ── */}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 3, mb: 3 }}>

          {/* Upload Learners */}
          <Box sx={{ ...cardSx }}>
            <SectionHeader icon={<SchoolIcon sx={{ fontSize: 20 }} />} title="Upload Learners" subtitle="CSV format" />
            <Box sx={{ p: 3 }}>
              <Box
                sx={{ border: `2px dashed ${learnersFile ? TOKENS.accent : TOKENS.border}`, borderRadius: "12px", p: 2.5, textAlign: "center", cursor: "pointer", background: learnersFile ? TOKENS.accentLight : TOKENS.surfaceAlt, transition: "all 0.2s ease", mb: 2, "&:hover": { borderColor: TOKENS.accent, background: TOKENS.accentLight } }}
                component="label"
              >
                <input type="file" accept=".csv" hidden onChange={e => setLearnersFile(e.target.files[0])} />
                <UploadFileIcon sx={{ fontSize: 28, color: learnersFile ? TOKENS.accent : TOKENS.textSub, mb: 0.5 }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: learnersFile ? TOKENS.accent : TOKENS.textSub }}>
                  {learnersFile ? learnersFile.name : "Click to choose CSV"}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Button variant="contained" onClick={handleUploadLearners} size="small"
                  sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", px: 2.5, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}>
                  Upload
                </Button>
                <Button variant="outlined" onClick={() => setShowLearnerPreview(v => !v)} disabled={learnerRows.length === 0} size="small"
                  sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", borderColor: TOKENS.border, color: TOKENS.textSub, "&:hover": { borderColor: TOKENS.accent, color: TOKENS.accent, background: TOKENS.accentLight } }}>
                  {showLearnerPreview ? "Hide" : "View"} List
                </Button>
              </Box>

              {uploadMsg && (
                <Fade in>
                  <Box sx={{ mt: 2, px: 2, py: 1, borderRadius: "8px", background: uploadMsg.startsWith("✅") ? TOKENS.success.light : TOKENS.warning.light, border: `1px solid ${uploadMsg.startsWith("✅") ? TOKENS.success.fill : TOKENS.warning.fill}44` }}>
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: uploadMsg.startsWith("✅") ? TOKENS.success.text : TOKENS.warning.text }}>{uploadMsg}</Typography>
                  </Box>
                </Fade>
              )}

              {showLearnerPreview && learnerRows.length > 0 && (
                <DataTable
                  headers={["Row", "Name", "Email", "Phone", "Batch No", "Status", "Errors", "Duplicate"]}
                  rows={learnerRows}
                  renderRow={(row, idx) => {
                    const hasErrors = row.__errors?.length > 0;
                    const isDup     = !!row.__duplicate;
                    return (
                      <Box key={idx} component="tr" sx={{ background: hasErrors ? TOKENS.error.light : isDup ? TOKENS.warning.light : "transparent", "&:hover": { background: TOKENS.surfaceAlt } }}>
                        {[row.__rowIndex, row.name, row.email, row.phone, row.batch_no, row.status].map((val, i) => (
                          <Box key={i} component="td" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.text, p: "6px 12px", borderBottom: `1px solid ${TOKENS.border}` }}>{val}</Box>
                        ))}
                        <Box component="td" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.error.text, p: "6px 12px", borderBottom: `1px solid ${TOKENS.border}` }}>{row.__errors?.join(", ")}</Box>
                        <Box component="td" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.warning.text, p: "6px 12px", borderBottom: `1px solid ${TOKENS.border}` }}>{row.__duplicate || ""}</Box>
                      </Box>
                    );
                  }}
                />
              )}
            </Box>
          </Box>

          {/* Upload Course Planner */}
          <Box sx={{ ...cardSx }}>
            <SectionHeader icon={<CalendarTodayIcon sx={{ fontSize: 20 }} />} title="Upload Course Planner" subtitle="CSV format" />
            <Box sx={{ p: 3 }}>
              <Box
                sx={{ border: `2px dashed ${plannerFile ? TOKENS.accent : TOKENS.border}`, borderRadius: "12px", p: 2.5, textAlign: "center", cursor: "pointer", background: plannerFile ? TOKENS.accentLight : TOKENS.surfaceAlt, transition: "all 0.2s ease", mb: 2, "&:hover": { borderColor: TOKENS.accent, background: TOKENS.accentLight } }}
                component="label"
              >
                <input type="file" accept=".csv" hidden onChange={handlePlannerFileChange} />
                <UploadFileIcon sx={{ fontSize: 28, color: plannerFile ? TOKENS.accent : TOKENS.textSub, mb: 0.5 }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: plannerFile ? TOKENS.accent : TOKENS.textSub }}>
                  {plannerFile ? plannerFile.name : "Click to choose CSV"}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Button variant="contained" onClick={handleUploadPlanner} size="small"
                  sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", px: 2.5, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}>
                  Upload
                </Button>
                <Button variant="outlined" onClick={() => setShowPlannerPreview(v => !v)} disabled={plannerRows.length === 0} size="small"
                  sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", borderColor: TOKENS.border, color: TOKENS.textSub, "&:hover": { borderColor: TOKENS.accent, color: TOKENS.accent, background: TOKENS.accentLight } }}>
                  {showPlannerPreview ? "Hide" : "View"} List
                </Button>
              </Box>

              {plannerMsg && (
                <Fade in>
                  <Box sx={{ mt: 2, px: 2, py: 1, borderRadius: "8px", background: plannerMsg.startsWith("✅") ? TOKENS.success.light : plannerMsg.startsWith("⚠️") ? TOKENS.warning.light : TOKENS.error.light, border: `1px solid ${plannerMsg.startsWith("✅") ? TOKENS.success.fill : plannerMsg.startsWith("⚠️") ? TOKENS.warning.fill : TOKENS.error.fill}44` }}>
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: plannerMsg.startsWith("✅") ? TOKENS.success.text : plannerMsg.startsWith("⚠️") ? TOKENS.warning.text : TOKENS.error.text }}>{plannerMsg}</Typography>
                  </Box>
                </Fade>
              )}

              {showPlannerPreview && plannerRows.length > 0 && (
                <DataTable
                  headers={["Row", "Classroom", "Batch No", "Mode", "Week", "Date", "Start", "End", "Module", "Topic", "Trainer"]}
                  rows={plannerRows}
                  renderRow={(row, idx) => (
                    <Box key={idx} component="tr" sx={{ "&:hover": { background: TOKENS.surfaceAlt } }}>
                      {[row.__rowIndex, row.classroom_name, row.batch_no, row.mode, row.week_no, row.date, row.start_time, row.end_time, row.module_name, row.topic_name, row.trainer_name].map((val, i) => (
                        <Box key={i} component="td" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.text, p: "6px 12px", borderBottom: `1px solid ${TOKENS.border}` }}>{val}</Box>
                      ))}
                    </Box>
                  )}
                />
              )}
            </Box>
          </Box>
        </Box>

        {/* ── Schedule Emails ── */}
        <Box sx={{ ...cardSx }}>
          <SectionHeader icon={<EmailIcon sx={{ fontSize: 20 }} />} title="Schedule Emails" subtitle="Configure and dispatch batch communications" />
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mb: 2 }}>

              {/* Batch — FIX: show loading state and all batches */}
              <FormControl size="small" fullWidth>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                  {loadingBatches ? "Loading batches…" : "Select Batch"}
                </InputLabel>
                <Select
                  value={selectedBatch}
                  label={loadingBatches ? "Loading batches…" : "Select Batch"}
                  onChange={e => setSelectedBatch(e.target.value)}
                  disabled={loadingBatches}
                  sx={inputSx}
                  MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
                >
                  <MenuItem value="">-- Choose Batch --</MenuItem>
                  {batches.map((b, i) => (
                    <MenuItem key={`${b.batch_no}-${i}`} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                      {b.batch_no}{b.start_date ? ` (${b.start_date})` : ""}
                    </MenuItem>
                  ))}
                </Select>
                {!loadingBatches && (
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: TOKENS.textSub, mt: 0.3 }}>
                    {batches.length} batch{batches.length !== 1 ? "es" : ""} available
                  </Typography>
                )}
              </FormControl>

              {/* Mode */}
              <FormControl size="small" fullWidth>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Mode</InputLabel>
                <Select value={mode} label="Mode" onChange={e => setMode(e.target.value)} sx={inputSx}>
                  <MenuItem value="Online"  sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Online</MenuItem>
                  <MenuItem value="Offline" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Offline</MenuItem>
                </Select>
              </FormControl>

              {/* Batch Type (offline only) */}
              {mode === "Offline" && (
                <FormControl size="small" fullWidth>
                  <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batch Type</InputLabel>
                  <Select value={batchType} label="Batch Type" onChange={e => setBatchType(e.target.value)} sx={inputSx}>
                    <MenuItem value="">-- Choose Batch Type --</MenuItem>
                    <MenuItem value="Morning Batch"   sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Morning Batch</MenuItem>
                    <MenuItem value="Afternoon Batch" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Afternoon Batch</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Classroom */}
              <FormControl size="small" fullWidth>
                <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Class Room</InputLabel>
                <Select value={classRoom} label="Class Room" onChange={e => setClassRoom(e.target.value)} sx={inputSx}>
                  <MenuItem value="">-- Choose Class Room --</MenuItem>
                  {["Ganga (5th Floor)", "Kaveri (5th Floor)", "Yamuna (1st Floor)"].map(r => (
                    <MenuItem key={r} value={r} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{r}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Offset */}
              <TextField
                label="Offset Value"
                type="number"
                value={offsetValue}
                onChange={e => setOffsetValue(e.target.value)}
                size="small"
                fullWidth
                placeholder="e.g. -2"
                helperText="Days offset from course start date"
                sx={{
                  "& .MuiInputBase-root": { ...inputSx, fontFamily: "'DM Sans', sans-serif", fontSize: 13 },
                  "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 },
                  "& .MuiFormHelperText-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 11 },
                }}
              />
            </Box>

            {/* ── Editable Email Templates ── */}
            {(loadingTemplates || templates.length > 0 || templatesMsg) && (
              <Box sx={{ mt: 2, pt: 2, borderTop: `1px dashed ${TOKENS.border}` }}>
                <Typography sx={{ ...labelSx, mb: 1 }}>
                  Email Templates{templates.length > 0 ? ` (${templates.length}) — editable` : ""}
                </Typography>

                {loadingTemplates && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: TOKENS.textSub, py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12 }}>Loading templates…</Typography>
                  </Box>
                )}

                {!loadingTemplates && templatesMsg && (
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: templatesMsg.startsWith("⚠️") ? TOKENS.warning.text : TOKENS.error.text, mb: 1 }}>
                    {templatesMsg}
                  </Typography>
                )}

                {!loadingTemplates && templates.length > 0 && (
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
                    {templates.map((t, idx) => (
                  <Box key={t.id ?? idx} sx={{ border: `1px solid ${TOKENS.border}`, borderRadius: "12px", p: 2, background: TOKENS.surfaceAlt }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
                      <Chip label={t.template_name || `Template ${idx + 1}`} size="small"
                        sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.accentLight, color: TOKENS.accent }} />
                    </Box>

                    <TextField
                      label="Subject"
                      value={t.subject || ""}
                      onChange={e => updateTemplateField(idx, "subject", e.target.value)}
                      size="small" fullWidth sx={{ mb: 1.5, "& .MuiInputBase-root": inputSx }}
                    />
                    <TextField
                      label="Body (HTML)"
                      value={t.body_html || ""}
                      onChange={e => updateTemplateField(idx, "body_html", e.target.value)}
                      size="small" fullWidth multiline minRows={4}
                      sx={{ mb: 1.5, "& .MuiInputBase-root": { ...inputSx, fontFamily: "'DM Mono', monospace", fontSize: 12 } }}
                    />
                    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
                      <TextField
                        label="Offset Days"
                        type="number"
                        value={t.offset_days ?? 0}
                        onChange={e => updateTemplateField(idx, "offset_days", e.target.value)}
                        size="small" fullWidth
                        helperText="Days from batch start date"
                        sx={{ "& .MuiInputBase-root": inputSx }}
                      />
                      <TextField
                        label="Send Time"
                        type="time"
                        value={t.send_time || "09:00"}
                        onChange={e => updateTemplateField(idx, "send_time", e.target.value)}
                        size="small" fullWidth
                        InputLabelProps={{ shrink: true }}
                        sx={{ "& .MuiInputBase-root": inputSx }}
                      />
                    </Box>
                  </Box>
                    ))}
                  </Box>
                )}
              </Box>
            )}

            {/* Action Buttons */}
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mt: 1 }}>
              <Button
                variant="contained"
                onClick={handleSchedule}
                disabled={loading || !selectedBatch}
                startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <EmailIcon sx={{ fontSize: 16 }} />}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 3, py: 1, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}
              >
                {loading ? "Scheduling..." : "Schedule Emails"}
              </Button>
              <Button
                variant="outlined"
                onClick={handleUpdateOffsets}
                disabled={loading || !offsetValue}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 3, py: 1, borderColor: TOKENS.border, color: TOKENS.textSub, "&:hover": { borderColor: TOKENS.accent, color: TOKENS.accent, background: TOKENS.accentLight }, "&:disabled": { opacity: 0.5 } }}
              >
                {loading ? "Updating..." : "Update Template Offsets"}
              </Button>
            </Box>

            <ResendFailedEmails batchNo={selectedBatch} />

            {message && (
              <Fade in>
                <Box sx={{ mt: 2.5, px: 2.5, py: 1.5, borderRadius: "10px", background: msgIsSuccess ? TOKENS.success.light : msgIsWarning ? TOKENS.warning.light : TOKENS.error.light, border: `1px solid ${msgIsSuccess ? TOKENS.success.fill : msgIsWarning ? TOKENS.warning.fill : TOKENS.error.fill}44` }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: msgIsSuccess ? TOKENS.success.text : msgIsWarning ? TOKENS.warning.text : TOKENS.error.text }}>
                    {message}
                  </Typography>
                </Box>
              </Fade>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}