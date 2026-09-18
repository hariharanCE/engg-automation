import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";
import {
  Typography,
  Button,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  Box,
  Fade,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Chip,
  TextField,
} from "@mui/material";
import {
  Download         as DownloadIcon,
  TableChart       as TableChartIcon,
  BarChart         as BarChartIcon,
  Person           as PersonIcon,
  CheckCircle      as CheckCircleIcon,
  Error            as ErrorIcon,
  InfoOutlined     as InfoOutlinedIcon,
  EmojiEvents      as TrophyIcon,
  School           as SchoolIcon,
  WorkspacePremium as CertIcon,
  Save             as SaveIcon,
  Undo             as UndoIcon,
  LockOpen         as LockOpenIcon,
  Lock             as LockIcon,
} from "@mui/icons-material";

const API_BASE =
  process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";

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
  pdft:        { fill: "#7c3aed", light: "#ede9fe", text: "#4c1d95" },
  dvft:        { fill: "#0891b2", light: "#e0f2fe", text: "#0c4a6e" },
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

const tableHeadSx = {
  fontFamily:    "'DM Sans', sans-serif",
  fontSize:      11,
  fontWeight:    700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color:         TOKENS.textSub,
  borderBottom:  `2px solid ${TOKENS.border}`,
  py:            1.4,
  whiteSpace:    "nowrap",
  background:    TOKENS.surfaceAlt,
};

const tableCellSx = {
  fontFamily:   "'DM Sans', sans-serif",
  fontSize:     13,
  color:        TOKENS.text,
  borderBottom: `1px solid ${TOKENS.border}`,
  whiteSpace:   "nowrap",
};

/* ─── Batch helpers ──────────────────────────────────────────────────────── */
function isPdftBatch(b) { return (b || "").toUpperCase().includes("PDFT"); }
function isDvftBatch(b) {
  const up = (b || "").toUpperCase();
  return up.includes("DVFT") || (up.startsWith("DV") && !up.includes("PDFT"));
}

/* ─── Timestamp helpers ──────────────────────────────────────────────────── */
function formatTimestamp(d) {
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fileTimestamp(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function resolveIntermediateTopic(topicName, assessmentName) {
  if (assessmentName && assessmentName.trim()) return assessmentName.trim();
  if (topicName && topicName.toLowerCase().includes("intermediate")) return topicName;
  return "Intermediate Assessment";
}

/* ─── Safe number parse ──────────────────────────────────────────────────── */
function n(val) {
  const v = parseFloat(val);
  return isNaN(v) ? null : v;
}

/* Scorecard export helper — absentees are stored as 0 marks, so a value of
 * exactly 0 is exported as "AB" (matching the on-screen scorecard). */
function ab(val) {
  if (val === null || val === undefined || val === "") return val;
  return parseFloat(val) === 0 ? "AB" : val;
}

/* Overall % is the ONLY figure that is displayed/exported as a whole number:
 * 82.14 -> 82, 82.52 -> 83. Every other percentage keeps its two decimals, and
 * the unrounded value is still what drives Grade / Certification / Placement. */
function roundOverall(val) {
  const num = parseFloat(val);
  return isNaN(num) ? null : Math.round(num);
}

/* Export variant of roundOverall — keeps the "AB" absentee marker. */
function abOverall(val) {
  if (val === null || val === undefined || val === "") return val;
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num === 0 ? "AB" : Math.round(num);
}

/* ─── Scorecard editing ──────────────────────────────────────────────────────
 * Admin / Manager / Coordinator may override the computed scorecard values.
 * Edits are held locally until Save; every learner whose row changed must
 * carry a Remarks note before the save is allowed through.
 * ────────────────────────────────────────────────────────────────────────── */

/* Tolerates the "Corrdinator" typo that exists in the internal_users table. */
const SCORECARD_EDIT_ROLES = ["admin", "manager", "coordinator", "corrdinator"];

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

/* Editable component marks are wired up per column in the scorecard tables:
 *   PDFT — intermediate, digital, cmos, tcl, physical, project, viva
 *   DVFT — intermediate, digital, verilog, sv, uvm, python, project, viva
 * Group averages (Theory / Grp1 / Grp2), Overall % and Grade are always
 * re-derived from those, never edited directly. */
const SCORECARD_YESNO_FIELDS = ["certification", "placement"];
/* Fields that live on the row itself; everything else sits under row.breakdown */
const SCORECARD_TOP_FIELDS = ["intermediate", "project", "viva"];

function scorecardFieldValue(row, field) {
  if (!row) return undefined;
  if (SCORECARD_TOP_FIELDS.includes(field) || SCORECARD_YESNO_FIELDS.includes(field)) return row[field];
  return row.breakdown?.[field];
}

function scGrade(overall) {
  if (overall >= 90) return "A";
  if (overall >= 80) return "B";
  if (overall >= 70) return "C";
  if (overall >= 60) return "D";
  return "F";
}

/* Re-derives group %, Overall %, Grade, Certification and Placement from a set
 * of component percentages — mirrors the backend scorecard formulas exactly so
 * the table updates live while editing. `weights` carries the original out_off
 * totals per theory subject (PDFT only) so an untouched row recomputes to the
 * same Theory % the backend produced. */
function recalcScorecard(kind, comp, weights) {
  const v       = f => { const x = parseFloat(comp[f]); return isNaN(x) ? 0 : x; };
  const inter   = v("intermediate");
  const project = v("project");
  const viva    = v("viva");

  let derived, overall;
  if (kind === "dvft") {
    const g1 = (v("digital") + v("verilog")) / 2;
    const g2 = (v("sv") + v("uvm") + v("python")) / 3;
    overall  = inter * 0.10 + g1 * 0.20 + g2 * 0.30 + project * 0.30 + viva * 0.10;
    derived  = { dvGroup1: g1.toFixed(2), dvGroup2: g2.toFixed(2) };
  } else {
    const w    = weights || {};
    const wn   = k => { const x = parseFloat(w[k]); return isNaN(x) ? 0 : x; };
    const wSum = wn("digital") + wn("cmos") + wn("tcl");
    const theory = wSum > 0
      ? (v("digital") * wn("digital") + v("cmos") * wn("cmos") + v("tcl") * wn("tcl")) / wSum
      : (v("digital") + v("cmos") + v("tcl")) / 3;
    overall = inter * 0.10 + theory * 0.20 + v("physical") * 0.30 + project * 0.30 + viva * 0.10;
    derived = { theory: theory.toFixed(2) };
  }

  return {
    ...derived,
    overall:       overall.toFixed(2),
    grade:         scGrade(overall),
    certification: project >= 70 && overall >= 70 ? "YES" : "NO",
    placement:     project >= 70 && viva >= 70 && overall >= 80 ? "YES" : "NO",
  };
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */
function SectionHeader({ icon, title, subtitle, right }) {
  return (
    <Box sx={{
      px: 3, py: 2.5,
      background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`,
      borderBottom: `1px solid ${TOKENS.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 1.5, flexWrap: "wrap",
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
      {right && <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>{right}</Box>}
    </Box>
  );
}

function StatusBanner({ message }) {
  if (!message) return null;
  const isSuccess = message.startsWith("✅");
  const isWarning = message.startsWith("⚠️");
  const colors = isSuccess ? TOKENS.success : isWarning ? TOKENS.warning : TOKENS.error;
  const Icon = isSuccess ? CheckCircleIcon : isWarning ? InfoOutlinedIcon : ErrorIcon;
  return (
    <Fade in>
      <Box sx={{ mt: 2, px: 2.5, py: 1.5, borderRadius: "10px", background: colors.light, border: `1px solid ${colors.fill}44`, display: "flex", alignItems: "center", gap: 1.5 }}>
        <Icon sx={{ fontSize: 16, color: colors.fill, flexShrink: 0 }} />
        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: colors.text }}>{message}</Typography>
      </Box>
    </Fade>
  );
}

/* Absent-mark pill — absent learners are stored as 0 marks; the scorecard
 * surfaces them as "AB" instead of a misleading 0%. */
function AbsentPill() {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", px: 1.2, py: 0.3, borderRadius: "20px", background: `${TOKENS.warning.fill}18`, border: `1px solid ${TOKENS.warning.fill}44` }}>
      <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 800, color: TOKENS.warning.fill }}>AB</Typography>
    </Box>
  );
}

/* Percentage cell — coloured pill. Accepts number or string.
 * When absentOnZero is set (scorecard view), a value of exactly 0 is shown
 * as "AB" because absentees are persisted with 0 marks. */
function PctCell({ value, absentOnZero }) {
  const num = parseFloat(value);
  if (absentOnZero && num === 0) {
    return <TableCell align="center" sx={{ ...tableCellSx, py: 0.8 }}><AbsentPill /></TableCell>;
  }
  if (isNaN(num) || (num === 0 && (value === null || value === undefined || value === ""))) {
    return <TableCell align="center" sx={{ ...tableCellSx, color: TOKENS.textSub, fontSize: 12 }}>—</TableCell>;
  }
  const color =
    num >= 80 ? TOKENS.success.fill :
    num >= 70 ? TOKENS.accent :
    num >= 60 ? TOKENS.warning.fill :
                TOKENS.error.fill;
  return (
    <TableCell align="center" sx={{ ...tableCellSx, py: 0.8 }}>
      <Box sx={{ display: "inline-flex", alignItems: "center", px: 1.2, py: 0.3, borderRadius: "20px", background: `${color}18`, border: `1px solid ${color}44` }}>
        <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color }}>{num.toFixed(2)}%</Typography>
      </Box>
    </TableCell>
  );
}

/* Overall cell — slightly larger. The only percentage shown rounded to a whole
 * number; the colour band still uses the exact value. */
function OverallCell({ value, accentColor, absentOnZero }) {
  const num = parseFloat(value) || 0;
  if (absentOnZero && parseFloat(value) === 0) {
    return <TableCell align="center" sx={tableCellSx}><AbsentPill /></TableCell>;
  }
  const c = accentColor || (num >= 80 ? TOKENS.success.fill : num >= 70 ? TOKENS.accent : TOKENS.error.fill);
  return (
    <TableCell align="center" sx={tableCellSx}>
      <Box sx={{ display: "inline-flex", px: 1.5, py: 0.4, borderRadius: "20px", background: `${c}18`, border: `1px solid ${c}44` }}>
        <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 800, color: c }}>{roundOverall(num)}%</Typography>
      </Box>
    </TableCell>
  );
}

/* YES / NO chip */
function YesNoChip({ value }) {
  const yes = value === "YES";
  return (
    <Chip label={value || "—"} size="small" sx={{
      fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11,
      background: yes ? TOKENS.success.light : TOKENS.error.light,
      color:      yes ? TOKENS.success.text  : TOKENS.error.text,
      border: `1px solid ${yes ? TOKENS.success.fill : TOKENS.error.fill}44`,
    }} />
  );
}

/* Grade chip */
const gradeColor = g => {
  if (g === "A" || g === "A+") return TOKENS.success.fill;
  if (g === "B")               return TOKENS.accent;
  if (g === "C")               return TOKENS.warning.fill;
  if (g === "D")               return "#8b5cf6";
  return TOKENS.error.fill;
};
function GradeChip({ grade }) {
  const c = gradeColor(grade || "F");
  return <Chip label={grade || "F"} size="small" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 12, background: `${c}18`, color: c, border: `1px solid ${c}44`, minWidth: 34 }} />;
}

/* Editable percentage cell — renders the read-only PctCell unless the current
 * user is allowed to edit the scorecard. */
function EditablePctCell({ value, editable, changed, onChange, absentOnZero }) {
  if (!editable) return <PctCell value={value} absentOnZero={absentOnZero} />;
  const invalid = value === "" || value === null || value === undefined ||
                  isNaN(parseFloat(value)) || parseFloat(value) < 0 || parseFloat(value) > 100;
  const bc = invalid ? TOKENS.error.fill : changed ? TOKENS.warning.fill : TOKENS.border;
  return (
    <TableCell align="center" sx={{ ...tableCellSx, py: 0.5, px: 0.5 }}>
      <TextField
        value={value ?? ""} onChange={e => onChange(e.target.value)}
        type="number" size="small"
        inputProps={{ min: 0, max: 100, step: "0.01",
          style: { textAlign: "center", padding: "6px 4px", fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700 } }}
        sx={{
          width: 82,
          "& .MuiOutlinedInput-root": { borderRadius: "8px", background: changed ? TOKENS.warning.light : TOKENS.surface },
          "& .MuiOutlinedInput-notchedOutline": { borderColor: bc },
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: invalid ? TOKENS.error.fill : TOKENS.accent },
        }}
      />
    </TableCell>
  );
}

/* Editable YES / NO cell — falls back to the read-only chip. */
function EditableYesNoCell({ value, editable, changed, onChange }) {
  if (!editable) return <TableCell align="center" sx={tableCellSx}><YesNoChip value={value} /></TableCell>;
  return (
    <TableCell align="center" sx={{ ...tableCellSx, py: 0.5, px: 0.5 }}>
      <Select value={value === "YES" ? "YES" : "NO"} onChange={e => onChange(e.target.value)} size="small"
        sx={{ ...inputSx, width: 88, fontWeight: 700, background: changed ? TOKENS.warning.light : TOKENS.surface,
              "& .MuiSelect-select": { py: 0.7 },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: changed ? TOKENS.warning.fill : TOKENS.border } }}>
        <MenuItem value="YES" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700 }}>YES</MenuItem>
        <MenuItem value="NO"  sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700 }}>NO</MenuItem>
      </Select>
    </TableCell>
  );
}

/* Remarks cell — mandatory whenever any value on the learner's row changed. */
function RemarksCell({ value, editable, required, error, onChange }) {
  if (!editable) {
    return (
      <TableCell sx={{ ...tableCellSx, whiteSpace: "normal", minWidth: 180, maxWidth: 280,
                       color: value ? TOKENS.text : TOKENS.textSub, fontSize: 12 }}>
        {value || "—"}
      </TableCell>
    );
  }
  return (
    <TableCell sx={{ ...tableCellSx, py: 0.5, minWidth: 220 }}>
      <TextField
        value={value ?? ""} onChange={e => onChange(e.target.value)}
        size="small" multiline maxRows={3} error={!!error}
        placeholder={required ? "Remarks required *" : "Remarks"}
        helperText={error ? "Mandatory — a mark was changed" : ""}
        inputProps={{ style: { fontFamily: "'DM Sans', sans-serif", fontSize: 12 } }}
        sx={{
          width: "100%", minWidth: 210,
          "& .MuiOutlinedInput-root": { borderRadius: "8px", background: required ? TOKENS.warning.light : TOKENS.surface, py: 0.4 },
          "& .MuiOutlinedInput-notchedOutline": { borderColor: error ? TOKENS.error.fill : required ? TOKENS.warning.fill : TOKENS.border },
          "& .MuiFormHelperText-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 10, mx: 0.4 },
        }}
      />
    </TableCell>
  );
}

/* Access badge for the scorecard header */
function ScorecardRoleBadge({ allowed, editing }) {
  const tok   = editing ? TOKENS.warning : allowed ? TOKENS.accent : null;
  const label = editing ? "Editing" : allowed ? "Edit allowed" : "View only";
  const color = editing ? TOKENS.warning.fill : allowed ? TOKENS.accent : TOKENS.textSub;
  const bg    = editing ? TOKENS.warning.light : allowed ? TOKENS.accentLight : TOKENS.surfaceAlt;
  return (
    <Chip
      size="small"
      icon={allowed ? <LockOpenIcon sx={{ fontSize: 13 }} /> : <LockIcon sx={{ fontSize: 13 }} />}
      label={label}
      sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11,
            background: bg, color, border: `1px solid ${tok ? color + "44" : TOKENS.border}` }}
    />
  );
}

/* Column group header */
function ColGroupHeader({ label, color, colSpan }) {
  return (
    <TableCell align="center" colSpan={colSpan}
      sx={{ ...tableHeadSx, background: color, color: TOKENS.text, borderRight: `1px solid ${TOKENS.border}`, textAlign: "center" }}>
      {label}
    </TableCell>
  );
}

/* Batch type pill */
function BatchPill({ batchNo }) {
  const isPdft = isPdftBatch(batchNo);
  const isDvft = isDvftBatch(batchNo);
  if (!isPdft && !isDvft) return null;
  const tok = isPdft ? TOKENS.pdft : TOKENS.dvft;
  return (
    <Chip label={isPdft ? "PDFT Batch" : "DVFT Batch"} size="small"
      sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: tok.light, color: tok.text, border: `1px solid ${tok.fill}40`, ml: 1 }} />
  );
}

/* ─── PDFT Scorecard Table ───────────────────────────────────────────────── */
function PdftScorecardTable({ data, batchNo, edit }) {
  const canEdit = !!edit?.enabled;
  return (
    <Box sx={{ ...cardSx }}>
      <SectionHeader
        icon={<TrophyIcon sx={{ fontSize: 20 }} />}
        title={<>Scorecard <BatchPill batchNo={batchNo} /></>}
        subtitle={`Batch ${batchNo} · ${data.length} learner${data.length !== 1 ? "s" : ""}`}
        right={
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {edit && <ScorecardRoleBadge allowed={edit.allowed} editing={canEdit} />}
            {[
              { label: "Intermediate 10%", color: "#e3f2fd" },
              { label: "Theory 20%",       color: "#f3e5f5" },
              { label: "Physical 30%",     color: "#fff3e0" },
              { label: "Project 30%",      color: "#fce4ec" },
              { label: "Viva 10%",         color: "#e0f7fa" },
            ].map(item => (
              <Chip key={item.label} label={item.label} size="small"
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 10, background: item.color, border: `1px solid ${TOKENS.border}` }} />
            ))}
          </Box>
        }
      />
      <TableContainer sx={{ maxHeight: 600 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell colSpan={2} sx={{ ...tableHeadSx }} />
              <ColGroupHeader label="Intermediate"  color="#e3f2fd" colSpan={1} />
              <ColGroupHeader label="Theory Group"  color="#f3e5f5" colSpan={4} />
              <ColGroupHeader label="Physical"      color="#fff3e0" colSpan={1} />
              <ColGroupHeader label="Project"       color="#fce4ec" colSpan={1} />
              <ColGroupHeader label="Viva"          color="#e0f7fa" colSpan={1} />
              <TableCell colSpan={5} sx={{ ...tableHeadSx }} />
            </TableRow>
            <TableRow>
              {[
                { l: "Name",           align: "left"   },
                { l: "Email",          align: "left"   },
                { l: "Intermediate %", align: "center", bg: "#e3f2fd" },
                { l: "Digital %",      align: "center", bg: "#f3e5f5" },
                { l: "CMOS %",         align: "center", bg: "#f3e5f5" },
                { l: "TCL %",          align: "center", bg: "#f3e5f5" },
                { l: "Theory Grp %",   align: "center", bg: "#f3e5f5" },
                { l: "Physical %",     align: "center", bg: "#fff3e0" },
                { l: "Project %",      align: "center", bg: "#fce4ec" },
                { l: "Viva %",         align: "center", bg: "#e0f7fa" },
                { l: "Overall %",      align: "center" },
                { l: "Grade",          align: "center" },
                { l: "Certification",  align: "center" },
                { l: "Placement",      align: "center" },
                { l: "Remarks",        align: "left"   },
              ].map(h => (
                <TableCell key={h.l} align={h.align}
                  sx={{ ...tableHeadSx, background: h.bg || TOKENS.surfaceAlt }}>{h.l}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((row, i) => {
              const em   = row.email;
              const cell = (field, value) => (
                <EditablePctCell value={value} editable={canEdit} absentOnZero
                  changed={canEdit && edit.changed(em, field)}
                  onChange={v => edit.onField(em, field, v)} />
              );
              return (
                <TableRow key={i} sx={{ "&:nth-of-type(even)": { background: TOKENS.surfaceAlt }, "&:hover": { background: `${TOKENS.accent}08` } }}>
                  <TableCell sx={{ ...tableCellSx, fontWeight: 600 }}>{row.name}</TableCell>
                  <TableCell sx={{ ...tableCellSx, color: TOKENS.textSub, fontSize: 12 }}>{row.email}</TableCell>
                  {cell("intermediate", row.intermediate)}
                  {cell("digital",  row.breakdown?.digital)}
                  {cell("cmos",     row.breakdown?.cmos)}
                  {cell("tcl",      row.breakdown?.tcl)}
                  {/* Theory Grp %, Overall % and Grade stay derived — never edited directly */}
                  <PctCell value={row.theory} absentOnZero />
                  {cell("physical", row.breakdown?.physical)}
                  {cell("project",  row.project)}
                  {cell("viva",     row.viva)}
                  <OverallCell value={row.overall} absentOnZero />
                  <TableCell align="center" sx={tableCellSx}><GradeChip grade={row.grade} /></TableCell>
                  <EditableYesNoCell value={row.certification} editable={canEdit}
                    changed={canEdit && edit.changed(em, "certification")}
                    onChange={v => edit.onField(em, "certification", v)} />
                  <EditableYesNoCell value={row.placement} editable={canEdit}
                    changed={canEdit && edit.changed(em, "placement")}
                    onChange={v => edit.onField(em, "placement", v)} />
                  <RemarksCell editable={canEdit}
                    value={canEdit ? edit.remarks(em) : row.remarks}
                    required={canEdit && edit.rowChanged(em)}
                    error={canEdit && edit.remarksError(em)}
                    onChange={v => edit.onRemarks(em, v)} />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ px: 3, py: 2, background: TOKENS.surfaceAlt, borderTop: `1px solid ${TOKENS.border}`, display: "flex", gap: 3, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <CertIcon sx={{ fontSize: 14, color: TOKENS.textSub }} />
          <Typography sx={{ ...labelSx, fontSize: 10 }}>Certification: Project ≥ 70% AND Overall ≥ 70%</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <SchoolIcon sx={{ fontSize: 14, color: TOKENS.textSub }} />
          {/* ✅ FIXED: Project threshold corrected from 70% → 60% */}
          <Typography sx={{ ...labelSx, fontSize: 10 }}>Placement: Project ≥ 60% AND Viva ≥ 70% AND Overall ≥ 80%</Typography>
        </Box>
        <Typography sx={{ ...labelSx, fontSize: 10 }}>
          Weightage: Intermediate 10% · Digital+CMOS+TCL 20% · Physical 30% · Project 30% · Viva 10%
        </Typography>
      </Box>
    </Box>
  );
}

/* ─── DVFT Scorecard Table ───────────────────────────────────────────────── */
function DvftScorecardTable({ data, batchNo, edit }) {
  const canEdit = !!edit?.enabled;
  return (
    <Box sx={{ ...cardSx }}>
      <SectionHeader
        icon={<TrophyIcon sx={{ fontSize: 20 }} />}
        title={<>Scorecard <BatchPill batchNo={batchNo} /></>}
        subtitle={`Batch ${batchNo} · ${data.length} learner${data.length !== 1 ? "s" : ""}`}
        right={
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {edit && <ScorecardRoleBadge allowed={edit.allowed} editing={canEdit} />}
            {[
              { label: "Intermediate 10%",      color: "#e3f2fd" },
              { label: "Digital + Verilog 20%", color: "#f3e5f5" },
              { label: "SV + UVM + Python 30%", color: "#fff3e0" },
              { label: "Project 30%",           color: "#fce4ec" },
              { label: "Viva 10%",              color: "#e0f7fa" },
            ].map(item => (
              <Chip key={item.label} label={item.label} size="small"
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 10, background: item.color, border: `1px solid ${TOKENS.border}` }} />
            ))}
          </Box>
        }
      />
      <TableContainer sx={{ maxHeight: 600 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell colSpan={2} sx={{ ...tableHeadSx }} />
              <ColGroupHeader label="Intermediate"               color="#e3f2fd" colSpan={1} />
              <ColGroupHeader label="Group 1 — Digital + Verilog" color="#f3e5f5" colSpan={3} />
              <ColGroupHeader label="Group 2 — SV + UVM + Python" color="#fff3e0" colSpan={4} />
              <ColGroupHeader label="Project"                    color="#fce4ec" colSpan={1} />
              <ColGroupHeader label="Viva"                       color="#e0f7fa" colSpan={1} />
              <TableCell colSpan={5} sx={{ ...tableHeadSx }} />
            </TableRow>
            <TableRow>
              {[
                { l: "Name",           align: "left"   },
                { l: "Email",          align: "left"   },
                { l: "Intermediate %", align: "center", bg: "#e3f2fd" },
                { l: "Digital %",      align: "center", bg: "#f3e5f5" },
                { l: "Verilog %",      align: "center", bg: "#f3e5f5" },
                { l: "Grp1 %",         align: "center", bg: "#f3e5f5" },
                { l: "SV %",           align: "center", bg: "#fff3e0" },
                { l: "UVM %",          align: "center", bg: "#fff3e0" },
                { l: "Python %",       align: "center", bg: "#fff3e0" },
                { l: "Grp2 %",         align: "center", bg: "#fff3e0" },
                { l: "Project %",      align: "center", bg: "#fce4ec" },
                { l: "Viva %",         align: "center", bg: "#e0f7fa" },
                { l: "Overall %",      align: "center" },
                { l: "Grade",          align: "center" },
                { l: "Certification",  align: "center" },
                { l: "Placement",      align: "center" },
                { l: "Remarks",        align: "left"   },
              ].map(h => (
                <TableCell key={h.l} align={h.align}
                  sx={{ ...tableHeadSx, background: h.bg || TOKENS.surfaceAlt }}>{h.l}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((row, i) => {
              const em   = row.email;
              const cell = (field, value) => (
                <EditablePctCell value={value} editable={canEdit} absentOnZero
                  changed={canEdit && edit.changed(em, field)}
                  onChange={v => edit.onField(em, field, v)} />
              );
              return (
                <TableRow key={i} sx={{ "&:nth-of-type(even)": { background: TOKENS.surfaceAlt }, "&:hover": { background: TOKENS.dvft.light } }}>
                  <TableCell sx={{ ...tableCellSx, fontWeight: 600 }}>{row.name}</TableCell>
                  <TableCell sx={{ ...tableCellSx, color: TOKENS.textSub, fontSize: 12 }}>{row.email}</TableCell>
                  {cell("intermediate", row.intermediate)}
                  {cell("digital", row.breakdown?.digital)}
                  {cell("verilog", row.breakdown?.verilog)}
                  {/* Grp1 %, Grp2 %, Overall % and Grade stay derived — never edited directly */}
                  <PctCell value={row.dvGroup1} absentOnZero />
                  {cell("sv",     row.breakdown?.sv)}
                  {cell("uvm",    row.breakdown?.uvm)}
                  {cell("python", row.breakdown?.python)}
                  <PctCell value={row.dvGroup2} absentOnZero />
                  {cell("project", row.project)}
                  {cell("viva",    row.viva)}
                  <OverallCell value={row.overall} accentColor={TOKENS.dvft.fill} absentOnZero />
                  <TableCell align="center" sx={tableCellSx}><GradeChip grade={row.grade} /></TableCell>
                  <EditableYesNoCell value={row.certification} editable={canEdit}
                    changed={canEdit && edit.changed(em, "certification")}
                    onChange={v => edit.onField(em, "certification", v)} />
                  <EditableYesNoCell value={row.placement} editable={canEdit}
                    changed={canEdit && edit.changed(em, "placement")}
                    onChange={v => edit.onField(em, "placement", v)} />
                  <RemarksCell editable={canEdit}
                    value={canEdit ? edit.remarks(em) : row.remarks}
                    required={canEdit && edit.rowChanged(em)}
                    error={canEdit && edit.remarksError(em)}
                    onChange={v => edit.onRemarks(em, v)} />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ px: 3, py: 2, background: TOKENS.surfaceAlt, borderTop: `1px solid ${TOKENS.border}`, display: "flex", gap: 3, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <CertIcon sx={{ fontSize: 14, color: TOKENS.textSub }} />
          <Typography sx={{ ...labelSx, fontSize: 10 }}>Certification: Project ≥ 70% AND Overall ≥ 70%</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <SchoolIcon sx={{ fontSize: 14, color: TOKENS.textSub }} />
          {/* ✅ FIXED: Project threshold corrected from 70% → 60% */}
          <Typography sx={{ ...labelSx, fontSize: 10 }}>Placement: Project ≥ 60% AND Viva ≥ 70% AND Overall ≥ 80%</Typography>
        </Box>
        <Typography sx={{ ...labelSx, fontSize: 10 }}>
          Weightage: Intermediate 10% · Digital+Verilog 20% · SV+UVM+Python 30% · Project 30% · Viva 10%
        </Typography>
      </Box>
    </Box>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
export default function MarksDashboard({ user }) {
  const [batchNo,        setBatchNo]        = useState("");
  const [assessmentType, setAssessmentType] = useState("weekly");
  const [marksData,      setMarksData]      = useState([]);
  const [scorecardData,  setScorecardData]  = useState([]);
  const [batches,        setBatches]        = useState([]);
  const [fetchLoading,   setFetchLoading]   = useState(false);
  const [message,        setMessage]        = useState("");

  /* ── Scorecard editing state (Admin / Manager / Coordinator) ── */
  const [editMode,     setEditMode]     = useState(false); // read-only until switched on
  const [edits,        setEdits]        = useState({});    // { email: { field: value } }
  const [remarksDraft, setRemarksDraft] = useState({});    // { email: remarks }
  const [showErrors,   setShowErrors]   = useState(false);
  const [saving,       setSaving]       = useState(false);

  /* Prefer the prop; fall back to the stored session so role detection works
   * regardless of which login flow ran. */
  const sessionUser = useMemo(getSessionUser, []);
  const activeUser  = (user && (user.role || user.email)) ? user : sessionUser;

  const welcomeName = user?.name || "User";
  const roleTitle   = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : "Dashboard";

  const isPdft      = isPdftBatch(batchNo);
  const isDvft      = isDvftBatch(batchNo);
  const isScorecard = assessmentType === "scorecard";

  const scorecardKind    = isDvft ? "dvft" : "pdft";
  const canEditScorecard = SCORECARD_EDIT_ROLES.includes(
    (activeUser?.role || "").toString().trim().toLowerCase()
  );

  /* ── Load batches ── */
  useEffect(() => {
    axios.get(`${API_BASE}/api/batches`)
      .then(res => { if (Array.isArray(res.data)) setBatches(res.data); })
      .catch(() => setMessage("Error loading batches"));
  }, []);

  /* ── Fetch marks ── */
  const fetchMarks = async () => {
    if (!batchNo) { setMessage("⚠️ Please select a batch"); return; }
    setFetchLoading(true); setMessage(""); setMarksData([]); setScorecardData([]);
    resetScorecardDrafts();

    try {
      if (isScorecard) {
        if (!isPdft && !isDvft) {
          setMessage("⚠️ Scorecard is only available for PDFT and DVFT batches");
          setFetchLoading(false);
          return;
        }

        const endpoint = isDvft
          ? `${API_BASE}/api/scorecard-dvft/${batchNo}`
          : `${API_BASE}/api/scorecard/${batchNo}`;

        const res = await axios.get(endpoint);

        const rows = Array.isArray(res.data?.data) ? res.data.data
                   : Array.isArray(res.data)       ? res.data
                   : [];

        if (!rows.length) {
          setMessage("⚠️ No scorecard data found for this batch");
          return;
        }

        setScorecardData(rows);
        setMessage(`✅ Loaded scorecard for ${rows.length} learner${rows.length !== 1 ? "s" : ""}`);

      } else {
        /* ── Regular assessment view ── */
        const res = await axios.get(`${API_BASE}/api/assessments/${batchNo}/${assessmentType}`);
        const data = Array.isArray(res.data?.data) ? res.data.data
                   : Array.isArray(res.data)       ? res.data
                   : [];
        const processed = data.map(row =>
          assessmentType === "intermediate"
            ? { ...row, topic_name: resolveIntermediateTopic(row.topic_name, row.assessment_name) }
            : row
        );
        setMarksData(processed);
        setMessage(
          processed.length
            ? `✅ Loaded ${processed.length} record${processed.length !== 1 ? "s" : ""}`
            : "⚠️ No data found for this batch and assessment type"
        );
      }
    } catch (err) {
      setMessage(`Error fetching data: ${err?.response?.data?.error || err.message || "unknown"}`);
    } finally {
      setFetchLoading(false);
    }
  };

  /* ─── Scorecard editing ──────────────────────────────────────────────────
   * Edits live in local state until Save. Overall %, Grade and the group
   * averages are re-derived on every keystroke, so the table always shows the
   * result the backend will store. */

  /* Drops pending edits but stays in edit mode. */
  function resetScorecardDrafts() {
    setEdits({}); setRemarksDraft({}); setShowErrors(false);
  }
  /* Full reset — also leaves edit mode (batch / assessment type switch). */
  function clearScorecardEdits() {
    resetScorecardDrafts(); setEditMode(false);
  }

  const baseRowByEmail = useMemo(() => {
    const m = {};
    scorecardData.forEach(r => { m[r.email] = r; });
    return m;
  }, [scorecardData]);

  const handleFieldChange = (email, field, value) => {
    setEdits(prev => {
      const orig    = scorecardFieldValue(baseRowByEmail[email], field);
      const rowNext = { ...(prev[email] || {}) };
      /* Typing the original value back clears the edit, so the row stops
       * counting as changed and its remarks stop being mandatory. */
      const isYesNo = SCORECARD_YESNO_FIELDS.includes(field);
      const same    = isYesNo
        ? String(value) === String(orig ?? "")
        : value !== "" && parseFloat(value) === parseFloat(orig);

      if (same) delete rowNext[field]; else rowNext[field] = value;

      const next = { ...prev };
      if (Object.keys(rowNext).length) next[email] = rowNext; else delete next[email];
      return next;
    });
  };

  const handleRemarksChange = (email, value) =>
    setRemarksDraft(prev => ({ ...prev, [email]: value }));

  const remarksFor = email =>
    remarksDraft[email] !== undefined
      ? remarksDraft[email]
      : (baseRowByEmail[email]?.remarks || "");

  /* Rows whose marks / YES-NO values changed. */
  const markDirtyEmails = Object.keys(edits);

  /* Rows where only the Remarks text was touched. These have to be saveable on
   * their own — otherwise a remark typed against an untouched row is silently
   * dropped and the Save button never even appears. */
  const remarksDirtyEmails = Object.keys(remarksDraft).filter(em =>
    !edits[em] &&
    baseRowByEmail[em] &&
    (remarksDraft[em] ?? "").trim() !== (baseRowByEmail[em]?.remarks || "").trim()
  );

  const dirtyEmails = [...markDirtyEmails, ...remarksDirtyEmails];
  const dirtyCount  = dirtyEmails.length;

  /* Remarks are mandatory only for rows whose marks changed. */
  const missingRemarks = markDirtyEmails.filter(em => !remarksFor(em).trim());
  const invalidMarks   = markDirtyEmails.filter(em =>
    Object.entries(edits[em]).some(([f, v]) => {
      if (SCORECARD_YESNO_FIELDS.includes(f)) return false;
      const num = parseFloat(v);
      return v === "" || isNaN(num) || num < 0 || num > 100;
    })
  );

  /* Rows with edits applied + derived fields recomputed. Untouched rows are
   * passed through by reference so the existing view is byte-for-byte
   * unchanged when nothing has been edited. */
  const displayScorecard = useMemo(() => scorecardData.map(row => {
    const e = edits[row.email];
    if (!e || !Object.keys(e).length) return row;

    const breakdown = { ...(row.breakdown || {}) };
    const comp      = { ...breakdown, intermediate: row.intermediate, project: row.project, viva: row.viva };
    const merged    = { ...row, breakdown };

    Object.entries(e).forEach(([f, v]) => {
      if (SCORECARD_YESNO_FIELDS.includes(f)) return;
      comp[f] = v;
      if (SCORECARD_TOP_FIELDS.includes(f)) merged[f] = v; else breakdown[f] = v;
    });

    const out = { ...merged, ...recalcScorecard(scorecardKind, comp, row.breakdownOut) };
    /* An explicit Certification / Placement override wins over the rule. */
    if (e.certification) out.certification = e.certification;
    if (e.placement)     out.placement     = e.placement;
    return out;
  }), [scorecardData, edits, scorecardKind]);

  const saveScorecardChanges = async () => {
    if (!dirtyCount || saving) return;

    if (invalidMarks.length) {
      setShowErrors(true);
      setMessage("⚠️ Every changed mark must be a number between 0 and 100");
      return;
    }
    if (missingRemarks.length) {
      setShowErrors(true);
      setMessage(`⚠️ Remarks are mandatory — ${missingRemarks.length} changed learner${missingRemarks.length !== 1 ? "s are" : " is"} missing one`);
      return;
    }

    /* Numeric overrides are sent as numbers so the backend never has to guess,
     * and rows that only carry a remark send an empty override map. */
    const updates = dirtyEmails.map(em => {
      const raw       = edits[em] || {};
      const overrides = {};
      Object.entries(raw).forEach(([f, v]) => {
        if (v === "" || v === null || v === undefined) return;
        overrides[f] = SCORECARD_YESNO_FIELDS.includes(f)
          ? String(v).trim().toUpperCase()
          : Number(parseFloat(v).toFixed(2));
      });
      return { learner_email: em, overrides, remarks: remarksFor(em).trim() };
    });

    setSaving(true); setMessage("");
    try {
      const res = await axios.post(`${API_BASE}/api/scorecard/override`, {
        batch_no:  batchNo,
        kind:      scorecardKind,
        role:      activeUser?.role  || "",
        edited_by: activeUser?.email || activeUser?.name || "",
        updates,
      });

      /* A 200 with success:false still means nothing was written — surface it
       * instead of reporting a save that never happened. */
      if (res?.data && res.data.success === false) {
        throw new Error(res.data.error || "The server did not save the changes");
      }

      const saved = res?.data?.saved ?? dirtyCount;
      resetScorecardDrafts();
      await fetchMarks();   // reload so the saved overrides come back merged
      setMessage(`✅ Saved changes for ${saved} learner${saved !== 1 ? "s" : ""}`);
    } catch (err) {
      const d = err?.response?.data;
      /* The backend returns details + hint on a storage failure — showing them
       * beats a bare "Failed to save scorecard changes" with a 500 in the
       * console and no way to tell what actually broke. */
      const parts = [d?.error || err.message || "unknown"];
      if (d?.details) parts.push(d.details);
      if (d?.hint)    parts.push(d.hint);
      console.error("Scorecard save failed:", d || err);
      setMessage(`Error saving scorecard: ${parts.join(" — ")}`);
    } finally {
      setSaving(false);
    }
  };

  /* Leaving edit mode with unsaved work would hide the pending changes, so
   * it is blocked until they are saved or discarded. */
  const toggleEditMode = () => {
    if (editMode && dirtyCount > 0) {
      setMessage("⚠️ Save or discard your changes before leaving edit mode");
      return;
    }
    setMessage("");
    setShowErrors(false);
    setEditMode(v => !v);
  };

  /* Handed to the scorecard tables. */
  const scorecardEdit = {
    allowed:      canEditScorecard,
    enabled:      canEditScorecard && editMode,
    changed:      (email, field) => edits[email]?.[field] !== undefined,
    rowChanged:   email => !!edits[email],
    onField:      handleFieldChange,
    remarks:      remarksFor,
    onRemarks:    handleRemarksChange,
    remarksError: email => showErrors && !!edits[email] && !remarksFor(email).trim(),
  };

  /* ── Column definitions for non-scorecard tables ── */
  const getNonScorecardColumns = () => {
    if (!marksData.length || isScorecard) return [];
    const sample = marksData[0];
    const cols = [
      { key: "learner_name",  label: "Name"  },
      { key: "learner_email", label: "Email" },
      { key: "batch_no",      label: "Batch" },
    ];
    if (assessmentType === "module") {
      if (sample.module_no !== undefined) cols.push({ key: "module_no", label: "Module" });
    } else {
      if (sample.week_no !== undefined) cols.push({ key: "week_no", label: "Week" });
    }
    cols.push(
      { key: "assessment_date", label: "Date"       },
      { key: "topic_name",      label: "Assessment" },
      { key: "out_off",         label: "Out Of"     },
      { key: "points",          label: "Points"     },
      { key: "percentage",      label: "Percentage" },
    );
    return cols;
  };

  /* ── Excel export ── */
  const downloadExcel = () => {
    const now = new Date();
    const tsDisplay = formatTimestamp(now), tsFile = fileTimestamp(now);
    let exportData;

    if (isScorecard && isPdft) {
      exportData = displayScorecard.map(r => ({
        Name: r.name, Email: r.email,
        "Intermediate (%)": ab(r.intermediate),
        "Digital (%)":       ab(r.breakdown?.digital),
        "CMOS (%)":          ab(r.breakdown?.cmos),
        "TCL (%)":           ab(r.breakdown?.tcl),
        "Theory Group (%)":  ab(r.theory),
        "Physical (%)":      ab(r.breakdown?.physical),
        "Project (%)":       ab(r.project),
        "Viva (%)":          ab(r.viva),
        "Overall (%)":       abOverall(r.overall),
        Grade: r.grade, Certification: r.certification, Placement: r.placement,
        Remarks: remarksFor(r.email) || "",
      }));
    } else if (isScorecard && isDvft) {
      exportData = displayScorecard.map(r => ({
        Name: r.name, Email: r.email,
        "Intermediate (%)":  ab(r.intermediate),
        "Digital (%)":       ab(r.breakdown?.digital),
        "Verilog (%)":       ab(r.breakdown?.verilog),
        "Grp1 Avg (%)":      ab(r.dvGroup1),
        "SV (%)":            ab(r.breakdown?.sv),
        "UVM (%)":           ab(r.breakdown?.uvm),
        "Python (%)":        ab(r.breakdown?.python),
        "Grp2 Avg (%)":      ab(r.dvGroup2),
        "Project (%)":       ab(r.project),
        "Viva (%)":          ab(r.viva),
        "Overall (%)":       abOverall(r.overall),
        Grade: r.grade, Certification: r.certification, Placement: r.placement,
        Remarks: remarksFor(r.email) || "",
      }));
    } else {
      const cols = getNonScorecardColumns();
      exportData = marksData.map(row => {
        const obj = {};
        cols.forEach(c => { obj[c.label] = row[c.key] ?? ""; });
        return obj;
      });
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([]);
    XLSX.utils.sheet_add_aoa(ws, [[`Batch: ${batchNo}  |  Type: ${assessmentType.toUpperCase()}  |  Downloaded: ${tsDisplay}`]], { origin: "A1" });
    XLSX.utils.sheet_add_json(ws, exportData, { origin: "A3" });
    XLSX.utils.book_append_sheet(wb, ws, "Marks Data");
    XLSX.writeFile(wb, `marks_${batchNo}_${assessmentType}_${tsFile}.xlsx`);
  };

  /* ── PDF export ── */
  const downloadPDF = () => {
    const now = new Date();
    const tsDisplay = formatTimestamp(now), tsFile = fileTimestamp(now);
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14); doc.setFont(undefined, "bold");
    doc.text(`Marks Report — ${batchNo}`, 14, 16);
    doc.setFontSize(9); doc.setFont(undefined, "normal"); doc.setTextColor(100);
    doc.text(`Type: ${assessmentType.toUpperCase()}   |   Downloaded: ${tsDisplay}`, 14, 23);
    doc.setTextColor(0);

    if (isScorecard && isPdft) {
      doc.autoTable({
        startY: 30,
        head: [["Name","Email","Inter %","Digital %","CMOS %","TCL %","Theory %","Physical %","Project %","Viva %","Overall %","Grade","Cert","Place","Remarks"]],
        body: displayScorecard.map(r => [
          r.name, r.email,
          ab(r.intermediate), ab(r.breakdown?.digital), ab(r.breakdown?.cmos), ab(r.breakdown?.tcl),
          ab(r.theory), ab(r.breakdown?.physical), ab(r.project), ab(r.viva), abOverall(r.overall),
          r.grade, r.certification, r.placement, remarksFor(r.email) || "",
        ]),
        styles: { fontSize: 7 }, alternateRowStyles: { fillColor: [245, 247, 255] },
        headStyles: { fillColor: [124, 58, 237], textColor: 255, fontStyle: "bold" },
      });
    } else if (isScorecard && isDvft) {
      doc.autoTable({
        startY: 30,
        head: [["Name","Email","Inter %","Digital %","Verilog %","Grp1 %","SV %","UVM %","Python %","Grp2 %","Project %","Viva %","Overall %","Grade","Cert","Place","Remarks"]],
        body: displayScorecard.map(r => [
          r.name, r.email,
          ab(r.intermediate), ab(r.breakdown?.digital), ab(r.breakdown?.verilog), ab(r.dvGroup1),
          ab(r.breakdown?.sv), ab(r.breakdown?.uvm), ab(r.breakdown?.python), ab(r.dvGroup2),
          ab(r.project), ab(r.viva), abOverall(r.overall), r.grade, r.certification, r.placement,
          remarksFor(r.email) || "",
        ]),
        styles: { fontSize: 7 }, alternateRowStyles: { fillColor: [240, 249, 255] },
        headStyles: { fillColor: [8, 145, 178], textColor: 255, fontStyle: "bold" },
      });
    } else {
      const cols = getNonScorecardColumns();
      doc.autoTable({
        startY: 30,
        head: [cols.map(c => c.label)],
        body: marksData.map(row =>
          cols.map(c =>
            c.key === "percentage" && row[c.key] != null
              ? `${parseFloat(row[c.key]).toFixed(2)}%`
              : (row[c.key] ?? "")
          )
        ),
        styles: { fontSize: 7 }, alternateRowStyles: { fillColor: [245, 247, 255] },
        headStyles: { fillColor: [61, 90, 254], textColor: 255, fontStyle: "bold" },
      });
    }

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(7); doc.setTextColor(150);
      doc.text(
        `Page ${i} of ${pages}   |   Downloaded: ${tsDisplay}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 6,
        { align: "center" }
      );
    }
    doc.save(`marks_${batchNo}_${assessmentType}_${tsFile}.pdf`);
  };

  const hasData = isScorecard ? scorecardData.length > 0 : marksData.length > 0;

  /* ─── Render ──────────────────────────────────────────────────────────── */
  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>

      <Box sx={{ maxWidth: 1700, mx: "auto" }}>

        {/* ── Page Header ── */}
        <Box sx={{ mb: 4, display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
          <Box>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
              {roleTitle} — Marks Dashboard
            </Typography>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
              Welcome back, <strong style={{ color: TOKENS.accent }}>{welcomeName}</strong>
            </Typography>
          </Box>
          {hasData && (
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
              {/* ── Edit toggle — Admin / Manager / Coordinator only ── */}
              {isScorecard && canEditScorecard && (isPdft || isDvft) && (
                <Button variant={editMode ? "contained" : "outlined"} onClick={toggleEditMode} disabled={saving}
                  startIcon={editMode ? <LockOpenIcon sx={{ fontSize: 16 }} /> : <LockIcon sx={{ fontSize: 16 }} />}
                  sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none",
                        ...(editMode
                          ? { background: TOKENS.warning.fill, color: "#fff", "&:hover": { background: "#d97706" } }
                          : { borderColor: TOKENS.accent + "55", color: TOKENS.accent, "&:hover": { borderColor: TOKENS.accent, background: TOKENS.accentLight } }) }}>
                  {editMode ? "Editing" : "Edit Scorecard"}
                </Button>
              )}

              {/* ── Save bar — only once something on the scorecard changed ── */}
              {isScorecard && canEditScorecard && dirtyCount > 0 && (
                <>
                  <Button variant="text" startIcon={<UndoIcon sx={{ fontSize: 16 }} />}
                    onClick={() => { resetScorecardDrafts(); setMessage(""); }} disabled={saving}
                    sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", color: TOKENS.textSub, "&:hover": { background: TOKENS.surfaceAlt } }}>
                    Discard
                  </Button>
                  <Button variant="contained" onClick={saveScorecardChanges} disabled={saving}
                    startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon sx={{ fontSize: 16 }} />}
                    sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", px: 2.5, background: TOKENS.success.fill, "&:hover": { background: "#0e9f74" }, "&:disabled": { opacity: 0.6 } }}>
                    {saving ? "Saving…" : `Save Changes (${dirtyCount})`}
                  </Button>
                </>
              )}
              <Button variant="outlined" startIcon={<DownloadIcon sx={{ fontSize: 16 }} />} onClick={downloadExcel}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", borderColor: TOKENS.border, color: TOKENS.textSub, "&:hover": { borderColor: TOKENS.accent, color: TOKENS.accent, background: TOKENS.accentLight } }}>
                Excel
              </Button>
              <Button variant="outlined" startIcon={<DownloadIcon sx={{ fontSize: 16 }} />} onClick={downloadPDF}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", textTransform: "none", borderColor: `${TOKENS.error.fill}44`, color: TOKENS.error.fill, "&:hover": { borderColor: TOKENS.error.fill, background: TOKENS.error.light } }}>
                PDF
              </Button>
            </Box>
          )}
        </Box>

        {/* ── Filters Card ── */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <SectionHeader
            icon={<BarChartIcon sx={{ fontSize: 20 }} />}
            title="Assessment Filters"
            subtitle="Select batch and assessment type, then click Fetch Marks"
          />
          <Box sx={{ p: 3, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-end" }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Select Batch</InputLabel>
              <Select value={batchNo} label="Select Batch"
                onChange={e => { setBatchNo(e.target.value); setMarksData([]); setScorecardData([]); setMessage(""); clearScorecardEdits(); }}
                sx={inputSx}>
                <MenuItem value="" sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>— Select Batch —</MenuItem>
                {batches.map((b, i) => (
                  <MenuItem key={i} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{b.batch_no}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Assessment Type</InputLabel>
              <Select value={assessmentType} label="Assessment Type"
                onChange={e => { setAssessmentType(e.target.value); setMarksData([]); setScorecardData([]); setMessage(""); clearScorecardEdits(); }}
                sx={inputSx}>
                {[
                  { v: "weekly",       l: "Weekly"          },
                  { v: "intermediate", l: "Intermediate"     },
                  { v: "module",       l: "Module"           },
                  { v: "final",        l: "Final Assessment" },
                  { v: "scorecard",    l: "Scorecard"        },
                ].map(item => (
                  <MenuItem key={item.v} value={item.v} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{item.l}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button variant="contained" onClick={fetchMarks} disabled={!batchNo || fetchLoading}
              startIcon={fetchLoading ? <CircularProgress size={14} color="inherit" /> : <TableChartIcon sx={{ fontSize: 16 }} />}
              sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 3, py: 1.1, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" }, "&:disabled": { opacity: 0.5 } }}>
              {fetchLoading ? "Loading…" : "Fetch Marks"}
            </Button>

            {batchNo && <BatchPill batchNo={batchNo} />}

            {hasData && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.8, borderRadius: "10px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                <PersonIcon sx={{ fontSize: 14, color: TOKENS.accent }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: TOKENS.accent }}>
                  {isScorecard ? scorecardData.length : marksData.length} {isScorecard ? "learners" : "records"}
                </Typography>
              </Box>
            )}
          </Box>
          <StatusBanner message={message} />
          {message && <Box sx={{ pb: 1 }} />}
        </Box>

        {/* ── PDFT Scorecard ── */}
        {isScorecard && isPdft && scorecardData.length > 0 && (
          <PdftScorecardTable data={displayScorecard} batchNo={batchNo} edit={scorecardEdit} />
        )}

        {/* ── DVFT Scorecard ── */}
        {isScorecard && isDvft && scorecardData.length > 0 && (
          <DvftScorecardTable data={displayScorecard} batchNo={batchNo} edit={scorecardEdit} />
        )}

        {/* ── Scorecard: non-special batch ── */}
        {isScorecard && !isPdft && !isDvft && batchNo && !fetchLoading && (
          <Box sx={{ ...cardSx, textAlign: "center", color: TOKENS.textSub, py: 5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 500 }}>
              Scorecard is only available for <strong>PDFT</strong> and <strong>DVFT</strong> batches.
            </Typography>
          </Box>
        )}

        {/* ── Non-Scorecard Table ── */}
        {!isScorecard && marksData.length > 0 && (() => {
          const columns = getNonScorecardColumns();
          return (
            <Box sx={{ ...cardSx }}>
              <SectionHeader
                icon={<TableChartIcon sx={{ fontSize: 20 }} />}
                title={`${assessmentType.charAt(0).toUpperCase() + assessmentType.slice(1)} Assessment Marks`}
                subtitle={`Batch ${batchNo} · ${marksData.length} records`}
                right={
                  <Chip label={`${marksData.length} records`} size="small"
                    sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.accentLight, color: TOKENS.accent, border: `1px solid ${TOKENS.accent}33` }} />
                }
              />
              <TableContainer sx={{ maxHeight: 600 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ ...tableHeadSx, width: 36 }}>#</TableCell>
                      {columns.map(col => <TableCell key={col.key} sx={tableHeadSx}>{col.label}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {marksData.map((row, i) => (
                      <TableRow key={i} sx={{ "&:nth-of-type(even)": { background: TOKENS.surfaceAlt }, "&:hover": { background: `${TOKENS.accent}08` } }}>
                        <TableCell sx={{ ...tableCellSx, color: TOKENS.textSub, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{i + 1}</TableCell>
                        {columns.map(col => {
                          if (col.key === "percentage") {
                            const nv = parseFloat(row[col.key]);
                            if (!isNaN(nv)) return <PctCell key={col.key} value={nv} />;
                            return <TableCell key={col.key} sx={tableCellSx}>—</TableCell>;
                          }
                          const isName  = col.key === "learner_name";
                          const isEmail = col.key === "learner_email";
                          const isNum   = ["points","out_off","week_no","module_no"].includes(col.key);
                          return (
                            <TableCell key={col.key} sx={{
                              ...tableCellSx,
                              fontWeight:  isName ? 600 : 400,
                              color:       isEmail ? TOKENS.textSub : TOKENS.text,
                              fontSize:    isEmail ? 12 : 13,
                              fontFamily:  isNum ? "'DM Mono', monospace" : "'DM Sans', sans-serif",
                            }}>
                              {row[col.key] ?? "—"}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          );
        })()}
      </Box>
    </Box>
  );
}