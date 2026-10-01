// routes/coursePlanner.js
// Course Planner Generator (Vercel-friendly).
// The Python scripts run in a separate Vercel Python function (planner-service),
// and generated files live in Supabase Storage instead of local disk.
import express from "express";
import crypto from "crypto";
import { supabase } from "../supabaseClient.js";

const router = express.Router();

const BUCKET = process.env.COURSE_PLANNER_BUCKET || "course-planner";
const PLANNER_URL = (process.env.PLANNER_SERVICE_URL || "").replace(/\/$/, "");
const PLANNER_SECRET = process.env.PLANNER_SECRET || "";

const isId = (s) => typeof s === "string" && /^[a-f0-9-]{36}$/i.test(s);

// ---- Python service -------------------------------------------------------
async function callPlanner(action, payload = {}) {
  if (!PLANNER_URL) throw new Error("PLANNER_SERVICE_URL is not configured");
  const r = await fetch(`${PLANNER_URL}/api/planner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-planner-secret": PLANNER_SECRET,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Planner service error (${r.status})`);
  return data;
}

// ---- Supabase Storage helpers --------------------------------------------
const store = () => supabase.storage.from(BUCKET);

async function putFile(name, buffer, contentType) {
  const { error } = await store().upload(name, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

async function getFile(name) {
  const { data, error } = await store().download(name);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function removeFile(name) {
  await store().remove([name]);
}

async function readMeta(id) {
  const buf = await getFile(`${id}.json`);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf-8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/course-planner/trainers
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

// ---------------------------------------------------------------------------
// POST /api/course-planner/generate
// ---------------------------------------------------------------------------
router.post("/generate", async (req, res) => {
  try {
    const { domain, batchType, batchNo, session1, session2, session3, labTimings, startDate } =
      req.body || {};
    if (!domain || !batchNo) {
      return res.status(400).json({ error: "domain and batchNo are required" });
    }

    const id = crypto.randomUUID();
    const cfg = {
      domain,
      batch_type: batchType || "",
      batch_no: batchNo,
      session1: session1 || "",
      session2: session2 || "",
      session3: session3 || "",
      lab_timings: labTimings || "",
      start_date: startDate || "",
    };

    const out = await callPlanner("generate", { cfg });
    let summary = {};
    try {
      summary = JSON.parse(out.stdout);
    } catch {
      /* non-JSON tail is fine */
    }

    const filename = `${batchNo} Course Planner.xlsx`;
    await putFile(
      `${id}.xlsx`,
      Buffer.from(out.xlsx_b64, "base64"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    await putFile(
      `${id}.json`,
      Buffer.from(JSON.stringify({ id, batchNo, domain, batchType: batchType || "", filename })),
      "application/json"
    );

    return res.json({
      id,
      filename,
      batchType: batchType || "",
      template: summary.template || null,
      holidaysMarked: summary.holidays_marked || 0,
      startDate: summary.start_date || null,
      effectiveStartDate: summary.effective_start_date || null,
      startWeekday: summary.start_weekday || null,
      weeks: summary.weeks || 0,
      firstWeekDays: summary.first_week_days || 0,
    });
  } catch (err) {
    console.error("Course planner generate error:", err);
    const missingTemplate = /no .*course planner template is available/i.test(err.message || "");
    return res
      .status(missingTemplate ? 400 : 500)
      .json({ error: err.message || "Generation failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/course-planner/preview/:id
// ---------------------------------------------------------------------------
router.get("/preview/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isId(id)) return res.status(400).json({ error: "valid id is required" });

    const xlsx = await getFile(`${id}.xlsx`);
    if (!xlsx) {
      return res.status(404).json({ error: "Generated planner not found. Generate it first." });
    }

    const out = await callPlanner("dump", { xlsx_b64: xlsx.toString("base64") });
    return res.json(JSON.parse(out.stdout));
  } catch (err) {
    console.error("Course planner preview error:", err);
    return res.status(500).json({ error: err.message || "Preview failed" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/course-planner/save/:id   body: { edits: [{ r, c, v }] }
// ---------------------------------------------------------------------------
router.post("/save/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isId(id)) return res.status(400).json({ error: "valid id is required" });

    const edits = Array.isArray(req.body?.edits) ? req.body.edits : [];
    const xlsx = await getFile(`${id}.xlsx`);
    if (!xlsx) {
      return res.status(404).json({ error: "Generated planner not found. Generate it first." });
    }

    const out = await callPlanner("apply", { xlsx_b64: xlsx.toString("base64"), edits });
    const summary = JSON.parse(out.stdout);

    await putFile(
      `${id}.xlsx`,
      Buffer.from(out.xlsx_b64, "base64"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    // The .xlsx changed, so any previously converted CSV is now stale.
    await removeFile(`${id}.csv`);

    return res.json({ id, saved: summary.saved || 0 });
  } catch (err) {
    console.error("Course planner save error:", err);
    return res.status(500).json({ error: err.message || "Save failed" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/course-planner/convert
// ---------------------------------------------------------------------------
router.post("/convert", async (req, res) => {
  try {
    const { id, theoryTrainerName, theoryTrainerEmail, labTrainerName, labTrainerEmail } =
      req.body || {};
    if (!isId(id)) return res.status(400).json({ error: "valid id is required" });

    const xlsx = await getFile(`${id}.xlsx`);
    if (!xlsx) {
      return res.status(404).json({ error: "Generated planner not found. Generate it first." });
    }

    const trainerCfg = JSON.stringify({
      theory_name: theoryTrainerName || "",
      theory_email: theoryTrainerEmail || "",
      lab_name: labTrainerName || "",
      lab_email: labTrainerEmail || "",
    });

    const out = await callPlanner("convert", {
      xlsx_b64: xlsx.toString("base64"),
      trainerCfg,
    });
    await putFile(`${id}.csv`, Buffer.from(out.csv_b64, "base64"), "text/csv");

    const meta = await readMeta(id);
    const rows = ((out.stdout || "").match(/Wrote\s+(\d+)/) || [])[1] || null;

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
// ---------------------------------------------------------------------------
router.get("/list", async (req, res) => {
  try {
    const { data, error } = await store().list("", {
      limit: 1000,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) throw error;

    const names = new Set((data || []).map((f) => f.name));
    const xlsxFiles = (data || [])
      .filter((f) => f.name.endsWith(".xlsx") && isId(f.name.replace(/\.xlsx$/, "")))
      .slice(0, 100);

    const items = await Promise.all(
      xlsxFiles.map(async (f) => {
        const id = f.name.replace(/\.xlsx$/, "");
        const meta = (await readMeta(id)) || {};
        return {
          id,
          batchNo: meta.batchNo || "",
          domain: meta.domain || "",
          filename: meta.filename || `${id}.xlsx`,
          createdAt: f.updated_at || f.created_at,
          hasCsv: names.has(`${id}.csv`),
        };
      })
    );
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return res.json({ items });
  } catch (err) {
    console.error("Course planner list error:", err);
    return res.status(500).json({ error: err.message || "List failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/course-planner/download/:id/:kind   (kind = xlsx | csv)
// ---------------------------------------------------------------------------
router.get("/download/:id/:kind", async (req, res) => {
  try {
    const { id, kind } = req.params;
    if (!isId(id) || !["xlsx", "csv"].includes(kind)) {
      return res.status(400).json({ error: "bad request" });
    }
    const buf = await getFile(`${id}.${kind}`);
    if (!buf) return res.status(404).json({ error: "file not found" });

    const meta = await readMeta(id);
    const base = meta ? meta.batchNo : id;
    const downloadName = kind === "xlsx" ? `${base} Course Planner.xlsx` : `${base} CP.csv`;

    res.setHeader(
      "Content-Type",
      kind === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${downloadName.replace(/"/g, "")}"`
    );
    return res.send(buf);
  } catch (err) {
    console.error("Course planner download error:", err);
    return res.status(500).json({ error: err.message || "Download failed" });
  }
});

export default router;