import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem, TextField,
  Button, CircularProgress, Checkbox, Chip, FormControlLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from "@mui/material";
import {
  RecordVoiceOver as InterviewIcon,
  Save            as SaveIcon,
  Send            as SendIcon,
  Download        as DownloadIcon,
  UploadFile      as UploadIcon,
  Schedule        as ScheduleIcon,
  CheckCircle     as CheckCircleIcon,
  Error           as ErrorIcon,
  InfoOutlined    as InfoOutlinedIcon,
} from "@mui/icons-material";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";

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
  head:        "#fff176",   // yellow header, like the sheet
  success:     { fill: "#10b981", light: "#d1fae5", text: "#065f46" },
  warning:     { fill: "#f59e0b", light: "#fef3c7", text: "#92400e" },
  error:       { fill: "#ef4444", light: "#fee2e2", text: "#991b1b" },
};

const cardSx = {
  background: TOKENS.surface, border: `1px solid ${TOKENS.border}`,
  borderRadius: "16px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden",
};
const labelSx = {
  fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700,
  letterSpacing: "0.08em", textTransform: "uppercase", color: TOKENS.textSub,
};
const inputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: "10px", fontFamily: "'DM Sans', sans-serif", fontSize: 13,
    "& fieldset": { borderColor: TOKENS.border },
    "&:hover fieldset": { borderColor: TOKENS.accent },
    "&.Mui-focused fieldset": { borderColor: TOKENS.accent },
  },
  "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 },
};
const headCellSx = {
  fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 800, color: TOKENS.text,
  background: TOKENS.head, borderBottom: "2px solid #000", borderRight: `1px solid ${TOKENS.border}`,
  textAlign: "center", whiteSpace: "normal", lineHeight: 1.25, py: 1.2,
};
const bodyCellSx = {
  fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.text,
  borderBottom: `1px solid ${TOKENS.border}`, borderRight: `1px solid ${TOKENS.border}`, py: 0.6,
};
const miniFieldSx = {
  "& .MuiOutlinedInput-root": { borderRadius: "8px", fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, background: TOKENS.surface },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.border },
  "& .MuiOutlinedInput-input": { py: "6px" },
};

/* ─── Skills (rating columns) ────────────────────────────────────────────── */
const SKILLS = [
  { key: "communication",         label: "Communication Skills",       match: "communication" },
  { key: "technical",             label: "Technical Confidence",       match: "technical" },
  { key: "concept_depth",         label: "Concept Depth",              match: "concept" },
  { key: "practical_application", label: "Practical Application",      match: "practical" },
  { key: "problem_solving",       label: "Problem-Solving Skills",     match: "problem" },
  { key: "attitude",              label: "Attitude & Professionalism", match: "attitude" },
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const pad2 = n => String(n).padStart(2, "0");

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

function courseForBatch(b) {
  const up = (b || "").toUpperCase();
  if (up.includes("PDFT") || up.startsWith("PD")) return "Physical Design";
  if (up.includes("DVFT") || up.startsWith("DV")) return "Design Verification";
  return "";
}

const hhmmToMin = t => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const minToHHMM = min => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;
const to12 = hhmm => {
  const m = hhmmToMin(hhmm);
  if (m === null) return "";
  const h = Math.floor(m / 60), mm = m % 60;
  return `${pad2(h % 12 || 12)}:${pad2(mm)} ${h >= 12 ? "PM" : "AM"}`;
};
/* "03:30 PM" / "15:30" -> "15:30" */
function parseClock(s) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(s || ""));
  if (!m) return "";
  let h = Number(m[1]);
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${pad2(h)}:${m[2]}`;
}

const longDate = iso => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", weekday: "long" });
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/* Formats the Excel / CSV template expects — shown in the template and in the page */
const DATE_FORMAT_HINT = "YYYY-MM-DD (e.g. 2026-06-08)";
const TIME_FORMAT_HINT = "hh:mm AM - hh:mm PM (e.g. 03:00 PM - 04:30 PM)";

/* Cell value (Date / Excel serial / "2026-06-08" / "06/08/2026 Monday") -> "YYYY-MM-DD" */
function parseDateCell(v) {
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() + 12 * 3600 * 1000);          // guards against sub-day drift
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  if (typeof v === "number" && v > 20000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const s = String(v || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const [mo, d] = a > 12 ? [b, a] : [a, b];                      // 06/08/2026 -> month/day, like the sheet
    return `${m[3]}-${pad2(mo)}-${pad2(d)}`;
  }
  /* "08-Jun-2026", "8 June 2026" */
  m = /^(\d{1,2})[\s/-]+([A-Za-z]{3,9})[\s/,.-]+(\d{4})/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (mo > 0) return `${m[3]}-${pad2(mo)}-${pad2(Number(m[1]))}`;
  }
  return "";
}

const blankRow = l => ({
  email: l.email, name: l.name || "", slot_time: "", trainer: "", absent: false,
  communication: "", technical: "", concept_depth: "", practical_application: "",
  problem_solving: "", attitude: "", remarks: "", areas: "", emailed_at: null,
});

const rowFromResult = r => ({
  email: r.learner_email, name: r.learner_name || "", slot_time: r.slot_time || "",
  trainer: r.trainer || "", absent: !!r.is_absent,
  ...Object.fromEntries(SKILLS.map(s => [s.key, r[s.key] == null ? "" : String(r[s.key])])),
  remarks: r.remarks || "", areas: r.areas_of_improvement || "", emailed_at: r.emailed_at || null,
});

const isComplete = r => !r.absent && SKILLS.every(s => r[s.key] !== "");
const rowAverage = r => {
  if (r.absent) return "A";
  if (!SKILLS.every(s => r[s.key] !== "")) return "";
  /* Calculated automatically and rounded to a whole number: 4.8 -> 5, 3.1 -> 3 */
  return String(Math.round(SKILLS.reduce((sum, s) => sum + Number(r[s.key]), 0) / SKILLS.length));
};

function StatusBanner({ msg, onClear }) {
  if (!msg) return null;
  const isSuccess = msg.startsWith("✅");
  const isWarning = msg.startsWith("⚠️");
  const tok  = isSuccess ? TOKENS.success : isWarning ? TOKENS.warning : TOKENS.error;
  const Icon = isSuccess ? CheckCircleIcon : isWarning ? InfoOutlinedIcon : ErrorIcon;
  return (
    <Box sx={{ mt: 2, px: 2.5, py: 1.5, borderRadius: "10px", background: tok.light, border: `1px solid ${tok.fill}44`, display: "flex", alignItems: "center", gap: 1 }}>
      <Icon sx={{ fontSize: 15, color: tok.fill, flexShrink: 0 }} />
      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, fontWeight: 600, color: tok.text, flex: 1, whiteSpace: "pre-line" }}>{msg}</Typography>
      {onClear && <Box onClick={onClear} sx={{ cursor: "pointer", color: tok.text, fontSize: 16, lineHeight: 1, fontWeight: 700 }}>×</Box>}
    </Box>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function MockInterviewDashboard() {
  const sessionUser = useMemo(getSessionUser, []);
  const fileRef = useRef(null);

  const [batches,   setBatches]   = useState([]);
  const [batchNo,   setBatchNo]   = useState("");
  const [course,    setCourse]    = useState("");
  const [venue,     setVenue]     = useState("");
  const [date,      setDate]      = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime,   setEndTime]   = useState("");
  const [interviewer, setInterviewer] = useState("");

  const [learners,  setLearners]  = useState([]);
  const [rows,      setRows]      = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [savedSessions, setSavedSessions] = useState([]);
  const [dirty,     setDirty]     = useState(false);

  const [slotLen,  setSlotLen]  = useState(30);
  const [perSlot,  setPerSlot]  = useState(4);

  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [sending,  setSending]  = useState(false);
  const [message,  setMessage]  = useState("");

  const [sendOpen, setSendOpen] = useState(false);
  const [sendSel,  setSendSel]  = useState({});
  const [note,     setNote]     = useState("");

  /* ── Batches ── */
  useEffect(() => {
    axios.get(`${API_BASE}/api/batches`)
      .then(res => setBatches(Array.isArray(res.data) ? res.data : []))
      .catch(() => setMessage("Error loading batches"));
  }, []);

  const batchOptions = useMemo(() => {
    const names = batches.map(b => (b && b.batch_no) || b).filter(b => typeof b === "string" && b);
    return [...new Set(names)];
  }, [batches]);

  /* ── Learners (name + email) and saved sessions of the chosen batch ── */
  const refreshSessions = async batch => {
    try {
      const res = await axios.get(`${API_BASE}/api/mock-interview/sessions`, { params: { batch_no: batch } });
      setSavedSessions(Array.isArray(res.data) ? res.data : []);
    } catch { setSavedSessions([]); }
  };

  useEffect(() => {
    if (!batchNo) { setLearners([]); setRows([]); setSavedSessions([]); setSessionId(null); return; }
    let cancelled = false;
    setLoading(true); setMessage("");

    Promise.all([
      axios.get(`${API_BASE}/apigetlearners`, { params: { batchno: batchNo } }),
      axios.get(`${API_BASE}/api/mock-interview/sessions`, { params: { batch_no: batchNo } }).catch(() => ({ data: [] })),
    ])
      .then(([lr, sr]) => {
        if (cancelled) return;
        const seen = new Set();
        const list = [];
        (lr.data || []).forEach(l => {
          const email = (l.email || "").trim();
          if (!email || seen.has(email.toLowerCase())) return;
          seen.add(email.toLowerCase());
          list.push({ name: l.name || "", email });
        });
        setLearners(list);
        setRows(list.map(blankRow));
        setSavedSessions(Array.isArray(sr.data) ? sr.data : []);
        setSessionId(null);
        setDirty(false);
        setCourse(courseForBatch(batchNo));
        if (!list.length) setMessage("⚠️ No learners with an email found for this batch");
      })
      .catch(() => { if (!cancelled) { setMessage("Error loading learners"); setLearners([]); setRows([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [batchNo]);

  const onBatchChange = value => {
    if (dirty && !window.confirm("You have unsaved changes. Switch batch and discard them?")) return;
    setBatchNo(value);
    setDirty(false);
  };

  /* ── Load a saved session ── */
  const loadSession = async id => {
    if (!id) {            // "New session"
      setSessionId(null);
      setRows(learners.map(blankRow));
      setDate(""); setStartTime(""); setEndTime(""); setInterviewer("");
      setDirty(false); setMessage("");
      return;
    }
    if (dirty && !window.confirm("You have unsaved changes. Load another session and discard them?")) return;
    setLoading(true); setMessage("");
    try {
      const res = await axios.get(`${API_BASE}/api/mock-interview/session/${id}`);
      const { session, results } = res.data;
      const byEmail = {};
      (results || []).forEach(r => { byEmail[(r.learner_email || "").toLowerCase()] = r; });

      setSessionId(session.id);
      setCourse(session.course || courseForBatch(batchNo));
      setVenue(session.venue || "");
      setDate(session.interview_date || "");
      setStartTime((session.start_time || "").slice(0, 5));
      setEndTime((session.end_time || "").slice(0, 5));
      setInterviewer(session.interviewer_name || "");
      setRows(learners.map(l => {
        const r = byEmail[l.email.toLowerCase()];
        return r ? rowFromResult(r) : blankRow(l);
      }));
      setDirty(false);
      setMessage(`✅ Loaded session of ${longDate(session.interview_date)}`);
    } catch (err) {
      setMessage(`Error loading session: ${err?.response?.data?.error || err.message}`);
    } finally { setLoading(false); }
  };

  /* ── Editing ── */
  const patchRow = (i, patch) => {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const setHeader = setter => v => { setter(v); setDirty(true); };

  const toggleAbsent = (i, absent) => {
    const clear = Object.fromEntries(SKILLS.map(s => [s.key, ""]));
    patchRow(i, absent ? { absent: true, ...clear } : { absent: false });
  };

  /* Time slots: e.g. 03:00 PM start, 30-min slots, 4 learners per slot */
  const autoAssignSlots = () => {
    const startMin = hhmmToMin(startTime);
    if (startMin === null) { setMessage("⚠️ Set the start time first"); return; }
    const len = Math.max(5, Number(slotLen) || 30);
    const per = Math.max(1, Number(perSlot) || 4);

    setRows(prev => prev.map((r, i) => {
      const s = startMin + Math.floor(i / per) * len;
      return {
        ...r,
        slot_time: `${to12(minToHHMM(s))} - ${to12(minToHHMM(s + len))}`,
        trainer: interviewer || r.trainer,
      };
    }));
    if (!endTime) {
      const lastSlots = Math.ceil(rows.length / per);
      setEndTime(minToHHMM(startMin + lastSlots * len));
    }
    setDirty(true);
    setMessage("✅ Time slots assigned — adjust any row by hand if needed");
  };

  /* ── Save ── */
  const saveSession = async (silent = false) => {
    if (!batchNo || !date || !interviewer.trim()) {
      setMessage("⚠️ Batch, date and interviewer name are required to save");
      return null;
    }
    if (!rows.length) { setMessage("⚠️ There are no learners to save"); return null; }

    setSaving(true);
    try {
      const res = await axios.post(`${API_BASE}/api/mock-interview/save`, {
        id: sessionId,
        batch_no: batchNo, course, venue,
        interview_date: date, start_time: startTime, end_time: endTime,
        interviewer_name: interviewer.trim(),
        role: sessionUser?.role || "",
        created_by: sessionUser?.email || sessionUser?.name || "",
        rows: rows.map(r => ({
          email: r.email, name: r.name, slot_time: r.slot_time, trainer: r.trainer, absent: r.absent,
          ...Object.fromEntries(SKILLS.map(s => [s.key, r.absent ? "" : r[s.key]])),
          remarks: r.remarks, areas_of_improvement: r.areas,
        })),
      });
      setSessionId(res.data.id);
      setDirty(false);
      refreshSessions(batchNo);
      if (!silent) setMessage(`✅ Saved mock interview for ${res.data.saved} learner${res.data.saved !== 1 ? "s" : ""}`);
      return res.data.id;
    } catch (err) {
      setMessage(`Error saving: ${err?.response?.data?.error || err.message || "unknown"}`);
      return null;
    } finally { setSaving(false); }
  };

  /* ── Excel / CSV template ── */
  const downloadTemplate = () => {
    const timeTxt = startTime && endTime ? `${to12(startTime)} - ${to12(endTime)}` : "";
    const header = [
      "S.No", "Name", "Email", "Date (YYYY-MM-DD)", "Time (hh:mm AM - hh:mm PM)", "Trainer",
      ...SKILLS.map(s => `${s.label} (1-5)`),
      "Average Rating (1-5)", "Interviewer Remarks", "Areas of Improvement",
    ];
    const sheetRows = rows.length ? rows : Array.from({ length: 10 }, () => null);

    const aoa = [
      ["Course:", course, "Date:", date],
      ["Batch:", batchNo, "Time:", timeTxt],
      ["Venue:", venue, "Interviewer Name:", interviewer],
      [`HOW TO FILL →  Date: ${DATE_FORMAT_HINT}   |   Time: ${TIME_FORMAT_HINT}   |   Ratings: whole numbers 1-5, or A if absent   |   Average Rating is calculated automatically (rounded) — do not type it.`],
      header,
      ...sheetRows.map((r, i) => {
        if (!r) return [i + 1, "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
        return [
          i + 1, r.name, r.email, date, r.slot_time, r.trainer || interviewer,
          ...SKILLS.map(s => (r.absent ? "A" : r[s.key] === "" ? "" : Number(r[s.key]))),
          "", r.remarks, r.areas,
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    /* Average Rating column (M) = live formula (rounded to a whole number), with the computed value cached */
    sheetRows.forEach((r, i) => {
      const n = 6 + i;                                   // first data row is Excel row 6
      const cached = r ? rowAverage(r) : "";
      ws[`M${n}`] = {
        t: cached === "" || cached === "A" ? "s" : "n",
        v: cached === "" || cached === "A" ? cached : Number(cached),
        f: `IF(COUNTIF(G${n}:L${n},"A")>0,"A",IF(COUNT(G${n}:L${n})=6,ROUND(AVERAGE(G${n}:L${n}),0),""))`,
      };
    });

    ws["!cols"] = [
      { wch: 6 }, { wch: 26 }, { wch: 30 }, { wch: 18 }, { wch: 28 }, { wch: 14 },
      ...SKILLS.map(() => ({ wch: 16 })), { wch: 14 }, { wch: 34 }, { wch: 34 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mock Interview");
    XLSX.writeFile(wb, `Mock_Interview_${batchNo || "Template"}${date ? "_" + date : ""}.xlsx`);
  };

  /* ── Upload Excel / CSV → populate the table (then Save) ── */
  const onUpload = async e => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!batchNo || !rows.length) { setMessage("⚠️ Select a batch first, then upload the file"); return; }

    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array", cellDates: true });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

      const norm = v => String(v ?? "").trim().toLowerCase().replace(/:$/, "");

      /* 1. the table header row */
      const hdrIdx = aoa.findIndex(r =>
        r.some(c => ["name", "learner name"].includes(norm(c))) && r.some(c => norm(c).includes("communication"))
      );
      if (hdrIdx < 0) {
        setMessage("⚠️ Could not find the table header (Name, Communication Skills …). Please use the downloaded template.");
        return;
      }
      const hdr = aoa[hdrIdx];
      const col = test => hdr.findIndex(h => test(norm(h)));
      const cName    = col(h => h === "name" || h === "learner name");
      const cEmail   = col(h => h.includes("email"));
      const cTime    = col(h => h === "time" || h.startsWith("time"));
      const cTrainer = col(h => h === "trainer");
      const cSkill   = SKILLS.map(s => col(h => h.includes(s.match)));
      const cRemarks = col(h => h.includes("remarks"));
      const cAreas   = col(h => h.includes("improvement"));

      /* 2. the top block (Course / Batch / Venue / Date / Time / Interviewer) */
      const meta = {};
      const keyMap = { course: "course", batch: "batch", venue: "venue", date: "date", time: "time", "interviewer name": "interviewer", interviewer: "interviewer" };
      for (let r = 0; r < hdrIdx; r++) {
        const row = aoa[r];
        row.forEach((cell, c) => {
          const k = keyMap[norm(cell)];
          if (!k || meta[k] !== undefined) return;
          for (let j = c + 1; j < row.length; j++) {
            if (String(row[j]).trim() !== "") { meta[k] = row[j]; break; }
          }
        });
      }

      if (meta.batch && String(meta.batch).trim().toLowerCase() !== batchNo.toLowerCase()) {
        setMessage(`⚠️ This file is for batch "${String(meta.batch).trim()}" but "${batchNo}" is selected. Nothing was imported.`);
        return;
      }

      /* 3. the learner rows — matched by email first, then by name */
      const next = rows.map(r => ({ ...r }));
      const byEmail = {}, byName = {};
      next.forEach((r, i) => { byEmail[r.email.toLowerCase()] = i; byName[r.name.trim().toLowerCase()] = i; });

      let matched = 0, invalid = 0;
      const unmatched = [];

      for (let r = hdrIdx + 1; r < aoa.length; r++) {
        const line = aoa[r];
        const name  = cName  >= 0 ? String(line[cName]  ?? "").trim() : "";
        const email = cEmail >= 0 ? String(line[cEmail] ?? "").trim() : "";
        if (!name && !email) continue;

        let idx = email ? byEmail[email.toLowerCase()] : undefined;
        if (idx === undefined && name) idx = byName[name.toLowerCase()];
        if (idx === undefined) { unmatched.push(name || email); continue; }

        const row = next[idx];
        const cells = cSkill.map(c => (c >= 0 ? line[c] : ""));
        const isAbsent = cells.some(v => ["a", "ab", "absent"].includes(String(v).trim().toLowerCase()));

        if (isAbsent) {
          SKILLS.forEach(s => { row[s.key] = ""; });
          row.absent = true;
        } else {
          row.absent = false;
          SKILLS.forEach((s, k) => {
            const raw = String(cells[k] ?? "").trim();
            if (raw === "") { row[s.key] = ""; return; }
            const num = Number(raw);
            if (Number.isInteger(num) && num >= 1 && num <= 5) row[s.key] = String(num);
            else { row[s.key] = ""; invalid++; }
          });
        }

        if (cTime >= 0 && String(line[cTime]).trim() !== "")       row.slot_time = String(line[cTime]).trim();
        if (cTrainer >= 0 && String(line[cTrainer]).trim() !== "") row.trainer   = String(line[cTrainer]).trim();
        if (cRemarks >= 0) row.remarks = String(line[cRemarks] ?? "").trim();
        if (cAreas >= 0)   row.areas   = String(line[cAreas] ?? "").trim();
        matched++;
      }

      setRows(next);
      if (meta.course)      setCourse(String(meta.course).trim());
      if (meta.venue)       setVenue(String(meta.venue).trim());
      if (meta.interviewer) setInterviewer(String(meta.interviewer).trim());
      const d = meta.date ? parseDateCell(meta.date) : "";
      if (d) setDate(d);
      if (meta.time) {
        const parts = String(meta.time).split(/\s*[-–]\s*/);
        if (parts[0] && parseClock(parts[0])) setStartTime(parseClock(parts[0]));
        if (parts[1] && parseClock(parts[1])) setEndTime(parseClock(parts[1]));
      }
      setDirty(true);

      const warn = [];
      if (unmatched.length) warn.push(`${unmatched.length} row(s) not in this batch were ignored (${unmatched.slice(0, 3).join(", ")}${unmatched.length > 3 ? "…" : ""})`);
      if (invalid) warn.push(`${invalid} rating(s) were not whole numbers from 1 to 5 and were left blank`);
      setMessage(
        `${warn.length ? "⚠️" : "✅"} Imported ${matched} learner${matched !== 1 ? "s" : ""} from "${file.name}". Review the table and click Save.` +
        (warn.length ? `\n${warn.join("\n")}` : "")
      );
    } catch (err) {
      console.error("Upload error:", err);
      setMessage(`Error reading file: ${err.message || "unsupported file"}`);
    }
  };

  /* ── Email ── */
  const openSendDialog = async () => {
    if (!batchNo || !rows.length) { setMessage("⚠️ Select a batch first"); return; }
    let id = sessionId;
    if (dirty || !id) {
      id = await saveSession(true);       // the mail always reflects what is saved
      if (!id) return;
    }
    const s = {};
    rows.forEach(r => { s[r.email] = isComplete(r); });
    setSendSel(s);
    setNote("");
    setSendOpen(true);
  };

  const confirmSend = async () => {
    const emails = rows.filter(r => sendSel[r.email] && isComplete(r)).map(r => r.email);
    if (!emails.length) { setMessage("⚠️ Select at least one learner"); return; }

    setSendOpen(false);
    setSending(true); setMessage("");
    try {
      const res = await axios.post(`${API_BASE}/api/mock-interview/send-email`, {
        session_id: sessionId, emails, note: note.trim(), role: sessionUser?.role || "",
      });
      const { sent = 0, failed = 0, skipped = [], sent_emails = [] } = res.data || {};
      const now = new Date().toISOString();
      const done = new Set(sent_emails.map(e => e.toLowerCase()));
      setRows(prev => prev.map(r => (done.has(r.email.toLowerCase()) ? { ...r, emailed_at: now } : r)));

      setMessage(
        failed || skipped.length
          ? `⚠️ Sent ${sent}, failed ${failed}, skipped ${skipped.length}`
          : `✅ Feedback emailed to ${sent} learner${sent !== 1 ? "s" : ""}`
      );
    } catch (err) {
      setMessage(`Error sending emails: ${err?.response?.data?.error || err.message || "unknown"}`);
    } finally { setSending(false); }
  };

  /* ── Derived numbers ── */
  const stats = useMemo(() => ({
    total: rows.length,
    absent: rows.filter(r => r.absent).length,
    done: rows.filter(isComplete).length,
  }), [rows]);

  const sendReadyCount = rows.filter(r => sendSel[r.email] && isComplete(r)).length;

  /* ─── Render ──────────────────────────────────────────────────────────── */
  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>

      <Box sx={{ maxWidth: 1700, mx: "auto" }}>

        {/* Page header + actions */}
        <Box sx={{ mb: 3, display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
          <Box>
            <Typography sx={{ fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
              Mock Interview
            </Typography>
            <Typography sx={{ fontSize: 14, color: TOKENS.textSub }}>
              Record each learner's interview ratings, save them, and email individual feedback
            </Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 1.2, flexWrap: "wrap", alignItems: "center" }}>
            {dirty && <Chip size="small" label="Unsaved changes" sx={{ fontWeight: 700, background: TOKENS.warning.light, color: TOKENS.warning.text }} />}

            <Button variant="outlined" startIcon={<DownloadIcon sx={{ fontSize: 16 }} />} onClick={downloadTemplate}
              sx={{ fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", borderColor: TOKENS.border, color: TOKENS.textSub, background: TOKENS.surface }}>
              Download Template
            </Button>

            <Button variant="outlined" component="label" disabled={!batchNo || !rows.length} startIcon={<UploadIcon sx={{ fontSize: 16 }} />}
              sx={{ fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", borderColor: TOKENS.accent + "66", color: TOKENS.accent, background: TOKENS.surface }}>
              Upload Excel / CSV
              <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv" onChange={onUpload} />
            </Button>

            <Button variant="contained" onClick={() => saveSession(false)} disabled={saving || !rows.length}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon sx={{ fontSize: 16 }} />}
              sx={{ fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", px: 2.5, background: TOKENS.success.fill, "&:hover": { background: "#0e9f74" } }}>
              {saving ? "Saving…" : "Save"}
            </Button>

            <Button variant="contained" onClick={openSendDialog} disabled={sending || saving || !rows.length}
              startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <SendIcon sx={{ fontSize: 16 }} />}
              sx={{ fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", px: 2.5, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}>
              {sending ? "Sending…" : "Send Email"}
            </Button>
          </Box>
        </Box>

        {/* Details card — mirrors the sheet's top block */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <Box sx={{ px: 3, py: 2, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box sx={{ color: TOKENS.accent, display: "flex" }}><InterviewIcon sx={{ fontSize: 20 }} /></Box>
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: TOKENS.text }}>Interview Details</Typography>
          </Box>

          <Box sx={{ p: 3, display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" } }}>
            <FormControl size="small" sx={inputSx}>
              <InputLabel>Batch *</InputLabel>
              <Select value={batchNo} label="Batch *" onChange={e => onBatchChange(e.target.value)}
                sx={{ borderRadius: "10px", fontSize: 13 }}>
                <MenuItem value=""><em>Select batch</em></MenuItem>
                {batchOptions.map(b => <MenuItem key={b} value={b} sx={{ fontSize: 13 }}>{b}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField size="small" label="Course" value={course} onChange={e => setHeader(setCourse)(e.target.value)} sx={inputSx} />
            <TextField size="small" label="Venue" value={venue} onChange={e => setHeader(setVenue)(e.target.value)} placeholder="ChipEdge Office 4th Floor" sx={inputSx} />
            <TextField size="small" label="Interviewer Name *" value={interviewer} onChange={e => setHeader(setInterviewer)(e.target.value)} placeholder="Mr. Obulesu" sx={inputSx} />

            <TextField size="small" type="date" label="Date *" value={date} onChange={e => setHeader(setDate)(e.target.value)} InputLabelProps={{ shrink: true }} sx={inputSx} />
            <TextField size="small" type="time" label="Start Time" value={startTime} onChange={e => setHeader(setStartTime)(e.target.value)} InputLabelProps={{ shrink: true }} sx={inputSx} />
            <TextField size="small" type="time" label="End Time" value={endTime} onChange={e => setHeader(setEndTime)(e.target.value)} InputLabelProps={{ shrink: true }} sx={inputSx} />

            <FormControl size="small" sx={inputSx} disabled={!savedSessions.length}>
              <InputLabel shrink>Saved sessions</InputLabel>
              <Select displayEmpty notched value={sessionId || ""} label="Saved sessions"
                onChange={e => loadSession(e.target.value)} sx={{ borderRadius: "10px", fontSize: 13 }}>
                <MenuItem value=""><em>{savedSessions.length ? "＋ New session" : "None saved yet"}</em></MenuItem>
                {savedSessions.map(s => (
                  <MenuItem key={s.id} value={s.id} sx={{ fontSize: 13 }}>
                    {longDate(s.interview_date)} · {s.interviewer_name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* Slot helper */}
          <Box sx={{ px: 3, pb: 3, display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
            <Typography sx={{ ...labelSx }}>Time slots</Typography>
            <TextField size="small" type="number" label="Minutes per slot" value={slotLen} onChange={e => setSlotLen(e.target.value)} sx={{ ...inputSx, width: 150 }} inputProps={{ min: 5 }} />
            <TextField size="small" type="number" label="Learners per slot" value={perSlot} onChange={e => setPerSlot(e.target.value)} sx={{ ...inputSx, width: 150 }} inputProps={{ min: 1 }} />
            <Button size="small" variant="outlined" onClick={autoAssignSlots} disabled={!rows.length}
              startIcon={<ScheduleIcon sx={{ fontSize: 16 }} />}
              sx={{ fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none" }}>
              Auto-assign slots &amp; trainer
            </Button>

            <Box sx={{ ml: "auto", display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Chip size="small" label={`${stats.total} learners`} sx={{ fontWeight: 700, background: TOKENS.accentLight, color: TOKENS.accent }} />
              <Chip size="small" label={`${stats.done} rated`} sx={{ fontWeight: 700, background: TOKENS.success.light, color: TOKENS.success.text }} />
              <Chip size="small" label={`${stats.absent} absent`} sx={{ fontWeight: 700, background: TOKENS.warning.light, color: TOKENS.warning.text }} />
            </Box>
          </Box>

          <Box sx={{ mx: 3, mb: 2, px: 2, py: 1.2, borderRadius: "10px", background: TOKENS.surfaceAlt, border: `1px dashed ${TOKENS.border}` }}>
            <Typography sx={{ ...labelSx, fontSize: 10, mb: 0.4 }}>Excel / CSV format</Typography>
            <Typography sx={{ fontSize: 12, color: TOKENS.textSub, lineHeight: 1.7 }}>
              <strong>Date:</strong> {DATE_FORMAT_HINT} &nbsp;·&nbsp; <strong>Time:</strong> {TIME_FORMAT_HINT} &nbsp;·&nbsp;
              <strong>Ratings:</strong> whole numbers 1–5, or <strong>A</strong> if absent &nbsp;·&nbsp;
              <strong>Average Rating:</strong> calculated automatically and rounded to a whole number (4.8 → 5, 3.1 → 3)
            </Typography>
          </Box>

          <Box sx={{ px: 3, pb: message ? 2 : 0 }}>
            <StatusBanner msg={message} onClear={() => setMessage("")} />
          </Box>
        </Box>

        {/* Interactive table */}
        <Box sx={cardSx}>
          {loading ? (
            <Box sx={{ p: 6, textAlign: "center" }}><CircularProgress size={26} /></Box>
          ) : !rows.length ? (
            <Box sx={{ p: 6, textAlign: "center", color: TOKENS.textSub }}>
              <Typography sx={{ fontSize: 14 }}>Select a batch — its learners' names and emails will appear here automatically.</Typography>
            </Box>
          ) : (
            <TableContainer sx={{ maxHeight: "72vh" }}>
              <Table stickyHeader size="small" sx={{ minWidth: 1900 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ ...headCellSx, width: 50 }}>S.No</TableCell>
                    <TableCell sx={{ ...headCellSx, minWidth: 200 }}>Name</TableCell>
                    <TableCell sx={{ ...headCellSx, minWidth: 220 }}>Email</TableCell>
                    <TableCell sx={{ ...headCellSx, minWidth: 150 }}>Date</TableCell>
                    <TableCell sx={{ ...headCellSx, minWidth: 190 }}>Time</TableCell>
                    <TableCell sx={{ ...headCellSx, minWidth: 130 }}>Trainer</TableCell>
                    <TableCell sx={{ ...headCellSx, width: 56 }}>Absent</TableCell>
                    {SKILLS.map(s => (
                      <TableCell key={s.key} sx={{ ...headCellSx, minWidth: 108 }}>{s.label} (1-5)</TableCell>
                    ))}
                    <TableCell sx={{ ...headCellSx, minWidth: 100 }}>
                      Average Rating (1-5)
                      <Box component="span" sx={{ display: "block", fontSize: 10, fontWeight: 600, color: TOKENS.textSub }}>auto · rounded</Box>
                    </TableCell>
                    <TableCell sx={{ ...headCellSx, minWidth: 230 }}>Interviewer Remarks</TableCell>
                    <TableCell sx={{ ...headCellSx, minWidth: 230 }}>Areas of Improvement</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r, i) => {
                    const avg = rowAverage(r);
                    const avgColor = avg === "A" ? TOKENS.warning.fill : avg === "" ? TOKENS.textSub
                      : Number(avg) >= 4 ? TOKENS.success.fill : Number(avg) >= 3 ? TOKENS.accent : TOKENS.error.fill;
                    return (
                      <TableRow key={r.email} sx={{ background: r.absent ? "#f3f4f6" : i % 2 ? TOKENS.surfaceAlt : TOKENS.surface, "&:hover": { background: `${TOKENS.accent}0a` } }}>
                        <TableCell align="center" sx={{ ...bodyCellSx, color: TOKENS.textSub }}>{i + 1}</TableCell>
                        <TableCell sx={{ ...bodyCellSx, fontWeight: 600 }}>
                          {r.name || "—"}
                          {r.emailed_at && <Chip size="small" label="Emailed" sx={{ ml: 1, height: 18, fontSize: 10, fontWeight: 700, background: TOKENS.success.light, color: TOKENS.success.text }} />}
                        </TableCell>
                        <TableCell sx={{ ...bodyCellSx, color: TOKENS.textSub, fontSize: 12 }}>{r.email}</TableCell>
                        <TableCell align="center" sx={{ ...bodyCellSx, fontSize: 12 }}>{longDate(date)}</TableCell>
                        <TableCell sx={{ ...bodyCellSx, px: 0.5 }}>
                          <TextField size="small" fullWidth value={r.slot_time} placeholder="03:00 PM - 03:30 PM"
                            onChange={e => patchRow(i, { slot_time: e.target.value })} sx={miniFieldSx} />
                        </TableCell>
                        <TableCell sx={{ ...bodyCellSx, px: 0.5 }}>
                          <TextField size="small" fullWidth value={r.trainer} placeholder={interviewer || "Trainer"}
                            onChange={e => patchRow(i, { trainer: e.target.value })} sx={miniFieldSx} />
                        </TableCell>
                        <TableCell align="center" sx={{ ...bodyCellSx, p: 0 }}>
                          <Checkbox size="small" checked={r.absent} onChange={e => toggleAbsent(i, e.target.checked)} />
                        </TableCell>

                        {SKILLS.map(s => (
                          <TableCell key={s.key} align="center" sx={{ ...bodyCellSx, px: 0.5 }}>
                            {r.absent ? (
                              <Typography sx={{ fontWeight: 800, color: TOKENS.warning.fill, fontSize: 13 }}>A</Typography>
                            ) : (
                              <TextField select size="small" value={r[s.key]} onChange={e => patchRow(i, { [s.key]: e.target.value })}
                                SelectProps={{ native: true }} sx={{ ...miniFieldSx, width: 70 }}>
                                <option value="">–</option>
                                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                              </TextField>
                            )}
                          </TableCell>
                        ))}

                        <TableCell align="center" sx={bodyCellSx}>
                          <Typography sx={{ fontFamily: "'DM Mono', monospace", fontWeight: 800, fontSize: 14, color: avgColor }}>
                            {avg === "" ? "—" : avg}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ ...bodyCellSx, px: 0.5 }}>
                          <TextField size="small" fullWidth multiline maxRows={3} value={r.remarks}
                            onChange={e => patchRow(i, { remarks: e.target.value })} sx={miniFieldSx} />
                        </TableCell>
                        <TableCell sx={{ ...bodyCellSx, px: 0.5 }}>
                          <TextField size="small" fullWidth multiline maxRows={3} value={r.areas}
                            onChange={e => patchRow(i, { areas: e.target.value })} sx={miniFieldSx} />
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

      {/* ── Send e-mail dialog ── */}
      <Dialog open={sendOpen} onClose={() => setSendOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Email mock interview feedback</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontSize: 13, color: TOKENS.textSub, mb: 1.5 }}>
            Each learner receives <strong>only their own</strong> ratings, remarks and areas of improvement in a table.
            Absent or incomplete learners can't be selected.
          </Typography>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <Button size="small" onClick={() => setSendSel(Object.fromEntries(rows.map(r => [r.email, isComplete(r)])))}>Select all</Button>
            <Button size="small" onClick={() => setSendSel({})}>Clear</Button>
            <Typography sx={{ ...labelSx, ml: "auto" }}>{sendReadyCount} selected</Typography>
          </Box>

          <Box sx={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${TOKENS.border}`, borderRadius: "10px", mb: 2 }}>
            {rows.map(r => {
              const ok = isComplete(r);
              return (
                <FormControlLabel key={r.email} sx={{ display: "flex", m: 0, px: 1, opacity: ok ? 1 : 0.6 }}
                  control={<Checkbox size="small" disabled={!ok} checked={!!sendSel[r.email] && ok}
                    onChange={e => setSendSel(p => ({ ...p, [r.email]: e.target.checked }))} />}
                  label={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                      <Typography sx={{ fontSize: 13 }}>{r.name || "—"} · <span style={{ color: TOKENS.textSub }}>{r.email}</span></Typography>
                      {r.absent && <Chip size="small" label="Absent" sx={{ height: 18, fontSize: 10, fontWeight: 700, background: TOKENS.warning.light, color: TOKENS.warning.text }} />}
                      {!r.absent && !ok && <Chip size="small" label="Incomplete" sx={{ height: 18, fontSize: 10, fontWeight: 700, background: TOKENS.error.light, color: TOKENS.error.text }} />}
                      {r.emailed_at && <Chip size="small" label="Already emailed" sx={{ height: 18, fontSize: 10, fontWeight: 700, background: TOKENS.success.light, color: TOKENS.success.text }} />}
                    </Box>
                  } />
              );
            })}
          </Box>

          <TextField fullWidth multiline rows={3} size="small" label="Extra message (optional)" value={note}
            onChange={e => setNote(e.target.value)} inputProps={{ maxLength: 1000 }}
            placeholder="e.g. Please work on the areas mentioned and be ready for the next round."
            helperText="Shown in a highlighted box under the greeting, on top of the standard message." />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSendOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!sendReadyCount || sending} onClick={confirmSend}>
            Send to {sendReadyCount}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}