// ManagerLeaveDashboard.js
import React, { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import {
  Box, Typography, IconButton, Chip, Tooltip,
  ToggleButton, ToggleButtonGroup, Button, CircularProgress,
} from "@mui/material";
import ArrowBackIosNewIcon  from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon  from "@mui/icons-material/ArrowForwardIos";
import CalendarMonthIcon    from "@mui/icons-material/CalendarMonth";
import UploadFileIcon       from "@mui/icons-material/UploadFile";
import CheckCircleIcon      from "@mui/icons-material/CheckCircle";
import ErrorIcon            from "@mui/icons-material/Error";

const API_BASE = process.env.REACT_APP_API_URL || "http://192.168.1.2:5000/";

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
  holiday:     { fill: "#10b981", light: "#d1fae5", text: "#065f46" },
  optional:    { fill: "#ef4444", light: "#fee2e2", text: "#991b1b" },
  success:     { fill: "#10b981", light: "#d1fae5", text: "#065f46" },
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

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function formatDate(d) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

/* ─── Main component ─────────────────────────────────────────────────────── */
function ManagerLeaveDashboard({ user, token }) {
  const [requests,          setRequests]          = useState([]);
  const [holidays,          setHolidays]          = useState([]);
  const [trainers,          setTrainers]          = useState([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState("all");
  const [viewType,          setViewType]          = useState("month");
  const [cursor,            setCursor]            = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const [holidayFile,       setHolidayFile]       = useState(null);
  const [uploadStatus,      setUploadStatus]      = useState(null);
  const [uploading,         setUploading]         = useState(false);
  const trainerHueMapRef = useRef({});

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  const getTrainerHue = (key) => {
    const k = String(key || "").trim().toLowerCase() || "trainer";
    const map = trainerHueMapRef.current;
    if (map[k] == null) map[k] = hashString(k) % 360;
    return map[k];
  };

  const getTrainerChipStyle = (trainerKey) => {
    const hue = getTrainerHue(trainerKey);
    return { bg: `hsl(${hue},75%,88%)`, border: `hsl(${hue},70%,75%)`, text: `hsl(${hue},55%,25%)` };
  };

  async function loadAllData(year) {
    try {
      const [unavailRes, holRes, trainersRes] = await Promise.all([
        axios.get(`${API_BASE}/api/unavailability-requests`, { headers: authHeaders }),
        axios.get(`${API_BASE}/api/holidays`, { headers: authHeaders, params: { year } }),
        axios.get(`${API_BASE}/api/trainers`, { headers: authHeaders }),
      ]);
      setRequests(Array.isArray(unavailRes.data) ? unavailRes.data : []);
      setHolidays(Array.isArray(holRes.data) ? holRes.data : []);
      setTrainers(Array.isArray(trainersRes.data) ? trainersRes.data : []);
    } catch {
      setRequests([]); setHolidays([]); setTrainers([]);
    }
  }

  useEffect(() => { loadAllData(cursor.getFullYear()); }, [authHeaders, cursor.getFullYear()]);

  const dayEventsMap = useMemo(() => {
    const map = {};
    const filtered = selectedTrainerId === "all" ? requests : requests.filter(r => String(r.trainer_id) === String(selectedTrainerId));

    filtered.forEach(req => {
      const start = new Date(req.start_date);
      const end   = new Date(req.end_date || req.start_date);
      const leaveType = (req.leave_type || req.reason || "").toLowerCase();
      const c = new Date(start);
      while (c <= end) {
        const key = formatDate(c);
        if (!map[key]) map[key] = [];
        let category = "trainer";
        if (leaveType.includes("optional holiday")) category = "optionalHoliday";
        else if (leaveType.includes("holiday"))    category = "holiday";
        const trainerKey = (req.trainer_email || req.traineremail || "").trim().toLowerCase() || (req.trainer_id != null ? `id:${req.trainer_id}` : "") || (req.trainer_name || "").trim().toLowerCase();
        map[key].push({ id: `leave-${req.id}-${key}`, trainer_name: req.trainer_name, trainer_key: trainerKey, domain: req.domain, reason: req.reason, category });
        c.setDate(c.getDate() + 1);
      }
    });

    holidays.forEach(h => {
      const key = h.holiday_date;
      if (!map[key]) map[key] = [];
      const category = (h.type || "").toLowerCase().includes("restricted") ? "optionalHoliday" : "holiday";
      map[key].push({ id: `holiday-${key}`, trainer_name: "", trainer_key: "", domain: "", reason: h.name, category });
    });

    return map;
  }, [requests, holidays, selectedTrainerId]);

  const year       = cursor.getFullYear();
  const monthIndex = cursor.getMonth();
  const monthLabel = cursor.toLocaleString("default", { month: "long", year: "numeric" });

  const goPrev = () => setCursor(prev => {
    const d = new Date(prev);
    if (viewType === "month") { d.setMonth(d.getMonth() - 1); d.setDate(1); }
    else if (viewType === "week") d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    return d;
  });

  const goNext = () => setCursor(prev => {
    const d = new Date(prev);
    if (viewType === "month") { d.setMonth(d.getMonth() + 1); d.setDate(1); }
    else if (viewType === "week") d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    return d;
  });

  const handleHolidayUpload = async () => {
    if (!holidayFile) { setUploadStatus({ type: "error", msg: "Please select a file to upload." }); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", holidayFile);
      await axios.post(`${API_BASE}/api/holidays/upload`, formData, { headers: { ...authHeaders, "Content-Type": "multipart/form-data" } });
      setUploadStatus({ type: "success", msg: "Holiday list uploaded and saved successfully." });
      await loadAllData(cursor.getFullYear());
    } catch (err) {
      setUploadStatus({ type: "error", msg: err.response?.data?.error || "Failed to upload. Please check file format." });
    } finally { setUploading(false); }
  };

  /* ── Day cell events ── */
  const renderDayCellEvents = (dateObj) => {
    const key = formatDate(dateObj);
    const events = dayEventsMap[key] || [];
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
        {events.map(ev => {
          let bg, color, border;
          if (ev.category === "holiday") {
            bg = TOKENS.holiday.light; color = TOKENS.holiday.text; border = `${TOKENS.holiday.fill}55`;
          } else if (ev.category === "optionalHoliday") {
            bg = TOKENS.optional.light; color = TOKENS.optional.text; border = `${TOKENS.optional.fill}55`;
          } else {
            const style = getTrainerChipStyle(ev.trainer_key || ev.trainer_name);
            bg = style.bg; color = style.text; border = style.border;
          }
          const label = ev.category === "trainer" ? (ev.trainer_name || "Trainer").trim() || "Trainer" : ev.reason || (ev.category === "holiday" ? "Holiday" : "Optional");
          return (
            <Tooltip key={ev.id} title={`${ev.trainer_name || ""}${ev.domain ? ` (${ev.domain})` : ""}${ev.reason ? ` — ${ev.reason}` : ""}`} arrow>
              <Box sx={{ px: 0.8, py: 0.2, borderRadius: "6px", background: bg, border: `1px solid ${border}`, cursor: "default", overflow: "hidden" }}>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 600, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {label}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    );
  };

  /* ── Month view ── */
  const renderMonthView = () => {
    const firstDay  = new Date(year, monthIndex, 1);
    const lastDay   = new Date(year, monthIndex + 1, 0);
    const startWd   = firstDay.getDay();
    const weeks     = [];
    let cur = 1 - startWd;
    while (cur <= lastDay.getDate()) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const dateObj = new Date(year, monthIndex, cur);
        dateObj.setHours(0,0,0,0);
        const isCurMonth = dateObj.getMonth() === monthIndex;
        const key    = formatDate(dateObj);
        const events = dayEventsMap[key] || [];
        const hasHoliday      = events.some(e => e.category === "holiday");
        const hasOptional     = events.some(e => e.category === "optionalHoliday");
        const hasTrainerLeave = events.some(e => e.category === "trainer");
        let bg = TOKENS.surface, border = TOKENS.border;
        if (hasHoliday)      { bg = TOKENS.holiday.light;  border = TOKENS.holiday.fill; }
        else if (hasOptional){ bg = TOKENS.optional.light; border = TOKENS.optional.fill; }
        else if (hasTrainerLeave){ bg = TOKENS.accentLight; border = TOKENS.accent; }
        week.push({ dateObj, displayDay: dateObj.getDate(), isCurMonth, bg, border });
        cur++;
      }
      weeks.push(week);
    }

    return (
      <>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${TOKENS.border}`, pb: 1, mb: 1 }}>
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <Box key={d} sx={{ textAlign: "center" }}>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: TOKENS.accent }}>{d}</Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.5 }}>
          {weeks.map((week, wi) => week.map((day, di) => (
            <Box key={`${wi}-${di}`} sx={{ minHeight: 88, borderRadius: "8px", border: `1px solid ${day.isCurMonth ? day.border + "66" : TOKENS.border}`, background: day.isCurMonth ? day.bg : TOKENS.surfaceAlt, opacity: day.isCurMonth ? 1 : 0.4, p: 0.6, display: "flex", flexDirection: "column" }}>
              <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 700, color: day.isCurMonth ? TOKENS.text : TOKENS.textSub, textAlign: "right", mb: 0.3 }}>{day.displayDay}</Typography>
              {day.isCurMonth && renderDayCellEvents(day.dateObj)}
            </Box>
          )))}
        </Box>
      </>
    );
  };

  /* ── Week view ── */
  const renderWeekView = () => {
    const sow = new Date(cursor);
    sow.setDate(sow.getDate() - sow.getDay()); sow.setHours(0,0,0,0);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(sow); d.setDate(sow.getDate() + i); d.setHours(0,0,0,0); return d; });

    return (
      <>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${TOKENS.border}`, pb: 1, mb: 1 }}>
          {days.map(d => (
            <Box key={d.toISOString()} sx={{ textAlign: "center" }}>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, color: TOKENS.accent }}>
                {d.toLocaleDateString("default", { weekday: "short", day: "numeric", month: "short" })}
              </Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.5 }}>
          {days.map(d => {
            const key    = formatDate(d);
            const events = dayEventsMap[key] || [];
            const hasH   = events.some(e => e.category === "holiday");
            const hasO   = events.some(e => e.category === "optionalHoliday");
            const hasT   = events.some(e => e.category === "trainer");
            let bg = TOKENS.surface, border = TOKENS.border;
            if (hasH) { bg = TOKENS.holiday.light;  border = TOKENS.holiday.fill; }
            else if (hasO) { bg = TOKENS.optional.light; border = TOKENS.optional.fill; }
            else if (hasT) { bg = TOKENS.accentLight;    border = TOKENS.accent; }
            return (
              <Box key={key} sx={{ minHeight: 120, borderRadius: "8px", border: `1px solid ${border}55`, background: bg, p: 0.75, display: "flex", flexDirection: "column" }}>
                {renderDayCellEvents(d)}
              </Box>
            );
          })}
        </Box>
      </>
    );
  };

  /* ── Day view ── */
  const renderDayView = () => {
    const d = new Date(cursor); d.setHours(0,0,0,0);
    return (
      <Box sx={{ borderRadius: "12px", border: `1px solid ${TOKENS.border}`, background: TOKENS.surfaceAlt, p: 2.5, minHeight: 150 }}>
        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 700, color: TOKENS.text, mb: 1.5 }}>
          {d.toLocaleDateString("default", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </Typography>
        {renderDayCellEvents(d)}
      </Box>
    );
  };

  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <Box sx={{ maxWidth: 1400, mx: "auto" }}>

        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
            Trainer Leave Calendar
          </Typography>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
            Track trainer unavailability, holidays and optional leave
          </Typography>
        </Box>

        {/* Calendar card */}
        <Box sx={cardSx}>
          {/* Toolbar */}
          <Box sx={{ px: 3, py: 2.5, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <CalendarMonthIcon sx={{ fontSize: 20, color: TOKENS.accent }} />
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text }}>
                {viewType === "month" ? monthLabel : cursor.toLocaleDateString("default", { day: "numeric", month: "long", year: "numeric" })}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <IconButton size="small" onClick={goPrev} sx={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, "&:hover": { background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}` } }}>
                <ArrowBackIosNewIcon sx={{ fontSize: 14, color: TOKENS.textSub }} />
              </IconButton>
              <ToggleButtonGroup size="small" value={viewType} exclusive onChange={(_, v) => v && setViewType(v)}
                sx={{ "& .MuiToggleButton-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, textTransform: "none", px: 1.5, py: 0.6, border: `1px solid ${TOKENS.border}`, color: TOKENS.textSub, "&.Mui-selected": { background: TOKENS.accent, color: "#fff", border: `1px solid ${TOKENS.accent}` } } }}>
                <ToggleButton value="day">Day</ToggleButton>
                <ToggleButton value="week">Week</ToggleButton>
                <ToggleButton value="month">Month</ToggleButton>
              </ToggleButtonGroup>
              <IconButton size="small" onClick={goNext} sx={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, "&:hover": { background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}` } }}>
                <ArrowForwardIosIcon sx={{ fontSize: 14, color: TOKENS.textSub }} />
              </IconButton>
            </Box>
          </Box>

          {/* Legend + upload row */}
          <Box sx={{ px: 3, py: 2, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
            {/* Legend */}
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              {[
                { label: "Holiday",    bg: TOKENS.holiday.light,  border: TOKENS.holiday.fill  },
                { label: "Optional",   bg: TOKENS.optional.light, border: TOKENS.optional.fill },
                { label: "Trainer",    bg: TOKENS.accentLight,    border: TOKENS.accent        },
              ].map(l => (
                <Box key={l.label} sx={{ display: "flex", alignItems: "center", gap: 0.7 }}>
                  <Box sx={{ width: 12, height: 12, borderRadius: "3px", background: l.bg, border: `1px solid ${l.border}66` }} />
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: TOKENS.textSub }}>{l.label}</Typography>
                </Box>
              ))}
            </Box>

            {/* Upload area */}
            <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <Typography sx={{ ...labelSx, fontSize: 10 }}>Upload Holiday List</Typography>
              <Box component="label" sx={{ px: 2, py: 0.6, borderRadius: "8px", border: `1px dashed ${TOKENS.border}`, background: TOKENS.surfaceAlt, cursor: "pointer", "&:hover": { border: `1px dashed ${TOKENS.accent}`, background: TOKENS.accentLight } }}>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={e => { setHolidayFile(e.target.files?.[0] || null); setUploadStatus(null); }} style={{ display: "none" }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: holidayFile ? TOKENS.accent : TOKENS.textSub }}>
                  {holidayFile ? holidayFile.name : "Choose file…"}
                </Typography>
              </Box>
              <Button variant="contained" size="small" onClick={handleHolidayUpload} disabled={!holidayFile || uploading}
                startIcon={uploading ? <CircularProgress size={12} color="inherit" /> : <UploadFileIcon sx={{ fontSize: 14 }} />}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, textTransform: "none", borderRadius: "8px", background: TOKENS.accent, "&:hover": { background: "#2a3fd4" }, "&:disabled": { opacity: 0.5 } }}>
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </Box>
          </Box>

          {/* Upload status */}
          {uploadStatus && (
            <Box sx={{ mx: 3, mt: 2, px: 2.5, py: 1.5, borderRadius: "10px",
              background: uploadStatus.type === "success" ? TOKENS.success.light : TOKENS.error.light,
              border: `1px solid ${uploadStatus.type === "success" ? TOKENS.success.fill : TOKENS.error.fill}44`,
              display: "flex", alignItems: "center", gap: 1 }}>
              {uploadStatus.type === "success"
                ? <CheckCircleIcon sx={{ fontSize: 14, color: TOKENS.success.fill }} />
                : <ErrorIcon sx={{ fontSize: 14, color: TOKENS.error.fill }} />}
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600,
                color: uploadStatus.type === "success" ? TOKENS.success.text : TOKENS.error.text }}>
                {uploadStatus.msg}
              </Typography>
            </Box>
          )}

          {/* Calendar grid */}
          <Box sx={{ p: 2.5 }}>
            {viewType === "month" && renderMonthView()}
            {viewType === "week"  && renderWeekView()}
            {viewType === "day"   && renderDayView()}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default ManagerLeaveDashboard;