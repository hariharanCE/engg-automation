// routes/mockInterview.js
// Mock Interview dashboard API.
//
// Mount in backend/index.js:
//   import mockInterviewRoutes from "./routes/mockInterview.js";
//   app.use("/api/mock-interview", mockInterviewRoutes);
//
// Tables: mock_interview_sessions, mock_interview_results (see mock_interview.sql)
import express from "express";
import { supabase } from "../supabaseClient.js";
import { sendRawEmail } from "../emailSender.js";

const router = express.Router();

/* Roles allowed to save marks / send mails (role arrives in the request body,
 * the same lightweight guard the other dashboards use). */
const ROLES = ["admin", "manager", "coordinator", "corrdinator", "trainer"];

const SKILLS = [
  { key: "communication",         label: "Communication Skills" },
  { key: "technical",             label: "Technical Confidence" },
  { key: "concept_depth",         label: "Concept Depth" },
  { key: "practical_application", label: "Practical Application" },
  { key: "problem_solving",       label: "Problem-Solving Skills" },
  { key: "attitude",              label: "Attitude & Professionalism" },
];

const isId   = (s) => typeof s === "string" && /^[a-f0-9-]{36}$/i.test(s);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const roleOk = (r) => ROLES.includes(String(r || "").trim().toLowerCase());
const timeOrNull = (t) => (/^\d{2}:\d{2}/.test(t || "") ? t.slice(0, 5) : null);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const toRating = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

const averageOf = (o) => {
  const vals = SKILLS.map((s) => o[s.key]);
  if (!vals.every((v) => Number.isInteger(v))) return null;
  /* Rounded to a whole number: 4.8 -> 5, 3.1 -> 3 */
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
};

/* ───────────────────────── GET /sessions?batch_no= ───────────────────────── */
router.get("/sessions", async (req, res) => {
  try {
    const { batch_no } = req.query;
    if (!batch_no) return res.status(400).json({ error: "batch_no is required" });

    const { data, error } = await supabase
      .from("mock_interview_sessions")
      .select("id, batch_no, interview_date, interviewer_name, updated_at")
      .eq("batch_no", batch_no)
      .order("interview_date", { ascending: false });
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("Mock interview sessions error:", err);
    res.status(500).json({ error: err.message || "Failed to load sessions" });
  }
});

/* ───────────────────────── GET /session/:id ───────────────────────── */
router.get("/session/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isId(id)) return res.status(400).json({ error: "valid id is required" });

    const { data: session, error } = await supabase
      .from("mock_interview_sessions")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !session) return res.status(404).json({ error: "Session not found" });

    const { data: results, error: rErr } = await supabase
      .from("mock_interview_results")
      .select("*")
      .eq("session_id", id);
    if (rErr) throw rErr;

    res.json({ session, results: results || [] });
  } catch (err) {
    console.error("Mock interview session error:", err);
    res.status(500).json({ error: err.message || "Failed to load session" });
  }
});

/* ───────────────────────── POST /save ─────────────────────────
 * body: { id?, batch_no, course, venue, interview_date, start_time, end_time,
 *         interviewer_name, rows:[{ email, name, slot_time, trainer, absent,
 *         communication … attitude, remarks, areas_of_improvement }], role, created_by }
 */
router.post("/save", async (req, res) => {
  try {
    const {
      id, batch_no, course, venue, interview_date, start_time, end_time,
      interviewer_name, rows, role, created_by,
    } = req.body || {};

    if (!roleOk(role)) return res.status(403).json({ error: "You are not allowed to save mock interview marks" });
    if (!batch_no || !isDate(interview_date) || !String(interviewer_name || "").trim()) {
      return res.status(400).json({ error: "batch_no, interview_date and interviewer_name are required" });
    }
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 300) {
      return res.status(400).json({ error: "rows must contain 1 to 300 learners" });
    }

    // Only learners that really belong to this batch can be saved
    const { data: learners, error: lErr } = await supabase
      .from("learners_data")
      .select("email")
      .eq("batch_no", batch_no);
    if (lErr) throw lErr;
    const valid = new Set((learners || []).map((l) => (l.email || "").trim().toLowerCase()));

    const now = new Date().toISOString();
    const sessionFields = {
      batch_no,
      course: course || null,
      venue: venue || null,
      interview_date,
      start_time: timeOrNull(start_time),
      end_time: timeOrNull(end_time),
      interviewer_name: String(interviewer_name).trim(),
      updated_at: now,
    };

    let session;
    if (isId(id)) {
      const { data, error } = await supabase
        .from("mock_interview_sessions")
        .update(sessionFields)
        .eq("id", id)
        .select()
        .single();
      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({ error: "A session for this batch, date and interviewer already exists — load it from Saved sessions." });
        }
        throw error;
      }
      session = data;
    } else {
      const { data, error } = await supabase
        .from("mock_interview_sessions")
        .upsert({ ...sessionFields, created_by: created_by || null }, { onConflict: "batch_no,interview_date,interviewer_name" })
        .select()
        .single();
      if (error) throw error;
      session = data;
    }

    const skipped = [];
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const email = String(r?.email || "").trim();
      const key = email.toLowerCase();
      if (!email || !valid.has(key) || seen.has(key)) { skipped.push(email || "(no email)"); continue; }
      seen.add(key);

      const absent = !!r.absent;
      const o = {
        session_id: session.id,
        learner_email: email,
        learner_name: r.name || null,
        slot_time: r.slot_time || null,
        trainer: r.trainer || null,
        is_absent: absent,
      };
      SKILLS.forEach((s) => { o[s.key] = absent ? null : toRating(r[s.key]); });
      o.average_rating = absent ? null : averageOf(o);
      o.remarks = r.remarks || null;
      o.areas_of_improvement = r.areas_of_improvement || null;
      o.updated_at = now;
      out.push(o);
    }
    if (!out.length) return res.status(400).json({ error: "No valid learners to save for this batch" });

    const { error: rErr } = await supabase
      .from("mock_interview_results")
      .upsert(out, { onConflict: "session_id,learner_email" });
    if (rErr) throw rErr;

    res.json({ success: true, id: session.id, saved: out.length, skipped });
  } catch (err) {
    console.error("Mock interview save error:", err);
    res.status(500).json({ error: err.message || "Failed to save" });
  }
});

/* ───────────────────────── DELETE /session/:id ───────────────────────── */
router.delete("/session/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isId(id)) return res.status(400).json({ error: "valid id is required" });
    if (!roleOk(req.query.role)) return res.status(403).json({ error: "You are not allowed to delete sessions" });

    const { error } = await supabase.from("mock_interview_sessions").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Mock interview delete error:", err);
    res.status(500).json({ error: err.message || "Failed to delete" });
  }
});

/* ───────────────────────── Email builder ───────────────────────── */
const to12 = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ap}`;
};

function buildEmail({ session, r, note }) {
  const FONT = "font-family:Arial,Helvetica,sans-serif;color:#1a1f36;font-size:14px;line-height:1.5;";
  const labelCell = "padding:6px 10px;border:1px solid #000;background:#f2f2f2;font-weight:bold;font-size:13px;";
  const valueCell = "padding:6px 10px;border:1px solid #000;font-size:13px;";
  const h3 = "font-size:16px;margin:22px 0 8px;";

  const kv = (pairs) =>
    `<table style="border-collapse:collapse;margin:0 0 8px;">` +
    pairs.map(([k, v]) => `<tr><td style="${labelCell}">${esc(k)}</td><td style="${valueCell}">${v}</td></tr>`).join("") +
    `</table>`;

  const dateLong = new Date(`${session.interview_date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
  const timeTxt =
    r.slot_time ||
    (session.start_time && session.end_time ? `${to12(session.start_time)} - ${to12(session.end_time)}` : "");
  const trainer = r.trainer || session.interviewer_name || "";
  const courseLabel = session.course ? `${session.course} (${session.batch_no})` : session.batch_no;

  const details = kv([
    ["Name", esc(r.learner_name || "")],
    ["Email ID", `<a href="mailto:${esc(r.learner_email)}">${esc(r.learner_email)}</a>`],
    ["Date", esc(dateLong)],
    ["Time", esc(timeTxt || "—")],
    ["Interviewer", esc(session.interviewer_name || trainer || "—")],
  ]);

  const ratings = kv([
    ...SKILLS.map((s) => [`${s.label} (1-5)`, esc(r[s.key])]),
    ["Average Rating (1-5)", `<b>${esc(Math.round(Number(r.average_rating)))}</b>`],
  ]);

  const feedback = kv([
    ["Interviewer Remarks", esc(r.remarks || "—").replace(/\r?\n/g, "<br/>")],
    ["Areas of Improvement", esc(r.areas_of_improvement || "—").replace(/\r?\n/g, "<br/>")],
  ]);

  const noteHtml = note
    ? `<p style="background:#eef2ff;border-left:4px solid #3d5afe;padding:8px 12px;">${esc(note).replace(/\r?\n/g, "<br/>")}</p>`
    : "";

  const html = `
    <div style="${FONT}">
      <p>Dear ${esc(r.learner_name || "Learner")},</p>
      <p>Greetings from <b>ChipEdge Technologies!</b></p>
      <p>Thank you for attending the <b>Mock Interview</b> for <b>${esc(courseLabel)}</b>.
         Please find below your individual performance feedback.</p>
      <p>Kindly go through it carefully and work on the areas of improvement mentioned, so that you are well prepared for your upcoming interviews.</p>
      ${noteHtml}

      <h3 style="${h3}">Interview Details</h3>
      ${details}

      <h3 style="${h3}">Performance Summary</h3>
      ${ratings}

      <h3 style="${h3}">Feedback</h3>
      ${feedback}

      <p style="margin:22px 0 4px;"><b>Note:</b></p>
      <ul style="margin:4px 0 0;padding-left:28px;">
        <li>Ratings are given on a scale of <b>1 to 5</b>, where 1 is the lowest and 5 is the highest.</li>
        <li>If you notice any discrepancies or have any questions, please revert back to the same email within <b>48 hours</b>.</li>
      </ul>
      <p style="margin-top:22px;"><b>Regards</b>,<br/>Training & Delivery Team,<br/>ChipEdge Technologies Pvt. Ltd.</p>
    </div>`;

  const text =
    `Dear ${r.learner_name || "Learner"},\n\nGreetings from ChipEdge Technologies!\n\n` +
    `Your Mock Interview feedback for ${courseLabel} (${dateLong}${timeTxt ? ", " + timeTxt : ""}):\n\n` +
    SKILLS.map((s) => `${s.label}: ${r[s.key]}/5`).join("\n") +
    `\nAverage Rating: ${Math.round(Number(r.average_rating))}/5\n\n` +
    `Interviewer Remarks: ${r.remarks || "-"}\nAreas of Improvement: ${r.areas_of_improvement || "-"}\n\n` +
    `${note ? note + "\n\n" : ""}Regards,\nTraining & Delivery Team,\nChipEdge Technologies Pvt. Ltd.`;

  return { html, text };
}

/* ───────────────────────── POST /send-email ─────────────────────────
 * body: { session_id, emails?: [..], note?, role }
 * Reads the SAVED marks from the database, so what the learner receives is
 * always exactly what is stored. Absent / incomplete learners are skipped.
 */
router.post("/send-email", async (req, res) => {
  try {
    const { session_id, emails, note, role } = req.body || {};
    if (!roleOk(role)) return res.status(403).json({ error: "You are not allowed to send mock interview mails" });
    if (!isId(session_id)) return res.status(400).json({ error: "valid session_id is required" });

    const { data: session, error: sErr } = await supabase
      .from("mock_interview_sessions").select("*").eq("id", session_id).single();
    if (sErr || !session) return res.status(404).json({ error: "Session not found — save it first" });

    const { data: results, error: rErr } = await supabase
      .from("mock_interview_results").select("*").eq("session_id", session_id);
    if (rErr) throw rErr;

    const want = Array.isArray(emails) && emails.length
      ? new Set(emails.map((e) => String(e).trim().toLowerCase()))
      : null;

    const skipped = [];
    const jobs = [];
    for (const r of results || []) {
      const email = (r.learner_email || "").trim();
      if (want && !want.has(email.toLowerCase())) continue;
      if (r.is_absent)                       { skipped.push(`${email} (absent)`); continue; }
      if (r.average_rating === null || SKILLS.some((s) => r[s.key] === null)) {
        skipped.push(`${email} (ratings incomplete)`); continue;
      }
      const { html, text } = buildEmail({ session, r, note: String(note || "").trim().slice(0, 1000) });
      jobs.push({ email, subject: `Mock Interview Feedback — ${session.batch_no}`, html, text });
    }

    let sent = 0;
    const failures = [];
    const sentEmails = [];
    for (let i = 0; i < jobs.length; i += 5) {
      const chunk = jobs.slice(i, i + 5);
      const out = await Promise.all(
        chunk.map((j) => sendRawEmail({ to: j.email, subject: j.subject, html: j.html, text: j.text }))
      );
      out.forEach((o, idx) => {
        if (o?.success) { sent++; sentEmails.push(chunk[idx].email); }
        else failures.push({ email: chunk[idx].email, error: o?.error || "send failed" });
      });
    }

    if (sentEmails.length) {
      await supabase
        .from("mock_interview_results")
        .update({ emailed_at: new Date().toISOString() })
        .eq("session_id", session_id)
        .in("learner_email", sentEmails);
    }

    res.json({ success: true, sent, failed: failures.length, skipped, failures, sent_emails: sentEmails });
  } catch (err) {
    console.error("Mock interview email error:", err);
    res.status(500).json({ error: err.message || "Failed to send emails" });
  }
});

export default router;