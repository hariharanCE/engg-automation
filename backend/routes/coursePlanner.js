// routes/coursePlanner.js
// Course Planner Generator: fills a domain template into an .xlsx (readable
// planner) and converts that .xlsx into the system-ingestable .csv.
// Both steps run the Python (openpyxl) scripts in ../scripts. openpyxl is
// vendored under ../scripts/vendor, so no system pip install is required
// (openpyxl is pure Python; exceljs was dropped because it produced .xlsx
// files that Microsoft Excel refused to open).
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { supabase } from "../supabaseClient.js";

const router = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT_DIR = path.resolve(__dirname, "..", ".."); // repo root (holds templates)
const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");

// Vercel serverless functions can write only to /tmp at runtime.
// Locally, continue using uploads/course-planner.
const WORK_DIR = process.env.VERCEL
  ? "/tmp/course-planner"
  : path.join(__dirname, "..", "uploads", "course-planner");

const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  (process.platform === "win32" ? "python" : "python3");

fs.mkdirSync(WORK_DIR, { recursive: true });

// Find the company holiday workbook dynamically (first "Holiday*.xlsx" in root).
function findHolidayFile() {
  try {
    const f = fs
      .readdirSync(ROOT_DIR)
      .find((n) => /holiday.*\.xlsx$/i.test(n));
    return f ? path.join(ROOT_DIR, f) : "";
  } catch {
    return "";
  }
}

// Run a python script, feed `stdinData` (if any), resolve with {stdout}.
function runPython(scriptName, args = [], stdinData = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [path.join(SCRIPTS_DIR, scriptName), ...args]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => reject(new Error(`Failed to start Python (${PYTHON_BIN}): ${e.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: out.trim() });
      else reject(new Error(err.trim() || `Python exited with code ${code}`));
    });
    if (stdinData !== null) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }
  });
}

const isId = (s) => typeof s === "string" && /^[a-f0-9-]{36}$/i.test(s);

// ---------------------------------------------------------------------------
// GET /api/course-planner/trainers
// -> [{ name, email }] from the internal_users table, for the Theory/Lab
//    trainer pickers in the Course Planner Generator (email auto-fills by name).
// ---------------------------------------------------------------------------
router.get("/trainers", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("internal_users")
      .select("name, email")
      .eq("role", "Trainer")
      .order("name");
    if (error) throw error;

    const seen = new Set();
    const trainers = [];
    for (const u of data || []) {
      const name = (u.name || "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      trainers.push({ name, email: (u.email || "").trim() });
    }
    return res.json({ trainers });
  } catch (err) {
    console.error("Course planner trainers error:", err);
    return res.status(500).json({ error: err.message || "Failed to load trainers" });
  }
});
const readMeta = (id) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(WORK_DIR, `${id}.json`), "utf-8"));
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// POST /api/course-planner/generate
// body: { domain, batchType, batchNo, session1, session2, session3, labTimings, startDate }
// -> generates the .xlsx, returns { id, filename, template, holidaysMarked }
// ---------------------------------------------------------------------------
router.post("/generate", async (req, res) => {
  try {
    const { domain, batchType, batchNo, session1, session2, session3, labTimings, startDate } = req.body || {};
    if (!domain || !batchNo) {
      return res.status(400).json({ error: "domain and batchNo are required" });
    }

    const id = crypto.randomUUID();
    const xlsxPath = path.join(WORK_DIR, `${id}.xlsx`);

    const cfg = {
      domain,
      batch_type: batchType || "",
      batch_no: batchNo,
      session1: session1 || "",
      session2: session2 || "",
      session3: session3 || "",
      lab_timings: labTimings || "",
      start_date: startDate || "",
      template_dir: ROOT_DIR,
      holiday_file: findHolidayFile(),
      out_path: xlsxPath,
    };

    const { stdout } = await runPython("generate_course_planner.py", [], JSON.stringify(cfg));
    let summary = {};
    try {
      summary = JSON.parse(stdout);
    } catch {
      /* non-JSON tail is fine */
    }

    const filename = `${batchNo} Course Planner.xlsx`;
    fs.writeFileSync(
      path.join(WORK_DIR, `${id}.json`),
      JSON.stringify({ id, batchNo, domain, batchType: batchType || "", filename })
    );

    return res.json({
      id,
      filename,
      batchType: batchType || "",
      template: summary.template || null,
      holidaysMarked: summary.holidays_marked || 0,
      startDate: summary.start_date || null,
      // Offline batches teach Mon-Fri, so a start date mid-week (or on a
      // weekend) reshapes the plan: the effective start can roll forward to the
      // Monday, and week 1 only holds the days left in that week.
      effectiveStartDate: summary.effective_start_date || null,
      startWeekday: summary.start_weekday || null,
      weeks: summary.weeks || 0,
      firstWeekDays: summary.first_week_days || 0,
    });
  } catch (err) {
    console.error("Course planner generate error:", err);
    // A missing domain/batch-type template is a configuration problem the user
    // can act on, not a server fault -> 400 with the script's own message.
    const missingTemplate = /no .*course planner template is available/i.test(err.message || "");
    return res
      .status(missingTemplate ? 400 : 500)
      .json({ error: err.message || "Generation failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/course-planner/preview/:id
// -> { sheet, maxRow, maxCol, rows } for the in-page editable grid (Online).
// ---------------------------------------------------------------------------
router.get("/preview/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isId(id)) return res.status(400).json({ error: "valid id is required" });

    const xlsxPath = path.join(WORK_DIR, `${id}.xlsx`);
    if (!fs.existsSync(xlsxPath)) {
      return res.status(404).json({ error: "Generated planner not found. Generate it first." });
    }

    const { stdout } = await runPython("course_planner_grid.py", ["dump", xlsxPath]);
    return res.json(JSON.parse(stdout));
  } catch (err) {
    console.error("Course planner preview error:", err);
    return res.status(500).json({ error: err.message || "Preview failed" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/course-planner/save/:id   body: { edits: [{ r, c, v }] }
// -> writes the edited cells back into the generated .xlsx, in place, so the
//    download always serves the edited planner.
// ---------------------------------------------------------------------------
router.post("/save/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isId(id)) return res.status(400).json({ error: "valid id is required" });

    const edits = Array.isArray(req.body?.edits) ? req.body.edits : [];
    const xlsxPath = path.join(WORK_DIR, `${id}.xlsx`);
    if (!fs.existsSync(xlsxPath)) {
      return res.status(404).json({ error: "Generated planner not found. Generate it first." });
    }

    const { stdout } = await runPython(
      "course_planner_grid.py",
      ["apply", xlsxPath],
      JSON.stringify({ edits })
    );
    const summary = JSON.parse(stdout);

    // The .xlsx changed, so any previously converted CSV is now stale.
    const csvPath = path.join(WORK_DIR, `${id}.csv`);
    if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);

    return res.json({ id, saved: summary.saved || 0 });
  } catch (err) {
    console.error("Course planner save error:", err);
    return res.status(500).json({ error: err.message || "Save failed" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/course-planner/convert   body: { id }
// -> flattens the generated .xlsx into the system .csv, returns { csvReady }
// ---------------------------------------------------------------------------
router.post("/convert", async (req, res) => {
  try {
    const {
      id,
      theoryTrainerName,
      theoryTrainerEmail,
      labTrainerName,
      labTrainerEmail,
    } = req.body || {};
    if (!isId(id)) return res.status(400).json({ error: "valid id is required" });

    const xlsxPath = path.join(WORK_DIR, `${id}.xlsx`);
    const csvPath = path.join(WORK_DIR, `${id}.csv`);
    if (!fs.existsSync(xlsxPath)) {
      return res.status(404).json({ error: "Generated planner not found. Generate it first." });
    }

    // Trainer overrides only apply to the system CSV (this "Generate CP for
    // System" step), never to the trainer-facing .xlsx.
    const trainerCfg = JSON.stringify({
      theory_name: theoryTrainerName || "",
      theory_email: theoryTrainerEmail || "",
      lab_name: labTrainerName || "",
      lab_email: labTrainerEmail || "",
    });

    const { stdout } = await runPython("course_planner_xlsx_to_csv.py", [
      xlsxPath,
      csvPath,
      trainerCfg,
    ]);
    const meta = readMeta(id);
    const rows = (stdout.match(/Wrote\s+(\d+)/) || [])[1] || null;

    return res.json({
      id,
      csvFilename: meta ? `${meta.batchNo} CP.csv` : `${id}.csv`,
      rows: rows ? Number(rows) : null,
    });
  } catch (err) {
    console.error("Course planner convert error:", err);
    return res.status(500).json({ error: err.message || "Conversion failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/course-planner/list
// -> [{ id, batchNo, domain, filename, createdAt, hasCsv }] for every planner
//    generated by the "Generate Course Planner" flow (newest first).
//    Used by the Admin/Manager/Coordinator "Generated Course Planners" view.
// ---------------------------------------------------------------------------
router.get("/list", (req, res) => {
  try {
    const items = fs
      .readdirSync(WORK_DIR)
      .filter((n) => /\.json$/i.test(n))
      .map((n) => n.replace(/\.json$/i, ""))
      .filter((id) => isId(id) && fs.existsSync(path.join(WORK_DIR, `${id}.xlsx`)))
      .map((id) => {
        const meta = readMeta(id) || {};
        const stat = fs.statSync(path.join(WORK_DIR, `${id}.xlsx`));
        return {
          id,
          batchNo: meta.batchNo || "",
          domain: meta.domain || "",
          filename: meta.filename || `${id}.xlsx`,
          createdAt: stat.mtime.toISOString(),
          hasCsv: fs.existsSync(path.join(WORK_DIR, `${id}.csv`)),
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return res.json({ items });
  } catch (err) {
    console.error("Course planner list error:", err);
    return res.status(500).json({ error: err.message || "List failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/course-planner/download/:id/:kind   (kind = xlsx | csv)
// ---------------------------------------------------------------------------
router.get("/download/:id/:kind", (req, res) => {
  const { id, kind } = req.params;
  if (!isId(id) || !["xlsx", "csv"].includes(kind)) {
    return res.status(400).json({ error: "bad request" });
  }
  const filePath = path.join(WORK_DIR, `${id}.${kind}`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "file not found" });

  const meta = readMeta(id);
  const base = meta ? meta.batchNo : id;
  const downloadName = kind === "xlsx" ? `${base} Course Planner.xlsx` : `${base} CP.csv`;
  return res.download(filePath, downloadName);
});

export default router;
