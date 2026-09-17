import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Table,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
  TableContainer,
  Button,
  Chip,
  Tooltip as MuiTooltip,
} from "@mui/material";
import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import RestartAltIcon    from "@mui/icons-material/RestartAlt";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import GroupIcon         from "@mui/icons-material/Group";
import PersonIcon        from "@mui/icons-material/Person";
import EmailIcon         from "@mui/icons-material/Email";
import PhoneIcon         from "@mui/icons-material/Phone";

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
  planned:     { fill: "#f59e0b", light: "#fef3c7", text: "#92400e" },
  progress:    { fill: "#3d5afe", light: "#e8ecff", text: "#1e3a8a" },
  completed:   { fill: "#10b981", light: "#d1fae5", text: "#065f46" },
};

const STATUS_MAP = {
  Planned:         TOKENS.planned,
  "In Progress":   TOKENS.progress,
  Completed:       TOKENS.completed,
};

const PIE_COLORS = [TOKENS.planned.fill, TOKENS.progress.fill, TOKENS.completed.fill];

const API_BASE =
  process.env.REACT_APP_API_URL || "http://192.168.1.2:5000/";

/* ─── Shared styles ──────────────────────────────────────────────────────── */
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

/* ═══════════════════════════════════════════════════════════════════════════
 *  renderTrainerNames
 * ═══════════════════════════════════════════════════════════════════════════ */
function renderTrainerNames(trainerNames, trainerDetails) {
  return (trainerNames || []).map((name, index) => {
    const details = trainerDetails?.[name];
    return (
      <span key={name + index}>
        <MuiTooltip
          arrow
          placement="right"
          componentsProps={{
            tooltip: {
              sx: {
                background:   "linear-gradient(135deg, #1a1f36 0%, #2d3561 100%)",
                color:        "#fff",
                p:            0,
                borderRadius: "12px",
                boxShadow:    "0 8px 32px rgba(0,0,0,0.3)",
                border:       "1px solid rgba(255,255,255,0.08)",
                minWidth:     220,
                overflow:     "hidden",
              },
            },
            arrow: { sx: { color: "#1a1f36" } },
          }}
          title={
            details ? (
              <Box>
                <Box sx={{ px: 2, py: 1.2, background: "rgba(61,90,254,0.25)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 13, color: "#fff", letterSpacing: "-0.01em" }}>{name}</Typography>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>Trainer</Typography>
                </Box>
                <Box sx={{ px: 2, py: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <EmailIcon sx={{ fontSize: 13, color: "#7c8cff", flexShrink: 0 }} />
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "#7c8cff", cursor: "pointer", textDecoration: "underline", wordBreak: "break-all", "&:hover": { color: "#a5b4ff" } }}
                      onClick={(e) => { e.stopPropagation(); window.location.href = `mailto:${details.email}`; }}>
                      {details.email}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <PhoneIcon sx={{ fontSize: 13, color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.65)" }}>{details.phone}</Typography>
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>No details available</Typography>
              </Box>
            )
          }
        >
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, color: TOKENS.accent, textDecoration: "underline dotted", textUnderlineOffset: "3px", cursor: "pointer" }}>
            {name}
          </span>
        </MuiTooltip>
        {index < (trainerNames || []).length - 1 && (
          <span style={{ color: TOKENS.textSub, margin: "0 4px" }}>,</span>
        )}
      </span>
    );
  });
}

/* ─── StatPill ───────────────────────────────────────────────────────────── */
function StatPill({ icon, label, value }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1, borderRadius: "10px", background: TOKENS.surfaceAlt, border: `1px solid ${TOKENS.border}` }}>
      <Box sx={{ color: TOKENS.accent, display: "flex", alignItems: "center" }}>{icon}</Box>
      <Box>
        <Typography sx={{ ...labelSx, fontSize: 10 }}>{label}</Typography>
        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: TOKENS.text, lineHeight: 1.2 }}>{value}</Typography>
      </Box>
    </Box>
  );
}

/* ─── TrainerPill ─────────────────────────────────────────────────────────── */
function TrainerPill({ trainerNames, trainerDetails }) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, px: 2, py: 1, borderRadius: "10px", background: TOKENS.surfaceAlt, border: `1px solid ${TOKENS.border}`, flexWrap: "wrap" }}>
      <Box sx={{ color: TOKENS.accent, display: "flex", alignItems: "center", mt: "2px" }}>
        <PersonIcon sx={{ fontSize: 16 }} />
      </Box>
      <Box>
        <Typography sx={{ ...labelSx, fontSize: 10 }}>Trainer</Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.3 }}>
          {trainerNames?.length
            ? renderTrainerNames(trainerNames, trainerDetails)
            : <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: TOKENS.text }}>—</Typography>}
        </Box>
      </Box>
    </Box>
  );
}

/* ─── Custom recharts tooltip ────────────────────────────────────────────── */
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  const colors = STATUS_MAP[name] || { fill: "#888", light: "#eee", text: "#333" };
  return (
    <Box sx={{ background: TOKENS.surface, border: `1.5px solid ${colors.fill}`, borderRadius: "10px", px: 2, py: 1.5, boxShadow: "0 4px 20px rgba(0,0,0,0.12)", minWidth: 120 }}>
      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, color: colors.text, mb: 0.3 }}>{name}</Typography>
      <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700, color: colors.fill, lineHeight: 1 }}>
        {value}
        <Typography component="span" sx={{ fontSize: 11, color: TOKENS.textSub, ml: 0.5 }}>topics</Typography>
      </Typography>
    </Box>
  );
}

/* ─── Custom recharts legend ─────────────────────────────────────────────── */
function CustomLegend({ payload }) {
  return (
    <Box sx={{ display: "flex", gap: 1.5, justifyContent: "center", flexWrap: "wrap", mt: 1 }}>
      {(payload || []).map((entry) => {
        const colors = STATUS_MAP[entry.value] || { fill: entry.color, light: "#eee", text: "#333" };
        return (
          <Box key={entry.value} sx={{ display: "flex", alignItems: "center", gap: 0.7, px: 1.5, py: 0.5, borderRadius: "20px", background: colors.light, border: `1px solid ${colors.fill}44` }}>
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", background: colors.fill, flexShrink: 0 }} />
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: colors.text }}>{entry.value}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/* ─── Inline % label ─────────────────────────────────────────────────────── */
function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700 }}>
      {`${Math.round(percent * 100)}%`}
    </text>
  );
}

/* ─── Progress summary bar ───────────────────────────────────────────────── */
function ProgressSummaryBar({ counts }) {
  const total    = Object.values(counts || {}).reduce((a, b) => a + b, 0) || 1;
  const segments = [
    { key: "Completed",   color: TOKENS.completed.fill },
    { key: "In Progress", color: TOKENS.progress.fill  },
    { key: "Planned",     color: TOKENS.planned.fill   },
  ];
  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: "flex", borderRadius: "6px", overflow: "hidden", height: 8, mb: 1 }}>
        {segments.map(({ key, color }) => {
          const val = counts?.[key] || 0;
          const pct = (val / total) * 100;
          if (pct === 0) return null;
          return <Box key={key} sx={{ width: `${pct}%`, background: color, transition: "width 0.6s ease" }} />;
        })}
      </Box>
      <Box sx={{ display: "flex", gap: 2 }}>
        {segments.map(({ key, color }) => (
          <Typography key={key} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: TOKENS.textSub, display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box component="span" sx={{ width: 8, height: 8, borderRadius: "2px", background: color, display: "inline-block" }} />
            {key}: <strong style={{ color: TOKENS.text }}>{counts?.[key] || 0}</strong>
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

/* ─── Topic table ────────────────────────────────────────────────────────── */
function TopicTable({ batchNo, topics, selectedStatus }) {
  const colors = STATUS_MAP[selectedStatus] || { fill: TOKENS.accent, light: TOKENS.accentLight, text: TOKENS.text };
  return (
    <Box sx={{ ...cardSx, mt: 2, animation: "fadeSlideIn 0.3s ease", "@keyframes fadeSlideIn": { from: { opacity: 0, transform: "translateY(8px)" }, to: { opacity: 1, transform: "translateY(0)" } } }}>
      <Box sx={{ px: 2.5, py: 1.5, background: colors.light, borderBottom: `1px solid ${colors.fill}33`, display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: "50%", background: colors.fill }} />
        <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, color: colors.text }}>{selectedStatus} Topics — {batchNo}</Typography>
        <Chip label={topics.length} size="small" sx={{ ml: "auto", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, height: 20, background: colors.fill, color: "#fff" }} />
      </Box>
      <TableContainer sx={{ maxHeight: 320 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {["#", "Topic Name", "Date", "Status", "Remarks"].map(h => (
                <TableCell key={h} sx={{ ...labelSx, background: TOKENS.surfaceAlt, borderBottom: `2px solid ${TOKENS.border}`, py: 1.2, whiteSpace: "nowrap" }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {topics.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, fontFamily: "'DM Sans', sans-serif", color: TOKENS.textSub, fontSize: 13 }}>
                  No topics found for "{selectedStatus}".
                </TableCell>
              </TableRow>
            ) : (
              topics.map((topic, idx) => (
                <TableRow key={idx} sx={{ "&:nth-of-type(even)": { background: TOKENS.surfaceAlt }, "&:hover": { background: colors.light, transition: "background 0.15s" } }}>
                  <TableCell sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: TOKENS.textSub, width: 36 }}>{idx + 1}</TableCell>
                  <TableCell sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, color: TOKENS.text }}>{topic.topic_name}</TableCell>
                  <TableCell sx={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: TOKENS.textSub, whiteSpace: "nowrap" }}>{topic.date}</TableCell>
                  <TableCell>
                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1.2, py: 0.3, borderRadius: "20px", background: colors.light, border: `1px solid ${colors.fill}44` }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: colors.fill }} />
                      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, color: colors.text }}>{topic.topic_status}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: topic.remarks ? TOKENS.text : TOKENS.textSub, fontStyle: topic.remarks ? "normal" : "italic" }}>
                    {topic.remarks || "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

/* ─── BatchCard ──────────────────────────────────────────────────────────── */
function BatchCard({ batch, selectedStatus, currentBatchNo, filteredTopics, onPieClick, trainerDetails }) {
  const pieData = [
    { name: "Planned",     value: batch.topic_status_counts?.Planned        || 0 },
    { name: "In Progress", value: batch.topic_status_counts?.["In Progress"] || 0 },
    { name: "Completed",   value: batch.topic_status_counts?.Completed       || 0 },
  ];
  const totalCount   = pieData.reduce((s, d) => s + d.value, 0);
  const completedPct = totalCount > 0 ? Math.round(((batch.topic_status_counts?.Completed || 0) / totalCount) * 100) : 0;

  return (
    <Box sx={{ ...cardSx, mb: 3 }}>
      <Box sx={{ px: 3, py: 2, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography sx={{ ...labelSx, mb: 0.2 }}>Batch</Typography>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 18, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.02em" }}>{batch.batch_no}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1, borderRadius: "10px", background: TOKENS.completed.light, border: `1px solid ${TOKENS.completed.fill}44` }}>
          <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 800, color: TOKENS.completed.fill, lineHeight: 1 }}>{completedPct}%</Typography>
          <Typography sx={{ ...labelSx, fontSize: 10, color: TOKENS.completed.text }}>complete</Typography>
        </Box>
      </Box>

      <Box sx={{ p: 3 }}>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2.5 }}>
          <TrainerPill trainerNames={batch.trainer_names} trainerDetails={trainerDetails} />
          <StatPill icon={<GroupIcon sx={{ fontSize: 16 }} />}         label="Learners" value={batch.total_learners ?? "—"} />
          <StatPill icon={<CalendarTodayIcon sx={{ fontSize: 16 }} />} label="Start"    value={batch.start_date || "—"} />
          <StatPill icon={<CalendarTodayIcon sx={{ fontSize: 16 }} />} label="End"      value={batch.end_date   || "—"} />
        </Box>

        <ProgressSummaryBar counts={batch.topic_status_counts} />

        <Box sx={{ mt: 3, display: "flex", justifyContent: "center" }}>
          <Box sx={{ width: "100%", maxWidth: 380 }}>
            <Typography sx={{ ...labelSx, textAlign: "center", mb: 1 }}>Click a segment to explore topics</Typography>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData} dataKey="value" nameKey="name" cx="50%" cy="45%"
                  outerRadius={95} innerRadius={42} paddingAngle={3}
                  labelLine={false} label={renderCustomLabel}
                  onClick={(data, index) => onPieClick(data, index, batch.batch_no, batch.topics)}
                  style={{ cursor: "pointer" }}
                >
                  {pieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="white" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend content={<CustomLegend />} />
              </PieChart>
            </ResponsiveContainer>
          </Box>
        </Box>

        {selectedStatus && currentBatchNo === batch.batch_no && (
          <TopicTable batchNo={batch.batch_no} topics={filteredTopics} selectedStatus={selectedStatus} />
        )}
      </Box>
    </Box>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function CourseProgress() {
  const [domains,        setDomains]        = useState([]);
  const [allBatches,     setAllBatches]     = useState([]);
  const [batches,        setBatches]        = useState([]);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [selectedBatch,  setSelectedBatch]  = useState("");
  const [loading,        setLoading]        = useState(false);
  const [progressData,   setProgressData]   = useState(null);
  const [error,          setError]          = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [filteredTopics, setFilteredTopics] = useState([]);
  const [currentBatchNo, setCurrentBatchNo] = useState("");
  const [trainerDetails, setTrainerDetails] = useState({});

  /* ── Initial load ── */
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        
        // FIX: Use /api/get_domains which reads from course_planner_data
        // instead of /api/domains which reads from a 'domains' table
        // Try get_domains first, fall back to domains endpoint
        const [domainsRes, batchesRes, trainersRes] = await Promise.all([
          // Use the correct endpoint that queries course_planner_data
          axios.get(`${API_BASE}/api/get_domains`).catch(() =>
            // fallback: try the other endpoint
            axios.get(`${API_BASE}/api/domains`)
          ),
          axios.get(`${API_BASE}/api/batches`),
          axios.get(`${API_BASE}/api/internal-users`),
        ]);

        // Handle domains response — could be array of strings or objects
        let domainList = [];
        if (Array.isArray(domainsRes.data)) {
          domainList = domainsRes.data
            .map(d => (typeof d === "string" ? d : d.domain || d.domain_name || ""))
            .filter(Boolean);
          // Deduplicate and sort
          domainList = [...new Set(domainList)].sort();
        }
        setDomains(domainList);

        // Handle batches response
        let batchList = [];
        if (Array.isArray(batchesRes.data)) {
          batchList = batchesRes.data.map(b => (typeof b === "string" ? { batch_no: b } : b)).filter(b => b.batch_no);
        }
        setAllBatches(batchList);
        setBatches(batchList);

        // Build trainer details map
        const trainerMap = {};
        (trainersRes.data || []).forEach(t => {
          if (t.name) trainerMap[t.name] = { email: t.email || "—", phone: t.phone || "—" };
        });
        setTrainerDetails(trainerMap);
      } catch (err) {
        console.error("Initial load error:", err);
        setError("Failed to load domain or batch information.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  /* ── Domain selected ── */
  useEffect(() => {
    if (!selectedDomain) return;
    async function fetchDomainData() {
      setLoading(true);
      setError("");
      try {
        // FIX: Use /api/batches?domain= which filters from course_planner_data
        const [batchRes, progressRes] = await Promise.all([
          axios.get(`${API_BASE}/api/batches`, { params: { domain: selectedDomain } }),
          axios.get(`${API_BASE}/api/course-progress`, { params: { domain: selectedDomain } }),
        ]);

        let batchList = [];
        if (Array.isArray(batchRes.data)) {
          batchList = batchRes.data.map(b => (typeof b === "string" ? { batch_no: b } : b)).filter(b => b.batch_no);
        }
        setBatches(batchList);
        setProgressData(progressRes.data);
        setSelectedBatch("");
      } catch (err) {
        console.error("Domain data error:", err);
        setError("Failed to load batches or domain progress.");
        setBatches([]);
        setProgressData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchDomainData();
  }, [selectedDomain]);

  /* ── Batch selected ── */
  useEffect(() => {
    if (!selectedBatch) return;
    async function fetchBatchProgress() {
      setLoading(true);
      setError("");
      try {
        const res = await axios.get(`${API_BASE}/api/course-progress`, {
          params: { batch_no: selectedBatch },
        });
        setProgressData(res.data);
      } catch (err) {
        console.error("Batch progress error:", err);
        setError("Failed to load progress for this batch.");
        setProgressData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchBatchProgress();
  }, [selectedBatch]);

  const handlePieClick = (data, _index, batchNo, topicsArr) => {
    setSelectedStatus(data.name);
    setCurrentBatchNo(batchNo);
    setFilteredTopics((topicsArr || []).filter(t => t.topic_status === data.name));
  };

  const handleDomainChange = (e) => {
    const domain = e.target.value;
    setSelectedDomain(domain);
    setSelectedBatch("");
    setProgressData(null);
    setError("");
    setSelectedStatus("");
    setFilteredTopics([]);
    setCurrentBatchNo("");
    if (!domain) setBatches(allBatches);
  };

  const handleBatchChange = (e) => {
    const batch = e.target.value;
    setSelectedBatch(batch);
    setSelectedDomain("");
    setProgressData(null);
    setError("");
    setSelectedStatus("");
    setFilteredTopics([]);
    setCurrentBatchNo("");
    setBatches(allBatches);
  };

  const handleReset = () => {
    setSelectedDomain("");
    setSelectedBatch("");
    setProgressData(null);
    setError("");
    setSelectedStatus("");
    setFilteredTopics([]);
    setCurrentBatchNo("");
    setBatches(allBatches);
  };

  const isMultiBatch = Boolean(progressData?.batches);

  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>

      <Box sx={{ maxWidth: 960, mx: "auto" }}>
        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
            Course Progress
          </Typography>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
            Monitor training progress by domain or individual batch
          </Typography>
        </Box>

        {/* Filter card */}
        <Box sx={{ ...cardSx, p: 3, mb: 3 }}>
          <Typography sx={{ ...labelSx, mb: 2 }}>Filter</Typography>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-end" }}>
            <FormControl sx={{ minWidth: 220 }} size="small">
              <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Domain</InputLabel>
              <Select
                value={selectedDomain}
                label="Domain"
                onChange={handleDomainChange}
                disabled={Boolean(selectedBatch) || loading}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, borderRadius: "10px", "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.border }, "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent } }}
              >
                <MenuItem value=""><em>Select Domain</em></MenuItem>
                {domains.map(d => (
                  <MenuItem key={d} value={d} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{d}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 220 }} size="small">
              <InputLabel sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Batch No</InputLabel>
              <Select
                value={selectedBatch}
                label="Batch No"
                onChange={handleBatchChange}
                disabled={Boolean(selectedDomain) || loading}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, borderRadius: "10px", "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.border }, "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.accent } }}
              >
                <MenuItem value=""><em>Select Batch</em></MenuItem>
                {batches.map(b => (
                  <MenuItem key={b.batch_no} value={b.batch_no} sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>
                    {b.batch_no}{b.start_date ? ` (${b.start_date})` : ""}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              startIcon={<RestartAltIcon sx={{ fontSize: 16 }} />}
              onClick={handleReset}
              disabled={!selectedDomain && !selectedBatch}
              size="small"
              sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, borderRadius: "10px", borderColor: TOKENS.border, color: TOKENS.textSub, textTransform: "none", px: 2, height: 40, "&:hover": { borderColor: TOKENS.accent, color: TOKENS.accent, background: TOKENS.accentLight } }}
            >
              Reset
            </Button>
          </Box>

          {/* Show domain count info */}
          {domains.length > 0 && (
            <Box sx={{ mt: 1.5, display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Typography sx={{ ...labelSx, fontSize: 10 }}>Available domains:</Typography>
              {domains.map(d => (
                <Box key={d} sx={{ display: "inline-flex", alignItems: "center", px: 1.2, py: 0.2, borderRadius: "8px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700, color: TOKENS.accent }}>{d}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {/* Loading */}
        {loading && (
          <Box sx={{ ...cardSx, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 8, gap: 2 }}>
            <CircularProgress size={36} sx={{ color: TOKENS.accent }} />
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>Loading progress data…</Typography>
          </Box>
        )}

        {/* Error */}
        {error && !loading && (
          <Box sx={{ ...cardSx, px: 3, py: 2, background: "#fff5f5", border: "1px solid #fca5a5" }}>
            <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#b91c1c", fontWeight: 500 }}>{error}</Typography>
          </Box>
        )}

        {/* Multi-batch (domain) view */}
        {isMultiBatch && !loading && (
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
              <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 700, color: TOKENS.text }}>Domain:</Typography>
              <Chip label={progressData.domain} sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, background: TOKENS.accentLight, color: TOKENS.accent, border: `1px solid ${TOKENS.accent}33` }} />
              <Chip label={`${progressData.batches.length} batches`} size="small" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 11, background: TOKENS.surfaceAlt, color: TOKENS.textSub, border: `1px solid ${TOKENS.border}` }} />
            </Box>

            {progressData.batches.length === 0 ? (
              <Box sx={{ ...cardSx, p: 4, textAlign: "center" }}>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>No batches found for this domain.</Typography>
              </Box>
            ) : (
              progressData.batches.map(batch => (
                <BatchCard
                  key={batch.batch_no}
                  batch={batch}
                  selectedStatus={selectedStatus}
                  currentBatchNo={currentBatchNo}
                  filteredTopics={filteredTopics}
                  onPieClick={handlePieClick}
                  trainerDetails={trainerDetails}
                />
              ))
            )}
          </Box>
        )}

        {/* Single batch view */}
        {progressData && !isMultiBatch && !loading && (
          <BatchCard
            batch={progressData}
            selectedStatus={selectedStatus}
            currentBatchNo={currentBatchNo}
            filteredTopics={filteredTopics}
            onPieClick={handlePieClick}
            trainerDetails={trainerDetails}
          />
        )}
      </Box>
    </Box>
  );
}