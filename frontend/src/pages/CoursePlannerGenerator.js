import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Stack,
  Alert,
  CircularProgress,
  Divider,
} from "@mui/material";

const API_BASE =
  process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

// Dropdown options (exactly as specified for the generator)
const DOMAINS = ["PD", "DV", "DFT"];
const BATCH_TYPES = ["Offline", "Online"];
const SESSION1 = ["7.30AM to 9.00AM", "1.30PM to 3.00PM"];
const SESSION2 = ["9.30AM to 11.00AM", "3.30PM to 5.00PM"];
const SESSION3 = ["11.15AM to 1.15PM", "5.30PM to 7.00PM"];
const LAB_TIMINGS = [
  "11.30AM to 1.30PM, 6.00 AM to 11:00 AM",
  "9.00PM to 7.00AM, 5:30 PM to 8.00 PM",
];

export default function CoursePlannerGenerator({ user }) {
  // "Generate CP for System" (xlsx -> system CSV) is admin-only; it is disabled
  // for Trainer, Manager and Coordinator roles.
  const role = (user?.role || "").toString().toLowerCase();
  const canConvert = role === "admin";

  const [domain, setDomain] = useState("");
  const [batchType, setBatchType] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [session1, setSession1] = useState("");
  const [session2, setSession2] = useState("");
  const [session3, setSession3] = useState("");
  const [labTimings, setLabTimings] = useState("");
  const [startDate, setStartDate] = useState("");

  const [generating, setGenerating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { id, filename, template, holidaysMarked }
  const [csv, setCsv] = useState(null); // { csvFilename, rows }

  // Online only: the generated planner is shown in-page as an editable grid.
  // `edits` holds the pending cell changes keyed "row:col"; saving writes them
  // back into the same .xlsx on the server, so the download serves the edits.
  const [grid, setGrid] = useState(null); // { maxRow, maxCol, rows }
  const [gridLoading, setGridLoading] = useState(false);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState("");

  // Trainer pickers (Theory / Lab). Names come from internal_users; the email
  // auto-fills from the selected name but stays editable. These are applied to
  // trainer_name / trainer_email only in the system CSV ("Generate CP for
  // System"), never in the trainer-facing planner.
  const [trainers, setTrainers] = useState([]); // [{ name, email }]
  const [theoryTrainerName, setTheoryTrainerName] = useState("");
  const [theoryTrainerEmail, setTheoryTrainerEmail] = useState("");
  const [labTrainerName, setLabTrainerName] = useState("");
  const [labTrainerEmail, setLabTrainerEmail] = useState("");

  useEffect(() => {
    axios
      .get(`${API_BASE}/api/course-planner/trainers`)
      .then(({ data }) => setTrainers(Array.isArray(data?.trainers) ? data.trainers : []))
      .catch(() => setTrainers([]));
  }, []);

  const emailForName = (name) =>
    (trainers.find((t) => t.name === name)?.email) || "";

  const handleTheoryName = (name) => {
    setTheoryTrainerName(name);
    setTheoryTrainerEmail(emailForName(name)); // auto-fill; still editable
  };
  const handleLabName = (name) => {
    setLabTrainerName(name);
    setLabTrainerEmail(emailForName(name)); // auto-fill; still editable
  };

  const showSession3 = domain === "PD"; // Session 3 only for the PD domain

  // Pull the generated workbook back as a grid so it can be reviewed and edited
  // in the page before downloading (Online batches only).
  const loadGrid = async (id) => {
    setGridLoading(true);
    try {
      const { data } = await axios.get(`${API_BASE}/api/course-planner/preview/${id}`);
      setGrid(data);
      setEdits({});
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Could not load the planner preview");
    } finally {
      setGridLoading(false);
    }
  };

  const handleGenerate = async () => {
    setError("");
    setResult(null);
    setCsv(null);
    setGrid(null);
    setEdits({});
    setSavedNote("");
    if (!domain || !batchType || !batchNo) {
      setError("Please select a Domain, a Batch Type and enter a Batch No.");
      return;
    }
    setGenerating(true);
    try {
      const { data } = await axios.post(`${API_BASE}/api/course-planner/generate`, {
        domain,
        batchType,
        batchNo: batchNo.trim(),
        session1,
        session2,
        session3: showSession3 ? session3 : "",
        labTimings,
        startDate, // "" is allowed; dates are only stamped when provided
      });
      setResult(data);
      if (data?.batchType === "Online" && data?.id) await loadGrid(data.id);
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const cellKey = (r, c) => `${r}:${c}`;
  const editCount = Object.keys(edits).length;

  // contentEditable hands back non-breaking spaces and a trailing newline that
  // the template never had, so compare normalised forms -- otherwise merely
  // clicking into a cell would look like an edit (several template headings
  // genuinely contain NBSPs) and saving would strip them.
  const normalizeCell = (s) =>
    (s || "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").replace(/\s+$/, "");

  // Commit a cell on blur, but only when the text actually changed.
  const handleCellBlur = (cell, e) => {
    const text = normalizeCell(e.currentTarget.innerText);
    const key = cellKey(cell.r, cell.c);
    setEdits((prev) => {
      if (text === normalizeCell(cell.v)) {
        if (!(key in prev)) return prev;
        const { [key]: _drop, ...rest } = prev; // reverted back to the original
        return rest;
      }
      return { ...prev, [key]: text };
    });
    setSavedNote("");
  };

  // Write the pending edits into the .xlsx on the server. Returns true when the
  // planner on disk is up to date (nothing to save counts as up to date).
  const saveEdits = async () => {
    if (!result?.id || editCount === 0) return true;
    setError("");
    setSaving(true);
    try {
      const payload = Object.entries(edits).map(([key, v]) => {
        const [r, c] = key.split(":");
        return { r: Number(r), c: Number(c), v };
      });
      const { data } = await axios.post(
        `${API_BASE}/api/course-planner/save/${result.id}`,
        { edits: payload }
      );
      setEdits({});
      setCsv(null); // the workbook changed, so the old CSV no longer matches
      setSavedNote(`Saved ${data?.saved ?? payload.length} change(s) to the planner.`);
      // Re-read the workbook so the grid shows exactly what is now on disk
      // (dates re-formatted, blanked cells cleared) instead of the stale dump.
      await loadGrid(result.id);
      return true;
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Always save first: the file that downloads must include the edits.
  const handleDownloadXlsx = async () => {
    if (!(await saveEdits())) return;
    window.location.href = downloadUrl("xlsx");
  };

  const handleConvert = async () => {
    if (!result?.id) return;
    // Convert from the edited planner, never from a stale one.
    if (!(await saveEdits())) return;
    setError("");
    setConverting(true);
    try {
      const { data } = await axios.post(`${API_BASE}/api/course-planner/convert`, {
        id: result.id,
        theoryTrainerName,
        theoryTrainerEmail,
        labTrainerName,
        labTrainerEmail,
      });
      setCsv(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Conversion failed");
    } finally {
      setConverting(false);
    }
  };

  const downloadUrl = (kind) =>
    `${API_BASE}/api/course-planner/download/${result.id}/${kind}`;

  // Offline batches cannot start on a Saturday or Sunday, so the generator
  // rolls the start forward to the Monday -- worth calling out, because the
  // date on the form is then not the date the batch actually begins.
  const rolledToMonday =
    !!result?.effectiveStartDate &&
    !!result?.startDate &&
    result.effectiveStartDate !== result.startDate;

  return (
    <Box sx={{ maxWidth: 720, mx: "auto", p: 2 }}>
      <Typography variant="h5" gutterBottom fontWeight={600}>
        Course Planner Generator
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Pick the batch details, generate the course planner from its domain
        template, then convert it to the system CSV. Offline batches teach
        Monday&ndash;Friday: Saturday &amp; Sunday are marked as the weekend break,
        a company holiday is banded across that whole day, and a batch starting
        mid-week only fills the days left in that week before settling into
        Monday&ndash;Friday.
      </Typography>

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <FormControl fullWidth required>
              <InputLabel>Domain</InputLabel>
              <Select
                label="Domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              >
                {DOMAINS.map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth required>
              <InputLabel>Batch Type</InputLabel>
              <Select
                label="Batch Type"
                value={batchType}
                onChange={(e) => setBatchType(e.target.value)}
              >
                {BATCH_TYPES.map((b) => (
                  <MenuItem key={b} value={b}>
                    {b}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Session 1</InputLabel>
              <Select
                label="Session 1"
                value={session1}
                onChange={(e) => setSession1(e.target.value)}
              >
                {SESSION1.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Session 2</InputLabel>
              <Select
                label="Session 2"
                value={session2}
                onChange={(e) => setSession2(e.target.value)}
              >
                {SESSION2.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {showSession3 && (
              <FormControl fullWidth>
                <InputLabel>Session 3</InputLabel>
                <Select
                  label="Session 3"
                  value={session3}
                  onChange={(e) => setSession3(e.target.value)}
                >
                  {SESSION3.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <TextField
              label="Batch No"
              required
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder="e.g. PDFT19"
              fullWidth
            />

            <FormControl fullWidth>
              <InputLabel>Lab Access Timings</InputLabel>
              <Select
                label="Lab Access Timings"
                value={labTimings}
                onChange={(e) => setLabTimings(e.target.value)}
              >
                {LAB_TIMINGS.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Batch Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              helperText={
                batchType === "Online"
                  ? "Online batches run on weekends: only Saturday (Theory) and Sunday (Lab) dates are stamped."
                  : "Offline batches teach Mon\u2013Fri. Starting mid-week gives week 1 only the days left in that week (the rest of the topics move on); a weekend date starts the batch on the following Monday."
              }
              fullWidth
            />

            <Divider textAlign="left">
              <Typography variant="caption" color="text.secondary">
                Trainer assignment (applied to the System CP only)
              </Typography>
            </Divider>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel>Theory Trainer Name</InputLabel>
                <Select
                  label="Theory Trainer Name"
                  value={theoryTrainerName}
                  onChange={(e) => handleTheoryName(e.target.value)}
                >
                  {trainers.map((t) => (
                    <MenuItem key={`th-${t.name}`} value={t.name}>
                      {t.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Theory Trainer Email ID"
                value={theoryTrainerEmail}
                onChange={(e) => setTheoryTrainerEmail(e.target.value)}
                placeholder="auto-filled from name (editable)"
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel>Lab Trainer Name</InputLabel>
                <Select
                  label="Lab Trainer Name"
                  value={labTrainerName}
                  onChange={(e) => handleLabName(e.target.value)}
                >
                  {trainers.map((t) => (
                    <MenuItem key={`lab-${t.name}`} value={t.name}>
                      {t.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Lab Trainer Email ID"
                value={labTrainerEmail}
                onChange={(e) => setLabTrainerEmail(e.target.value)}
                placeholder="auto-filled from name (editable)"
                fullWidth
              />
            </Stack>

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Button
                variant="contained"
                onClick={handleGenerate}
                disabled={generating}
                startIcon={generating ? <CircularProgress size={18} /> : null}
              >
                {generating ? "Generating..." : "Generate Course Planner"}
              </Button>

              <Button
                variant="outlined"
                onClick={handleConvert}
                disabled={!result || converting || !canConvert}
                startIcon={converting ? <CircularProgress size={18} /> : null}
              >
                {converting ? "Converting..." : "Generate CP for System"}
              </Button>
            </Stack>

            {!canConvert && (
              <Typography variant="caption" color="text.secondary">
                “Generate CP for System” is available to Admin users only.
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      {result && (
        <Card variant="outlined" sx={{ mt: 2 }}>
          <CardContent>
            <Alert severity="success" sx={{ mb: 2 }}>
              Course planner generated from{" "}
              <strong>{result.template || "template"}</strong>
              {result.holidaysMarked ? (
                <> — {result.holidaysMarked} holiday(s) marked.</>
              ) : (
                <>.</>
              )}
              {/* Offline only: show how the mid-week start reshaped the plan. */}
              {result.batchType !== "Online" && result.weeks > 0 && (
                <Box component="span" sx={{ display: "block", mt: 0.5 }}>
                  {result.weeks} week(s)
                  {result.startWeekday && (
                    <> — starts {result.startWeekday}</>
                  )}
                  {result.firstWeekDays > 0 &&
                    result.firstWeekDays < 5 && (
                      <>
                        , so week 1 holds {result.firstWeekDays} teaching day(s)
                        and the remaining topics move into week 2 (Mon–Fri)
                      </>
                    )}
                  .
                  {rolledToMonday && (
                    <>
                      {" "}
                      The date picked falls on a weekend, so the batch starts on{" "}
                      <strong>{result.effectiveStartDate}</strong>.
                    </>
                  )}
                </Box>
              )}
            </Alert>
            <Button
              variant="contained"
              color="success"
              onClick={handleDownloadXlsx}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={18} /> : null}
            >
              {saving
                ? "Saving..."
                : editCount > 0
                ? "Save & Download Course Planner (.xlsx)"
                : "Download Course Planner (.xlsx)"}
            </Button>

            {csv && (
              <>
                <Divider sx={{ my: 2 }} />
                <Alert severity="success" sx={{ mb: 2 }}>
                  Converted to system CSV
                  {csv.rows ? <> — {csv.rows} rows.</> : <>.</>}
                </Alert>
                <Button
                  variant="contained"
                  color="secondary"
                  href={downloadUrl("csv")}
                >
                  Download CP for System (.csv)
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Online batches: review and edit the generated planner in-page. Edits
          are written back into the same .xlsx, so the download serves them. */}
      {result?.batchType === "Online" && (
        <Card variant="outlined" sx={{ mt: 2 }}>
          <CardContent>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              alignItems={{ sm: "center" }}
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>
                  Course Planner — {result.filename}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Click any cell to edit it, then save. Changes are stored in the
                  generated planner itself.
                </Typography>
              </Box>
              <Button
                variant="contained"
                onClick={saveEdits}
                disabled={saving || editCount === 0}
                startIcon={saving ? <CircularProgress size={18} /> : null}
              >
                {saving
                  ? "Saving..."
                  : editCount > 0
                  ? `Save ${editCount} change(s)`
                  : "Saved"}
              </Button>
            </Stack>

            {savedNote && (
              <Alert severity="success" sx={{ mb: 1 }}>
                {savedNote}
              </Alert>
            )}
            {editCount > 0 && (
              <Alert severity="info" sx={{ mb: 1 }}>
                {editCount} unsaved change(s). Downloading will save them first.
              </Alert>
            )}

            {gridLoading && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                <CircularProgress size={18} />
                <Typography variant="body2">Loading planner…</Typography>
              </Stack>
            )}

            {grid && (
              <Box
                sx={{
                  maxHeight: 560,
                  overflow: "auto",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                }}
              >
                <Box
                  component="table"
                  sx={{
                    borderCollapse: "collapse",
                    width: "max-content",
                    fontSize: 12,
                    "& td": {
                      border: "1px solid",
                      borderColor: "divider",
                      p: "4px 6px",
                      verticalAlign: "top",
                      minWidth: 90,
                      maxWidth: 280,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    },
                    "& td:focus": {
                      outline: "2px solid",
                      outlineColor: "primary.main",
                      backgroundColor: "action.hover",
                    },
                  }}
                >
                  <tbody>
                    {grid.rows.map((row, ri) => (
                      <tr key={`r-${ri}`}>
                        {row.map((cell, ci) => {
                          if (!cell) return null; // swallowed by a merged range
                          const key = cellKey(cell.r, cell.c);
                          const dirty = key in edits;
                          return (
                            <Box
                              component="td"
                              key={`c-${cell.r}-${cell.c}`}
                              rowSpan={cell.rs || undefined}
                              colSpan={cell.cs || undefined}
                              contentEditable
                              suppressContentEditableWarning
                              onBlur={(e) => handleCellBlur(cell, e)}
                              sx={{
                                backgroundColor: dirty ? "warning.light" : undefined,
                                fontWeight: cell.t === "date" ? 600 : undefined,
                              }}
                            >
                              {dirty ? edits[key] : cell.v}
                            </Box>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

