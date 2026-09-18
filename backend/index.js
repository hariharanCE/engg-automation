// index.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import xlsx from "xlsx";
import cron from "node-cron";
import fetch from "node-fetch";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import multer from "multer";
import fs from "fs";
import path from "path";
import { supabase } from "./supabaseClient.js";
import { sendRawEmail } from "./emailSender.js";
import {
  scheduleWeeklyQuizReminders,
  scheduleIntermediateAssessmentReminders,
} from "./reminderScheduler.js";
import { scheduleCourseApplicationEmails } from "./courseApplicationScheduler.js";
import { scheduleInternalEmail } from "./emailScheduler.js";
import { processAttendanceFile } from "./attendanceMailer.js";
import bcrypt from "bcrypt";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import stream from "stream";
import PDFTable from "pdfkit-table";
import ExcelJS from "exceljs";
import { getWindowStatus } from "./marksWindowService.js";
import marksWindowsRouter from "./routes/marksWindows.js";
import marksSaveRouter from "./routes/marksSave.js";
import { pool } from "./db.js";
import pgDriver from "pg";
import announceRouter from "./routes/announce.js";
import attendanceRoutes from "./routes/attendance.js";
import jwt from "jsonwebtoken";
import holidaysRoutes from "./routes/holidaysRoutes.js";
import internalUsersRoutes from "./routes/internalUsersRoutes.js";
import coursePlannerRoutes from "./routes/coursePlanner.js";
import pushTokensRouter from "./routes/pushTokens.js";
import { notify, getRoleEmails, getApproverEmails } from "./push/sendPush.js";

dotenv.config();

// Day.js timezone configuration (IST)
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Asia/Kolkata");


const app = express();
const PORT = process.env.PORT || 5000;
const router = express.Router();

// ============================
// 🔥 IMPORTANT: NO TRAILING /
// ============================
const FRONTEND_URL = "https://engg-automation-6zzs.onrender.com";
const LOCAL_URL = "http://localhost:3000";

// File filter for Excel files
const excelFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    cb(null, true);
  } else {
    cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
  }
};

// Middleware to verify JWT token
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // Adjust secret
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};


// =====================================================
// ✅ FIXED CORS — ONLY THIS IS ENOUGH (Render Friendly)
// =====================================================
const ALLOWED_ORIGINS = [
  "https://engg-automation-6zzs.onrender.com",
  "http://localhost:3000",
  // Capacitor mobile app origins (APK / iOS)
  "https://localhost",
  "http://localhost",
  "capacitor://localhost"
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(cors({
  origin: [
    "https://engg-automation-6zzs.onrender.com",
    "http://localhost:3000",
    "http://192.168.1.2:5000/",
    // Capacitor mobile app origins (APK / iOS)
    "https://localhost",
    "http://localhost",
    "capacitor://localhost"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// =====================================================
// Body Parser
// =====================================================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Mount routers
app.use("/api/attendance", attendanceRoutes);
app.use("/api/course-planner", coursePlannerRoutes);
app.use("/api/push", pushTokensRouter);

// =====================================================
// Multer File Upload Config
// =====================================================
const upload = multer({ dest: "/tmp/uploads/" });


// ─── TABLE NAME MAP ──────────────────────────────────────────────────────────
const ASSESSMENT_TABLE_MAP = {
  "weekly-assessment":       "weekly_assessment_scores",
  "intermediate-assessment": "intermediate_assessment_scores",
  "module-level-assessment": "module_level_assessment_scores",
  "final-assessment":        "final_assessment_scores",
  "final-project":           "final_project_scores",
  "viva":                    "viva_scores",
};

const validateMarkEntryWindow = (assessmentDate, assessmentType) => {
  try {
    const daysWindowMap = {
      'weekly-assessment': 4,
      'intermediate-assessment': 5,
      'module-level-assessment': 6,
      'weekly-quiz': 7
    };

    const daysWindow = daysWindowMap[assessmentType] || 7;
    
    // STRICT DD/MM/YYYY parsing
    const [day, month, year] = assessmentDate.split('/');
    const assessment = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    
    if (isNaN(assessment.getTime())) {
      return { valid: false, error: 'Invalid date format (DD/MM/YYYY)' };
    }

    // BLOCK old dates (2025 in 2026)
    const now = new Date('2026-01-08T22:27:00+05:30'); // Current IST time
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    if (assessment < thirtyDaysAgo) {
      return { 
        valid: false, 
        error: `Assessment too old (${assessment.toLocaleDateString('en-GB')}). Max 30 days allowed.` 
      };
    }

    const closeDate = new Date(assessment);
    closeDate.setDate(assessment.getDate() + daysWindow);
    closeDate.setHours(23, 59, 59, 999);

    const isOpen = now <= closeDate;
    
    if (!isOpen) {
      return {
        valid: false,
        error: `Window closed. Assessment: ${assessmentDate}. Deadline: ${closeDate.toLocaleDateString('en-GB')}`
      };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Date validation failed' };
  }
};

const MOCK_INTERVIEW_REMINDER_SEND_TIME = "17:05"; // HH:mm
const TRAINER_SOFT_SKILLS_REMINDER_TIME = "17:08"; // HH:mm
const LEARNER_SOFT_SKILLS_REMINDER_TIME = "17:10"; // HH:mm

const getPlannerByBatchAndDate = async (batch_no, date) => {
  const { data, error } = await supabase
    .from("course_planner_data")
    .select("id, topic_name, module_name")
    .eq("batch_no", batch_no)
    .eq("date", date)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0];
};


app.use(bodyParser.json());

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // same secret as /api/login
    // decoded should include { id, role, name, email }
    req.user = decoded;
    next();
  } catch (err) {
    console.error("authMiddleware error:", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// === Helpers ===
function formatDate(dateStr) {
  if (!dateStr) return "";
  return dayjs(dateStr).format("DD-MMM-YYYY");
}

function getCurrentYear() {
  return new Date().getFullYear(); // 2026 now → 2027 next year
}

function toISODateOnly(d) {
  // returns YYYY-MM-DD
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function parseHolidayDateCell(cell, currentYear) {
  if (cell == null) return null;

  if (cell instanceof Date) return toISODateOnly(cell);

  const raw = String(cell).trim();
  if (!raw) return null;

  // 1) YYYY-MM-DD (full date)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // 2) DD-MMM (e.g., "1-Jan") → add currentYear
  const m1 = raw.match(/^(\d{1,2})-([A-Za-z]{3})$/);
  if (m1) {
    const dd = m1[1].padStart(2, "0");
    const monStr = m1[2];
    const monthIndex = new Date(`${monStr} 1, 2000`).getMonth();
    if (Number.isNaN(monthIndex)) return null;
    const dt = new Date(currentYear, monthIndex, Number(dd));
    return toISODateOnly(dt);
  }

  // 3) DD-MMM-YYYY (e.g., "1-Jan-2026")
  const m2 = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m2) {
    const dd = m2[1].padStart(2, "0");
    const monStr = m2[2];
    const yyyy = m2[3];
    const monthIndex = new Date(`${monStr} 1, 2000`).getMonth();
    if (Number.isNaN(monthIndex)) return null;
    const dt = new Date(Number(yyyy), monthIndex, Number(dd));
    return toISODateOnly(dt);
  }

  // 4) DD-MM-YYYY (e.g., "01-01-2026")
  const m3 = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m3) {
    const yyyy = m3[3];
    const mm = m3[2].padStart(2, "0");
    const dd = m3[1].padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  // 5) Last attempt: try as raw date
  return toISODateOnly(raw);
}

function computeTodayISO(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return dayjs().hour(hours).minute(minutes).second(0).millisecond(0).toISOString();
}

// FIXED: Properly handles negative offsets
function computeScheduledAtISO(startDateStr, offsetDays = 0, sendTime = "09:00") {
  try {
    // 1. Coerce offset to integer — DB often returns strings like "-1"
    const offset = Number(offsetDays);
    if (Number.isNaN(offset)) {
      throw new Error(`offsetDays is not a valid number: "${offsetDays}"`);
    }

    // 2. Parse send time
    const parts = String(sendTime || "09:00").split(":");
    const hh  = Math.max(0, Math.min(23, parseInt(parts[0], 10) || 0));
    const mm  = Math.max(0, Math.min(59, parseInt(parts[1], 10) || 0));

    // 3. Extract the calendar date part (first 10 chars = YYYY-MM-DD)
    //    Works whether startDateStr is "2026-03-09" or "2026-03-09T06:00:00.000Z"
    const datePart = String(startDateStr).slice(0, 10);
    const [y, mo, d] = datePart.split("-").map(Number);
    if (!y || !mo || !d) {
      throw new Error(`Cannot parse date from: "${startDateStr}"`);
    }

    // 4. Apply offset using UTC Date arithmetic to avoid DST/month-end issues
    //    We only care about the calendar date, so work in pure UTC day units.
    const baseMs = Date.UTC(y, mo - 1, d);              // midnight UTC of that date
    const targetMs = baseMs + offset * 24 * 60 * 60 * 1000; // add/subtract days
    const target = new Date(targetMs);

    const ty   = target.getUTCFullYear();
    const tm   = String(target.getUTCMonth() + 1).padStart(2, "0");
    const td   = String(target.getUTCDate()).padStart(2, "0");
    const thh  = String(hh).padStart(2, "0");
    const tmm  = String(mm).padStart(2, "0");

    // 5. Build an explicit IST timestamp string (Node always parses +05:30 correctly)
    //    "2026-03-08T09:00:00+05:30" → Node converts to "2026-03-08T03:30:00.000Z"
    const istStr = `${ty}-${tm}-${td}T${thh}:${tmm}:00+05:30`;
    const result = new Date(istStr);

    if (isNaN(result.getTime())) {
      throw new Error(`Produced invalid date from: "${istStr}"`);
    }

    const utcISO = result.toISOString();

    // Human-readable IST for logging
    const istDisplay = new Date(result.getTime() + 5.5 * 3600 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 16) + " IST";

    console.log("═══ computeScheduledAtISO ═══");
    console.log(`  startDate  : ${startDateStr}`);
    console.log(`  offsetDays : ${offset}  (raw="${offsetDays}", type=${typeof offsetDays})`);
    console.log(`  sendTime   : ${thh}:${tmm} IST`);
    console.log(`  target IST : ${ty}-${tm}-${td} ${thh}:${tmm}  (${istDisplay})`);
    console.log(`  stored UTC : ${utcISO}`);
    console.log("═════════════════════════════");

    return utcISO;
  } catch (err) {
    console.error("computeScheduledAtISO error:", err.message);
    throw err;
  }
}

function scheduleIST(startDateStr, offsetDays, sendTime) {
  const offset = Number(offsetDays);
  if (Number.isNaN(offset)) throw new Error(`Invalid offsetDays: "${offsetDays}"`);

  // Normalise: accept both "HH:mm" and "HH.mm" (dot-separated from DB)
  const normalised = String(sendTime || "09:00").trim().replace(".", ":");
  const [hhStr, mmStr] = normalised.split(":");
  const hh = Math.max(0, Math.min(23, parseInt(hhStr, 10) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(mmStr, 10) || 0));

  const datePart = String(startDateStr).slice(0, 10);
  const [y, mo, d] = datePart.split("-").map(Number);
  if (!y || !mo || !d) throw new Error(`Cannot parse date: "${startDateStr}"`);

  const baseMs   = Date.UTC(y, mo - 1, d);
  const targetMs = baseMs + offset * 86400000;
  const t        = new Date(targetMs);

  const ty  = t.getUTCFullYear();
  const tm  = String(t.getUTCMonth() + 1).padStart(2, "0");
  const td  = String(t.getUTCDate()).padStart(2, "0");
  const thh = String(hh).padStart(2, "0");
  const tmm = String(mm).padStart(2, "0");

  const istStr = `${ty}-${tm}-${td}T${thh}:${tmm}:00+05:30`;
  const result = new Date(istStr);
  if (isNaN(result.getTime())) throw new Error(`Produced invalid date: "${istStr}"`);

  const utcISO = result.toISOString();
  console.log(
    `  scheduleIST | base=${datePart} offset=${offset}` +
    ` sendTime="${sendTime}"→${thh}:${tmm} IST → UTC=${utcISO}`
  );
  return utcISO;
}



/* ======================
   HELPER: DATE PARSER
   ====================== */
function normalizeDate(value) {
  if (!value) return null;

  // Excel serial number
  if (typeof value === "number") {
    const d = new Date((value - 25569) * 86400 * 1000);
    return d.toISOString().split("T")[0];
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  // DD/MM/YYYY or DD-MM-YYYY
  const parts = value.split(/[-/]/);
  if (parts.length === 3) {
    const [d, m, y] = parts.map(Number);
    return new Date(y, m - 1, d).toISOString().split("T")[0];
  }

  return null;
}

// Helper used by leave emails
async function sendEmail({ to, subject, text, html }) {{
  const result = await sendRawEmail({ to, subject, text, html });
    if (!result.success) throw new Error(result.error);
    return result;
  }

  const mailOptions = {
    from: `Leave Management <${fromAddress}>`,
    to,
    subject,
    text: text || "",
    html: html || text || "",
  };

  try {
    const info = await mailTransporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully:", info.messageId);
    return info;
  } catch (err) {
    console.error("❌ Error sending email:", err);
    throw err; // IMPORTANT: don’t swallow the error
  }
}

// Helper to generate Soft Skills monthly reminder email HTML
function generateSoftSkillSummaryEmail(topics, trainerEmail) {
  let formRows = "";
  for (const t of topics) {
    formRows += `
      <tr>
        <td>${t.batch_no}</td>
        <td>${t.topic_name}</td>
        <td>
          <input type="date" name="date_${t.id}" value="${(t.date || "").slice(0, 10)}" required />
          <input type="hidden" name="id_${t.id}" value="${t.id}" />
        </td>
      </tr>`;
  }
  return `
    <form action="http://localhost:3000/api/soft-skills-trainer-confirmation?trainer_email=${encodeURIComponent(
      trainerEmail
    )}" method="POST">
      <p>Dear ${topics[0]?.trainer_name || "Trainer"},</p>
      <p>Please review and confirm your Soft Skills sessions below by editing dates as necessary and clicking Confirm.</p>
      <table border="1" cellpadding="7" style="border-collapse: collapse;">
        <thead>
          <tr><th>Batch No</th><th>Topic</th><th>Date</th></tr>
        </thead>
        <tbody>${formRows}</tbody>
      </table><br/>
      <button type="submit">Confirm Dates</button>
    </form>
  `;
}

// Helper: checks if two date ranges overlap (inclusive)
function isDateOverlap(start1, end1, start2, end2) {
  return new Date(start1) <= new Date(end2) &&
         new Date(start2) <= new Date(end1);
}

// ============================================================
// HELPER: Compute occupancy end = start + 5 months + 2 weeks
// Used everywhere A.DUE DATE was previously used for overlap.
// ============================================================
function computeOccupancyEnd(startDateStr) {
  if (!startDateStr) return null;
  const d = new Date(startDateStr);
  if (isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + 5);
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

function isWindowOpen(assessmentType, assessmentDate) {
  const date = new Date(assessmentDate);
  const now = new Date();

  let close = new Date(date);

  if (assessmentType === "weekly-assessment") {
    // Friday → Monday
    close.setDate(close.getDate() + 3);
  } 
  else if (
    assessmentType === "intermediate-assessment" ||
    assessmentType === "module-level-assessment"
  ) {
    // Friday → Wednesday
    close.setDate(close.getDate() + 5);
  } 
  else if (assessmentType === "final-assessment") {
    // 7 days
    close.setDate(close.getDate() + 7);
  }

  close.setHours(23, 59, 59, 999);

  return now <= close;
}


// Tools: you need a 'tools' column in classroom_occupancy or separate table if you want to restrict by required tools.
async function hasRequiredTools(classroomName, requiredTools) {
  // Implement this lookup if your schema has tools info (pseudo-code):
  // const { data: classroom } = await supabase.from('classrooms').select('tools').eq('name', classroomName).single();
  // return !requiredTools || requiredTools.every(tool => classroom.tools.includes(tool));
  return true; // always true if not using tool restrictions
}


// === Send Attendance mails ===
function parseMeta(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const periodRow = rows[2].join(" ");
  let period = periodRow.match(/Period\s*:?\s*(\d{1,2} \w{3} \d{4}) to (\d{1,2} \w{3} \d{4})/i);
  let startDate = null, endDate = null;
  if (period) {
    startDate = new Date(period[1]);
    endDate = new Date(period[2]);
  }
  const sessionRow = rows[3].join(" ");
  let session = sessionRow.match(/Session\s*:\s*(.*)/i);
  if (!session) session = sessionRow.match(/Session\s*(.*)/i);
  session = session ? session[1].trim() : "";
  return { session, startDate, endDate, periodRaw: periodRow };
}

// -- KEY: Assign correct year to each date column using period start, end, and order --
function parseDateCols(rows, startDate, endDate) {
  const headerRow = rows[6];
  const dateMap = [];
  // Count for each date (for Session 1/2 labeling)
  const dateCounter = {};
  let prevYear = startDate.getFullYear();
  let prevMonth = startDate.getMonth();
  let currYear = prevYear;

  for (let colIdx = 4; colIdx < headerRow.length; colIdx++) {
    const raw = headerRow[colIdx];
    if (!raw || raw.toLowerCase().includes('total')) break;
    if (raw.toLowerCase().includes('notes')) continue;

    // Parse date value
    let [day, mon] = raw.split('-');
    day = parseInt(day, 10);
    let monthNum = new Date(Date.parse(mon + " 1, 2000")).getMonth();

    // Check if we cross to next year (last month is Dec, current is Jan)
    if (monthNum < prevMonth) {
      currYear = prevYear + 1;
    }
    prevMonth = monthNum;
    prevYear = currYear;

    // Compose date and labeling
    let fullDate = new Date(currYear, monthNum, day);
    let printKey = `${day} ${mon} ${currYear}`;
    dateCounter[printKey] = (dateCounter[printKey] || 0) + 1;
    let sessionTag = dateCounter[printKey] > 1 ? `Session ${dateCounter[printKey]}` : "";

    dateMap.push({
      colIdx,
      print: fullDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      tag: sessionTag
    });
  }
  return dateMap;
}

// Helper to check date range overlap
function isOverlap(startA, endA, startB, endB) {
  return (dayjs(startA).isBefore(dayjs(endB).add(1, 'day')) && dayjs(endA).isAfter(dayjs(startB).subtract(1, 'day')));
}

// Find available classroom and slot (morning/afternoon)
async function findAvailableClassroom(supabase, students, start_date, end_date, preferred_slot) {
  // Get all classrooms that have capacity >= students
  let { data: classrooms, error } = await supabase.from('classrooms').select('*').gte('capacity', students);
  if (error) throw error;

  // Get all batches in the same date range overlapping and slot
  let { data: batches, error: batchesErr } = await supabase
    .from('batches')
    .select('*')
    .or(
      `and(start_date.gte.${start_date},start_date.lte.${end_date})`,
      `and(end_date.gte.${start_date},end_date.lte.${end_date})`,
      `and(start_date.lte.${start_date},end_date.gte.${end_date})`
    )
    .eq('preferred_slot', preferred_slot);

  if (batchesErr) throw batchesErr;

  for (let classroom of classrooms) {
    // Check if classroom is free during the slot and date range (no batch overlapping for that classroom)
    const isBooked = batches.some(b =>
      b.classroom_id === classroom.id && isOverlap(b.start_date, b.end_date, start_date, end_date)
    );
    if (!isBooked) return classroom;
  }
  return null; // no classroom available
}

// Check license availability for domain and students count
async function checkLicenseAvailability(supabase, domain, students) {
  let { data: licenses, error } = await supabase.from('licenses').select('count').eq('domain', domain);
  if (error) throw error;

  if (!licenses || licenses.length === 0) return { available: false, missing: students };
  const availableCount = licenses.reduce((sum, lic) => sum + lic.count, 0);
  if (availableCount >= students) return { available: true, missing: 0 };
  else return { available: false, missing: students - availableCount };
}

// example helper
export async function getDistinctTrainersForBatch(batchNo) {
  const { data, error } = await supabase
    .from("course_planner_data")
    .select("trainer_email")
    .eq("batch_no", batchNo)
    .neq("trainer_email", null);

  if (error) {
    console.error("Error fetching trainers for batch", batchNo, error);
    return [];
  }

  const emails = [...new Set(data.map((row) => row.trainer_email))];
  return emails;
}

/* ---------------- HEALTH CHECK ---------------- */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Backend is running" });
});

// Enhanced session-based attendance report API
app.get('/api/session-attendance-report', async (req, res) => {
  try {
    const { batch_no } = req.query;
    console.log(`🔍=== API HIT === batch_no="${batch_no}"`);
    
    // STEP 1: Count ALL records for this batch
    const [countResult] = await pool.execute(`
      SELECT COUNT(*) as total 
      FROM learner_attendance 
      WHERE TRIM(batch_no) = ?
    `, [batch_no]);
    
    console.log(`📊 COUNT RESULT: ${countResult[0].total} records`);
    
    // STEP 2: Get actual data with your EXACT format
    const [rows] = await pool.execute(`
      SELECT 
        TRIM(REGEXP_REPLACE(learner_email, '\\[mailto:([^\\]]+)\\].*', '$1')) as learner_email,
        LEFT(TRIM(status), 1) as status,
        CAST(session AS UNSIGNED) as session,
        date as date,
        CONCAT('Session ', CAST(session AS UNSIGNED)) as topic_name,
        TRIM(REGEXP_REPLACE(learner_email, '\\[mailto:([^\\]]+)\\].*', '$1')) as learner_name
      FROM learner_attendance 
      WHERE TRIM(batch_no) = ?
      ORDER BY session, learner_email
    `, [batch_no]);
    
    console.log(`✅ RETURNING ${rows.length} rows`);
    console.log('FIRST ROW:', rows[0]);
    
    res.json(rows);
    
  } catch (error) {
    console.error('🚨 API ERROR:', error.message);
    res.json([]); // Always return array
  }
});

// Add this route to your Express app
app.get('/api/modules-by-date', async (req, res) => {
  try {
    const { dates } = req.query; // comma-separated dates: 2026-01-21,2026-01-22
    
    if (!dates) {
      return res.json([]);
    }
    
    const dateArray = dates.split(',').map(d => d.trim());
    
    const [rows] = await pool.execute(`
      SELECT DISTINCT 
        DATE(date) as date,
        module_name
      FROM course_planner_data 
      WHERE DATE(date) IN (?)
        AND module_name IS NOT NULL 
        AND module_name != ''
      ORDER BY date, module_name
    `, [dateArray]);
    
    res.json(rows);
  } catch (error) {
    console.error('Modules API error:', error);
    res.json([]);
  }
});


// GET /api/learner-attendance - Fetch attendance by batch
app.get('/api/learner-attendance', async (req, res) => {
  try {
    const { batch_no } = req.query;
    
    if (!batch_no) {
      return res.status(400).json({ error: 'batch_no required' });
    }

    console.log(`🔍 Processing batch: ${batch_no}`);

    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    // 1️⃣ Get ALL sessions for batch
    const { data: plannerData, error: plannerError } = await supabase
      .from("course_planner_data")
      .select("date, batch_no")
      .eq("batch_no", batch_no)
      .order("date");

    if (plannerError) {
      console.error("Planner error:", plannerError);
      return res.status(500).json({ error: plannerError.message });
    }

    let totalBatchSessions = 0;
    let sessionsTillToday = 0;

    if (plannerData) {
      const uniqueDates = [...new Set(plannerData.map(row => row.date))];
      totalBatchSessions = uniqueDates.length;

      // ✅ Count only sessions till today
      const pastDates = uniqueDates.filter(date => date <= today);
      sessionsTillToday = pastDates.length;

      console.log(`📅 Total Batch Sessions: ${totalBatchSessions}`);
      console.log(`📅 Sessions Till Today (${today}): ${sessionsTillToday}`);
    }

    // 2️⃣ Get ATTENDANCE data
    const { data: attendanceData, error: attendanceError } = await supabase
      .from("learner_attendance")
      .select("learner_email, batch_no, date, session, status")
      .eq("batch_no", batch_no);

    if (attendanceError) {
      console.error("Attendance error:", attendanceError);
      return res.status(500).json({ error: attendanceError.message });
    }

    console.log(`📊 ${attendanceData?.length || 0} attendance records`);

    res.json({
      attendance: attendanceData || [],
      total_batch_sessions: totalBatchSessions,
      sessions_till_today: sessionsTillToday,
      planner_dates: plannerData?.map(p => p.date) || []   // ✅ ADD THIS
    });

  } catch (err) {
    console.error("🚨 API Error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});


// Learners by batch (NO authMiddleware)
app.get('/api/learners', async (req, res) => {
  try {
    const { batch_no } = req.query;
    
    let query = supabase
      .from("learners_data")
      .select("id, name, email, batch_no, status")
      .eq("name", supabase.rls?.shared ? supabase.auth.getUser() : true)
      .order("name");

    if (batch_no) {
      query = query.eq("batch_no", batch_no);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Learners error:", error);
      return res.status(500).json([]);
    }

    const normalized = (data || [])
      .map(row => ({
        id: row.id,
        name: row.name || row.email?.split('@')[0] || "Unknown",  // PRIORITY: learners_data.name
        email: row.email,
        batch_no: row.batch_no,
        status: row.status || "Enabled"
      }))
      .filter(row => row.email && row.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    console.log(`👥 ${normalized.length} learners for ${batch_no || 'ALL'}`);
    res.json(normalized);

  } catch (err) {
    console.error("Learners CRASH:", err);
    res.status(500).json([]);
  }
});

// get the internal users details from the table
app.get("/api/internal-users", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("internal_users")
      .select("name, email")
      .eq("is_active", true);

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error("Internal Users Fetch Error:", err);
    res.status(500).json({ error: "Failed to fetch internal users" });
  }
});

// 🔥 CRITICAL: learners_data table endpoints
app.get('/api/learners-data', async (req, res) => {
  try {
    console.log('🔍 /api/learners-data called');
    
    const { data, error } = await supabase
      .from('learners_data')
      .select('*')
      .order('name');

    if (error) {
      console.error('❌ learners_data error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`✅ learners_data: ${data?.length || 0} rows`);
    res.json(data || []);
  } catch (err) {
    console.error('🚨 learners_data CRASH:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// API to schedule batch with classroom suggestion and license check
app.post('/api/scheduleBatch', async (req, res) => {
  try {
    const { domain, batch_no, students, start_date, end_date, preferred_slot } = req.body;

    if (!domain || !batch_no || !students || !start_date || !end_date || !preferred_slot) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check classroom availability
    const classroom = await findAvailableClassroom(supabase, students, start_date, end_date, preferred_slot);
    if (!classroom) {
      return res.status(400).json({
        error: 'No classroom available with required capacity and free in preferred slot for full date range',
      });
    }

    // Check license availability for domain
    const licenseCheck = await checkLicenseAvailability(supabase, domain, students);
    if (!licenseCheck.available) {
      return res.status(400).json({
        error: `Insufficient licenses. Need additional ${licenseCheck.missing} licenses.`,
      });
    }

    // Save the batch with locked classroom
    const { error: insertError } = await supabase.from('batches').insert({
      batch_no,
      domain,
      students,
      start_date,
      end_date,
      preferred_slot,
      classroom_id: classroom.id,
      created_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;

    // 🔔 Notify approvers that a new batch was scheduled.
    notify(getApproverEmails(), {
      title: "New batch scheduled",
      body: `Batch ${batch_no} (${domain}) was scheduled.`,
      data: { type: "batch_scheduled", batch_no: String(batch_no) },
    });

    res.json({
      message: 'Batch scheduled successfully',
      classroom: classroom.name,
      preferred_slot,
    });
  } catch (err) {
    console.error('ScheduleBatch API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function extractAttendanceData(filepath) {
  const wb = xlsx.readFile(filepath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const { session, startDate, endDate } = parseMeta(sheet);
  const dateCols = parseDateCols(rows, startDate, endDate);
  const users = [];
  for (let i = 7; i < rows.length; i++) {
    const row = rows[i];
    const name = row[0] && String(row[0]).trim();

    let rawEmail = (row[1] || "").trim();
    if (!rawEmail) continue;
    // Try to auto-correct if missing @
    if (!rawEmail.includes('@') && rawEmail.includes('chipedge.com')) {
      const idx = rawEmail.indexOf('chipedge.com');
      const infix = rawEmail.lastIndexOf('.', idx - 2);
      if (infix !== -1) {
        rawEmail = rawEmail.slice(0, infix) + '@' + rawEmail.slice(infix + 1);
      } else {
        rawEmail = rawEmail.replace('chipedge.com', '@chipedge.com');
      }
    }
    if (!isValidEmail(rawEmail)) continue;
    const email = rawEmail;

    if (!name || !email) continue;
    let absents = [];
    dateCols.forEach(({ colIdx, print, tag }) => {
      const val = (row[colIdx] || "").toUpperCase().trim();
      if (val === "A" || val === "OL") {
        absents.push(tag ? `${print} - ${tag}` : print);
      }
    });
    users.push({ name, email, absents });
  }
  return { session, users };
}

async function sendMail({ name, email, session, absents }) {
  const formatted_dates = absents.map(d => `• ${d}`).join("\n");
  const mailText = `Dear ${name},

We noticed that you were absent for the enrolled course ${session} on the following days:
${formatted_dates}

Regular attendance is essential to stay aligned with the course content.

Kindly note 85% attendance is mandatory to get certification.

Warm Regards,
Kowshika
Learning Coordinator
9606056288
ChipEdge Technologies Pvt Ltd`;

  const result = await sendRawEmail({
    to: email,
    subject: `Absent Notification: ${session}`,
    text: mailText,
  });
  if (!result.success) throw new Error(result.error);
}

app.use(express.json());

app.post("/api/send-attendance-emails", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const filepath = req.file.path;
    const { session, users } = extractAttendanceData(filepath);
    let sentDetails = [];
    for (const u of users) {
      if (!u.absents.length) continue;
      try {
        await sendMail({ ...u, session });
        sentDetails.push({ email: u.email, name: u.name, status: "sent" });
        console.log(`Email sent to: ${u.name} <${u.email}>`);
      } catch (e) {
        sentDetails.push({ email: u.email, name: u.name, status: "failed", error: e.message });
        console.error(`Failed to send email to: ${u.name} <${u.email}> - ${e.message}`);
      }
    }
    fs.unlinkSync(filepath);
    res.json({
      success: true,
      details: sentDetails,
      message: `Processed ${sentDetails.length} absent entries.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1) GET /api/marks/window-status
app.get("/api/marks/window-status", async (req, res) => {
  try {
    const { batch_no, assessment_type, week_no } = req.query;
    if (!batch_no || !assessment_type) {
      return res
        .status(400)
        .json({ error: "batch_no and assessment_type are required" });
    }

    const status = await getWindowStatus({
      batchNo: batch_no,
      assessmentType: assessment_type,
      weekNo: week_no ? Number(week_no) : null,
    });

    // Check if this trainer already has a pending request
    let hasPendingRequest = false;
    if (req.user?.email) {
      const { data, error } = await supabase
        .from("marks_entry_extension_requests")
        .select("id")
        .eq("batch_no", batch_no)
        .eq("assessment_type", assessment_type)
        .or(
          week_no
            ? `week_no.eq.${week_no}`
            : "week_no.is.null"
        )
        .eq("trainer_email", req.user.email)
        .eq("status", "pending")
        .limit(1);

      if (!error && data && data.length > 0) {
        hasPendingRequest = true;
      }
    }

    return res.json({ ...status, has_pending_request: hasPendingRequest });
  } catch (err) {
    console.error("window-status error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Admin/Manager/Coordinator "Extend Window" persistence (shared across users).
// Previously the extension was kept in the admin's browser localStorage, so
// trainers on other machines never saw it and their window stayed closed.
// It is now stored server-side keyed by (batch_no, assessment_type, date) so
// the trainer's mark sheet honours it too.
//
// Persisted to a small JSON file under uploads/ (the same store the app already
// uses for file artifacts). This avoids a DB dependency for a short-lived
// (≈ one day) value and works on the current deployment.
// ───────────────────────────────────────────────────────────────────────────
const MARK_EXT_DIR = "/tmp/uploads";
const MARK_EXT_FILE = path.join(MARK_EXT_DIR, "mark-window-extensions.json");
const markExtKey = (b, t, d) => `${b}::${t}::${d}`;

function readMarkExtStore() {
  try {
    return JSON.parse(fs.readFileSync(MARK_EXT_FILE, "utf-8")) || {};
  } catch {
    return {}; // missing/blank file → no extensions yet
  }
}
function writeMarkExtStore(store) {
  try {
    fs.mkdirSync(MARK_EXT_DIR, { recursive: true });
    fs.writeFileSync(MARK_EXT_FILE, JSON.stringify(store));
    return true;
  } catch (e) {
    console.error("window-extension store write error:", e);
    return false;
  }
}

// GET the current shared extension for a batch/assessment/date
app.get("/api/marks/window-extension", (req, res) => {
  try {
    const { batch_no, assessment_type, assessment_date } = req.query;
    if (!batch_no || !assessment_type || !assessment_date) {
      return res
        .status(400)
        .json({ error: "batch_no, assessment_type and assessment_date are required" });
    }
    const store = readMarkExtStore();
    const val = store[markExtKey(batch_no, assessment_type, assessment_date)] || null;
    return res.json({ extended_until: val });
  } catch (err) {
    console.error("window-extension get error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST set/extend the window (Admin/Manager/Coordinator). Latest write wins.
app.post("/api/marks/window-extension", (req, res) => {
  try {
    const { batch_no, assessment_type, assessment_date, extended_until } = req.body || {};
    if (!batch_no || !assessment_type || !assessment_date || !extended_until) {
      return res.status(400).json({
        error: "batch_no, assessment_type, assessment_date and extended_until are required",
      });
    }
    const until = new Date(extended_until);
    if (isNaN(until.getTime())) {
      return res.status(400).json({ error: "invalid extended_until" });
    }
    const store = readMarkExtStore();
    store[markExtKey(batch_no, assessment_type, assessment_date)] = until.toISOString();
    if (!writeMarkExtStore(store)) {
      return res.status(500).json({ error: "Could not save the extension" });
    }
    // 🔔 Notify the batch's trainers that their mark-entry window was extended.
    notify(getDistinctTrainersForBatch(batch_no), {
      title: "Mark-entry window extended",
      body: `The window for ${batch_no} · ${assessment_type} is open until ${until.toLocaleString("en-IN")}.`,
      data: { type: "window_extended", batch_no },
    });
    return res.json({ success: true, extended_until: until.toISOString() });
  } catch (err) {
    console.error("window-extension set error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// "Open Mark Entry" persistence (shared across users). Admin/Manager/Coordinator
// unlock the mark-entry fields for TRAINERS for the current day only (till 11:59
// PM), WITHOUT changing the window close date. Stored server-side (JSON file)
// keyed by (batch_no, assessment_type, date) so trainers on any machine see it.
// Kept separate from the window extension so the two actions stay independent.
// ───────────────────────────────────────────────────────────────────────────
const MARK_OPEN_FILE = path.join(MARK_EXT_DIR, "mark-entry-open.json");
function readMarkOpenStore() {
  try {
    return JSON.parse(fs.readFileSync(MARK_OPEN_FILE, "utf-8")) || {};
  } catch {
    return {};
  }
}
function writeMarkOpenStore(store) {
  try {
    fs.mkdirSync(MARK_EXT_DIR, { recursive: true });
    fs.writeFileSync(MARK_OPEN_FILE, JSON.stringify(store));
    return true;
  } catch (e) {
    console.error("mark-entry-open store write error:", e);
    return false;
  }
}

// GET the current "mark entry open" flag for a batch/assessment/date
app.get("/api/marks/mark-entry-open", (req, res) => {
  try {
    const { batch_no, assessment_type, assessment_date } = req.query;
    if (!batch_no || !assessment_type || !assessment_date) {
      return res
        .status(400)
        .json({ error: "batch_no, assessment_type and assessment_date are required" });
    }
    const store = readMarkOpenStore();
    const val = store[markExtKey(batch_no, assessment_type, assessment_date)] || null;
    return res.json({ open_until: val });
  } catch (err) {
    console.error("mark-entry-open get error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST open the mark-entry fields (Admin/Manager/Coordinator). Latest write wins.
app.post("/api/marks/mark-entry-open", (req, res) => {
  try {
    const { batch_no, assessment_type, assessment_date, open_until } = req.body || {};
    if (!batch_no || !assessment_type || !assessment_date || !open_until) {
      return res.status(400).json({
        error: "batch_no, assessment_type, assessment_date and open_until are required",
      });
    }
    const until = new Date(open_until);
    if (isNaN(until.getTime())) {
      return res.status(400).json({ error: "invalid open_until" });
    }
    const store = readMarkOpenStore();
    store[markExtKey(batch_no, assessment_type, assessment_date)] = until.toISOString();
    if (!writeMarkOpenStore(store)) {
      return res.status(500).json({ error: "Could not open mark entry" });
    }
    // 🔔 Notify the batch's trainers their mark-entry was opened.
    notify(getDistinctTrainersForBatch(batch_no), {
      title: "Mark entry opened",
      body: `Mark entry for ${batch_no} · ${assessment_type} is now open.`,
      data: { type: "mark_entry_open", batch_no: String(batch_no) },
    });
    return res.json({ success: true, open_until: until.toISOString() });
  } catch (err) {
    console.error("mark-entry-open set error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Mark-entry extension REQUESTS (trainer → admin/manager/coordinator approval).
// A trainer whose window is closed clicks "Request Extension" in the Mark Sheet;
// the request lands here and shows up in the Mark Extension Report. On approve,
// we open the window for that (batch, assessment_type, date) until 11:59 PM of
// the NEXT day (IST) by writing the same window-extension file store the Mark
// Sheet reads. Persisted to a JSON file (no DB dependency), like the stores
// above.
// ───────────────────────────────────────────────────────────────────────────
const MARK_REQ_FILE = path.join(MARK_EXT_DIR, "mark-extension-requests.json");
function readMarkReqStore() {
  try {
    const arr = JSON.parse(fs.readFileSync(MARK_REQ_FILE, "utf-8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function writeMarkReqStore(list) {
  try {
    fs.mkdirSync(MARK_EXT_DIR, { recursive: true });
    fs.writeFileSync(MARK_REQ_FILE, JSON.stringify(list));
    return true;
  } catch (e) {
    console.error("mark-extension-requests store write error:", e);
    return false;
  }
}
// Tomorrow 23:59:59.999 in IST (UTC+5:30), returned as a UTC ISO string.
function nextDayEndIstISO() {
  const IST = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth();
  const d = nowIst.getUTCDate();
  return new Date(Date.UTC(y, m, d + 1, 23, 59, 59, 999) - IST).toISOString();
}

// Trainer raises an extension request.
app.post("/api/mark-extension/request", (req, res) => {
  try {
    const {
      batch_no, assessment_type, assessment_date,
      week_no, trainer_email, trainer_name, reason,
    } = req.body || {};
    if (!batch_no || !assessment_type || !assessment_date) {
      return res.status(400).json({
        error: "batch_no, assessment_type and assessment_date are required",
      });
    }

    const list = readMarkReqStore();

    // Avoid duplicate pending requests for the same assessment instance.
    const dup = list.find(
      (r) =>
        r.status === "pending" &&
        r.batch_no === batch_no &&
        r.assessment_type === assessment_type &&
        r.assessment_date === assessment_date
    );
    if (dup) {
      return res.json({ success: false, error: "A pending request already exists for this assessment." });
    }

    const request = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      batch_no,
      assessment_type,
      assessment_date,
      week_no: week_no ?? null,
      trainer_email: trainer_email || null,
      trainer_name: trainer_name || null,
      reason: reason || null,
      status: "pending",
      created_at: new Date().toISOString(),
      decided_at: null,
      decided_by: null,
      extended_until: null,
    };
    list.unshift(request);
    if (!writeMarkReqStore(list)) {
      return res.status(500).json({ error: "Could not save the request" });
    }
    // 🔔 Notify approvers that a new mark-extension request needs action.
    notify(getApproverEmails(), {
      title: "New mark-extension request",
      body: `${trainer_name || trainer_email || "A trainer"} requested an extension for ${batch_no} · ${assessment_type}.`,
      data: { type: "mark_extension_request", request_id: request.id, batch_no },
    });
    return res.json({ success: true, request_id: request.id });
  } catch (err) {
    console.error("mark-extension request error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// List requests (default: pending) for the Mark Extension Report.
app.get("/api/mark-extension/list", (req, res) => {
  try {
    const status = req.query.status || "pending";
    const list = readMarkReqStore();
    const filtered = status === "all" ? list : list.filter((r) => r.status === status);
    return res.json({ requests: filtered });
  } catch (err) {
    console.error("mark-extension list error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Approve a request → open the window until tomorrow 11:59 PM (IST).
app.post("/api/mark-extension/:id/approve", (req, res) => {
  try {
    const { id } = req.params;
    const decidedBy = (req.body && req.body.decided_by) || null;

    const list = readMarkReqStore();
    const reqRow = list.find((r) => r.id === id);
    if (!reqRow) return res.status(404).json({ error: "Request not found" });
    if (reqRow.status !== "pending") {
      return res.status(400).json({ error: `Request already ${reqRow.status}` });
    }

    // Open the mark-entry window for this assessment (the store the Mark Sheet
    // reads via GET /api/marks/window-extension).
    const untilIso = nextDayEndIstISO();
    const key = markExtKey(reqRow.batch_no, reqRow.assessment_type, reqRow.assessment_date);

    const winStore = readMarkExtStore();
    winStore[key] = untilIso;
    if (!writeMarkExtStore(winStore)) {
      return res.status(500).json({ error: "Could not open the window" });
    }

    // Also open the mark-entry FIELDS for the same period (the store the Mark
    // Sheet reads via GET /api/marks/mark-entry-open), so approving unlocks
    // editing even when the marks were already saved — not just the date.
    const openStore = readMarkOpenStore();
    openStore[key] = untilIso;
    writeMarkOpenStore(openStore);

    reqRow.status = "approved";
    reqRow.decided_at = new Date().toISOString();
    reqRow.decided_by = decidedBy;
    reqRow.extended_until = untilIso;
    writeMarkReqStore(list);

    // 🔔 Notify the requesting trainer that their extension was approved.
    if (reqRow.trainer_email) {
      notify(reqRow.trainer_email, {
        title: "Mark-extension approved ✅",
        body: `Your mark-entry window for ${reqRow.batch_no} · ${reqRow.assessment_type} is now open until ${new Date(untilIso).toLocaleString("en-IN")}.`,
        data: { type: "mark_extension_approved", batch_no: reqRow.batch_no },
      });
    }
    return res.json({ success: true, extended_until: untilIso });
  } catch (err) {
    console.error("mark-extension approve error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Reject a request.
app.post("/api/mark-extension/:id/reject", (req, res) => {
  try {
    const { id } = req.params;
    const decidedBy = (req.body && req.body.decided_by) || null;

    const list = readMarkReqStore();
    const reqRow = list.find((r) => r.id === id);
    if (!reqRow) return res.status(404).json({ error: "Request not found" });
    if (reqRow.status !== "pending") {
      return res.status(400).json({ error: `Request already ${reqRow.status}` });
    }
    reqRow.status = "rejected";
    reqRow.decided_at = new Date().toISOString();
    reqRow.decided_by = decidedBy;
    writeMarkReqStore(list);
    // 🔔 Notify the requesting trainer that their extension was declined.
    if (reqRow.trainer_email) {
      notify(reqRow.trainer_email, {
        title: "Mark-extension request declined",
        body: `Your extension request for ${reqRow.batch_no} · ${reqRow.assessment_type} was not approved.`,
        data: { type: "mark_extension_rejected", batch_no: reqRow.batch_no },
      });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("mark-extension reject error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 2) GET /api/marks/:assessmentType — load existing marks
app.get("/api/marks/:assessmentType", async (req, res, next) => {
  const { assessmentType } = req.params;
  const { batch_no, course_planner_id, assessment_date } = req.query;

  // Skip non-assessment routes so they fall through to their own handlers
  const table = ASSESSMENT_TABLE_MAP[assessmentType];
  if (!table) return next();

  // final-project / viva are one-per-batch assessments with no course_planner_id
  // column, so assessment_date is optional — callers may fetch by batch alone.
  const noPlannerIdTypes = ["final-project", "viva"];
  const hasPlannerCol = !noPlannerIdTypes.includes(assessmentType);

  if (!batch_no)
    return res.status(400).json({ error: "batch_no is required" });
  if (!assessment_date && hasPlannerCol)
    return res.status(400).json({ error: "assessment_date is required" });

  try {
    let query = supabase
      .from(table)
      .select("*")
      .eq("batch_no", batch_no);

    if (assessment_date) {
      // Normalize assessment_date to ISO YYYY-MM-DD for reliable date column matching
      const parsedDate = dayjs(assessment_date);
      const normalizedDate = parsedDate.isValid() ? parsedDate.format("YYYY-MM-DD") : null;
      query = query.eq("assessment_date", normalizedDate || assessment_date);
    }

    // Only filter by course_planner_id if the table has that column AND it was provided
    if (course_planner_id && hasPlannerCol) {
      query = query.eq("course_planner_id", Number(course_planner_id));
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET marks Supabase error:", error);
      throw error;
    }

    // Normalize response — include assessment_date so callers (final-project /
    // viva) that fetched without a date filter can recover the saved date.
    const normalized = (data || []).map(row => ({
      learner_id:      row.learner_id,
      out_off:         row.out_off,
      points:          row.points,
      percentage:      row.percentage,
      assessment_name: row.assessment_name || null,
      assessment_date: row.assessment_date || null,
    }));

    return res.json(normalized);
  } catch (err) {
    console.error("GET marks error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 3) POST /api/marks/extension-request
app.post("/api/marks/extension-request", async (req, res) => {
  try {
    const { batch_no, assessment_type, week_no, reason } = req.body;

    if (!batch_no || !assessment_type || !week_no) {
      return res
        .status(400)
        .json({ error: "batch_no, assessment_type, week_no are required" });
    }

    // Check if portal is still open — no need to request if open
    const status = await getWindowStatus({
      batchNo: batch_no,
      assessmentType: assessment_type,
      weekNo: week_no,
    });
    if (status.is_open) {
      return res.json({
        success: false,
        error: "Portal is already open for this assessment",
      });
    }

    // Prevent duplicate pending requests from any trainer email who wants to request for same batch/week (optional)
    const { data: existing, error: existErr } = await supabase
      .from("marks_entry_extension_requests")
      .select("id")
      .eq("batch_no", batch_no)
      .eq("assessment_type", assessment_type)
      .eq("week_no", week_no)
      .eq("status", "pending")
      .limit(1);

    if (!existErr && existing && existing.length > 0) {
      return res.json({
        success: false,
        error: "There is already a pending extension request for this assessment",
      });
    }

    // Use trainer emails from course_planner_data, requires passing trainer_email in request now or store who requested
    
    // For demo, we can require trainer_email in body or set it to null
    // Recommend passing trainer_email from frontend as the logged-in user email (optional)
    // Or omit and store NULL (then embedding auth is better)
    const trainerEmail = req.body.trainer_email || null;

    const { data, error } = await supabase
      .from("marks_entry_extension_requests")
      .insert({
        batch_no,
        assessment_type,
        week_no,
        trainer_email: trainerEmail,
        reason: reason || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("extension-request insert error:", error);
      return res.status(500).json({ error: "Failed to create request" });
    }

    // Get distinct trainer emails for batch to notify
    const notifyEmails = await getDistinctTrainersForBatch(batch_no);

    const subject = `Extension request for batch ${batch_no}`;
    const htmlBody = `
      <p>An extension request has been made.</p>
      <ul>
        <li><b>Batch:</b> ${batch_no}</li>
        <li><b>Assessment Type:</b> ${assessment_type}</li>
        <li><b>Week No:</b> ${week_no}</li>
        <li><b>Reason:</b> ${reason || "N/A"}</li>
      </ul>
      <p>Please review the request and approve or reject it.</p>`;

    // Send emails asynchronously but don't wait to respond to client
    notifyEmails.forEach((email) => {
      sendRawEmail({
        to: email,
        subject,
        html: htmlBody,
      }).catch((e) => console.error("Failed to send mail to", email, e));
    });

    return res.json({ success: true, request_id: data.id });
  } catch (err) {
    console.error("extension-request error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 4) GET /api/marks/extension-requests
app.get("/api/marks/extension-requests", async (req, res) => {
  try {
    const status = req.query.status || "pending";

    const { data, error } = await supabase
      .from("marks_entry_extension_requests")
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("list extension-requests error:", error);
      return res.status(500).json({ error: "Failed to fetch requests" });
    }

    return res.json(data || []);
  } catch (err) {
    console.error("list extension-requests error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 5) POST /api/marks/extension-requests/:id/approve
app.post("/api/marks/extension-requests/:id/approve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const managerEmail = req.user?.email;

    const { data: reqRow, error: fetchErr } = await supabase
      .from("marks_entry_extension_requests")
      .select("*")
      .eq("id", id)
      .eq("status", "pending")
      .single();

    if (fetchErr || !reqRow) {
      return res
        .status(404)
        .json({ error: "Request not found or already decided" });
    }

    const nowPlus24 = dayjs().add(24, "hour").toISOString();

    const { error: winErr } = await supabase
      .from("marks_entry_windows")
      .update({
        is_extended: true,
        extended_until: supabase.rpc
          ? undefined
          : nowPlus24, // simple set; the GREATEST logic can be approximated
        updated_at: new Date().toISOString(),
      })
      .eq("batch_no", reqRow.batch_no)
      .eq("assessment_type", reqRow.assessment_type)
      .or(
        reqRow.week_no
          ? `week_no.eq.${reqRow.week_no}`
          : "week_no.is.null"
      );

    if (winErr) {
      console.error("update window error:", winErr);
      return res.status(500).json({ error: "Failed to extend window" });
    }

    const { error: updReqErr } = await supabase
      .from("marks_entry_extension_requests")
      .update({
        status: "approved",
        decided_at: new Date().toISOString(),
        decided_by: managerEmail || null,
      })
      .eq("id", id);

    if (updReqErr) {
      console.error("update request error:", updReqErr);
      return res.status(500).json({ error: "Failed to update request" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("approve extension error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 6) POST /api/marks/extension-requests/:id/reject
app.post("/api/marks/extension-requests/:id/reject", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const managerEmail = req.user?.email;

    const { error } = await supabase
      .from("marks_entry_extension_requests")
      .update({
        status: "rejected",
        decided_at: new Date().toISOString(),
        decided_by: managerEmail || null,
      })
      .eq("id", id)
      .eq("status", "pending");

    if (error) {
      console.error("reject extension error:", error);
      return res.status(500).json({ error: "Failed to update request" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("reject extension error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});



// === Form Service via Apps Script WebApp ===
async function createBatchForm(batch_no, start_date) {
  const res = await fetch(process.env.FORM_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batch_no, start_date }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Form creation failed");
  console.log("✅ Form created:", data);
  return data; // { form_url, sheet_url }
}

// === Upload Learners ===
app.post("/upload-learners", async (req, res) => {
  try {
    const { learners } = req.body;
    if (!Array.isArray(learners) || learners.length === 0) {
      return res.status(400).json({ error: "No learners provided" });
    }

    // Helper to build a composite key
    const buildKey = (l) =>
      `${(l.name || "").trim().toLowerCase()}|${(l.email || "").trim().toLowerCase()}|${(l.batch_no || "").trim()}`;

    // 1) Normalize and map incoming rows
    const normalized = learners.map((l) => ({
      name: (l.name || "").trim(),
      email: (l.email || "").trim(),
      phone: (l.phone || "").trim(),
      batch_no: (l.batch_no || "").trim(),
      status: (l.status || "").trim(),
      server_id: (l.server_id || "").trim(),
    }));

    // 2) Detect in-file duplicates
    const seen = new Set();
    const unique = [];
    const inFileDuplicates = [];

    for (const l of normalized) {
      const k = buildKey(l);
      if (!l.name || !l.email || !l.batch_no) {
        // allow frontend validation to handle missing fields; still pass through as unique
        unique.push(l);
        continue;
      }
      if (seen.has(k)) {
        inFileDuplicates.push(l);
      } else {
        seen.add(k);
        unique.push(l);
      }
    }

    if (unique.length === 0) {
      return res.json({
        message: "No rows to insert",
        alreadyInDb: [],
        inFileDuplicates,
      });
    }

    // 3) Query Supabase to find already existing learners (same name+email+batch_no)
    // Supabase does not support a multi-column IN directly in one call,
    // so do a single select and filter in Node.
    const { data: existingData, error: existingError } = await supabase
      .from("learners_data")
      .select("name, email, batch_no");

    if (existingError) throw existingError;

    const existingKeys = new Set(
      (existingData || []).map((row) => buildKey(row))
    );

    const newRows = [];
    const alreadyInDb = [];

    for (const l of unique) {
      const k = buildKey(l);
      if (!l.name || !l.email || !l.batch_no) {
        // if key is incomplete, treat as new row (backend will still insert it)
        newRows.push(l);
        continue;
      }
      if (existingKeys.has(k)) {
        alreadyInDb.push(l);
      } else {
        newRows.push(l);
      }
    }

    // 4) Insert only newRows
    let insertedCount = 0;
    if (newRows.length > 0) {
      const { error: insertError } = await supabase
        .from("learners_data")
        .insert(newRows);

      if (insertError) {
        // If you have a UNIQUE constraint on (name,email,batch_no),
        // Supabase may still throw on conflicts; you can ignore conflict codes if needed.
        throw insertError;
      }
      insertedCount = newRows.length;
    }

    return res.json({
      message: `Inserted ${insertedCount} learners. ${alreadyInDb.length} already present.`,
      alreadyInDb,      // for React: mark "Already in database"
      inFileDuplicates, // for React: mark "Duplicate in file"
    });
  } catch (err) {
    console.error("❌ Upload learners error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// === Upload Course Planner ===
app.post("/upload-course-planner", async (req, res) => {
  try {
    const { courses } = req.body;

    if (!Array.isArray(courses) || courses.length === 0) {
      return res
        .status(400)
        .json({ error: "No course planner rows provided" });
    }

    // Take batch_no from first row (all rows in file should belong to same batch)
    const batchNo = (courses[0].batch_no || "").trim();
    if (!batchNo) {
      return res.status(400).json({ error: "batch_no missing in file" });
    }

    // 1) Check if planner already exists for this batch_no in course_planner_data
    const { data: existing, error: selError } = await supabase
      .from("course_planner_data")
      .select("id")
      .eq("batch_no", batchNo)
      .limit(1);

    if (selError) throw selError;

    if (existing && existing.length > 0) {
      // Do NOT insert, just tell frontend it is already present
      return res.status(200).json({
        message: `Course planner for ${batchNo} is already in database`,
        alreadyPresent: true,
        batch_no: batchNo,
        insertedCount: 0,
      });
    }

    // 2) Normalize all expected columns for insert
    const rows = courses.map((c) => ({
      classroom_name: (c.classroom_name || c.classroom || "").trim(),
      batch_no: (c.batch_no || "").trim(),
      domain: (c.domain || null),
      mode: (c.mode || null),
      week_no: (c.week_no || null),
      date: (c.date || null),
      start_time: (c.start_time || null),
      end_time: (c.end_time || null),
      module_name: (c.module_name || null),
      module_topic: (c.module_topic || null),
      topic_name: (c.topic_name || null),
      trainer_name: (c.trainer_name || null),
      trainer_email: (c.trainer_email || null),
      topic_status: (c.topic_status || null),
      remarks: (c.remarks || null),
      batch_type: (c.batch_type || null),
      actual_date: (c.actual_date || null),
      date_difference: (c.date_difference || null),
      date_changed_by: (c.date_changed_by || null),
      date_changed_at: (c.date_changed_at || null),
    }));

    // 3) Insert into Supabase table
    const { error: insError } = await supabase
      .from("course_planner_data")
      .insert(rows);

    if (insError) throw insError;

    // 🔔 Notify the batch's trainers a course planner was uploaded.
    notify(getDistinctTrainersForBatch(batchNo), {
      title: "Course planner uploaded",
      body: `A course planner was uploaded for ${batchNo}.`,
      data: { type: "course_planner_uploaded", batch_no: String(batchNo) },
    });

    return res.json({
      message: `Inserted ${rows.length} course planner rows for ${batchNo}`,
      alreadyPresent: false,
      batch_no: batchNo,
      insertedCount: rows.length,
    });
  } catch (err) {
    console.error("❌ Upload course planner error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// Assuming you already have supabase client initialised above
app.get("/api/course-planner-meta/:batchNo", async (req, res) => {
  try {
    const batchNo = (req.params.batchNo || "").trim();
    if (!batchNo) {
      return res.status(400).json({ error: "batch_no is required" });
    }

    const { data, error } = await supabase
      .from("course_planner_data")
      .select("batch_no, mode, batch_type, classroom_name")
      .eq("batch_no", batchNo)
      .limit(1);

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: `No course planner found for ${batchNo}` });
    }

    const row = data[0];

    return res.json({
      batch_no: row.batch_no,
      mode: row.mode || null,
      batch_type: row.batch_type || null,
      classroom_name: row.classroom_name || null,
    });
  } catch (err) {
    console.error("❌ course-planner-meta error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// === Get Batch List (merged from course_planner_data + learners_data) ===
app.get("/api/batches", async (req, res) => {
  const domain = req.query.domain;

  try {
    // 1) Fetch batches from course_planner_data
    let plannerQuery = supabase
      .from("course_planner_data")
      .select("batch_no, date");

    if (domain) {
      plannerQuery = plannerQuery.eq("domain", domain);
    }

    plannerQuery = plannerQuery.order("date", { ascending: true });

    const { data: plannerData, error: plannerError } = await plannerQuery;
    if (plannerError) throw plannerError;

    // Group by batch_no picking earliest date as start_date
    const batchMap = {};
    for (const row of plannerData || []) {
      if (!row.batch_no) continue;
      if (!batchMap[row.batch_no] && row.date) batchMap[row.batch_no] = row.date;
    }

    // 2) Fetch distinct batch_no from learners_data (no domain filter — learners may not have domain)
    const { data: learnerData, error: learnerError } = await supabase
      .from("learners_data")
      .select("batch_no");

    if (learnerError) {
      console.warn("Warning: failed to fetch learners_data batches:", learnerError.message);
      // Continue with planner batches only
    } else {
      for (const row of learnerData || []) {
        if (!row.batch_no) continue;
        // Add batch if not already present from planner data
        if (!batchMap[row.batch_no]) batchMap[row.batch_no] = null;
      }
    }

    // Format output array [{ batch_no, start_date }, ...]
    const formatted = Object.entries(batchMap).map(([batch_no, date]) => ({
      batch_no,
      start_date: date ? formatDate(date) : "",
    }));

    // Sort by batch_no for consistent ordering
    formatted.sort((a, b) => (a.batch_no || "").localeCompare(b.batch_no || ""));

    res.json(formatted);
  } catch (err) {
    console.error("❌ /api/batches error:", err.message);
    res.status(500).json({ error: "Failed to fetch batches" });
  }
});


//===Get Domain list ===
app.get('/api/domains', async (req, res) => {
  try {
    // Select domains, filter out nulls, order ascending
    const { data, error } = await supabase
      .from('course_planner_data')
      .select('domain')
      .neq('domain', null)
      .order('domain', { ascending: true });

    if (error) {
      console.error('Error fetching domains:', error);
      return res.status(500).json({ error: error.message });
    }

    // Deduplicate & filter out falsy values
    const distinctDomains = [...new Set(data.map(x => x.domain))].filter(Boolean);

    res.json(distinctDomains);
  } catch (err) {
    console.error("Exception in /api/domains:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Suggest classroom API (unchanged, your existing logic)
app.post('/api/suggestClassroom', async (req, res) => {
  const { batch_no, domain, students, start_date, end_date, required_tools } = req.body;

  if (!batch_no || !domain || !students || !start_date || !end_date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data: classrooms, error: classErr } = await supabase
    .from('classrooms')
    .select('*')
    .gte('capacity', students);

  if (classErr) return res.status(500).json({ error: 'Failed to fetch classrooms' });
  if (!classrooms.length) return res.status(400).json({ error: 'No classrooms with sufficient capacity' });

  const { data: occupancy, error: occErr } = await supabase
    .from('classroom_occupancy')
    .select('*');

  if (occErr) return res.status(500).json({ error: 'Failed to fetch occupancy' });

  let suggested = null;
  for (const classroom of classrooms) {
    for (const slot of ['morning', 'evening']) {
      const overlap = occupancy.some(occ =>
        occ.classroom_name === classroom.name &&
        occ.slot === slot &&
        !(new Date(occ.occupancy_end) < new Date(start_date) ||
          new Date(occ.occupancy_start) > new Date(end_date))
      );

      if (!overlap) {
        suggested = { classroom: classroom.name, slot };
        break;
      }
    }
    if (suggested) break;
  }

  if (!suggested) return res.status(400).json({ error: 'No classrooms available for the date range and capacity' });

  // License details for domain from licenses table
  const { data: licenses, error: licErr } = await supabase
    .from('licenses')
    .select('license_name, count, domain')
    .eq('domain', domain);

  if (licErr) return res.status(500).json({ error: 'Failed to fetch licenses' });

  const licensesWithAdditional = licenses.map(lic => ({
    license_name: lic.license_name,
    count: lic.count,
    additional_needed: Math.max(0, students - lic.count),
  }));

  const anyAdditionalNeeded = licensesWithAdditional.some(l => l.additional_needed > 0);

  const { error: insertErr } = await supabase.from('classroom_occupancy').insert({
    classroom_name: suggested.classroom,
    slot: suggested.slot,          // DB column name is "slot"
    batch_no,
    occupancy_start: start_date,
    occupancy_end: end_date,
  });

  if (insertErr) return res.status(500).json({ error: 'Failed to schedule batch' });

  res.json({
    message: 'Batch scheduled successfully',
    classroom: suggested.classroom,
    slot: suggested.slot,
    licenses: licensesWithAdditional,
    licensesSufficient: !anyAdditionalNeeded,
  });
});

// Get licenses (used by ClassroomPlanner)
app.get('/api/licenses', async (req, res) => {
  const { data, error } = await supabase
    .from('licenses')
    .select('license_name, count, domain');

  if (error) {
    console.error('licenses error', error);
    return res.status(500).json({ error: 'Failed to fetch licenses' });
  }

  res.json(data); // plain array
});


// ----------------------------------------------------------------
// GET /api/get-classroom-matrix
//
// FIX: Removed `a_end` from SELECT — that column does not exist in
// the classroom_occupancy table, which caused a Supabase 500 error
// on every page refresh, making the DB query return nothing and the
// frontend show "Upload a file..." after refresh.
//
// occupancy_end stores the 5m+2w computed end date (saved during
// handleSaveMatrix). If a row is missing it (older record), we
// compute it here from occupancy_start before returning.
// ----------------------------------------------------------------
app.get("/api/get-classroom-matrix", async (req, res) => {
  try {
    const { data: occupancyRows, error } = await supabase
      .from("classroom_occupancy")
      .select(
        "batch_no, classroom_name, slot, occupancy_start, occupancy_end, enrolled, capacity, class_room, shifts"
      )
      .order("occupancy_start", { ascending: true });

    if (error) {
      console.error("get-classroom-matrix error:", error);
      return res.status(500).json({ error: error.message });
    }
    if (!occupancyRows?.length) {
      return res.json({ occupancyRows: [], weeks: [] });
    }

    const batchNos = occupancyRows.map((r) => r.batch_no).filter(Boolean);

    // Pull primary trainer from course_planner_data (fallback for display)
    const { data: plannerData } = await supabase
      .from("course_planner_data")
      .select("batch_no, trainer_name")
      .in("batch_no", batchNos)
      .not("trainer_name", "is", null)
      .neq("trainer_name", "");

    const trainerMap = {};
    (plannerData || []).forEach((row) => {
      if (row.batch_no && row.trainer_name && !trainerMap[row.batch_no]) {
        trainerMap[row.batch_no] = row.trainer_name;
      }
    });

    const transformedRows = occupancyRows.map((r) => {
      // Prefer DB-stored occupancy_end; compute from start if absent
      const occEnd = r.occupancy_end || computeOccupancyEnd(r.occupancy_start);
      return {
        batch_no:        r.batch_no,
        classroom_name:  r.classroom_name || null,
        slot:            r.slot           || null,
        occupancy_start: r.occupancy_start,
        occupancy_end:   occEnd,
        // a_end is intentionally omitted — it's not stored in the table.
        // The frontend will show "—" for due date; it uses occupancy_end
        // for all scheduling/rendering.
        enrolled:        r.enrolled  || 0,
        capacity:        r.capacity  || r.enrolled || 0,
        mode:            "OFFLINE",
        trainer_name:    trainerMap[r.batch_no] || "UNASSIGNED",
      };
    });

    res.json({ occupancyRows: transformedRows, weeks: [] });
  } catch (err) {
    console.error("get-classroom-matrix error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ----------------------------------------------------------------
// POST /api/get-batch-module-trainers
// Returns moduleTrainerMap (trainer assignments per batch/module)
// and overlapInfo (scheduling conflicts) from the DB.
// Called by loadExistingMatrix on every page load.
// ----------------------------------------------------------------
app.post("/api/get-batch-module-trainers", async (req, res) => {
  try {
    const { batch_nos } = req.body;
    if (!Array.isArray(batch_nos) || !batch_nos.length) {
      return res.status(400).json({ error: "batch_nos array required" });
    }

    // 1. Fetch module-trainer assignments
    const { data: bmtRows, error: bmtError } = await supabase
      .from("batch_module_trainers")
      .select("batch_no, module_name, module_type, trainer_name, trainer_email")
      .in("batch_no", batch_nos)
      .order("batch_no")
      .order("module_type");

    if (bmtError) {
      console.error("get-batch-module-trainers bmt error:", bmtError);
      return res.status(500).json({ error: bmtError.message });
    }

    // 2. Fetch saved conflicts
    const { data: conflictRows, error: conflictError } = await supabase
      .from("batch_trainer_conflicts")
      .select("batch_no, module_type, trainer_name, conflict_batch_no, conflict_start, conflict_end")
      .in("batch_no", batch_nos)
      .order("batch_no")
      .order("module_type");

    if (conflictError) {
      console.error("get-batch-module-trainers conflict error (non-fatal):", conflictError);
    }

    // Build moduleTrainerMap
    const moduleTrainerMap = {};
    (bmtRows || []).forEach((row) => {
      if (!row.batch_no) return;
      if (!moduleTrainerMap[row.batch_no]) moduleTrainerMap[row.batch_no] = [];
      moduleTrainerMap[row.batch_no].push({
        module_type:   row.module_type   || "",
        module_name:   row.module_name   || "",
        trainer_name:  row.trainer_name  || "UNASSIGNED",
        trainer_email: row.trainer_email || "",
      });
    });

    // Build overlapInfo from saved conflicts
    const overlapInfo = {};
    (conflictRows || []).forEach((row) => {
      if (!row.batch_no) return;
      if (!overlapInfo[row.batch_no]) overlapInfo[row.batch_no] = [];
      let entry = overlapInfo[row.batch_no].find(
        (e) => e.module_type === row.module_type && e.trainer === row.trainer_name
      );
      if (!entry) {
        entry = { module_type: row.module_type || "", trainer: row.trainer_name || "", conflicts: [] };
        overlapInfo[row.batch_no].push(entry);
      }
      if (row.conflict_batch_no) {
        entry.conflicts.push({
          batch_no: row.conflict_batch_no,
          start:    row.conflict_start,
          end:      row.conflict_end,
        });
      }
    });

    res.json({ moduleTrainerMap, overlapInfo });
  } catch (err) {
    console.error("get-batch-module-trainers error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ----------------------------------------------------------------
// POST /api/assign-batch-trainers-by-module
// Called during file upload. batch_date_ranges carries
// end = occupancy_end (start + 5m + 2w) sent from the frontend.
// The backend normalises it via computeOccupancyEnd as a fallback.
// ----------------------------------------------------------------
app.post("/api/assign-batch-trainers-by-module", async (req, res) => {
  try {
    const { batch_nos, batch_date_ranges } = req.body;
    if (!Array.isArray(batch_nos) || !batch_nos.length) {
      return res.status(400).json({ error: "batch_nos array required" });
    }

    console.log("=== assign-batch-trainers-by-module START ===");
    console.log("batch_nos:", batch_nos);

    // Normalise date ranges — end is always the 5m+2w occupancy window
    const normalisedRanges = {};
    batch_nos.forEach((bn) => {
      const raw = batch_date_ranges?.[bn];
      if (!raw?.start) return;
      normalisedRanges[bn] = {
        start: raw.start,
        end:   raw.end || computeOccupancyEnd(raw.start),
      };
    });

    // 1. Fetch trainer_domain
    const { data: trainerDomainData, error: tdError } = await supabase
      .from("trainer_domain")
      .select("trainer_name, trainer_email, trainer_domain, domain_handling, module_name");
    if (tdError) return res.status(500).json({ error: tdError.message });
    console.log(`trainer_domain rows: ${trainerDomainData?.length || 0}`);

    // 2. Fetch course_module_template
    const { data: moduleTemplates, error: mtError } = await supabase
      .from("course_module_template")
      .select("domain, module_name, module_type");
    if (mtError) return res.status(500).json({ error: mtError.message });
    console.log(`course_module_template rows: ${moduleTemplates?.length || 0}`);

    // 3. Fetch existing occupancy for overlap checking (use occupancy_end)
    const { data: occupancyData, error: ocError } = await supabase
      .from("classroom_occupancy")
      .select("batch_no, occupancy_start, occupancy_end")
      .order("occupancy_start", { ascending: true });
    if (ocError) return res.status(500).json({ error: ocError.message });

    // 4. Fetch existing batch_module_trainers for already-saved batches
    const savedBatchNos = (occupancyData || [])
      .map((r) => r.batch_no)
      .filter((bn) => bn && !batch_nos.includes(bn));

    let existingModuleAssignments = [];
    if (savedBatchNos.length > 0) {
      const { data: bmtData } = await supabase
        .from("batch_module_trainers")
        .select("batch_no, trainer_name, module_type, occupancy_start, occupancy_end")
        .in("batch_no", savedBatchNos);
      existingModuleAssignments = bmtData || [];
    }

    // Build trainer booking index from saved batches (use occupancy_end)
    const trainerBookings = {};
    existingModuleAssignments.forEach((row) => {
      if (!row.trainer_name || row.trainer_name === "UNASSIGNED") return;
      const occEnd = row.occupancy_end || computeOccupancyEnd(row.occupancy_start);
      if (!trainerBookings[row.trainer_name]) trainerBookings[row.trainer_name] = [];
      trainerBookings[row.trainer_name].push({
        batch_no: row.batch_no,
        start:    row.occupancy_start,
        end:      occEnd,
      });
    });

    // ── Helpers ─────────────────────────────────────────────────────────
    const normalize  = (str) => (str || "").toString().toLowerCase().trim();
    const isOverlap  = (s1, e1, s2, e2) => {
      if (!s1 || !e1 || !s2 || !e2) return false;
      return new Date(s1) <= new Date(e2) && new Date(s2) <= new Date(e1);
    };
    const inferDomain = (batchNo) => {
      const up = (batchNo || "").toUpperCase();
      if (up.startsWith("DFTFT") || up.startsWith("DFT")) return "dft";
      if (up.startsWith("DVFT")  || up.startsWith("DV"))  return "dv";
      if (up.startsWith("PDFT")  || up.startsWith("PD"))  return "pd";
      return "";
    };
    const getEligibleTrainers = (domain, moduleType) => {
      const seen = new Set();
      const result = [];
      (trainerDomainData || []).forEach((t) => {
        if (seen.has(t.trainer_name)) return;
        let match = false;
        if (moduleType === "BASIC") {
          match = normalize(t.domain_handling) === domain;
        } else if (moduleType === "CORE_THEORY" || moduleType === "CORE_LAB") {
          match = normalize(t.trainer_domain) === domain;
        }
        if (match) {
          seen.add(t.trainer_name);
          result.push({ trainer_name: t.trainer_name, trainer_email: t.trainer_email || "" });
        }
      });
      return result;
    };

    // Sort batches by start date ascending
    const sortedBatchNos = [...batch_nos].sort((a, b) => {
      const sa = normalisedRanges[a]?.start || "";
      const sb = normalisedRanges[b]?.start || "";
      if (sa !== sb) return sa.localeCompare(sb);
      const ea = normalisedRanges[a]?.end || "";
      const eb = normalisedRanges[b]?.end || "";
      if (ea !== eb) return ea.localeCompare(eb);
      return a.localeCompare(b);
    });

    // Local booking tracker (clone from saved)
    const localBookings = {};
    Object.keys(trainerBookings).forEach((tn) => {
      localBookings[tn] = [...trainerBookings[tn]];
    });

    const moduleTrainerMap = {};
    const overlapInfo      = {};

    for (const batchNo of sortedBatchNos) {
      const dateRange = normalisedRanges[batchNo];
      if (!dateRange?.start || !dateRange?.end) {
        console.warn(`No date range for batch: ${batchNo}`);
        moduleTrainerMap[batchNo] = [];
        continue;
      }

      const { start: bStart, end: bEnd } = dateRange;
      const domain = inferDomain(batchNo);
      console.log(`\nBatch: ${batchNo} | domain="${domain}" | occupancy ${bStart} → ${bEnd}`);

      if (!domain) {
        console.warn(`Cannot infer domain for: ${batchNo}`);
        moduleTrainerMap[batchNo] = [];
        continue;
      }

      const moduleTypeMap = new Map();
      (moduleTemplates || []).forEach((t) => {
        if (normalize(t.domain) === domain && t.module_type && !moduleTypeMap.has(t.module_type)) {
          moduleTypeMap.set(t.module_type, t.module_name || t.module_type);
        }
      });
      console.log(`Module types for domain "${domain}":`, [...moduleTypeMap.keys()]);

      if (!moduleTypeMap.size) {
        console.warn(`No module templates for domain "${domain}".`);
        moduleTrainerMap[batchNo] = [];
        continue;
      }

      moduleTrainerMap[batchNo] = [];

      for (const [moduleType, moduleName] of moduleTypeMap.entries()) {
        const eligible = getEligibleTrainers(domain, moduleType);
        console.log(`  [${moduleType}] eligible: ${eligible.map((e) => e.trainer_name).join(", ") || "NONE"}`);

        if (!eligible.length) {
          moduleTrainerMap[batchNo].push({
            module_type: moduleType, module_name: moduleName,
            trainer_name: "UNASSIGNED", trainer_email: "",
          });
          continue;
        }

        const available = eligible.filter((t) => {
          const bookings = localBookings[t.trainer_name] || [];
          return !bookings.some((b) => isOverlap(bStart, bEnd, b.start, b.end));
        });
        console.log(`  [${moduleType}] available: ${available.map((a) => a.trainer_name).join(", ") || "NONE"}`);

        if (!available.length) {
          if (!overlapInfo[batchNo]) overlapInfo[batchNo] = [];
          eligible.forEach((t) => {
            const conflicts = (localBookings[t.trainer_name] || []).filter((b) =>
              isOverlap(bStart, bEnd, b.start, b.end)
            );
            overlapInfo[batchNo].push({ module_type: moduleType, trainer: t.trainer_name, conflicts });
          });
          moduleTrainerMap[batchNo].push({
            module_type: moduleType, module_name: moduleName,
            trainer_name: "UNASSIGNED", trainer_email: "",
          });
          continue;
        }

        available.sort((a, b) => {
          const aLast = (localBookings[a.trainer_name] || []).reduce((m, x) => x.end > m ? x.end : m, "");
          const bLast = (localBookings[b.trainer_name] || []).reduce((m, x) => x.end > m ? x.end : m, "");
          if (!aLast && !bLast) return a.trainer_name.localeCompare(b.trainer_name);
          if (!aLast) return -1;
          if (!bLast) return  1;
          return aLast.localeCompare(bLast);
        });

        const selected = available[0];
        console.log(`  [${moduleType}] ASSIGNED: ${selected.trainer_name}`);
        moduleTrainerMap[batchNo].push({
          module_type: moduleType, module_name: moduleName,
          trainer_name: selected.trainer_name, trainer_email: selected.trainer_email || "",
        });
        if (!localBookings[selected.trainer_name]) localBookings[selected.trainer_name] = [];
        localBookings[selected.trainer_name].push({ batch_no: batchNo, start: bStart, end: bEnd });
      }
    }

    console.log("=== RESULT moduleTrainerMap ===", JSON.stringify(moduleTrainerMap, null, 2));
    res.json({ moduleTrainerMap, overlapInfo });
  } catch (err) {
    console.error("assign-batch-trainers-by-module error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// NEW: /api/get-module-trainers
// FIX 1: Returns per-module trainer assignments for saved batches
// so the Trainer Matrix and Batch Detail popup work after refresh.
// Also returns capacity per batch for license summary (FIX 2).
// ============================================================
app.post("/api/get-module-trainers", async (req, res) => {
  try {
    const { batch_nos } = req.body;
    if (!Array.isArray(batch_nos) || !batch_nos.length) {
      return res.status(400).json({ error: "batch_nos array required" });
    }

    // Fetch all course_planner_data rows for these batches
    // This table stores module-level records (one row per module per batch)
    const { data: plannerRows, error: plannerError } = await supabase
      .from("course_planner_data")
      .select("batch_no, module_name, module_type, trainer_name, capacity")
      .in("batch_no", batch_nos);

    if (plannerError) {
      console.error("get-module-trainers planner fetch error:", plannerError);
      return res.status(500).json({ error: plannerError.message });
    }

    // Group by batch_no → array of {module_name, module_type, trainer_name}
    const moduleTrainerMap = {};
    const batchCapacityMap = {};

    (plannerRows || []).forEach((row) => {
      if (!row.batch_no) return;

      // Track capacity (pick max in case of multiple rows)
      if (row.capacity) {
        const cap = Number(row.capacity);
        if (!batchCapacityMap[row.batch_no] || cap > batchCapacityMap[row.batch_no]) {
          batchCapacityMap[row.batch_no] = cap;
        }
      }

      if (!moduleTrainerMap[row.batch_no]) {
        moduleTrainerMap[row.batch_no] = [];
      }

      // Deduplicate by module_type (keep first assigned trainer per type)
      const existingForType = moduleTrainerMap[row.batch_no].find(
        (mt) => mt.module_type === row.module_type
      );
      if (!existingForType) {
        moduleTrainerMap[row.batch_no].push({
          module_name: row.module_name || "",
          module_type: row.module_type || "",
          trainer_name: row.trainer_name || "UNASSIGNED",
        });
      }
    });

    res.json({ moduleTrainerMap, batchCapacityMap });
  } catch (err) {
    console.error("get-module-trainers error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// NEW: /api/get-batch-trainers-by-module
// FIX 3: Replaces the old /api/get-batch-trainers
// Assigns trainers PER MODULE TYPE for each batch:
//   BASIC      → trainer must have matching domain_handling in trainer_domain
//   CORE_THEORY → trainer must have matching trainer_domain in trainer_domain
//   CORE_LAB   → trainer must have matching trainer_domain in trainer_domain
// Multiple trainers can be assigned to one batch (one per module type).
// Overlap checking is still date-wise per trainer.
// ============================================================
app.post("/api/get-batch-trainers-by-module", async (req, res) => {
  try {
    const { batch_nos, batch_date_ranges } = req.body;
    if (!Array.isArray(batch_nos) || !batch_nos.length) {
      return res.status(400).json({ error: "batch_nos array required" });
    }

    // 1. Fetch trainer_domain table
    const { data: trainerDomainData, error: tdError } = await supabase
      .from("trainer_domain")
      .select("trainer_name, trainer_email, trainer_domain, domain_handling, module_name");

    if (tdError) {
      console.error("trainer_domain fetch error:", tdError);
      return res.status(500).json({ error: tdError.message });
    }

    // 2. Fetch course_module_template to know which module types exist per domain
    const { data: moduleTemplates, error: mtError } = await supabase
      .from("course_module_template")
      .select("domain, module_name, module_type");

    if (mtError) {
      console.error("course_module_template fetch error:", mtError);
      return res.status(500).json({ error: mtError.message });
    }

    // 3. Fetch existing classroom occupancy to build current trainer bookings
    const { data: occupancyData, error: ocError } = await supabase
      .from("classroom_occupancy")
      .select("batch_no, occupancy_start, occupancy_end")
      .order("occupancy_start", { ascending: true });

    if (ocError) {
      console.error("classroom_occupancy fetch error:", ocError);
      return res.status(500).json({ error: ocError.message });
    }

    // 4. Fetch trainer assignments for ALREADY SAVED batches (not in current upload)
    const savedBatchNos = (occupancyData || [])
      .map((r) => r.batch_no)
      .filter((bn) => bn && !batch_nos.includes(bn));

    let existingTrainerAssignments = [];
    if (savedBatchNos.length > 0) {
      const { data: cpData } = await supabase
        .from("course_planner_data")
        .select("batch_no, trainer_name, module_type")
        .in("batch_no", savedBatchNos)
        .not("trainer_name", "is", null)
        .neq("trainer_name", "");
      existingTrainerAssignments = cpData || [];
    }

    // Build saved batch → trainer map per module_type
    // savedBatchModuleTrainerMap[batch_no][module_type] = trainer_name
    const savedBatchModuleTrainerMap = {};
    existingTrainerAssignments.forEach((row) => {
      if (!row.batch_no || !row.trainer_name) return;
      if (!savedBatchModuleTrainerMap[row.batch_no]) {
        savedBatchModuleTrainerMap[row.batch_no] = {};
      }
      const mt = row.module_type || "UNKNOWN";
      if (!savedBatchModuleTrainerMap[row.batch_no][mt]) {
        savedBatchModuleTrainerMap[row.batch_no][mt] = row.trainer_name;
      }
    });

    // 5. Build trainer booking index (trainer_name → [{batch_no, start, end}])
    // from already-saved occupancy data
    const trainerBookings = {};
    (occupancyData || []).forEach((row) => {
      if (!row.batch_no || batch_nos.includes(row.batch_no)) return;
      // Get all trainers assigned to this saved batch
      const moduleTrainers = savedBatchModuleTrainerMap[row.batch_no];
      if (!moduleTrainers) return;
      Object.values(moduleTrainers).forEach((trainerName) => {
        if (!trainerName) return;
        if (!trainerBookings[trainerName]) trainerBookings[trainerName] = [];
        trainerBookings[trainerName].push({
          batch_no: row.batch_no,
          start: row.occupancy_start,
          end: row.occupancy_end,
        });
      });
    });

    // Helper functions
    const normalize = (str) => (str || "").toString().toLowerCase().trim();

    const isOverlap = (s1, e1, s2, e2) => {
      if (!s1 || !e1 || !s2 || !e2) return false;
      return new Date(s1) <= new Date(e2) && new Date(s2) <= new Date(e1);
    };

    const inferDomain = (batchNo) => {
      const up = (batchNo || "").toUpperCase();
      if (up.startsWith("DFTFT") || up.startsWith("DFT")) return "DFT";
      if (up.startsWith("DVFT") || up.startsWith("DV")) return "DV";
      if (up.startsWith("PDFT") || up.startsWith("PD")) return "PD";
      return "";
    };

    // Get eligible trainers for a given domain and module_type
    // FIX 3: Apply correct matching rules per module_type:
    //   BASIC      → trainer_domain.domain_handling matches domain
    //   CORE_THEORY → trainer_domain.trainer_domain matches domain
    //   CORE_LAB   → trainer_domain.trainer_domain matches domain
    const getEligibleTrainersForModuleType = (domain, moduleType) => {
      const normDomain = normalize(domain);
      const trainerSet = new Map();

      (trainerDomainData || []).forEach((t) => {
        let matches = false;
        if (moduleType === "BASIC") {
          matches = normalize(t.domain_handling) === normDomain;
        } else if (moduleType === "CORE_THEORY" || moduleType === "CORE_LAB") {
          matches = normalize(t.trainer_domain) === normDomain;
        }

        if (matches && !trainerSet.has(t.trainer_name)) {
          trainerSet.set(t.trainer_name, {
            trainer_name: t.trainer_name,
            trainer_email: t.trainer_email,
          });
        }
      });

      return Array.from(trainerSet.values());
    };

    // 6. Sort batches by start date ascending (earliest gets first pick)
    const sortedBatchNos = [...batch_nos].sort((a, b) => {
      const sa = batch_date_ranges?.[a]?.start || "";
      const sb = batch_date_ranges?.[b]?.start || "";
      if (sa !== sb) return sa.localeCompare(sb);
      const ea = batch_date_ranges?.[a]?.end || "";
      const eb = batch_date_ranges?.[b]?.end || "";
      if (ea !== eb) return ea.localeCompare(eb);
      return a.localeCompare(b);
    });

    // moduleTrainerMap[batch_no] = [{module_type, module_name, trainer_name}]
    const moduleTrainerMap = {};
    // overlapInfo[batch_no] = [{module_type, trainer, conflicts: [...]}]
    const overlapInfo = {};

    // Local booking tracker (includes newly assigned in this run)
    const localBookings = {};
    Object.keys(trainerBookings).forEach((tn) => {
      localBookings[tn] = [...trainerBookings[tn]];
    });

    for (const batchNo of sortedBatchNos) {
      const dateRange = batch_date_ranges?.[batchNo];
      if (!dateRange?.start || !dateRange?.end) {
        console.warn(`No date range for batch: ${batchNo}`);
        moduleTrainerMap[batchNo] = [];
        continue;
      }

      const { start: bStart, end: bEnd } = dateRange;
      const domain = inferDomain(batchNo);

      if (!domain) {
        console.warn(`Cannot infer domain for: ${batchNo}`);
        moduleTrainerMap[batchNo] = [];
        continue;
      }

      // Get all module types for this domain from course_module_template
      // Deduplicate by module_type — we assign one trainer per module_type
      const domainModules = (moduleTemplates || [])
        .filter((t) => normalize(t.domain) === normalize(domain))
        .reduce((acc, t) => {
          if (!acc.find((m) => m.module_type === t.module_type)) {
            acc.push({ module_name: t.module_name, module_type: t.module_type });
          }
          return acc;
        }, []);

      if (!domainModules.length) {
        console.warn(`No module templates found for domain: ${domain}`);
        moduleTrainerMap[batchNo] = [];
        continue;
      }

      moduleTrainerMap[batchNo] = [];

      // FIX 3: For each module_type, find an available trainer independently
      for (const mod of domainModules) {
        const { module_type, module_name } = mod;
        const eligible = getEligibleTrainersForModuleType(domain, module_type);

        if (!eligible.length) {
          console.warn(`No eligible trainers for domain ${domain}, module_type ${module_type}`);
          moduleTrainerMap[batchNo].push({
            module_type,
            module_name,
            trainer_name: "UNASSIGNED",
          });
          continue;
        }

        // Filter out trainers with date overlaps
        const available = eligible.filter((t) => {
          const bookings = localBookings[t.trainer_name] || [];
          return !bookings.some((b) => isOverlap(bStart, bEnd, b.start, b.end));
        });

        if (!available.length) {
          // All eligible trainers are busy — record conflict info
          if (!overlapInfo[batchNo]) overlapInfo[batchNo] = [];
          eligible.forEach((t) => {
            const conflicts = (localBookings[t.trainer_name] || []).filter((b) =>
              isOverlap(bStart, bEnd, b.start, b.end)
            );
            overlapInfo[batchNo].push({
              module_type,
              trainer: t.trainer_name,
              conflicts,
            });
          });

          moduleTrainerMap[batchNo].push({
            module_type,
            module_name,
            trainer_name: "UNASSIGNED",
          });
          continue;
        }

        // Among available, prefer trainer who finished their last batch earliest
        // (most idle trainer gets priority to balance workload)
        available.sort((a, b) => {
          const aBookings = localBookings[a.trainer_name] || [];
          const bBookings = localBookings[b.trainer_name] || [];
          const aLastEnd = aBookings.length
            ? aBookings.reduce((max, x) => (x.end > max ? x.end : max), "")
            : "";
          const bLastEnd = bBookings.length
            ? bBookings.reduce((max, x) => (x.end > max ? x.end : max), "")
            : "";

          if (!aLastEnd && !bLastEnd) return a.trainer_name.localeCompare(b.trainer_name);
          if (!aLastEnd) return -1;
          if (!bLastEnd) return 1;
          return aLastEnd.localeCompare(bLastEnd);
        });

        const selected = available[0];

        // Record the assignment
        moduleTrainerMap[batchNo].push({
          module_type,
          module_name,
          trainer_name: selected.trainer_name,
        });

        // Add to local bookings so subsequent batches see this trainer as booked
        if (!localBookings[selected.trainer_name]) {
          localBookings[selected.trainer_name] = [];
        }
        localBookings[selected.trainer_name].push({
          batch_no: batchNo,
          start: bStart,
          end: bEnd,
        });
      }
    }

    console.log("moduleTrainerMap:", JSON.stringify(moduleTrainerMap, null, 2));
    console.log("overlapInfo:", JSON.stringify(overlapInfo, null, 2));

    res.json({ moduleTrainerMap, overlapInfo });
  } catch (err) {
    console.error("get-batch-trainers-by-module error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ----------------------------------------------------------------
// POST /api/save-classroom-matrix
//
// FIX: Removed a_end from upsertData and from the existing-row
// comparison query. That column does not exist in classroom_occupancy
// and was causing Supabase errors that silently broke the save.
//
// occupancy_end (5m+2w from start) is what gets stored and used
// for all scheduling. a_end (original due date) is not persisted.
// ----------------------------------------------------------------
app.post("/api/save-classroom-matrix", async (req, res) => {
  try {
    const { occupancyRows } = req.body;
    if (!Array.isArray(occupancyRows) || !occupancyRows.length) {
      return res.status(400).json({ error: "occupancyRows required" });
    }

    const sortedRows = [...occupancyRows].sort((a, b) =>
      (a.occupancy_start || "").localeCompare(b.occupancy_start || "")
    );

    let inserted = 0, updated = 0, skipped = 0;

    for (const row of sortedRows) {
      const batch_no = row.batch_no?.trim();
      if (!batch_no || !row.occupancy_start) { skipped++; continue; }

      const occupancy_start = row.occupancy_start;

      // occupancy_end = 5m+2w window (sent from frontend or computed here)
      const occupancy_end =
        row.occupancy_end ||
        computeOccupancyEnd(occupancy_start);

      const enrolled       = Number(row.enrolled)  || 0;
      const capacity       = Number(row.capacity)  || enrolled;
      const classroom_name = row.classroom_name    || null;
      const slot           = row.slot              || null;

      // ── 1. classroom_occupancy ────────────────────────────────
      // NOTE: a_end deliberately excluded — column does not exist in table.
      const upsertData = {
        batch_no,
        classroom_name,
        slot,
        occupancy_start,
        occupancy_end,
        enrolled,
        capacity,
        class_room: classroom_name ? classroom_name.split(" ")[0] : null,
        shifts: slot === "morning" ? "Shift_1" : slot === "evening" ? "Shift_2" : null,
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from("classroom_occupancy")
        .select("id, occupancy_start, occupancy_end, enrolled, capacity, classroom_name, slot")
        .eq("batch_no", batch_no)
        .maybeSingle();

      if (existing) {
        const changed =
          existing.occupancy_start !== occupancy_start ||
          existing.occupancy_end   !== occupancy_end   ||
          existing.enrolled        !== enrolled        ||
          existing.capacity        !== capacity        ||
          existing.classroom_name  !== classroom_name  ||
          existing.slot            !== slot;

        if (changed) {
          const { error } = await supabase
            .from("classroom_occupancy")
            .update(upsertData)
            .eq("batch_no", batch_no);
          if (!error) updated++;
          else console.error("classroom_occupancy update error:", error);
        } else {
          skipped++;
        }
      } else {
        const { error } = await supabase
          .from("classroom_occupancy")
          .insert(upsertData);
        if (!error) inserted++;
        else console.error("classroom_occupancy insert error:", error);
      }

      // ── 2. batch_module_trainers ──────────────────────────────
      const moduleTrainers = row.module_trainers || [];
      for (const mt of moduleTrainers) {
        if (!mt.module_type) continue;
        const bmtData = {
          batch_no,
          module_name:     mt.module_name   || null,
          module_type:     mt.module_type,
          trainer_name:    mt.trainer_name  || "UNASSIGNED",
          trainer_email:   mt.trainer_email || null,
          occupancy_start,
          occupancy_end,
          updated_at: new Date().toISOString(),
        };
        const { error: bmtError } = await supabase
          .from("batch_module_trainers")
          .upsert(bmtData, { onConflict: "batch_no,module_type" });
        if (bmtError) {
          console.error(`batch_module_trainers upsert error [${batch_no}/${mt.module_type}]:`, bmtError);
        }
      }

      // ── 3. batch_trainer_conflicts ────────────────────────────
      const overlapInfoForBatch = row.overlap_info || [];
      if (overlapInfoForBatch.length > 0) {
        await supabase.from("batch_trainer_conflicts").delete().eq("batch_no", batch_no);
        const conflictInserts = [];
        overlapInfoForBatch.forEach((oi) => {
          if (oi.conflicts && oi.conflicts.length > 0) {
            oi.conflicts.forEach((c) => {
              conflictInserts.push({
                batch_no,
                module_type:       oi.module_type || null,
                trainer_name:      oi.trainer      || null,
                conflict_batch_no: c.batch_no      || null,
                conflict_start:    c.start         || null,
                conflict_end:      c.end           || null,
                updated_at: new Date().toISOString(),
              });
            });
          } else {
            conflictInserts.push({
              batch_no,
              module_type:       oi.module_type || null,
              trainer_name:      oi.trainer      || null,
              conflict_batch_no: null,
              conflict_start:    null,
              conflict_end:      null,
              updated_at: new Date().toISOString(),
            });
          }
        });
        if (conflictInserts.length > 0) {
          const { error: conflictError } = await supabase
            .from("batch_trainer_conflicts")
            .insert(conflictInserts);
          if (conflictError) {
            console.error(`batch_trainer_conflicts insert error [${batch_no}]:`, conflictError);
          }
        }
      } else {
        await supabase.from("batch_trainer_conflicts").delete().eq("batch_no", batch_no);
      }

      // ── 4. course_planner_data (backward compat) ──────────────
      const primaryTrainer = moduleTrainers.find(
        (mt) => mt.trainer_name && mt.trainer_name !== "UNASSIGNED"
      )?.trainer_name || row.trainer_name;

      if (primaryTrainer && primaryTrainer !== "UNASSIGNED") {
        await supabase
          .from("course_planner_data")
          .update({ trainer_name: primaryTrainer, trainer_status: "ASSIGNED", classroom_name })
          .eq("batch_no", batch_no);
      }
    }

    res.json({
      success: true,
      summary: { inserted, updated, skipped },
      totalProcessed: occupancyRows.length,
    });
  } catch (err) {
    console.error("save-classroom-matrix error:", err);
    res.status(500).json({ error: err.message });
  }
});



//get the trainers for the mapping to the batches
app.get("/api/trainer-mapping-data", async (req, res) => {
  try {
    const trainerRes = await pool.query(`
      SELECT trainer_name, trainer_email, trainer_domain, domain_handling, module_name
      FROM trainer_domain
    `);

    const templateRes = await pool.query(`
      SELECT domain, module_name, module_type
      FROM course_module_template
    `);

    res.json({
      trainers: trainerRes.rows,
      templates: templateRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch trainer mapping data" });
  }
});

// This endpoint looks up trainer assignments for batches
// from the course_planner_data table (batch-level source of truth)

app.post("/api/get-batch-trainers", async (req, res) => {
  try {
    const { batch_nos, batch_date_ranges } = req.body;

    if (!Array.isArray(batch_nos) || batch_nos.length === 0) {
      return res.status(400).json({ error: "batch_nos array required" });
    }

    const { data: trainerDomainData, error: tdError } = await supabase
      .from("trainer_domain")
      .select("trainer_name, trainer_email, trainer_domain, domain_handling, module_name");

    if (tdError) {
      console.error("trainer_domain fetch error:", tdError);
      return res.status(500).json({ error: tdError.message });
    }

    const { data: occupancyData, error: ocError } = await supabase
      .from("classroom_occupancy")
      .select("batch_no, occupancy_start, occupancy_end")
      .order("occupancy_start", { ascending: true });

    if (ocError) {
      console.error("classroom_occupancy fetch error:", ocError);
      return res.status(500).json({ error: ocError.message });
    }

    // Get trainer assignments for already-saved batches (not in current upload)
    const savedBatchNos = (occupancyData || [])
      .map((r) => r.batch_no)
      .filter((bn) => bn && !batch_nos.includes(bn));

    let existingTrainerAssignments = [];
    if (savedBatchNos.length > 0) {
      const { data: cpData, error: cpError } = await supabase
        .from("course_planner_data")
        .select("batch_no, trainer_name")
        .in("batch_no", savedBatchNos)
        .not("trainer_name", "is", null)
        .neq("trainer_name", "");

      if (!cpError && cpData) {
        existingTrainerAssignments = cpData;
      }
    }

    // Build existing batch->trainer map for saved batches
    const savedBatchTrainerMap = {};
    existingTrainerAssignments.forEach((row) => {
      if (row.batch_no && row.trainer_name && !savedBatchTrainerMap[row.batch_no]) {
        savedBatchTrainerMap[row.batch_no] = row.trainer_name;
      }
    });

    // Build trainerBookings from already-saved occupancy data
    const trainerBookings = {};
    (occupancyData || []).forEach((row) => {
      if (!row.batch_no || batch_nos.includes(row.batch_no)) return;
      const trainerName = savedBatchTrainerMap[row.batch_no];
      if (!trainerName) return;
      if (!trainerBookings[trainerName]) trainerBookings[trainerName] = [];
      trainerBookings[trainerName].push({
        batch_no: row.batch_no,
        start: row.occupancy_start,
        end: row.occupancy_end,
      });
    });

    const normalize = (str) => (str || "").toString().toLowerCase().trim();

    const isOverlap = (s1, e1, s2, e2) => {
      if (!s1 || !e1 || !s2 || !e2) return false;
      return new Date(s1) <= new Date(e2) && new Date(s2) <= new Date(e1);
    };

    const inferDomain = (batchNo) => {
      const up = (batchNo || "").toUpperCase();
      if (up.startsWith("DFTFT") || up.startsWith("DFT")) return "DFT";
      if (up.startsWith("DVFT") || up.startsWith("DV")) return "DV";
      if (up.startsWith("PDFT") || up.startsWith("PD")) return "PD";
      return "";
    };

    const getEligibleTrainers = (domain) => {
      const norm = normalize(domain);
      const trainerSet = new Map();
      (trainerDomainData || []).forEach((t) => {
        if (
          normalize(t.trainer_domain) === norm ||
          normalize(t.domain_handling) === norm
        ) {
          if (!trainerSet.has(t.trainer_name)) {
            trainerSet.set(t.trainer_name, {
              trainer_name: t.trainer_name,
              trainer_email: t.trainer_email,
            });
          }
        }
      });
      return Array.from(trainerSet.values());
    };

    // ✅ KEY: Sort batches strictly by start date ascending before assigning
    const sortedBatchNos = [...batch_nos].sort((a, b) => {
      const sa = batch_date_ranges?.[a]?.start || "";
      const sb = batch_date_ranges?.[b]?.start || "";
      if (sa !== sb) return sa.localeCompare(sb);
      // Secondary sort: end date ascending
      const ea = batch_date_ranges?.[a]?.end || "";
      const eb = batch_date_ranges?.[b]?.end || "";
      if (ea !== eb) return ea.localeCompare(eb);
      // Tertiary: batch name
      return a.localeCompare(b);
    });

    const trainerMap = {};
    const overlapInfo = {};

    // Clone existing bookings into local tracker
    const localBookings = {};
    Object.keys(trainerBookings).forEach((tn) => {
      localBookings[tn] = [...trainerBookings[tn]];
    });

    for (const batchNo of sortedBatchNos) {
      const dateRange = batch_date_ranges?.[batchNo];

      if (!dateRange?.start || !dateRange?.end) {
        console.warn(`No date range for batch: ${batchNo}`);
        trainerMap[batchNo] = null;
        continue;
      }

      const { start: bStart, end: bEnd } = dateRange;
      const domain = inferDomain(batchNo);

      if (!domain) {
        console.warn(`Cannot infer domain for: ${batchNo}`);
        trainerMap[batchNo] = null;
        continue;
      }

      const eligible = getEligibleTrainers(domain);

      if (!eligible.length) {
        console.warn(`No eligible trainers for domain: ${domain}`);
        trainerMap[batchNo] = null;
        continue;
      }

      // Filter out trainers with overlapping bookings
      const available = eligible.filter((t) => {
        const bookings = localBookings[t.trainer_name] || [];
        return !bookings.some((b) => isOverlap(bStart, bEnd, b.start, b.end));
      });

      if (!available.length) {
        overlapInfo[batchNo] = eligible.map((t) => ({
          trainer: t.trainer_name,
          conflicts: (localBookings[t.trainer_name] || []).filter((b) =>
            isOverlap(bStart, bEnd, b.start, b.end)
          ),
        }));
        trainerMap[batchNo] = null;
        continue;
      }

      // ✅ KEY: Among available trainers, prefer who finished their last batch earliest
      available.sort((a, b) => {
        const aBookings = localBookings[a.trainer_name] || [];
        const bBookings = localBookings[b.trainer_name] || [];

        const aLastEnd = aBookings.length
          ? aBookings.reduce((max, x) => (x.end > max ? x.end : max), "")
          : "";
        const bLastEnd = bBookings.length
          ? bBookings.reduce((max, x) => (x.end > max ? x.end : max), "")
          : "";

        // No bookings = most idle = highest priority
        if (!aLastEnd && !bLastEnd) return a.trainer_name.localeCompare(b.trainer_name);
        if (!aLastEnd) return -1;
        if (!bLastEnd) return 1;
        return aLastEnd.localeCompare(bLastEnd);
      });

      const selected = available[0];
      trainerMap[batchNo] = selected.trainer_name;

      if (!localBookings[selected.trainer_name]) {
        localBookings[selected.trainer_name] = [];
      }
      localBookings[selected.trainer_name].push({
        batch_no: batchNo,
        start: bStart,
        end: bEnd,
      });
    }

    console.log("trainerMap:", trainerMap);
    console.log("overlapInfo:", overlapInfo);

    res.json({ trainerMap, overlapInfo });
  } catch (err) {
    console.error("get-batch-trainers error:", err);
    res.status(500).json({ error: err.message });
  }
});


//TRAINER ASSIGNMENT + CLASSROOM FLOW
app.post("/api/plan-with-trainers", async (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ error: "Invalid rows input" });
    }

    const trainerRes = await supabase.from("trainer_domain").select("*");
    if (trainerRes.error) return res.status(500).json({ error: trainerRes.error.message });

    const templateRes = await supabase.from("course_module_template").select("*");
    if (templateRes.error) return res.status(500).json({ error: templateRes.error.message });

    const trainers = trainerRes.data || [];
    const templates = templateRes.data || [];

    const normalize = (str) =>
      (str || "").toString().toLowerCase().replace(/\s+/g, " ").trim();

    const isOverlap = (s1, e1, s2, e2) => {
      if (!s1 || !e1 || !s2 || !e2) return false;
      return new Date(s1) <= new Date(e2) && new Date(s2) <= new Date(e1);
    };

    // Build batch date ranges from rows
    const batchRanges = {};
    rows.forEach((originalRow) => {
      const row = {};
      Object.keys(originalRow).forEach((k) => {
        row[k.toLowerCase().trim()] = originalRow[k];
      });
      const batchNo = row["batch_no"] || row["course"] || "";
      const date = String(row["date"] || "");
      if (!batchNo || !date) return;
      if (!batchRanges[batchNo]) {
        batchRanges[batchNo] = {
          start: date,
          end: date,
          domain: normalize(row["domain"] || ""),
        };
      } else {
        if (date < batchRanges[batchNo].start) batchRanges[batchNo].start = date;
        if (date > batchRanges[batchNo].end) batchRanges[batchNo].end = date;
      }
    });

    // ✅ KEY: Sort rows by date ascending so earlier dates get assigned first
    const sortedRows = [...rows].sort((a, b) => {
      const da = String(a["date"] || a["Date"] || "");
      const db = String(b["date"] || b["Date"] || "");
      if (da !== db) return da.localeCompare(db);
      // Secondary: batch_no
      const ba = String(a["batch_no"] || a["COURSE"] || "");
      const bb = String(b["batch_no"] || b["COURSE"] || "");
      return ba.localeCompare(bb);
    });

    // trainerName -> [{batch_no, start, end}]
    const trainerBatchBookings = {};
    // batchNo -> assigned trainer (one trainer per full batch)
    const batchTrainerAssignment = {};

    const assignedRows = [];

    for (const originalRow of sortedRows) {
      const row = {};
      Object.keys(originalRow).forEach((key) => {
        row[key.toLowerCase().trim()] = originalRow[key];
      });

      const mode = normalize(row["mode"]);
      if (mode !== "offline") {
        assignedRows.push({
          ...originalRow,
          trainer_name: null,
          trainer_status: "NOT_REQUIRED",
        });
        continue;
      }

      const batchDomain = normalize(row["domain"]);
      const moduleName = normalize(row["module_name"] || row["module name"]);
      const batchNo = row["batch_no"] || row["course"] || "";
      const currentDate = row["date"];

      if (!batchDomain || !moduleName || !currentDate || !batchNo) {
        assignedRows.push({
          ...originalRow,
          trainer_name: null,
          trainer_status: "INVALID_ROW",
        });
        continue;
      }

      // Reuse already-assigned trainer for this batch
      if (batchTrainerAssignment[batchNo]) {
        const assignedTrainer = trainers.find(
          (t) => t.trainer_name === batchTrainerAssignment[batchNo]
        );
        assignedRows.push({
          ...originalRow,
          trainer_name: batchTrainerAssignment[batchNo],
          trainer_email: assignedTrainer?.trainer_email || null,
          trainer_status: "ASSIGNED",
        });
        continue;
      }

      // Find template to determine module_type
      const template = templates.find(
        (t) =>
          normalize(t.domain) === batchDomain &&
          normalize(t.module_name) === moduleName
      );

      if (!template) {
        assignedRows.push({
          ...originalRow,
          trainer_name: null,
          trainer_status: "NO_TEMPLATE",
        });
        continue;
      }

      const moduleType = template.module_type;

      // Find eligible trainers by module type rule
      let eligible = [];
      if (moduleType === "CORE_THEORY" || moduleType === "CORE_LAB") {
        eligible = trainers.filter(
          (t) =>
            normalize(t.trainer_domain) === batchDomain &&
            normalize(t.module_name) === moduleName
        );
      } else {
        // BASIC
        eligible = trainers.filter(
          (t) =>
            normalize(t.domain_handling) === batchDomain &&
            normalize(t.module_name) === moduleName
        );
      }

      // Deduplicate by trainer_name
      const seen = new Set();
      eligible = eligible.filter((t) => {
        if (seen.has(t.trainer_name)) return false;
        seen.add(t.trainer_name);
        return true;
      });

      const batchStart = batchRanges[batchNo]?.start;
      const batchEnd = batchRanges[batchNo]?.end;

      // Filter overlapping trainers
      const available = eligible.filter((t) => {
        const bookings = trainerBatchBookings[t.trainer_name] || [];
        return !bookings.some((b) => isOverlap(batchStart, batchEnd, b.start, b.end));
      });

      if (!available.length) {
        assignedRows.push({
          ...originalRow,
          trainer_name: null,
          trainer_status: "NOT_AVAILABLE",
        });
        continue;
      }

      // Prefer trainer who finished last batch earliest
      available.sort((a, b) => {
        const aBookings = trainerBatchBookings[a.trainer_name] || [];
        const bBookings = trainerBatchBookings[b.trainer_name] || [];
        const aLastEnd = aBookings.length
          ? aBookings.reduce((max, x) => (x.end > max ? x.end : max), "")
          : "";
        const bLastEnd = bBookings.length
          ? bBookings.reduce((max, x) => (x.end > max ? x.end : max), "")
          : "";
        if (!aLastEnd && !bLastEnd) return a.trainer_name.localeCompare(b.trainer_name);
        if (!aLastEnd) return -1;
        if (!bLastEnd) return 1;
        return aLastEnd.localeCompare(bLastEnd);
      });

      const selected = available[0];

      batchTrainerAssignment[batchNo] = selected.trainer_name;
      if (!trainerBatchBookings[selected.trainer_name]) {
        trainerBatchBookings[selected.trainer_name] = [];
      }
      trainerBatchBookings[selected.trainer_name].push({
        batch_no: batchNo,
        start: batchStart,
        end: batchEnd,
      });

      assignedRows.push({
        ...originalRow,
        trainer_name: selected.trainer_name,
        trainer_email: selected.trainer_email,
        trainer_status: "ASSIGNED",
      });
    }

    res.json({ assignedRows });
  } catch (err) {
    console.error("PLAN TRAINER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});



// ✅ GET holidays for current year (no query param needed)
app.get("/api/holidays", async (req, res) => {
  try {
    const year = Number(req.query.year) || getCurrentYear(); // fallback to current year
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    console.log(`GET /api/holidays?year=${year} → ${from} to ${to}`);

    const { data, error } = await supabase
      .from("holidays")
      .select("id, holiday_date, name, type")
      .gte("holiday_date", from)
      .lte("holiday_date", to)
      .order("holiday_date", { ascending: true });

    if (error) {
      console.error("GET /api/holidays error:", error);
      return res.status(200).json([]);
    }

    console.log(`Found ${data?.length || 0} holidays for ${year}`);
    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error("GET /api/holidays crash:", err);
    return res.status(200).json([]);
  }
});

// POST /api/holidays/upload
app.post("/api/holidays/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File is required" });
    }

    const currentYear = new Date().getFullYear();
    console.log(`POST /api/holidays/upload for year ${currentYear}`);

    const ext = req.file.originalname.split(".").pop().toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: "Only .xlsx, .xls or .csv files are supported" });
    }

    // Read as RAW array of arrays (bypass xlsx date parsing)
    const workbook = xlsx.readFile(req.file.path, { dateNF: "YYYY-MM-DD" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { 
      header: 1, 
      raw: false,  // ✅ Parse numbers as dates safely
      defval: "",
      dateNF: "dd-mmm-yyyy"  // ✅ Force Excel date format
    });

    // Your format: Row 0=header, Row 1+=data
    // Col0=Date, Col1=Day, Col2=Holiday, Col3=Type of Holiday
    const dateIdx = 0;  // Fixed: col0
    const nameIdx = 2;  // Fixed: col2  
    const typeIdx = 3;  // Fixed: col3

    const startRow = 1; // Skip header
    const toUpsert = [];
    const skipped = [];

    for (let i = startRow; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;

      // ✅ ROBUST DATE PARSING (handles Excel serials, corrupted dates)
      let dateRaw = r[dateIdx];
      let dateISO = null;

      // Case 1: Already ISO or valid date
      if (dateRaw && /^\d{4}-\d{2}-\d{2}/.test(String(dateRaw))) {
        dateISO = String(dateRaw).slice(0, 10);
      }
      // Case 2: Excel date serial → convert to ISO
      else if (typeof dateRaw === "number" && dateRaw > 0) {
        const excelEpoch = new Date(1899, 11, 30); // Excel epoch
        const jsDate = new Date(excelEpoch.getTime() + dateRaw * 86400000);
        dateISO = jsDate.toISOString().slice(0, 10);
      }
      // Case 3: "DD-MMM" → add current year
      else if (typeof dateRaw === "string") {
        const raw = String(dateRaw).trim();
        const m1 = raw.match(/^(\d{1,2})\s*-\s*([A-Za-z]{3})(?:\s*-?\s*(\d{4}))?$/i);
        if (m1) {
          const dd = m1[1].padStart(2, "0");
          const monStr = m1[2];
          const yyyy = m1[3] || currentYear;
          const monthIndex = new Date(`${monStr} 1, ${yyyy}`).getMonth();
          if (!Number.isNaN(monthIndex)) {
            const dt = new Date(Number(yyyy), monthIndex, Number(dd));
            if (!Number.isNaN(dt.getTime())) {
              dateISO = dt.toISOString().slice(0, 10);
            }
          }
        }
      }

      const name = String(r[nameIdx] || "").trim();
      const type = String(r[typeIdx] || "").trim();

      if (!dateISO || !name) {
        skipped.push({ row: i + 1, dateRaw, name, type, reason: "invalid date/name" });
        continue;
      }

      toUpsert.push({
        holiday_date: dateISO,
        name: name.slice(0, 255), // DB safety
        type: (type || "Holiday").slice(0, 100),
      });

      console.log(`✅ Row ${i + 1}: ${dateISO} | ${name} | ${type}`);
    }

    // Cleanup
    try { fs.unlinkSync(req.file.path); } catch {}

    if (!toUpsert.length) {
      return res.status(400).json({ 
        error: `No valid rows found. Skipped: ${skipped.length}`,
        skipped 
      });
    }

    // Upsert (update existing dates)
    const { data, error, count } = await supabase
      .from("holidays")
      .upsert(toUpsert, { onConflict: "holiday_date" })
      .select();

    if (error) {
      console.error("Upsert error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: `✅ Saved ${toUpsert.length} holidays for ${currentYear}`,
      count: count || 0,
      skipped: skipped.length ? skipped : undefined,
    });
  } catch (err) {
    console.error("POST /api/holidays/upload CRASH:", err);
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(500).json({ error: "Server error: " + err.message });
  }
});


// Get trainers for dropdown
app.get("/api/trainers", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("internal_users")
      .select("id, name, email, role")
      .eq("role", "Trainer")
      .order("name", { ascending: true });

    if (error) {
      console.error("GET /api/trainers error:", error);
      return res.status(200).json([]); // avoid frontend console 500s
    }

    const trainers = (data || []).map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
    }));

    return res.status(200).json(trainers);
  } catch (err) {
    console.error("GET /api/trainers crash:", err);
    return res.status(200).json([]);
  }
});

// =============================== UNAVAILABILITY REQUESTS - FIXED
// Provides GET /api/unavailability-requests
// ===============================
app.get("/api/unavailability-requests", async (req, res) => {
  try {
    // 1) Get all requests
    const { data: reqs, error: reqErr } = await supabase
      .from("trainer_unavailability")
      .select("id, trainer_email, trainer_name, domain, start_date, end_date, reason, status, batch_nos, submitted_at")
      .order("submitted_at", { ascending: false });

    if (reqErr) {
      console.error("GET /api/unavailability-requests error:", reqErr);
      return res.status(200).json([]); // avoid 404/500 in UI
    }

    // 2) Get trainers lookup for trainer_id enrichment
    const { data: trainers, error: trErr } = await supabase
      .from("internal_users")
      .select("id, email")
      .eq("role", "Trainer");

    if (trErr) {
      console.error("GET trainers lookup error:", trErr);
      // still return requests without trainer_id
    }

    const emailToId = new Map((trainers || []).map((t) => [String(t.email || "").toLowerCase(), t.id]));

    const out = (reqs || []).map((r) => {
      const email = String(r.traineremail || "").toLowerCase();
      return {
        id: r.id,
        trainer_id: emailToId.get(email) || null,
        trainer_name: r.trainer_name || (r.traineremail ? r.traineremail.split("@")[0] : ""),
        trainer_email: r.trainer_email || "",
        domain: r.domain || "",
        start_date: r.start_date,
        end_date: r.end_date || r.start_date,
        leave_type: r.reason || "", // your UI checks leave_type/reason keywords
        reason: r.reason || "",
        status: r.status || "Pending",
      };
    });

    return res.status(200).json(out);
  } catch (err) {
    console.error("GET /api/unavailability-requests crash:", err);
    return res.status(200).json([]);
  }
});


//===Load the domain progress ===
app.get('/api/course-progress', async (req, res) => {
  const { domain, batch_no } = req.query;

  if ((domain && batch_no) || (!domain && !batch_no)) {
    return res.status(400).json({ error: 'Provide either domain or batch_no, not both or none' });
  }

  try {
    // Helper function to fetch progress data for a single batch_no
    async function getBatchProgress(bno) {
      // Trainer names (unchanged)
      const { data: trainers, error: trainerErr } = await supabase
        .from('course_planner_data')
        .select('trainer_name')
        .eq('batch_no', bno);
      if (trainerErr) throw new Error(trainerErr.message);

      const trainerNames = [...new Set(trainers.map(t => t.trainer_name))].filter(Boolean);

      // Learners count (unchanged)
      const { error: learnerErr, count: learnerCount } = await supabase
        .from('learners_data')
        .select('*', { count: 'exact', head: true })
        .eq('batch_no', bno);
      if (learnerErr) throw new Error(learnerErr.message);

      // FULL topic info
      const { data: plannerRows, error: plannerErr } = await supabase
        .from('course_planner_data')
        .select('batch_no, topic_name, date, topic_status, remarks')
        .eq('batch_no', bno)
        .order('date', { ascending: true });
      if (plannerErr) throw new Error(plannerErr.message);

      // Calculate counts as before
      const topicStatusCounts = plannerRows.reduce((counts, row) => {
        if (row.topic_status) {
          counts[row.topic_status] = (counts[row.topic_status] || 0) + 1;
        }
        return counts;
      }, {});

      // Find start/end dates (unchanged)
      const dates = plannerRows.map(r => r.date).filter(Boolean);
      const startDate = dates.length ? dates[0] : null;
      const endDate = dates.length ? dates[dates.length - 1] : null;

      return {
        batch_no: bno,
        trainer_names: trainerNames,
        total_learners: learnerCount || 0,
        start_date: startDate,
        end_date: endDate,
        topic_status_counts: topicStatusCounts,
        topics: plannerRows // array of topic details for frontend filtering
      };
    }

    if (domain) {
      // Scenario 1: For domain, find batches and fetch progress for each
      const { data: batches, error: batchErr } = await supabase
        .from('course_planner_data')
        .select('batch_no')
        .eq('domain', domain);

      if (batchErr) return res.status(500).json({ error: batchErr.message });

      const batchNos = [...new Set(batches.map(b => b.batch_no))].filter(Boolean);

      const allBatchesData = await Promise.all(batchNos.map(bno => getBatchProgress(bno)));

      return res.json({ domain, batches: allBatchesData });

    } else {
      // Scenario 2: For single batch_no return its progress
      const progress = await getBatchProgress(batch_no);
      return res.json(progress);
    }
  } catch (err) {
    console.error("Course progress API error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get course progress data for batch_no
app.get('/api/course-progress/:batch_no', async (req, res) => {
  const batch_no = req.params.batch_no;
  if (!batch_no) return res.status(400).json({ error: "Batch No is required" });

  try {
    // Get distinct trainer names for batch
    const { data: trainers, error: trainerErr } = await supabase
      .from('course_planner_data')
      .select('trainer_name')
      .eq('batch_no', batch_no);
    if (trainerErr) return res.status(500).json({ error: trainerErr.message });

    const trainerNames = [...new Set(trainers.map(t => t.trainer_name))].filter(Boolean);

    // Get total learners count efficiently
    const { error: learnerErr, count } = await supabase
      .from('learners_data')
      .select('*', { count: "exact", head: true })
      .eq('batch_no', batch_no);
    if (learnerErr) return res.status(500).json({ error: learnerErr.message });
    const totalLearners = count || 0;

    // Get course planner rows to extract dates and topic statuses
    const { data: plannerRows, error: plannerErr } = await supabase
      .from('course_planner_data')
      .select('date, topic_status')
      .eq('batch_no', batch_no)
      .order('date', { ascending: true });
    if (plannerErr) return res.status(500).json({ error: plannerErr.message });

    const dates = plannerRows.map(r => r.date).filter(Boolean);
    const startDate = dates.length ? dates[0] : null;
    const endDate = dates.length ? dates[dates.length - 1] : null;

    const topicStatusCounts = plannerRows.reduce((counts, row) => {
      if (row.topic_status) {
        counts[row.topic_status] = (counts[row.topic_status] || 0) + 1;
      }
      return counts;
    }, {});

    res.json({
      batch_no,
      trainer_names: trainerNames,
      total_learners: totalLearners,
      start_date: startDate,
      end_date: endDate,
      topic_status_counts: topicStatusCounts,
    });
  } catch (err) {
    console.error("Course progress error:", err);
    res.status(500).json({ error: err.message });
  }
});

// New API: Get templates filtered by mode
app.get("/api/templates", async (req, res) => {
  try {
    const mode = req.query.mode;
    if (!mode || !["Online", "Offline"].includes(mode)) {
      return res.status(400).json({ error: "Invalid or missing mode parameter" });
    }
    const { data: templates, error } = await supabase
      .from("email_templates")
      .select("template_name")
      .eq("mode", mode)
      .eq("active", true)
      .order("template_name", { ascending: true });

    if (error) {
      console.error("Error fetching templates:", error);
      return res.status(500).json({ error: "Failed to fetch templates" });
    }
    if (!templates || templates.length === 0) {
      return res.status(404).json({ error: "No templates found for selected mode" });
    }

    res.json(templates);
  } catch (error) {
    console.error("Unexpected error fetching templates:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Full email templates (subject/body/offset/send_time) for the Home Dashboard
// schedule editor. Filtered exactly like /api/schedule-email so what you edit
// is what gets scheduled. Returns [] (200) when none exist.
app.get("/api/email-templates", async (req, res) => {
  try {
    const { mode, batch_type } = req.query;
    if (!mode || !["Online", "Offline"].includes(mode)) {
      return res.status(400).json({ error: "Invalid or missing mode parameter" });
    }

    let query = supabase
      .from("email_templates")
      .select("id, template_name, subject, body_html, offset_days, send_time, mode, batch_type, active")
      .eq("mode", mode)
      .eq("active", true);

    if (mode === "Offline") {
      if (!batch_type) {
        return res.status(400).json({ error: "batch_type is required for Offline mode" });
      }
      query = query.eq("batch_type", batch_type);
    } else {
      query = query.is("batch_type", null);
    }

    const { data, error } = await query
      .order("offset_days", { ascending: true })
      .order("template_name", { ascending: true });

    if (error) {
      console.error("Error fetching full email templates:", error);
      return res.status(500).json({ error: "Failed to fetch templates" });
    }
    res.json(data || []);
  } catch (error) {
    console.error("Unexpected error fetching full email templates:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Express + Supabase (ESM syntax)
// === Login API ===
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const lookupEmail = email ? email.toLowerCase().trim() : '';

    if (!lookupEmail || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password required'
      });
    }

    // 1) Find user in internal_users table
    const { data: users, error: dbError } = await supabase
      .from('internal_users')
      .select('id, name, email, role, password_hash, is_active')
      .eq('email', lookupEmail);

    if (dbError) {
      console.error('DB error in /api/login:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Database error'
      });
    }

    if (!users || users.length === 0) {
      console.log('Login failed: no user found for', lookupEmail);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const user = users[0];

    // 2) Check if user is active
    if (user.is_active === false) {
      console.log('Login failed: inactive user', lookupEmail);
      return res.status(401).json({
        success: false,
        error: 'User account is inactive. Contact administrator.'
      });
    }

    // 3) Check password (supports both plain text and bcrypt-hashed passwords)
    let passwordMatch = false;
    if (user.password_hash) {
      if (user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2a$')) {
        // Password is bcrypt-hashed
        passwordMatch = await bcrypt.compare(password, user.password_hash);
      } else {
        // Password is plain text
        passwordMatch = (password === user.password_hash);
      }
    }
    if (!passwordMatch) {
      console.log('Login failed: wrong password for', lookupEmail);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // 4) Generate secure JWT token (base64 encoded payload)
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: (user.role || '').toString().toLowerCase(),
      name: user.name || '',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // 7 days
    };

    const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

    console.log('Login successful for:', lookupEmail, 'role:', user.role);

    // 5) Return success response (matches frontend expectation)
    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name || user.email,
        email: user.email,
        role: (user.role || '').toString().toLowerCase()
      }
    });

  } catch (err) {
    console.error('Unexpected /api/login error:', err);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});


//=== Reset password ===
app.post('/api/reset-password', async (req, res) => {
  const { email, new_password } = req.body;

  if (!email || !new_password) {
    return res.status(400).json({ error: 'Missing email or new_password' });
  }

  try {
    const { error } = await supabase
      .from('internal_users')
      .update({ password_hash: new_password })  // correct column name
      .eq('email', email);

    if (error) {
      console.error('Error resetting password:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, message: 'Password reset successful.' });
  } catch (err) {
    console.error('Exception resetting password:', err);
    return res.status(500).json({ error: err.message });
  }
});

//=== Get the domains ===
app.get("/api/get_domains", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("course_planner_data")
      .select("domain", { count: "exact", head: false })
      .neq("domain", null)
      .neq("domain", "");

    if (error) throw error;

    // Extract unique domains
    const uniqueDomainsSet = new Set(data.map((row) => row.domain));
    const uniqueDomains = Array.from(uniqueDomainsSet);

    res.json(uniqueDomains);
  } catch (err) {
    console.error("Error fetching domains:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//=== Get the batches by domain ===
app.get("/api/get_batches_by_domain", async (req, res) => {
  try {
    const domain = req.query.domain;
    if (!domain) return res.status(400).json({ error: "Domain is required" });

    // Fetch from course_planner_data
    const { data: plannerData, error: plannerError } = await supabase
      .from("course_planner_data")
      .select("batch_no")
      .eq("domain", domain)
      .neq("batch_no", null);

    if (plannerError) throw plannerError;

    const batchSet = new Set(plannerData.map((row) => row.batch_no).filter(Boolean));

    // Also fetch from learners_data to include batches not yet in planner
    const { data: learnerData, error: learnerError } = await supabase
      .from("learners_data")
      .select("batch_no")
      .neq("batch_no", null);

    if (!learnerError && learnerData) {
      for (const row of learnerData) {
        if (row.batch_no) batchSet.add(row.batch_no);
      }
    }

    const batches = Array.from(batchSet).sort();

    res.json(batches);
  } catch (err) {
    console.error("Error fetching batches:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//=== Get the learners data ===
app.get("/api/get_learners", async (req, res) => {
  try {
    const batch_no = req.query.batch_no;
    if (!batch_no) return res.status(400).json({ error: "Batch number is required" });

    const { data, error } = await supabase
      .from("learners_data")
      .select("name, email, batch_no, status")
      .eq("batch_no", batch_no);

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error("Error fetching learners:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// GET assessments by batch and type
app.get('/api/assessments/:batchNo/:assessmentType', async (req, res) => {
  try {
    const { batchNo, assessmentType } = req.params;

    // ── 1. Determine which scores table to query ──────────────────────────────
    let tableName;
    switch (assessmentType.toLowerCase()) {
      case 'weekly':
        tableName = 'weekly_assessment_scores';
        break;
      case 'intermediate':
        tableName = 'intermediate_assessment_scores';
        break;
      case 'module':
        tableName = 'module_level_assessment_scores';
        break;
      case 'final':                          // ← NEW
        tableName = 'final_assessment_scores';
        break;
      default:
        return res.status(400).json({ error: 'Invalid assessment type' });
    }

    // ── 2. Fetch raw scores ───────────────────────────────────────────────────
    const { data: scores, error: scoresErr } = await supabase
      .from(tableName)
      .select('*')
      .eq('batch_no', batchNo)
      .order('learner_id')
      .order('assessment_date', { ascending: false });

    if (scoresErr) {
      console.error(`[assessments] ${tableName} error:`, scoresErr);
      return res.status(500).json({ error: scoresErr.message });
    }

    if (!scores || scores.length === 0) {
      return res.json({ data: [] });
    }

    // ── 3. Collect unique learner_ids and course_planner_ids ─────────────────
    const learnerIds   = [...new Set(scores.map(r => r.learner_id).filter(Boolean))];
    const plannerIds   = [...new Set(scores.map(r => r.course_planner_id).filter(Boolean))];

    // ── 4. Fetch learner names in one batch query ─────────────────────────────
    let learnerMap = {};   // { learner_id → { name, email } }
    if (learnerIds.length > 0) {
      const { data: learners, error: learnersErr } = await supabase
        .from('learners_data')
        .select('id, name, email')
        .in('id', learnerIds);

      if (learnersErr) {
        console.error('[assessments] learners lookup error:', learnersErr);
      } else {
        (learners || []).forEach(l => {
          learnerMap[l.id] = { name: l.name || '', email: l.email || '' };
        });
      }
    }

    // ── 5. Fetch topic names in one batch query ───────────────────────────────
    let plannerMap = {};   // { course_planner_id → topic_name }
    if (plannerIds.length > 0) {
      const { data: plannerRows, error: plannerErr } = await supabase
        .from('course_planner_data')
        .select('id, topic_name')
        .in('id', plannerIds);

      if (plannerErr) {
        console.error('[assessments] planner lookup error:', plannerErr);
      } else {
        (plannerRows || []).forEach(p => {
          plannerMap[p.id] = p.topic_name || '';
        });
      }
    }

    // ── 6. Enrich each row; omit course_planner_id from output ───────────────
    const enriched = scores.map(row => {
      const learner   = learnerMap[row.learner_id]         || {};
      const topicName = plannerMap[row.course_planner_id]  || row.assessment_name || '';

      // Build the output object — deliberately exclude course_planner_id and learner_id
      const out = {
        learner_name:    learner.name  || String(row.learner_id),
        learner_email:   learner.email || '',
        batch_no:        row.batch_no,
        assessment_date: row.assessment_date,
        topic_name:      topicName,
        out_off:         row.out_off,
        points:          row.points,
        percentage:      row.percentage,
      };

      // Include week_no or module_no only if present in the source row
      if (row.week_no   !== undefined && row.week_no   !== null) out.week_no   = row.week_no;
      if (row.module_no !== undefined && row.module_no !== null) out.module_no = row.module_no;

      return out;
    });

    return res.json({ data: enriched });

  } catch (err) {
    console.error('[assessments] unexpected error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Download CSV
app.get('/api/download/csv/:batchNo/:assessmentType', async (req, res) => {
  try {
    const { batchNo, assessmentType } = req.params;
    
    // Fetch data (same logic as above)
    let query;
    switch (assessmentType.toLowerCase()) {
      case 'weekly':
        query = supabase.from('weekly_assessment_scores').select('*').eq('batch_no', batchNo);
        break;
      case 'intermediate':
        query = supabase.from('intermediate_assessment_scores').select('*').eq('batch_no', batchNo);
        break;
      case 'module':
        query = supabase.from('module_level_assessment_scores').select('*').eq('batch_no', batchNo);
        break;
    }

    const { data } = await query;
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Assessments');
    
    const filename = `assessments_${batchNo}_${assessmentType}_${Date.now()}.xlsx`;
    const filepath = path.join(__dirname, 'downloads', filename);
    
    XLSX.writeFile(wb, filepath);
    
    res.json({ downloadUrl: `/downloads/${filename}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// SCORECARD API - FULLY FIXED
// JOINs final_assessment_scores → course_planner_data to resolve topic_name
// All marks converted to /100 before weightage
// Weightage: Intermediate 10% | Theory(D+C+T) 20% | Physical 30% | Project 30% | Viva 10%
// ==============================
// ==============================
// SCORECARD OVERRIDES — Admin / Manager / Coordinator edits
//
// Purely additive layer: the calculations below are untouched. Any saved
// override is merged on top of the computed row and the derived fields
// (group %, Overall %, Grade, Certification, Placement) are recalculated
// from the merged component percentages.
//
// Required table (run once in Supabase):
//   create table if not exists scorecard_overrides (
//     id            bigserial   primary key,
//     batch_no      text        not null,
//     learner_email text        not null,
//     overrides     jsonb       not null default '{}'::jsonb,
//     remarks       text        not null,
//     edited_by     text,
//     edited_at     timestamptz not null default now(),
//     unique (batch_no, learner_email)
//   );
// ==============================

/* Tolerates the "Corrdinator" typo that exists in the internal_users table. */
const SCORECARD_EDIT_ROLES = ["admin", "manager", "coordinator", "corrdinator"];

/* Component marks that may be overridden, per scorecard flavour. Group
 * averages, Overall % and Grade are always re-derived, never stored. */
const SCORECARD_OVERRIDE_FIELDS = {
  pdft: ["intermediate", "digital", "cmos", "tcl", "physical", "project", "viva", "certification", "placement"],
  dvft: ["intermediate", "digital", "verilog", "sv", "uvm", "python", "project", "viva", "certification", "placement"],
};
const SCORECARD_YESNO_FIELDS = ["certification", "placement"];
const SCORECARD_TOP_FIELDS   = ["intermediate", "project", "viva"];

const scNum   = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
const scGrade = (o) => (o >= 90 ? "A" : o >= 80 ? "B" : o >= 70 ? "C" : o >= 60 ? "D" : "F");

/* Re-derives group %, Overall %, Grade, Certification and Placement from a set
 * of component percentages. `weights` carries the original out_off totals per
 * theory subject (PDFT) so an unedited row reproduces exactly the same Theory %
 * the calculation above produced. */
function recalcScorecardRow(kind, comp, weights) {
  const v       = (f) => scNum(comp[f]);
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
    const wn   = (k) => scNum(w[k]);
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

/* The scorecard_overrides table used to be a manual "run this SQL once" step,
 * which is why saving failed on a fresh database: the POST below got a
 * "relation does not exist" / PostgREST schema-cache miss and nothing was ever
 * written. It is now created on demand over the direct Postgres pool, and every
 * read/write falls back to that pool when PostgREST cannot see the table yet
 * (its schema cache only refreshes periodically after a DDL change). */
/* Table bootstrap.
 *
 * `CREATE` is the only statement that must succeed; everything after it repairs
 * a table that already exists but is missing columns or the
 * (batch_no, learner_email) unique key — that missing key is what makes an
 * ON CONFLICT upsert fail with SQLSTATE 42P10. Each repair runs on its own so
 * one failing (e.g. insufficient privileges on someone else's table) cannot
 * abort the rest. */
const SCORECARD_OVERRIDES_CREATE = `
  create table if not exists public.scorecard_overrides (
    id            bigserial   primary key,
    batch_no      text        not null,
    learner_email text        not null,
    overrides     jsonb       not null default '{}'::jsonb,
    remarks       text                 default '',
    edited_by     text,
    edited_at     timestamptz not null default now()
  )
`;

const SCORECARD_OVERRIDES_REPAIRS = [
  `alter table public.scorecard_overrides add column if not exists batch_no      text`,
  `alter table public.scorecard_overrides add column if not exists learner_email text`,
  `alter table public.scorecard_overrides add column if not exists overrides     jsonb not null default '{}'::jsonb`,
  `alter table public.scorecard_overrides add column if not exists remarks       text`,
  `alter table public.scorecard_overrides add column if not exists edited_by     text`,
  `alter table public.scorecard_overrides add column if not exists edited_at     timestamptz not null default now()`,
  /* A NOT NULL on remarks would reject a marks-only edit. */
  `alter table public.scorecard_overrides alter column remarks drop not null`,
  `alter table public.scorecard_overrides alter column remarks set default ''`,
  /* Collapse duplicates so the unique key below can be installed. */
  `delete from public.scorecard_overrides a
    using public.scorecard_overrides b
    where a.batch_no = b.batch_no
      and a.learner_email = b.learner_email
      and a.id < b.id`,
  `do $do$
   begin
     if not exists (
       select 1 from pg_constraint
        where conrelid = 'public.scorecard_overrides'::regclass
          and conname  = 'scorecard_overrides_batch_learner_key'
     ) then
       alter table public.scorecard_overrides
         add constraint scorecard_overrides_batch_learner_key
         unique (batch_no, learner_email);
     end if;
   end $do$`,
  `create index if not exists scorecard_overrides_batch_no_idx
     on public.scorecard_overrides (batch_no)`,
  /* PostgREST caches the schema; without this nudge the Supabase client keeps
   * reporting the table as missing until its next periodic reload. */
  `select pg_notify('pgrst', 'reload schema')`,
];

/* Creating the table needs a real Postgres connection — the Supabase REST
 * client cannot issue DDL. Three ways to supply one, cheapest first:
 *   DATABASE_URL          — the standard full connection string
 *   SUPABASE_DB_URL       — an explicit override, same format
 *   SUPABASE_DB_PASSWORD  — just the DB password; the host is derived from
 *                           SUPABASE_URL as db.<project-ref>.supabase.co
 * With none of them set the table has to be created by hand in the SQL editor. */
function scorecardOverridesDbUrl() {
  if (process.env.DATABASE_URL)    return process.env.DATABASE_URL;
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;

  const pwd = process.env.SUPABASE_DB_PASSWORD;
  const ref = (process.env.SUPABASE_URL || "").match(/^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in)/i)?.[1];
  if (pwd && ref) {
    return `postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`;
  }
  return null;
}

const SCORECARD_DDL_HELP =
  "The scorecard_overrides table does not exist in this Supabase project and none of " +
  "DATABASE_URL / SUPABASE_DB_URL / SUPABASE_DB_PASSWORD is set on the backend, so it " +
  "cannot be created automatically. Run backend/sql/scorecard_overrides.sql once in the " +
  "Supabase SQL editor (Dashboard > SQL Editor > New query > paste > Run).";

/* Reuses the shared pool when it is the one holding DATABASE_URL, otherwise
 * opens a small dedicated pool for the derived connection string. */
let scorecardDdlPool = null;
function scorecardOverridesPool() {
  const url = scorecardOverridesDbUrl();
  if (!url) return null;
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) return pool;
  if (!scorecardDdlPool) {
    scorecardDdlPool = new pgDriver.Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
    scorecardDdlPool.on("error", (err) =>
      console.error("SCORECARD overrides pool error:", err.message));
  }
  return scorecardDdlPool;
}

let scorecardOverridesReady = null;
async function ensureScorecardOverridesTable() {
  if (!scorecardOverridesReady) {
    scorecardOverridesReady = (async () => {
      const db = scorecardOverridesPool();
      if (!db) throw new Error(SCORECARD_DDL_HELP);

      await db.query(SCORECARD_OVERRIDES_CREATE);
      for (const stmt of SCORECARD_OVERRIDES_REPAIRS) {
        try {
          await db.query(stmt);
        } catch (err) {
          console.warn("SCORECARD overrides repair skipped:", err.code || "", err.message);
        }
      }
    })().catch((err) => {
      scorecardOverridesReady = null;           // let the next call retry
      throw err;
    });
  }
  return scorecardOverridesReady;
}

/* supabase-js hands back { data, error, status, statusText }. A PostgREST
 * failure normally fills error.message/.code, but a proxy-level failure (bad
 * key, empty body, network) can leave an error object with neither — so this
 * reports the HTTP status and the raw serialised error rather than printing
 * "undefined" and leaving nothing to go on. */
function describeSupabaseError(resp) {
  const e = resp?.error;
  const bits = [];
  if (resp?.status) bits.push(`HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`);
  if (e?.code)      bits.push(`code=${e.code}`);
  if (e?.message)   bits.push(e.message);
  if (e?.details)   bits.push(`details=${e.details}`);
  if (e?.hint)      bits.push(`hint=${e.hint}`);
  if (!bits.length || (!e?.message && !e?.code)) {
    let raw;
    try { raw = JSON.stringify(e, Object.getOwnPropertyNames(e || {})); } catch { raw = String(e); }
    bits.push(`raw=${raw}`);
  }
  return bits.join(" ") || "unknown PostgREST error";
}

/* Normalises a DB row into the shape mergeScorecardOverrides expects. */
function toOverrideEntry(r) {
  let ov = r.overrides;
  if (typeof ov === "string") { try { ov = JSON.parse(ov); } catch { ov = {}; } }
  return {
    overrides: (ov && typeof ov === "object") ? ov : {},
    remarks:   r.remarks   || "",
    edited_by: r.edited_by || "",
    edited_at: r.edited_at || null,
  };
}

/* Reads the saved overrides for a batch. A missing table or any read failure
 * degrades to "no overrides" so the scorecard keeps working. */
async function fetchScorecardOverrides(batchNo) {
  const map = {};
  try {
    const resp = await supabase
      .from("scorecard_overrides")
      .select("learner_email, overrides, remarks, edited_by, edited_at")
      .eq("batch_no", batchNo);

    if (!resp.error) {
      (resp.data || []).forEach((r) => {
        map[(r.learner_email || "").trim().toLowerCase()] = toOverrideEntry(r);
      });
      return map;
    }
    console.error("SCORECARD overrides read error:", describeSupabaseError(resp));
  } catch (err) {
    console.error("SCORECARD overrides exception:", err.message);
  }

  /* PostgREST could not read it — go straight to Postgres, when possible. */
  const db = scorecardOverridesPool();
  if (!db) return map;
  try {
    await ensureScorecardOverridesTable();
    const { rows } = await db.query(
      `select learner_email, overrides, remarks, edited_by, edited_at
         from public.scorecard_overrides
        where batch_no = $1`,
      [batchNo]
    );
    rows.forEach((r) => {
      map[(r.learner_email || "").trim().toLowerCase()] = toOverrideEntry(r);
    });
  } catch (err) {
    console.error("SCORECARD overrides pg read failed:", err.message);
  }
  return map;
}

/* Writes the overrides straight over the Postgres pool, creating the table if
 * this is the first ever save.
 *
 * Deliberately UPDATE-then-INSERT rather than ON CONFLICT: the upsert form
 * needs a unique index on (batch_no, learner_email) and blows up with 42P10
 * when it is absent, which is exactly the state a hand-created table is in.
 * The whole batch runs in one transaction so a partial save is impossible. */
async function saveScorecardOverridesViaPg(rows) {
  await ensureScorecardOverridesTable();

  const db = scorecardOverridesPool();
  if (!db) throw new Error(SCORECARD_DDL_HELP);

  const client = await db.connect();
  try {
    await client.query("begin");
    for (const r of rows) {
      const params = [
        r.batch_no,
        r.learner_email,
        JSON.stringify(r.overrides || {}),
        r.remarks || "",
        r.edited_by,
        r.edited_at,
      ];
      const upd = await client.query(
        `update public.scorecard_overrides
            set overrides = $3::jsonb,
                remarks   = $4,
                edited_by = $5,
                edited_at = $6
          where batch_no = $1
            and lower(learner_email) = lower($2)`,
        params
      );
      if (upd.rowCount === 0) {
        await client.query(
          `insert into public.scorecard_overrides
             (batch_no, learner_email, overrides, remarks, edited_by, edited_at)
           values ($1, $2, $3::jsonb, $4, $5, $6)`,
          params
        );
      }
    }
    await client.query("commit");
  } catch (err) {
    try { await client.query("rollback"); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/* Merges saved overrides into the computed rows. Rows without an override
 * entry are returned untouched. */
function mergeScorecardOverrides(rows, overrideMap, kind) {
  if (!overrideMap || !Object.keys(overrideMap).length) return rows;
  const allowed = SCORECARD_OVERRIDE_FIELDS[kind] || [];

  return rows.map((row) => {
    const entry = overrideMap[(row.email || "").trim().toLowerCase()];
    if (!entry) return row;

    const applied = {};
    allowed.forEach((f) => {
      const val = entry.overrides?.[f];
      if (val !== undefined && val !== null && val !== "") applied[f] = val;
    });

    const meta = {
      remarks:   entry.remarks,
      edited_by: entry.edited_by,
      edited_at: entry.edited_at,
      overrides: applied,
    };
    if (!Object.keys(applied).length) return { ...row, ...meta };

    const breakdown = { ...(row.breakdown || {}) };
    const comp      = { ...breakdown, intermediate: row.intermediate, project: row.project, viva: row.viva };
    const merged    = { ...row, breakdown };

    Object.entries(applied).forEach(([f, val]) => {
      if (SCORECARD_YESNO_FIELDS.includes(f)) return;
      const pct = scNum(val).toFixed(2);
      comp[f] = pct;
      if (SCORECARD_TOP_FIELDS.includes(f)) merged[f] = pct; else breakdown[f] = pct;
    });

    const out = { ...merged, ...recalcScorecardRow(kind, comp, row.breakdownOut), ...meta };
    /* An explicit Certification / Placement override wins over the rule. */
    if (applied.certification) out.certification = applied.certification;
    if (applied.placement)     out.placement     = applied.placement;
    return out;
  });
}

/* Save scorecard edits. Remarks are mandatory for every learner in the batch. */
app.post("/api/scorecard/override", async (req, res) => {
  try {
    const { batch_no, kind, updates, edited_by, role } = req.body || {};

    if (!batch_no) return res.status(400).json({ error: "batch_no is required" });
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: "No changes to save" });
    }
    if (!SCORECARD_EDIT_ROLES.includes((role || "").toString().trim().toLowerCase())) {
      return res.status(403).json({ error: "Only Admin, Manager or Coordinator can edit the scorecard" });
    }

    const k       = (kind || "").toString().toLowerCase() === "dvft" ? "dvft" : "pdft";
    const allowed = SCORECARD_OVERRIDE_FIELDS[k];
    const nowIso  = new Date().toISOString();
    const rows    = [];

    for (const u of updates) {
      const email = (u?.learner_email || "").trim();
      if (!email) return res.status(400).json({ error: "learner_email is required for every change" });

      const remarks = (u?.remarks || "").toString().trim();

      const clean = {};
      for (const [f, v] of Object.entries(u?.overrides || {})) {
        if (!allowed.includes(f))              continue;
        if (v === null || v === undefined || v === "") continue;

        if (SCORECARD_YESNO_FIELDS.includes(f)) {
          const yn = String(v).trim().toUpperCase();
          if (yn !== "YES" && yn !== "NO") {
            return res.status(400).json({ error: `${f} must be YES or NO (${email})` });
          }
          clean[f] = yn;
          continue;
        }

        const num = parseFloat(v);
        if (isNaN(num) || num < 0 || num > 100) {
          return res.status(400).json({ error: `${f} must be a number between 0 and 100 (${email})` });
        }
        clean[f] = Number(num.toFixed(2));
      }

      /* Remarks are mandatory whenever a mark changed. A row that carries only
       * a remark (no mark edit) is a valid update on its own. */
      if (Object.keys(clean).length && !remarks) {
        return res.status(400).json({ error: `Remarks are mandatory (missing for ${email})` });
      }
      if (!Object.keys(clean).length && !remarks) {
        return res.status(400).json({ error: `No valid changes to save for ${email}` });
      }

      rows.push({
        batch_no,
        learner_email: email,
        overrides:     clean,
        remarks,
        edited_by:     edited_by || null,
        edited_at:     nowIso,
      });
    }

    /* Try PostgREST first. `.select()` is deliberate: without it supabase-js
     * sends Prefer: return=minimal, and a failure can come back as an error
     * object carrying neither code nor message — which is exactly the opaque
     * "PostgREST: ? undefined" this endpoint was reporting. */
    const resp = await supabase
      .from("scorecard_overrides")
      .upsert(rows, { onConflict: "batch_no,learner_email" })
      .select("learner_email");

    if (!resp.error) return res.json({ success: true, saved: rows.length, via: "postgrest" });

    const restDesc = describeSupabaseError(resp);
    console.warn("SCORECARD override supabase save failed, falling back to pg:", restDesc);

    /* HTTP 404 from PostgREST means the relation is not in its schema cache —
     * i.e. the table has never been created. Name that outright; "not
     * reachable" sends people looking at credentials that are demonstrably
     * fine, since every other scorecard query uses the same client. */
    const tableMissing = resp.status === 404 || resp.error?.code === "PGRST205";

    /* Without a Postgres connection string the auto-create fallback cannot run
     * at all — say so plainly instead of burying it behind a generic failure. */
    if (!scorecardOverridesPool()) {
      return res.status(500).json({
        error:   tableMissing
          ? "The scorecard_overrides table does not exist in this Supabase project"
          : "Failed to save scorecard changes",
        details: `PostgREST: ${restDesc}`,
        hint:    SCORECARD_DDL_HELP,
        postgrest: {
          status: resp.status, statusText: resp.statusText,
          code: resp.error?.code, message: resp.error?.message,
          details: resp.error?.details, hint: resp.error?.hint,
        },
      });
    }

    try {
      await saveScorecardOverridesViaPg(rows);
      return res.json({ success: true, saved: rows.length, via: "postgres" });
    } catch (pgErr) {
      console.error("SCORECARD override pg save error:", pgErr);
      /* Both paths failed — hand back everything needed to diagnose it rather
       * than a bare "Failed to save scorecard changes". */
      return res.status(500).json({
        error:   "Failed to save scorecard changes",
        details: `PostgREST: ${restDesc} | Postgres: ${pgErr.code || "?"} ${pgErr.message}`,
        hint:    "Run backend/sql/scorecard_overrides.sql once in the Supabase SQL editor.",
        postgrest: {
          status: resp.status, statusText: resp.statusText,
          code: resp.error?.code, message: resp.error?.message,
          details: resp.error?.details, hint: resp.error?.hint,
        },
        postgres:  { code: pgErr.code, message: pgErr.message },
      });
    }
  } catch (err) {
    console.error("SCORECARD override exception:", err);
    res.status(500).json({ error: "Failed to save scorecard changes", details: err.message });
  }
});

/* Diagnostic — tells you in one request whether the scorecard_overrides table
 * is actually usable, and if not, exactly why. It performs a real round-trip
 * write (then removes it) because a successful SELECT does not prove the table
 * accepts inserts. Safe to call from a browser. */
app.get("/api/scorecard/override/health", async (_req, res) => {
  const PROBE_BATCH = "__healthcheck__";
  const out = {
    ddl_connection: scorecardOverridesDbUrl()
      ? (process.env.DATABASE_URL    ? "DATABASE_URL"
      :  process.env.SUPABASE_DB_URL ? "SUPABASE_DB_URL"
      :                                "SUPABASE_DB_PASSWORD")
      : null,
    postgrest: { read: false, write: false },
    postgres:  { available: false },
  };

  /* ── PostgREST read ── */
  const readResp = await supabase.from("scorecard_overrides").select("id").limit(1);
  if (readResp.error) out.postgrest.read_error = describeSupabaseError(readResp);
  else                out.postgrest.read = true;

  /* ── PostgREST write round-trip ── */
  const probe = {
    batch_no: PROBE_BATCH, learner_email: "healthcheck@local",
    overrides: {}, remarks: "healthcheck", edited_by: "healthcheck",
    edited_at: new Date().toISOString(),
  };
  const writeResp = await supabase
    .from("scorecard_overrides")
    .upsert([probe], { onConflict: "batch_no,learner_email" })
    .select("learner_email");

  if (writeResp.error) {
    out.postgrest.write_error = describeSupabaseError(writeResp);
  } else {
    out.postgrest.write = true;
    await supabase.from("scorecard_overrides").delete().eq("batch_no", PROBE_BATCH);
  }

  /* ── Direct Postgres (needs one of the DDL connection sources) ── */
  const db = scorecardOverridesPool();
  if (!db) {
    out.postgres.error = "No DATABASE_URL / SUPABASE_DB_URL / SUPABASE_DB_PASSWORD is set — " +
                         "the table cannot be created automatically.";
  } else {
    try {
      await ensureScorecardOverridesTable();
      const { rows } = await db.query("select count(*)::int as n from public.scorecard_overrides");
      out.postgres = { available: true, rows: rows[0]?.n ?? 0 };
    } catch (err) {
      out.postgres = { available: false, code: err.code, error: err.message };
    }
  }

  out.table_exists = out.postgrest.read || out.postgres.available;
  out.can_save     = out.postgrest.write || out.postgres.available;
  if (!out.can_save) out.fix = SCORECARD_DDL_HELP;
  res.status(out.can_save ? 200 : 500).json(out);
});

app.get("/api/scorecard/:batchNo", async (req, res) => {
  const { batchNo } = req.params;

  try {
    // ── 1. Fetch learners ──────────────────────────────────────────────────
    const { data: learners, error: learnersErr } = await supabase
      .from("learners_data")
      .select("id, name, email")
      .eq("batch_no", batchNo);

    if (learnersErr) {
      console.error("SCORECARD learners error:", learnersErr);
      return res.status(500).json({
        error: "Failed to fetch learners",
        details: learnersErr.message,
      });
    }

    if (!learners || learners.length === 0) {
      return res.json({ data: [] });
    }

    // ── 2. Pre-fetch ALL final_assessment_scores for the batch ───────────────
    const { data: allFinalScores, error: finalScoresErr } = await supabase
      .from("final_assessment_scores")
      .select("learner_id, course_planner_id, assessment_name, points, out_off")
      .eq("batch_no", batchNo);

    if (finalScoresErr) {
      console.error("SCORECARD final_assessment_scores error:", finalScoresErr);
    }

    // ── 3. Resolve topic_name for each course_planner_id ────────────────────
    // Collect unique planner IDs from the fetched scores
    const plannerIds = [
      ...new Set(
        (allFinalScores || [])
          .map((r) => r.course_planner_id)
          .filter(Boolean)
      ),
    ];

    let plannerTopicMap = {}; // { course_planner_id → topic_name }
    if (plannerIds.length > 0) {
      const { data: plannerRows, error: plannerErr } = await supabase
        .from("course_planner_data")
        .select("id, topic_name")
        .in("id", plannerIds);

      if (plannerErr) {
        console.error("SCORECARD planner lookup error:", plannerErr);
      } else {
        (plannerRows || []).forEach((row) => {
          plannerTopicMap[row.id] = row.topic_name || "";
        });
      }
    }

    // ── 4. Pre-fetch ALL intermediate scores for the batch ───────────────────
    const { data: allIntermediateScores, error: interErr } = await supabase
      .from("intermediate_assessment_scores")
      .select("learner_id, points, out_off")
      .eq("batch_no", batchNo);

    if (interErr) {
      console.error("SCORECARD intermediate error:", interErr);
    }

    // ── 5. Pre-fetch ALL final_project_scores for the batch ──────────────────
    const { data: allProjectScores, error: projectErr } = await supabase
      .from("final_project_scores")
      .select("learner_id, points, out_off")
      .eq("batch_no", batchNo);

    if (projectErr) {
      console.error("SCORECARD project error:", projectErr);
    }

    // ── 6. Pre-fetch ALL viva_scores for the batch ───────────────────────────
    const { data: allVivaScores, error: vivaErr } = await supabase
      .from("viva_scores")
      .select("learner_id, points, out_off")
      .eq("batch_no", batchNo);

    if (vivaErr) {
      console.error("SCORECARD viva error:", vivaErr);
    }

    // ── Helper: resolve canonical subject key ─────────────────────────────────
    // topic_name examples from course_planner_data:
    //   "Final Assessment  - 1. Digital Design & Aptitude"
    //   "Final Assessment - 2. CMOS Devices & Technology"
    //   "Final Assessment - 2. TCL Assessment"
    //   "Final Assessment - 3. Physical Design"
    // assessment_name in final_assessment_scores may mirror these or be shorter.
    // We check both, preferring topic_name from course_planner_data.
    const getSubjectKey = (topicName, assessmentName) => {
      const raw = ((topicName || "") + " " + (assessmentName || "")).toLowerCase();
      if (raw.includes("digital"))                         return "digital";
      if (raw.includes("cmos"))                            return "cmos";
      if (raw.includes("tcl"))                             return "tcl";
      if (raw.includes("physical") || raw.includes("phy")) return "physical";
      return null;
    };

    // ── Helper: sum raw points & out_off ─────────────────────────────────────
    const sumRows = (rows) => ({
      totalPoints: rows.reduce((s, r) => s + (Number(r.points)  || 0), 0),
      totalOut:    rows.reduce((s, r) => s + (Number(r.out_off) || 0), 0),
    });

    // ── Helper: convert to percentage out of 100 ──────────────────────────────
    const toPct = ({ totalPoints, totalOut }) =>
      totalOut > 0 ? (totalPoints / totalOut) * 100 : 0;

    // ── 7. Build per-learner results ──────────────────────────────────────────
    const results = [];

    for (const learner of learners) {
      const learnerId = Number(learner.id);

      // ── Intermediate ─────────────────────────────────────────────────────────
      const intermediateRows = (allIntermediateScores || []).filter(
        (r) => Number(r.learner_id) === learnerId
      );
      const intermediateOutOf100 = toPct(sumRows(intermediateRows));

      // ── Final assessments: group into subject buckets ─────────────────────────
      const learnerFinalRows = (allFinalScores || []).filter(
        (r) => Number(r.learner_id) === learnerId
      );

      const buckets = {
        digital:  { pts: 0, out: 0 },
        cmos:     { pts: 0, out: 0 },
        tcl:      { pts: 0, out: 0 },
        physical: { pts: 0, out: 0 },
      };

      learnerFinalRows.forEach((row) => {
        // Resolve topic_name via course_planner_data lookup
        const topicName      = plannerTopicMap[row.course_planner_id] || "";
        const assessmentName = row.assessment_name || "";
        const key            = getSubjectKey(topicName, assessmentName);

        if (key) {
          buckets[key].pts += Number(row.points)  || 0;
          buckets[key].out += Number(row.out_off) || 0;
        } else {
          // Unrecognised — log for debugging
          console.log(
            `[SCORECARD] Unrecognised assessment for learner ${learnerId}:`,
            { topicName, assessmentName, pts: row.points, out: row.out_off }
          );
        }
      });

      // Subject % out of 100
      const subjectPct = (key) =>
        buckets[key].out > 0
          ? (buckets[key].pts / buckets[key].out) * 100
          : 0;

      const digitalOutOf100  = subjectPct("digital");
      const cmosOutOf100     = subjectPct("cmos");
      const tclOutOf100      = subjectPct("tcl");
      const physicalOutOf100 = subjectPct("physical");

      // Theory group = Digital + CMOS + TCL combined into one %
      const theoryTotalPts = buckets.digital.pts + buckets.cmos.pts + buckets.tcl.pts;
      const theoryTotalOut = buckets.digital.out + buckets.cmos.out + buckets.tcl.out;
      const theoryOutOf100 = theoryTotalOut > 0
        ? (theoryTotalPts / theoryTotalOut) * 100
        : 0;

      // ── Final Project ─────────────────────────────────────────────────────────
      const projectRows     = (allProjectScores || []).filter(
        (r) => Number(r.learner_id) === learnerId
      );
      const projectOutOf100 = toPct(sumRows(projectRows));

      // ── Viva ──────────────────────────────────────────────────────────────────
      const vivaRows     = (allVivaScores || []).filter(
        (r) => Number(r.learner_id) === learnerId
      );
      const vivaOutOf100 = toPct(sumRows(vivaRows));

      // ── Weighted Overall ──────────────────────────────────────────────────────
      // Intermediate (all inter assessments combined)   10%
      // Theory       (Digital + CMOS + TCL combined)    20%
      // Physical Design                                 30%
      // Final Project                                   30%
      // Viva                                            10%
      const overall =
        intermediateOutOf100 * 0.10 +
        theoryOutOf100       * 0.20 +
        physicalOutOf100     * 0.30 +
        projectOutOf100      * 0.30 +
        vivaOutOf100         * 0.10;

      // ── Grade ─────────────────────────────────────────────────────────────────
      let grade = "F";
      if      (overall >= 90) grade = "A";
      else if (overall >= 80) grade = "B";
      else if (overall >= 70) grade = "C";
      else if (overall >= 60) grade = "D";

      // ── Certification Eligibility ─────────────────────────────
      // Condition:
      //   Project >= 70%  AND  Overall >= 70%
      const certification =
        projectOutOf100 >= 70 &&
        overall >= 70
          ? "YES"
          : "NO";

      // ── Placement Eligibility ─────────────────────────────────
      // Condition:
      //   Project >= 70%  AND
      //   Viva >= 70%     AND
      //   Overall >= 80%
      const placement =
        projectOutOf100 >= 70 &&
        vivaOutOf100 >= 70 &&
        overall >= 80
          ? "YES"
          : "NO";

      // Debug log (remove or reduce in production)
      console.log(
        `[SCORECARD] ${learner.name} | ` +
        `Inter=${intermediateOutOf100.toFixed(1)}% ` +
        `Digital=${digitalOutOf100.toFixed(1)}% ` +
        `CMOS=${cmosOutOf100.toFixed(1)}% ` +
        `TCL=${tclOutOf100.toFixed(1)}% ` +
        `Theory=${theoryOutOf100.toFixed(1)}% ` +
        `Phy=${physicalOutOf100.toFixed(1)}% ` +
        `Proj=${projectOutOf100.toFixed(1)}% ` +
        `Viva=${vivaOutOf100.toFixed(1)}% ` +
        `=> Overall=${overall.toFixed(2)}% Grade=${grade}`
      );

      results.push({
        name:  learner.name,
        email: learner.email,

        // Individual subject percentages (each converted to /100)
        breakdown: {
          digital:  digitalOutOf100.toFixed(2),
          cmos:     cmosOutOf100.toFixed(2),
          tcl:      tclOutOf100.toFixed(2),
          physical: physicalOutOf100.toFixed(2),
        },

        // Raw out_off totals per theory subject — used to re-derive Theory %
        // with the original weighting when a subject mark is overridden.
        breakdownOut: {
          digital: buckets.digital.out,
          cmos:    buckets.cmos.out,
          tcl:     buckets.tcl.out,
        },

        // Group percentages used in weightage formula
        intermediate: intermediateOutOf100.toFixed(2),
        theory:       theoryOutOf100.toFixed(2),
        project:      projectOutOf100.toFixed(2),
        viva:         vivaOutOf100.toFixed(2),

        overall:      overall.toFixed(2),
        grade,
        certification,
        placement,
      });
    }

    // ── 8. Merge any saved Admin / Manager / Coordinator overrides ───────────
    const overrideMap = await fetchScorecardOverrides(batchNo);
    res.json({ data: mergeScorecardOverrides(results, overrideMap, "pdft") });
  } catch (err) {
    console.error("SCORECARD ERROR:", err);
    res.status(500).json({
      error: "Scorecard calculation failed",
      details: err.message,
    });
  }
});


// ==============================
// SCORECARD API - DVFT BATCHES
// Tables used:
//   intermediate_assessment_scores  → Intermediate  (10%)
//   final_assessment_scores         → Digital(25) + Verilog(25) → Group1 (20%)
//                                   → SV(30) + UVM(30) + Python(15) → Group2 (30%)
//   final_project_scores            → Project (30%)
//   viva_scores                     → Viva (10%)
//
// All marks converted to /100 before weightage is applied.
// Group averages: each subject is first converted to /100, then the group
// percentage is the average of those /100 values.
// ==============================
app.get("/api/scorecard-dvft/:batchNo", async (req, res) => {
  const { batchNo } = req.params;

  try {
    // 1. Fetch learners
    const { data: learners } = await supabase
      .from("learners_data")
      .select("id,name,email")
      .eq("batch_no", batchNo);

    if (!learners || learners.length === 0) {
      return res.json({ data: [] });
    }

    // 2. Fetch scores
    const { data: intermediate } = await supabase
      .from("intermediate_assessment_scores")
      .select("learner_id,points,out_off")
      .eq("batch_no", batchNo);

    const { data: finals } = await supabase
      .from("final_assessment_scores")
      .select("learner_id,assessment_name,points,out_off")
      .eq("batch_no", batchNo);

    const { data: projects } = await supabase
      .from("final_project_scores")
      .select("learner_id,points,out_off")
      .eq("batch_no", batchNo);

    const { data: vivas } = await supabase
      .from("viva_scores")
      .select("learner_id,points,out_off")
      .eq("batch_no", batchNo);

    const results = [];

    const pct = (pts, out) => out > 0 ? (pts / out) * 100 : 0;

    for (const learner of learners) {
      const id = learner.id;

      // Intermediate
      const iRows = intermediate.filter(r => r.learner_id === id);
      const iPts = iRows.reduce((s,r)=>s+(r.points||0),0);
      const iOut = iRows.reduce((s,r)=>s+(r.out_off||0),0);
      const intermediatePct = pct(iPts,iOut);

      // Final assessments
      const fRows = finals.filter(r => r.learner_id === id);

      let digital=0, digitalOut=0;
      let verilog=0, verilogOut=0;
      let sv=0, svOut=0;
      let uvm=0, uvmOut=0;
      let python=0, pythonOut=0;

      fRows.forEach(r=>{
        const name=(r.assessment_name||"").toLowerCase();

        if(name.includes("digital")){
          digital+=r.points||0
          digitalOut+=r.out_off||0
        }

        if(name.includes("verilog")){
          verilog+=r.points||0
          verilogOut+=r.out_off||0
        }

        if(name.includes("systemverilog") || name.includes("sv")){
          sv+=r.points||0
          svOut+=r.out_off||0
        }

        if(name.includes("uvm")){
          uvm+=r.points||0
          uvmOut+=r.out_off||0
        }

        if(name.includes("python")){
          python+=r.points||0
          pythonOut+=r.out_off||0
        }
      });

      const digitalPct=pct(digital,digitalOut)
      const verilogPct=pct(verilog,verilogOut)
      const svPct=pct(sv,svOut)
      const uvmPct=pct(uvm,uvmOut)
      const pythonPct=pct(python,pythonOut)

      // Group averages
      const group1=(digitalPct+verilogPct)/2
      const group2=(svPct+uvmPct+pythonPct)/3

      // Project
      const pRows = projects.filter(r=>r.learner_id===id)
      const pPts=pRows.reduce((s,r)=>s+(r.points||0),0)
      const pOut=pRows.reduce((s,r)=>s+(r.out_off||0),0)
      const projectPct=pct(pPts,pOut)

      // Viva
      const vRows = vivas.filter(r=>r.learner_id===id)
      const vPts=vRows.reduce((s,r)=>s+(r.points||0),0)
      const vOut=vRows.reduce((s,r)=>s+(r.out_off||0),0)
      const vivaPct=pct(vPts,vOut)

      // Overall
      const overall =
        intermediatePct*0.10 +
        group1*0.20 +
        group2*0.30 +
        projectPct*0.30 +
        vivaPct*0.10

      // Grade
      let grade="F"
      if(overall>=90) grade="A"
      else if(overall>=80) grade="B"
      else if(overall>=70) grade="C"
      else if(overall>=60) grade="D"

      const certification =
        projectPct>=70 && overall>=70 ? "YES":"NO"

      const placement =
        projectPct>=70 && vivaPct>=70 && overall>=80 ? "YES":"NO"

      results.push({
        name:learner.name,
        email:learner.email,

        breakdown:{
          digital:digitalPct.toFixed(2),
          verilog:verilogPct.toFixed(2),
          sv:svPct.toFixed(2),
          uvm:uvmPct.toFixed(2),
          python:pythonPct.toFixed(2)
        },

        intermediate:intermediatePct.toFixed(2),
        dvGroup1:group1.toFixed(2),
        dvGroup2:group2.toFixed(2),
        project:projectPct.toFixed(2),
        viva:vivaPct.toFixed(2),

        overall:overall.toFixed(2),
        grade,
        certification,
        placement
      })
    }

    // Merge any saved Admin / Manager / Coordinator overrides
    const overrideMap = await fetchScorecardOverrides(batchNo);
    res.json({ data: mergeScorecardOverrides(results, overrideMap, "dvft") });

  } catch(err){
    console.error("DVFT SCORECARD ERROR",err)
    res.status(500).json({error:"Scorecard calculation failed"})
  }
});




// Download PDF
app.get('/api/download/pdf/:batchNo/:assessmentType', async (req, res) => {
  try {
    const { batchNo, assessmentType } = req.params;
    
    let query;
    switch (assessmentType.toLowerCase()) {
      case 'weekly':
        query = supabase.from('weekly_assessment_scores').select('*').eq('batch_no', batchNo);
        break;
      case 'intermediate':
        query = supabase.from('intermediate_assessment_scores').select('*').eq('batch_no', batchNo);
        break;
      case 'module':
        query = supabase.from('module_level_assessment_scores').select('*').eq('batch_no', batchNo);
        break;
    }

    const { data } = await query;
    
    const doc = new jsPDF();
    doc.text(`Assessment Report - ${batchNo} (${assessmentType})`, 14, 15);
    
    doc.autoTable({
      startY: 20,
      head: [['Learner ID', 'Date', 'Assessment Name', 'Out Of', 'Points', 'Percentage']],
      body: data.map(row => [
        row.learner_id,
        row.assessment_date,
        row.assessment_name || '-',
        row.out_off,
        row.points,
        row.percentage ? `${row.percentage.toFixed(2)}%` : '-'
      ])
    });
    
    const filename = `assessments_${batchNo}_${assessmentType}_${Date.now()}.pdf`;
    const filepath = path.join(__dirname, 'downloads', filename);
    doc.save(filepath);
    
    res.json({ downloadUrl: `/downloads/${filename}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//=== Get the batches dates ===
app.get("/api/get_batch_dates", async (req, res) => {
  try {
    const batch_no = req.query.batch_no;
    if (!batch_no) return res.status(400).json({ error: "Batch number is required" });

    // Supabase does not support aggregate queries in standard query, so workaround by
    // fetching all dates for batch and find min/max in server code.
    const { data, error } = await supabase
      .from("course_planner_data")
      .select("date")
      .eq("batch_no", batch_no)
      .order("date", { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Batch not found or no dates" });
    }

    const start_date = data[0].date;
    const end_date = data[data.length - 1].date;

    res.json({ start_date, end_date });
  } catch (err) {
    console.error("Error fetching batch dates:", err);
    res.status(500).json({ error: "Server error" });
  }
});


//=== Get batch attendance ===
app.get("/api/get_batch_attendance", async (req, res) => {
  try {
    const batch_no = req.query.batch_no;
    if (!batch_no) return res.status(400).json({ error: "Missing batch_no" });
    const date = req.query.date; // optional — when provided, only return that day's rows

    // Query all attendance records for the batch (and optionally a specific date)
    let query = supabase
      .from("learner_attendance")
      .select("learner_email, date, session, status")
      .eq("batch_no", batch_no);
    if (date) query = query.eq("date", date);

    const { data, error } = await query;
    if (error) throw error;

    /* Build { learnerEmail: { date: { session: { status } } } } so the frontend
     * (which reads serverAttendance[email][date][session].status) gets a hit
     * for each saved row. */
    const result = {};
    (data || []).forEach((row) => {
      if (!result[row.learner_email]) result[row.learner_email] = {};
      if (!result[row.learner_email][row.date]) result[row.learner_email][row.date] = {};
      result[row.learner_email][row.date][row.session] = { status: row.status };
    });

    res.json(result);
  } catch (err) {
    console.error("GET /api/get_batch_attendance error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Attendance saving route
app.post("/api/save_attendance_ui", async (req, res) => {
  try {
    const { batch_no, attendance } = req.body;
    if (!batch_no || !attendance) {
      return res.status(400).json({ error: "Missing batch_no or attendance" });
    }
    const rows = [];
    // Transform attendance to flat row format
    // attendance: { learnerEmail: { date: { session: "P/A/NA" } } }
    for (const [learner_email, dateObj] of Object.entries(attendance)) {
      for (const [date, sessions] of Object.entries(dateObj)) {
        for (const [session, status] of Object.entries(sessions)) {
          if (status && status.length > 0) {
            rows.push({
              learner_email,
              batch_no,
              date,
              session: parseInt(session, 10),
              status,
              marked_by: req.user?.email || "trainer",
              marked_at: new Date().toISOString(),
            });
          }
        }
      }
    }
    // Upsert into database (requires unique constraint on learner_email, batch_no, date, session)
    const { error } = await supabase
      .from("learner_attendance")
      .upsert(rows, { onConflict: ["learner_email", "batch_no", "date", "session"] });

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Error saving attendance:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===========================
// FIXED ANNOUNCEMENT SEND API
// ===========================
app.post("/api/announcement/send", async (req, res) => {
  try {
    const { subject, message, messageType, batch_no, domain } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        error: "Subject and message are required",
      });
    }

    if (!batch_no && !domain) {
      return res.status(400).json({
        success: false,
        error: "Batch No or Domain is required",
      });
    }

    // 🔔 Push the announcement to the batch's trainers (learners get email).
    if (batch_no) {
      notify(getDistinctTrainersForBatch(batch_no), {
        title: subject || "New announcement",
        body: message
          ? String(message).replace(/<[^>]+>/g, "").slice(0, 140)
          : "New announcement",
        data: { type: "announcement", batch_no: String(batch_no) },
      });
    }

    let learners = [];

    // ====================
    // FETCH LEARNERS BY BATCH
    // ====================
    if (batch_no) {
      const { data, error } = await supabase
        .from("learners_data")               // ✔ correct table
        .select("name, email, phone, batch_no, status")  // ✔ correct columns
        .eq("batch_no", batch_no);           // ✔ correct column

      if (error) {
        console.error("Fetch learners by batch failed:", error);
        return res.status(500).json({
          success: false,
          error: "Failed to fetch learners (batch query failed)",
        });
      }

      learners = data || [];
    }

    // ====================
    // FETCH LEARNERS BY DOMAIN (OPTIONAL)
    // Only if domain exists AND no batch results found
    // ====================
    if (!learners.length && domain) {
      const { data, error } = await supabase
        .from("learners_data")
        .select("name, email, phone, batch_no, status")
        .eq("domain", domain);               // ONLY if you have domain column

      if (error) {
        console.error("Fetch learners by domain failed:", error);
        return res.status(500).json({
          success: false,
          error: "Failed to fetch learners (domain query failed)",
        });
      }

      learners = data || [];
    }

    // =====================
    // IF NO LEARNERS FOUND
    // =====================
    if (!learners.length) {
      return res.status(404).json({
        success: false,
        error: "No learners found for this batch or domain",
      });
    }

    console.log(`📨 Sending announcement to ${learners.length} learners...`);

    let sentCount = 0;
    let failed = [];

    // =====================
    // SEND EMAIL TO EACH LEARNER
    // =====================
    for (const l of learners) {
      const email = l.email;
      const name = l.name || "Learner";

      const htmlBody =
        messageType === "link"
          ? `<p>Dear ${name},</p><p><a href="${message}" target="_blank">${message}</a></p>`
          : `<p>Dear ${name},</p><p>${message}</p>`;

      try {
        await sendRawEmail({
          to: email,
          subject: subject,
          html: htmlBody,
        });

        sentCount++;
      } catch (err) {
        console.error("Email failed →", email, " Reason:", err.message);
        failed.push({ email, error: err.message });
      }
    }

    return res.json({
      success: failed.length === 0,
      sentTo: sentCount,
      failed: failed.length,
      failures: failed,
    });

  } catch (e) {
    console.error("Announcement send – unexpected error:", e);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});



// === save the attendance ===
app.post("/api/save_attendance", async (req, res) => {
  try {
    const { batch_no, attendance } = req.body;
    if (!batch_no || !attendance) {
      return res.status(400).json({ error: "Missing fields" });
    }

    /*
     attendance object:
     {
       learnerEmail: {
         "YYYY-MM-DD_session1": true/false/ "NA",
         "YYYY-MM-DD_session2": true/false/ "NA",
         ...
       },
       ...
     }
    */

    // Flatten attendance objects for upsert into 'learner_attendance' table
    const rowsToUpsert = [];
    const markedBy = req.user?.email || "unknown"; // You need to set req.user from auth middleware if available

    for (const [learnerEmail, sessions] of Object.entries(attendance)) {
      for (const [key, present] of Object.entries(sessions)) {
        const [date, sessionStr] = key.split("_session");
        const session = parseInt(sessionStr, 10);
        let status = "Absent";
        if (present === true) status = "Present";
        else if (present === "NA") status = "NA";

        rowsToUpsert.push({
          learner_email: learnerEmail,
          batch_no,
          date,
          session,
          status,
          marked_by: markedBy,
          marked_at: new Date().toISOString(),
        });
      }
    }

    // Upsert all rows (requires your table primary key or unique constraint setup properly)
    // Supabase upsert via .upsert() method

    const { data, error } = await supabase
      .from("learner_attendance")
      .upsert(rowsToUpsert, {
        onConflict: ["learner_email", "batch_no", "date", "session"],
      });

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving attendance:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// === update the learners status ===
app.post("/api/update-learner-status", async (req, res) => {
  try {
    const { learner_email, batch_no, new_status } = req.body;
    if (!learner_email || !batch_no || !new_status) {
      return res.status(400).json({ error: "Missing fields" });
    }
    const validStatuses = ["Enabled", "Disabled", "Dropout"];
    if (!validStatuses.includes(new_status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { error } = await supabase
      .from("learners_data")
      .update({ status: new_status })
      .eq("email", learner_email)
      .eq("batch_no", batch_no);

    if (error) throw error;

    // If Dropout, optionally delete attendance records
    if (new_status === "Dropout") {
      const { error: delError } = await supabase
        .from("learner_attendance")
        .delete()
        .eq("learner_email", learner_email)
        .eq("batch_no", batch_no);

      if (delError) throw delError;
    }

    // 🔔 Notify the batch's trainers of the learner status change.
    notify(getDistinctTrainersForBatch(batch_no), {
      title: "Learner status updated",
      body: `${learner_email} in ${batch_no} is now ${new_status}.`,
      data: { type: "learner_status", batch_no: String(batch_no) },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error updating learner status:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// API to get all classrooms (for frontend dropdown or validation)
app.get('/api/classrooms', async (req, res) => {
  try {
    const { data, error } = await supabase.from('classrooms').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch classrooms' });
  }
});

// API to get domains for dropdown selection
app.get('/api/domains', async (req, res) => {
  try {
    const { data, error } = await supabase.from('domains').select('domain_name');
    if (error) throw error;
    const domains = data.map(d => d.domain_name);
    res.json(domains);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch domains' });
  }
});

// ================= APPLY LEAVE (TRAINER) =================
app.post('/api/leave/apply', async (req, res) => {
  try {
    console.log('Apply leave body:', req.body);

    const { trainer_id, from_date, to_date, reason, manager_id } = req.body;

    if (!trainer_id || !from_date || !to_date || !manager_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO trainer_leaves
       (trainer_id, from_date, to_date, reason, manager_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [trainer_id, from_date, to_date, reason || null, manager_id]
    );

    console.log('Inserted leave:', result.rows[0]);

    // 🔔 Notify the approving manager that a new leave request needs action.
    try {
      const { data: mgr } = await supabase
        .from("internal_users")
        .select("email")
        .eq("id", manager_id)
        .single();
      if (mgr?.email) {
        notify(mgr.email, {
          title: "New leave request",
          body: `A trainer applied for leave from ${from_date} to ${to_date}.`,
          data: { type: "leave_request", leave_id: String(result.rows[0]?.id ?? "") },
        });
      }
    } catch (e) {
      console.error("[push] leave/apply notify error:", e.message);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Apply leave error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ================= MANAGER FILTER =================
app.post('/api/leave/manager/filter', async (req, res) => {
  try {
    const { type, value } = req.body;
    let query = '';
    let params = [];

    if (type === 'date') {
      query = `SELECT * FROM trainer_leaves WHERE from_date <= $1 AND to_date >= $1`;
      params = [value];
    }

    if (type === 'week') {
      query = `
        SELECT * FROM trainer_leaves
        WHERE from_date <= ($1::date + interval '6 day')
        AND to_date >= $1`;
      params = [value];
    }

    if (type === 'month') {
      query = `
        SELECT * FROM trainer_leaves
        WHERE EXTRACT(MONTH FROM from_date) = $1`;
      params = [value];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Suggest classroom API
app.post('/api/suggestClassroom', async (req, res) => {
  const { batch_no, domain, students, start_date, end_date, required_tools } = req.body;

  if (!batch_no || !domain || !students || !start_date || !end_date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data: classrooms, error: classErr } = await supabase
    .from('classrooms')
    .select('*')
    .gte('capacity', students);

  if (classErr) return res.status(500).json({ error: 'Failed to fetch classrooms' });
  if (!classrooms.length) return res.status(400).json({ error: 'No classrooms with sufficient capacity' });

  const { data: occupancy, error: occErr } = await supabase
    .from('classroom_occupancy')
    .select('*');

  if (occErr) return res.status(500).json({ error: 'Failed to fetch occupancy' });

  let suggested = null;
  for (const classroom of classrooms) {
    for (const slot of ['morning', 'evening']) {
      const overlap = occupancy.some(occ =>
        occ.classroom_name === classroom.name &&
        occ.slot === slot &&
        !(new Date(occ.occupancy_end) < new Date(start_date) || new Date(occ.occupancy_start) > new Date(end_date))
      );

      if (!overlap) {
        suggested = { classroom: classroom.name, slot };
        break;
      }
    }
    if (suggested) break;
  }

  if (!suggested) return res.status(400).json({ error: 'No classrooms available for the date range and capacity' });

  // License details for domain from licenses table
  const { data: licenses, error: licErr } = await supabase
    .from('licenses')
    .select('license_name, count, domain')
    .eq('domain', domain);

  if (licErr) return res.status(500).json({ error: 'Failed to fetch licenses' });

  // Calculate additional licenses needed per license entry
  const licensesWithAdditional = licenses.map(lic => ({
    license_name: lic.license_name,
    count: lic.count,
    additional_needed: Math.max(0, students - lic.count),
  }));

  // Check if any license is insufficient
  const anyAdditionalNeeded = licensesWithAdditional.some(l => l.additional_needed > 0);

  // Insert batch occupation record
  const { error: insertErr } = await supabase.from('classroom_occupancy').insert({
    classroom_name: suggested.classroom,
    slot: suggested.slot,
    batch_no,
    occupancy_start: start_date,
    occupancy_end: end_date,
  });

  if (insertErr) return res.status(500).json({ error: 'Failed to schedule batch' });

  res.json({
    message: 'Batch scheduled successfully',
    classroom: suggested.classroom,
    slot: suggested.slot,
    licenses: licensesWithAdditional,
    licensesSufficient: !anyAdditionalNeeded,
  });
});

// Classroom occupancy matrix API
app.get('/api/classroom-matrix', async (req, res) => {
  const { data, error } = await supabase.from('classroom_occupancy').select('*');
  if (error) return res.status(500).json({ error: 'Failed to fetch occupancy data' });
  res.json(data);
});

//===Download the planner as xlsx or pdf===
app.post('/api/download-schedule', async (req, res) => {
  const {
    fileType,
    batchDetails,
    licensesData = [],
    matrixTable = [],
    weeks = [],
    batchColorMap = {},
  } = req.body;

  // --- Sheets for Excel ---
  const batchSheet = [
    ["Batch Number", batchDetails.batch_no],
    ["Domain", batchDetails.domain],
    ["No. of Learners", batchDetails.students],
    ["Start Date", batchDetails.start_date],
    ["End Date", batchDetails.end_date],
    ["Required Tools", (batchDetails.required_tools || []).join(', ')],
  ];

  const licensesSheet = [["License Name", "Count", "Additional Needed"]];
  licensesData.forEach(l =>
    licensesSheet.push([
      l.license_name || "",
      l.count || "",
      l.additional_needed || 0,
    ])
  );

  const matrixHeader = ["Classroom", "Slot", ...weeks.map(w => `${w.month} W${w.weekNum}`)];
  const matrixSheet = [matrixHeader];
  matrixTable.forEach(row => {
    const displayRow = [...row];
    for (let i = 2; i < displayRow.length; ++i) {
      if (Array.isArray(displayRow[i]))
        displayRow[i] = displayRow[i].filter(x => !!x).join(', ');
    }
    matrixSheet.push(displayRow);
  });

  if (fileType === "xlsx") {
    const wb = new ExcelJS.Workbook();

    // Batch Details
    const ws1 = wb.addWorksheet("Batch Details");
    batchSheet.forEach(r => ws1.addRow(r));

    // License Info as table
    const ws2 = wb.addWorksheet("License Info");
    licensesSheet.forEach((row, i) => {
      const rowObj = ws2.addRow(row);
      if (i === 0) rowObj.font = { bold: true };
    });

    // Matrix Table with batch color
    const ws3 = wb.addWorksheet("Occupancy Matrix");
    matrixSheet.forEach((r, i) => {
      const row = ws3.addRow(r);
      if (i === 0) {
        row.font = { bold: true };
        return;
      }
      for (let j = 2; j < r.length; ++j) {
        const cellContent = r[j];
        const batchNames = cellContent ? cellContent.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (batchNames.length === 1 && batchColorMap[batchNames[0]]) {
          row.getCell(j + 1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: batchColorMap[batchNames[0]].replace('#','FF') }
          };
          row.getCell(j + 1).font = { color: { argb: "FF222222" }, bold: true };
        }
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="schedule_export.xlsx"');
    wb.xlsx.writeBuffer().then(buf => res.end(Buffer.from(buf)));
    return;
  }

  // --- PDF version ---
  if (fileType === "pdf") {
    const doc = new PDFDocument({ margin: 25, size: "A3", bufferPages: true });
    let buffers = [];
    doc.on("data", (data) => buffers.push(data));
    doc.on("end", () => {
      let pdfData = Buffer.concat(buffers);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="schedule_export.pdf"');
      res.end(pdfData);
    });

    doc.fontSize(18).fillColor("#123456").text("Batch Details", { underline: true });
    Object.entries(batchDetails).forEach(([key, value]) => {
      doc.fontSize(12).fillColor("black").text(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
    });

    doc.moveDown().fontSize(16).fillColor("#123456").text("License Info", { underline: true });
    // Render License table (pdfkit-table expects headers+rows)
    if (licensesData.length > 0) {
      const licenseHeaders = ["License Name", "Count", "Additional Needed"];
      const licenseRows = licensesData.map(l => [l.license_name, l.count, l.additional_needed || 0]);
      await doc.table({
        headers: licenseHeaders,
        rows: licenseRows
      }, { 
        prepareHeader: () => doc.fontSize(11).fillColor("#456"),
        prepareRow: (row, i) => doc.fontSize(10)
      });
    } else {
      doc.fontSize(10).text("No License Data");
    }

    doc.moveDown().fontSize(16).fillColor("#123456").text("Occupancy Matrix", { underline: true });

    if (weeks.length && matrixTable.length) {
      const header = matrixHeader;
      const pdfRows = matrixTable.map(row =>
        row.map((cell, ci) => {
          if (ci >= 2 && Array.isArray(cell)) {
            if (cell.length === 1 && batchColorMap[cell[0]]) {
              return {
                label: cell[0],
                fillColor: batchColorMap[cell[0]],
                color: "#222"
              };
            }
            if (cell.length > 1) {
              return {
                label: cell.join(', '),
                fillColor: undefined,
                color: "#222"
              };
            }
          }
          return { label: Array.isArray(cell) ? cell.join(', ') : cell, fillColor: undefined };
        })
      );
      await doc.table({
        headers: header,
        rows: pdfRows,
      }, {
        prepareHeader: () => doc.fontSize(9).fillColor("#456"),
        prepareRow: (row, i) => doc.fontSize(8),
        prepareCell: (cell, i, j, row, rect) => {
          if (cell && cell.fillColor) {
            doc.rect(rect.x, rect.y, rect.width, rect.height).fillAndStroke(cell.fillColor, cell.fillColor);
            doc.fillColor(cell.color || "#222");
          }
        }
      });
    } else {
      doc.fontSize(10).text("No matrix data");
    }

    doc.end();
    return;
  }

  res.status(400).send("Unsupported file type");
});



// Get batches and domains handled by a trainer
app.get('/api/trainer-batches', async (req, res) => {
  try {
    const { trainer_email } = req.query;
    if (!trainer_email) {
      return res.status(200).json([]);
    }

    const { data, error } = await supabase
      .from('course_planner_data')
      .select('batch_no, domain, trainer_email')
      .eq('trainer_email', trainer_email);

    if (error) {
      console.error('trainer-batches error:', error);
      return res.status(200).json([]);
    }

    // Deduplicate by (batch_no, domain)
    const keyMap = new Map();
    (data || []).forEach((row) => {
      if (!row.batch_no) return;
      const key = `${row.batch_no}__${row.domain || ''}`;
      if (!keyMap.has(key)) {
        keyMap.set(key, {
          batch_no: row.batch_no,
          domain: row.domain || '',
        });
      }
    });

    res.status(200).json(Array.from(keyMap.values()));
  } catch (err) {
    console.error('Unhandled error in /api/trainer-batches:', err);
    res.status(200).json([]);
  }
});

// 1. GET trainer_unavailability - BULLETPROOF
app.get("/api/trainer-unavailability", async (req, res) => {
  console.log("🔥 TRAINER API HIT ✅ - PURE DATABASE");
  
  try {
    const { data, error, count } = await supabase
      .from("trainer_unavailability")
      .select(`
        id,
        trainer_name,
        trainer_email,
        domain,
        start_date,
        end_date,
        status,
        assigned_to,
        submitted_at,
        reason
      `)
      .order("submitted_at", { ascending: false })
      .limit(50);

    console.log("✅ DATABASE:", {
      count: data?.length || 0,
      first: data?.[0]?.trainer_name,
      sample: data?.[0]
    });

    if (error) {
      console.error("❌ DB ERROR:", error.message);
      return res.status(500).json({ error: error.message, data: [] });
    }

    res.status(200).json(data || []);
  } catch (err) {
    console.error("💥 CRASH:", err);
    res.status(500).json({ error: "Server error", data: [] });
  }
});

// 2. GET topics - SIMPLIFIED
app.get("/api/unavailability-topics/:id", async (req, res) => {
  console.log("🔍 Topics for ID:", req.params.id);
  try {
    const { id } = req.params;
    const { data: ua } = await supabase
      .from("trainer_unavailability")
      .select("trainer_email, domain")
      .eq("id", id)
      .single();

    if (!ua) {
      return res.json({ topics: [], batch_owner: null });
    }

    const { data: topics } = await supabase
      .from("course_planner_data")
      .select("id, date, topic_name")
      .eq("trainer_email", ua.trainer_email)
      .eq("domain", ua.domain)
      .limit(10);

    res.json({ 
      topics: topics || [], 
      batch_owner: "Coordinator" 
    });
  } catch (err) {
    console.error("Topics error:", err);
    res.json({ topics: [], batch_owner: null });
  }
});

// 3. GET trainers - SIMPLE
app.get("/api/available-trainers", async (req, res) => {
  console.log("🔍 Available trainers, domain:", req.query.domain);
  try {
    const { domain } = req.query;
    const { data } = await supabase
      .from("internal_users")
      .select("name, email")
      .eq("role", "Trainer")
      .eq("is_active", true)
      .eq("domain", domain || "PD")
      .limit(20);

    res.json(data || []);
  } catch (err) {
    console.error("Trainers error:", err);
    res.json([]);
  }
});

// 3. POST available trainers by schedule (DATE + TIME CONFLICT CHECK)
app.post("/api/available-trainers-by-schedule", async (req, res) => {
  try {
    const {
      trainer_email,
      domain,
      start_date,
      end_date,
      start_time,
      end_time
    } = req.body;

    console.log("🔎 Checking availability:", {
      trainer_email,
      domain,
      start_date,
      end_date,
      start_time,
      end_time
    });

    // 1️⃣ Get all trainers in same domain except unavailable trainer
    const { data: allTrainers, error: trainerError } = await supabase
      .from("course_planner_data")
      .select("trainer_email, trainer_name, batch_no")
      .eq("domain", domain)
      .neq("trainer_email", trainer_email);

    if (trainerError) {
      console.error("Trainer fetch error:", trainerError.message);
      return res.status(500).json({ error: trainerError.message });
    }

    if (!allTrainers || allTrainers.length === 0) {
      return res.json({ trainers: [] });
    }

    // Remove duplicate trainers
    const uniqueTrainers = Object.values(
      allTrainers.reduce((acc, t) => {
        acc[t.trainer_email] = t;
        return acc;
      }, {})
    );

    const availableTrainers = [];

    // 2️⃣ Check each trainer for conflicts
    for (const trainer of uniqueTrainers) {
      const { data: sessions, error: sessionError } = await supabase
        .from("course_planner_data")
        .select("date, start_time, end_time")
        .eq("trainer_email", trainer.trainer_email)
        .gte("date", start_date)
        .lte("date", end_date);

      if (sessionError) {
        console.error("Session error:", sessionError.message);
        continue;
      }

      let hasConflict = false;

      for (const session of sessions || []) {
        // TIME OVERLAP CHECK
        if (
          session.start_time < end_time &&
          session.end_time > start_time
        ) {
          hasConflict = true;
          break;
        }
      }

      if (!hasConflict) {
        availableTrainers.push({
          name: trainer.trainer_name,
          email: trainer.trainer_email,
          batch_no: trainer.batch_no
        });
      }
    }

    res.json({ trainers: availableTrainers });

  } catch (err) {
    console.error("Availability crash:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. POST assign - SAFE
app.post("/api/assign-topics-to-trainer", async (req, res) => {
  try {
    const { unavailability_id, trainer_email, topic_ids } = req.body;
    
    console.log("Assigning:", { unavailability_id, trainer_email, topic_ids: topic_ids?.length });

    // Update topics
    if (topic_ids && topic_ids.length > 0) {
      const { error: topicError } = await supabase
        .from("course_planner_data")
        .update({ trainer_email: trainer_email.toLowerCase() })
        .in("id", topic_ids);
      
      if (topicError) console.error("Topic update error:", topicError);
    }

    // Update unavailability status
    const { error: uaError } = await supabase
      .from("trainer_unavailability")
      .update({ 
        status: "assigned", 
        assigned_to: trainer_email 
      })
      .eq("id", unavailability_id);

    if (uaError) {
      return res.status(500).json({ error: uaError.message });
    }

    // 🔔 Notify the trainer whose leave was approved, and the substitute assigned.
    try {
      const { data: ua } = await supabase
        .from("trainer_unavailability")
        .select("trainer_email, start_date, end_date")
        .eq("id", unavailability_id)
        .single();
      if (ua?.trainer_email) {
        notify(ua.trainer_email, {
          title: "Leave approved ✅",
          body: `Your leave${ua.start_date ? ` (${ua.start_date} to ${ua.end_date})` : ""} has been approved and your sessions reassigned.`,
          data: { type: "leave_approved", leave_id: String(unavailability_id) },
        });
      }
    } catch (e) {
      console.error("[push] assign notify error:", e.message);
    }
    if (trainer_email) {
      notify(trainer_email, {
        title: "New assignment",
        body: "You've been assigned to cover sessions for a trainer on leave.",
        data: { type: "assignment", leave_id: String(unavailability_id) },
      });
    }

    res.json({ success: true, message: "Topics assigned successfully" });
  } catch (err) {
    console.error("Assign error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW SMART AVAILABILITY API
app.post("/api/smart-available-trainers", async (req, res) => {
  try {
    const { domain, start_date, end_date, exclude_trainer } = req.body;
    
    // 1. Get all trainers for domain
    const { data: allTrainers } = await supabase
      .from("internal_users")
      .select("id, name, email, domain")
      .eq("role", "Trainer")
      .eq("is_active", true)
      .eq("domain", domain);

    // 2. Find busy trainers in date range
    const { data: busyTrainers } = await supabase
      .from("course_planner_data")
      .select("trainer_email")
      .gte("date", start_date)
      .lte("date", end_date);

    const busyEmails = [...new Set(busyTrainers?.map(t => t.trainer_email) || [])];
    
    // 3. Filter available trainers
    const available = allTrainers?.filter(t => 
      t.email !== exclude_trainer && !busyEmails.includes(t.email)
    ) || [];

    res.json({ 
      available, 
      total: allTrainers?.length || 0, 
      busy: busyEmails.length,
      message: `${available.length} trainers available` 
    });
  } catch (err) {
    console.error("Smart availability error:", err);
    res.status(500).json({ error: err.message, available: [] });
  }
});


//=== Progress update based on the trainer email ===
app.get('/api/batch-owner/:batch_no', async (req, res) => {
  const { batch_no } = req.params;
  // Your query to find owner email for batch
  const { data, error } = await supabase
    .from('batch_table') // or wherever you keep batch owner info
    .select('owner_email')
    .eq('batch_no', batch_no)
    .single();

  if(error) return res.status(400).json({ error: error.message });
  res.json(data);
});

//=== Fetch the Learners ===
app.get('/apigetlearners', async (req, res) => {
  try {
    const { batchno } = req.query;
    
    if (!batchno) {
      return res.status(400).json({ error: 'Batch number required' });
    }

    console.log(`🔍 Fetching learners for batch: ${batchno}`);

    const { data, error } = await supabase
      .from('learners_data') // Your actual table name
      .select('id, name, email, batch_no, status, server_id')
      .eq('batch_no', batchno)
      .order('name', { ascending: true });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch learners', 
        details: error.message 
      });
    }

    console.log(`✅ Found ${data?.length || 0} learners for ${batchno}`);
    res.json(data || []);

  } catch (error) {
    console.error('Get learners error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch learners',
      details: error.message 
    });
  }
});

// MARKSHEET - Get Periods for Assessment Type
app.get('/apiperiods/:batchNo/:assessmentType', async (req, res) => {
  try {
    const { batchNo, assessmentType } = req.params;
    console.log(`🔍 Loading periods: batchNo=${batchNo}, type=${assessmentType}`);
    if (!batchNo || !assessmentType) {
      return res.status(400).json({ error: 'batchNo and assessmentType required' });
    }
    let queryFilter = '';
    switch (assessmentType) {
      case 'weekly-assessment':
        queryFilter = "topic_name.ilike.%Weekly%";
        break;
      case 'intermediate-assessment':
        queryFilter = "topic_name.ilike.%Intermediate%";
        break;
      case 'module-level-assessment':
        queryFilter = "topic_name.ilike.%Module Level%";
        break;
      case 'final-assessment':
        queryFilter = "topic_name.ilike.%Final%";
        break;
      case 'weekly-quiz':
        queryFilter = "topic_name.ilike.%Quiz%";
        break;
      default:
        return res.status(400).json({ error: 'Invalid assessment type' });
    }
    const { data, error } = await supabase
      .from('course_planner_data')
      .select('id, week_no, date, topic_name')   // ← CHANGE: added 'id'
      .eq('batch_no', batchNo)
      .or(queryFilter)
      .order('week_no', { ascending: true })
      .order('date', { ascending: true });
    if (error) {
      console.error('❌ Supabase error:', error);
      return res.status(500).json({
        error: 'Database query failed',
        details: error.message
      });
    }
    const periods = (data || [])
      .filter(row => row.week_no && row.date && row.topic_name)
      .map(row => ({
        id: row.id,               // ← CHANGE: added id so frontend can use it as course_planner_id
        week_no: row.week_no,
        date: row.date,
        topic_name: row.topic_name
      }));
    console.log(`✅ Found ${periods.length} periods`);
    res.json(periods);
  } catch (error) {
    console.error('🚨 /apiperiods ERROR:', error);
    res.status(500).json({
      error: 'Server error',
      details: error.message
    });
  }
});

app.post("/api/trainer-leaves", async (req, res) => {
  const {
    trainer_email,
    trainer_name,
    domain,
    start_date,
    end_date,
    reason,
    batch_nos,
  } = req.body;

  if (!trainer_email || !start_date || !end_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const safeDomain = domain || null;
  const safeBatchNos = batch_nos || null;
  const safeReason = reason || null;
  const safeTrainerName = trainer_name || (trainer_email ? trainer_email.split("@")[0] : "Unknown");

  try {
    const { data, error } = await supabase
      .from("trainer_unavailability")
      .insert([
        {
          trainer_email,
          trainer_name: safeTrainerName,
          domain: safeDomain,
          start_date,
          end_date,
          reason: safeReason,
          batch_nos: safeBatchNos,
          status: "pending",
          submitted_at: new Date().toISOString(),
        },
      ])
      .select("id, trainer_email, trainer_name, domain, start_date, end_date, status")
      .single();

    if (error) {
      console.error("Error applying leave (supabase):", error);
      return res.status(500).json({ error: error.message || "Failed to apply leave" });
    }

    // 🔔 Notify approvers that a new leave request needs approval.
    notify(getApproverEmails(), {
      title: "New leave request",
      body: `${safeTrainerName} requested leave from ${start_date} to ${end_date}.`,
      data: { type: "leave_request", leave_id: String(data?.id ?? "") },
    });

    res.json({ success: true, leave: data });
  } catch (err) {
    console.error("Error applying leave:", err);
    res.status(500).json({ error: err.message || "Failed to apply leave" });
  }
});

// PUT - update a leave (only if not yet processed)
app.put("/api/trainer-leaves/:id", async (req, res) => {
  const { id } = req.params;
  const { start_date, end_date, reason } = req.body;

  if (!id) return res.status(400).json({ error: "Missing leave id" });
  if (!start_date || !end_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from("trainer_unavailability")
      .select("id, status")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    const lockedStatuses = ["assigned", "approved"];
    if (lockedStatuses.includes(String(existing.status || "").toLowerCase())) {
      return res
        .status(409)
        .json({ error: "Cannot edit — leave already processed" });
    }

    const { data, error } = await supabase
      .from("trainer_unavailability")
      .update({
        start_date,
        end_date,
        reason: reason || null,
      })
      .eq("id", id)
      .select("id, start_date, end_date, reason, status")
      .single();

    if (error) {
      console.error("Error updating leave:", error);
      return res.status(500).json({ error: error.message });
    }

    // 🔔 Notify approvers that a pending leave request was edited.
    notify(getApproverEmails(), {
      title: "Leave request updated",
      body: `A pending leave request was updated (dates ${start_date} to ${end_date}).`,
      data: { type: "leave_updated", leave_id: String(id) },
    });

    res.json({ success: true, leave: data });
  } catch (err) {
    console.error("Error updating leave:", err);
    res.status(500).json({ error: err.message || "Failed to update leave" });
  }
});

// DELETE - cancel a leave (only if not yet processed)
app.delete("/api/trainer-leaves/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Missing leave id" });

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from("trainer_unavailability")
      .select("id, status")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    const lockedStatuses = ["assigned", "approved"];
    if (lockedStatuses.includes(String(existing.status || "").toLowerCase())) {
      return res
        .status(409)
        .json({ error: "Cannot delete — leave already processed" });
    }

    const { error } = await supabase
      .from("trainer_unavailability")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error deleting leave:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting leave:", err);
    res.status(500).json({ error: err.message || "Failed to delete leave" });
  }
});

//get the topics from course planner table
app.get("/api/topic", async (req, res) => {
  try {
    const { batch_no, date } = req.query;

    const { data, error } = await supabase
      .from("course_planner_data")
      .select("id, topic_name")
      .eq("batch_no", batch_no)
      .eq("date", date)
      .limit(1)
      .single();

    if (error) return res.status(404).json(null);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//get the assessment dates
app.get("/api/assessment-dates", async (req, res) => {
  try {
    const { batch_no, type } = req.query;

    if (!batch_no || !type) {
      return res.json([]); // ALWAYS array
    }

    const textMap = {
      weekly: "Weekly Assessment",
      intermediate: "Intermediate Assessment",
      module: "Module Level Assessment",
      final: "Final Assessment",
    };

    const searchText = textMap[type];

    const { data, error } = await supabase
      .from("course_planner_data")
      .select("date, week_no, module_no")
      .eq("batch_no", batch_no)
      .ilike("topic_name", `${searchText}%`)
      .order("date", { ascending: true });

    if (error) {
      console.error("assessment-dates error:", error.message);
      return res.json([]); // 👈 NEVER fail
    }

    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error("assessment-dates crash:", err.message);
    res.json([]); // 👈 ABSOLUTE SAFETY
  }
});


// Add or update Weekly Assessment Score
app.post("/api/marks/weekly-assessment", async (req, res) => {
  try {
    const {
      learner_id,
      batch_no,
      week_no,
      assessment_date,
      out_off,
      points,
      percentage,
      course_planner_id
    } = req.body;

    // Normalize date to YYYY-MM-DD
    const isoDate = dayjs(assessment_date).isValid() ? dayjs(assessment_date).format("YYYY-MM-DD") : assessment_date;

    // Use course_planner_id from frontend if provided, otherwise look it up
    let plannerId = course_planner_id ? Number(course_planner_id) : null;

    if (!plannerId) {
      const planner = await getPlannerByBatchAndDate(batch_no, assessment_date);
      if (!planner) {
        return res.status(409).json({ error: "Planner not found" });
      }
      plannerId = planner.id;
    }

    const { error } = await supabase
      .from("weekly_assessment_scores")
      .upsert(
        {
          learner_id,
          course_planner_id: plannerId,
          batch_no,
          week_no,
          assessment_date: isoDate,
          out_off,
          points,
          percentage,
          marked_at: new Date()
        },
        {
          onConflict: "learner_id,course_planner_id,week_no,assessment_date"
        }
      );

    if (error) throw error;
    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//save the intermediate assessment marks
app.post("/api/marks/intermediate-assessment", async (req, res) => {
  try {
    const {
      learner_id,
      batch_no,
      week_no,
      assessment_date,
      assessment_name,
      out_off,
      points,
      percentage,
      course_planner_id
    } = req.body;

    if (!week_no) {
      return res.status(400).json({ error: "week_no is required" });
    }

    // Normalize date to YYYY-MM-DD
    const isoDate = dayjs(assessment_date).isValid() ? dayjs(assessment_date).format("YYYY-MM-DD") : assessment_date;

    // Use course_planner_id from frontend if provided, otherwise look it up
    let plannerId = course_planner_id ? Number(course_planner_id) : null;

    if (!plannerId) {
      const { data: planner, error: plannerError } = await supabase
        .from("course_planner_data")
        .select("id")
        .eq("batch_no", batch_no)
        .eq("date", assessment_date)
        .limit(1)
        .single();

      if (plannerError || !planner) {
        return res.status(409).json({ error: "Planner not found for this batch and date" });
      }
      plannerId = planner.id;
    }

    const { error } = await supabase
      .from("intermediate_assessment_scores")
      .upsert(
        {
          learner_id,
          course_planner_id: plannerId,
          batch_no,
          week_no,
          assessment_date: isoDate,
          assessment_name,
          out_off,
          points,
          percentage,
          marked_at: new Date()
        },
        {
          onConflict: "learner_id,course_planner_id,week_no,assessment_date"
        }
      );

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    console.error("Intermediate save error:", err);
    res.status(500).json({ error: err.message });
  }
});


//save the module level assessment marks
app.post("/api/marks/module-level-assessment", async (req, res) => {
  try {
    const {
      learner_id,
      batch_no,
      module_no,
      assessment_date,
      assessment_name,
      out_off,
      points,
      percentage,
      course_planner_id
    } = req.body;

    if (!module_no) {
      return res.status(400).json({ error: "module_no is required" });
    }

    // Normalize date to YYYY-MM-DD
    const isoDate = dayjs(assessment_date).isValid() ? dayjs(assessment_date).format("YYYY-MM-DD") : assessment_date;

    // Use course_planner_id from frontend if provided, otherwise look it up
    let plannerId = course_planner_id ? Number(course_planner_id) : null;

    if (!plannerId) {
      const { data: planner, error: plannerError } = await supabase
        .from("course_planner_data")
        .select("id")
        .eq("batch_no", batch_no)
        .eq("date", assessment_date)
        .limit(1)
        .single();

      if (plannerError || !planner) {
        return res.status(409).json({ error: "Planner not found" });
      }
      plannerId = planner.id;
    }

    const { error } = await supabase
      .from("module_level_assessment_scores")
      .upsert(
        {
          learner_id,
          course_planner_id: plannerId,
          batch_no,
          module_no,
          assessment_date: isoDate,
          assessment_name,
          out_off,
          points,
          percentage,
          marked_at: new Date()
        },
        {
          // ✅ MUST MATCH TABLE PRIMARY KEY
          onConflict: "learner_id,course_planner_id,module_no,assessment_date"
        }
      );

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    console.error("Module save error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// SAVE FINAL ASSESSMENT MARKS - FIXED
// Uses course_planner_id sent directly from frontend.
// This ensures two assessments on the same date are stored as separate rows
// because the unique key is (learner_id, course_planner_id, week_no, assessment_date).
// ==============================
app.post("/api/marks/final-assessment", async (req, res) => {
  try {
    const {
      learner_id,
      batch_no,
      week_no,
      assessment_date,
      assessment_name,
      out_off,
      points,
      percentage,
      course_planner_id,
    } = req.body;

    if (!week_no) {
      return res.status(400).json({ error: "week_no is required" });
    }

    // Normalize date to YYYY-MM-DD
    const isoDate = dayjs(assessment_date).isValid() ? dayjs(assessment_date).format("YYYY-MM-DD") : assessment_date;

    let plannerId = course_planner_id ? Number(course_planner_id) : null;

    if (!plannerId) {
      const matchName = assessment_name || "";
      let query = supabase
        .from("course_planner_data")
        .select("id")
        .eq("batch_no", batch_no)
        .eq("date", assessment_date);

      if (matchName) {
        query = query.ilike("topic_name", `%${matchName}%`);
      }

      const { data: plannerRows, error: plannerErr } = await query.limit(1);

      if (plannerErr || !plannerRows || plannerRows.length === 0) {
        return res.status(409).json({
          error: "Could not resolve course_planner_id. Please select the assessment from the dropdown.",
        });
      }
      plannerId = plannerRows[0].id;
    }

    const { error } = await supabase
      .from("final_assessment_scores")
      .upsert(
        {
          learner_id:        Number(learner_id),
          course_planner_id: plannerId,
          batch_no,
          week_no:           Number(week_no),
          assessment_date:   isoDate,
          assessment_name:   assessment_name || null,
          out_off:           Number(out_off),
          points:            Number(points),
          percentage:        percentage != null ? Number(percentage) : null,
          marked_at:         new Date(),
        },
        {
          onConflict: "learner_id,course_planner_id,week_no,assessment_date",
        }
      );

    if (error) {
      console.error("final-assessment upsert error:", error);
      throw error;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Final assessment save error:", err);
    res.status(500).json({ error: err.message });
  }
});

//save the final project marks
app.post("/api/marks/final-project", async (req, res) => {
  try {
    const {
      learner_id,
      batch_no,
      assessment_date: rawDate,   // ← FIXED: accept date from frontend
      out_off,
      points,
      percentage
    } = req.body;

    // Use date sent by frontend; fall back to today only if absent
    const assessment_date = rawDate
      ? dayjs(rawDate).format("YYYY-MM-DD")
      : new Date().toISOString().split("T")[0];

    const { error } = await supabase
      .from("final_project_scores")
      .upsert(
        { learner_id, batch_no, assessment_date, out_off, points, percentage, marked_at: new Date() },
        { onConflict: "learner_id,batch_no,assessment_date" }
      );
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Final Project Save Error:", err);
    res.status(500).json({ error: err.message });
  }
});

//save the viva marks
app.post("/api/marks/viva", async (req, res) => {
  try {
    const {
      learner_id,
      batch_no,
      assessment_date: rawDate,   // ← FIXED: accept date from frontend
      out_off,
      points,
      percentage
    } = req.body;

    const assessment_date = rawDate
      ? dayjs(rawDate).format("YYYY-MM-DD")
      : new Date().toISOString().split("T")[0];

    const { error } = await supabase
      .from("viva_scores")
      .upsert(
        { learner_id, batch_no, assessment_date, out_off, points, percentage, marked_at: new Date() },
        { onConflict: "learner_id,batch_no,assessment_date" }
      );
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Viva Save Error:", err);
    res.status(500).json({ error: err.message });
  }
});

//save out of API
app.post("/api/outoff/save", async (req, res) => {
  const { batch_no, topic_name, out_off } = req.body;

  await pool.query(
    `UPDATE final_assessment_scores
     SET out_off=$1
     WHERE batch_no=$2
     AND assessment_name=$3`,
    [out_off, batch_no, topic_name]
  );

  res.json({ success: true });
});


// Fetch all marks for a learner and batch (optional API for dashboard display)
app.get('/api/marks/:category', async (req, res) => {
  try {
    const { category } = req.params; // one of: weekly-assessment-scores, intermediate-assessment-scores, module-level-assessment-scores, weekly-quiz-scores
    const { learner_id, batchno } = req.query;
    const { data, error } = await supabase
      .from(category)
      .select('*')
      .eq('learner_id', learner_id)
      .eq('batchno', batchno);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

//update the out of marks in the marks sheet page
app.post("/api/marks/update-out-of", async (req, res) => {
  const { batch_no, assessment_type, course_planner_id, assessment_date, out_off } = req.body;

  if (!batch_no || !assessment_type || !assessment_date || out_off == null)
    return res.status(400).json({ error: "batch_no, assessment_type, assessment_date, out_off are required" });

  const table = ASSESSMENT_TABLE_MAP[assessment_type];
  if (!table) return res.status(400).json({ error: "Invalid assessment type" });

  try {
    let query = supabase
      .from(table)
      .update({ out_off: Number(out_off) })
      .eq("batch_no", batch_no)
      .eq("assessment_date", assessment_date);

    if (course_planner_id) {
      query = query.eq("course_planner_id", Number(course_planner_id));
    }

    const { error, count } = await query;

    if (error) throw error;
    return res.json({ updated: count ?? 0 });
  } catch (err) {
    console.error("Update out_off error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ✅ FIXED: Main announcement endpoint - NO SYNTAX ERRORS
app.post('/api/announcement/send-direct', async (req, res) => {
  try {
    const { subject, message, messageType, batch_no } = req.body;

    if (!subject || !message || !batch_no) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    console.log('📥 Announcement request:', { subject, batch_no });

    // 🔹 Fetch learners
    const learnerRes = await fetch(
      `${process.env.API_BASE_URL || 'http://localhost:5000'}/apigetlearners?batchno=${batch_no}`
    );
    const learners = await learnerRes.json();

    const validLearners = learners.filter(
      l => l.email && l.email.trim()
    );

    if (validLearners.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No learners with valid email'
      });
    }

    let sentCount = 0;
    let failed = [];

    for (const learner of validLearners) {
      try {
        const mailOptions = {
          from: `"Training Team" <${process.env.EMAIL_USER}>`,
          to: learner.email,
          subject: `[${batch_no}] ${subject}`,
          text: message,
          html: messageType === 'html'
            ? `
              <div style="font-family:Arial;padding:20px">
                <h2>${subject}</h2>
                <div>${message.replace(/\n/g, '<br>')}</div>
                <p style="font-size:12px;color:#666">
                  Batch: ${batch_no}<br/>
                  ${new Date().toLocaleString('en-IN')}
                </p>
              </div>
            `
            : undefined
        };

        await transporter.sendMail(mailOptions);
        sentCount++;

        // Gmail rate limit safety
        await new Promise(r => setTimeout(r, 250));

      } catch (err) {
        failed.push({ email: learner.email, error: err.message });
        console.error(`❌ Failed ${learner.email}`, err.message);
      }
    }

    console.log(`📊 RESULT: ${sentCount} sent, ${failed.length} failed`);

    return res.json({
      success: sentCount > 0,
      sentCount,
      failedCount: failed.length,
      failed
    });

  } catch (err) {
    console.error('❌ Announcement fatal error:', err);
    res.status(500).json({
      success: false,
      error: 'Server error while sending emails'
    });
  }
});


// ✅ Email sending function (separate)
async function sendBatchEmails(data) {
  try {
    const { subject, message, messageType, batch_no } = data;
    
    // Get learners for batch
    const learnerRes = await fetch(`http://localhost:5000/apigetlearners?batchno=${batch_no}`);
    const learners = await learnerRes.json();
    const validLearners = learners.filter(l => l.email && l.email.trim());

    console.log(`📤 Processing ${validLearners.length} emails for ${batch_no}`);

    let sentCount = 0;
    let failedCount = 0;

    for (const learner of validLearners) {
      try {
        const mailOptions = {
          from: `"Training Team" <${process.env.EMAIL_USER}>`,
          to: learner.email,
          subject: `[${batch_no}] ${subject}`,
          text: message,
          html: messageType === 'html' ? `
            <div style="font-family: Arial; padding: 20px; max-width: 600px;">
              <h2 style="color: #2c5aa0;">${subject}</h2>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
                ${message.replace(/\n/g, '<br>')}
              </div>
              <p style="color: #666; font-size: 12px; margin-top: 20px;">
                Batch: ${batch_no} | ${new Date().toLocaleString('en-IN')}
              </p>
            </div>
          ` : undefined
        };

        await transporter.sendMail(mailOptions);
        sentCount++;
        console.log(`✅ SENT: ${learner.email}`);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (emailError) {
        failedCount++;
        console.error(`❌ FAILED ${learner.email}:`, emailError.message);
      }
    }

    console.log(`🎉 RESULT: ${sentCount} sent, ${failedCount} failed`);

  } catch (error) {
    console.error('Batch email error:', error);
  }
}

// File upload (IMMEDIATE response)
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl });
  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Test email endpoint
app.get("/api/test-email", async (req, res) => {
  try {
    const result = await sendRawEmail({
      to: "hariharan@chipedge.com",
      subject: "Email Test from Render",
      text: "Email sending works on Render 🚀",
    });
    if (!result.success) throw new Error(result.error);
    res.json({ success: true, messageId: result.messageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// === Schedule Email API (with Templates + Course Application Emails + Internal Emails) ===
// === Schedule Email API (with Templates + Mock Interview Emails) ===
// ==================== 1. SCHEDULE EMAIL API ====================
app.post("/api/schedule-email", async (req, res) => {
  try {
    const { batch_no, mode, batch_type, class_room, templates: templateOverrides } = req.body;

    if (!batch_no || !mode) {
      return res.status(400).json({ error: "Batch No and Mode are required" });
    }

    // ── Fetch batch start date ────────────────────────────────────
    const { data: courseData, error: courseError } = await supabase
      .from("course_planner_data")
      .select("date, trainer_email")
      .eq("batch_no", batch_no)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (courseError) {
      console.error("Error fetching course planner data:", courseError);
      return res.status(500).json({ error: "Failed to fetch batch course data" });
    }
    if (!courseData || !courseData.date) {
      return res.status(404).json({ error: "Batch course details not found" });
    }

    const startDateStr       = courseData.date;
    const formattedStartDate = formatDate(startDateStr);

    // ── Fetch learners ────────────────────────────────────────────
    const { data: learners, error: learnersError } = await supabase
      .from("learners_data")
      .select("email, name")
      .eq("batch_no", batch_no);

    if (learnersError) {
      console.error("Error fetching learners:", learnersError);
      return res.status(500).json({ error: "Failed to fetch batch learners data" });
    }
    if (!learners || learners.length === 0) {
      return res.status(404).json({ error: "No learners found for this batch" });
    }

    // ── Email templates ───────────────────────────────────────────
    // Use the edited templates coming from the Home Dashboard editor when
    // provided; otherwise fall back to the active templates in the DB
    // (unchanged original behaviour).
    let templates;
    if (Array.isArray(templateOverrides) && templateOverrides.length > 0) {
      templates = templateOverrides.map((t) => ({
        id:            t.id ?? null,
        template_name: t.template_name || "",
        subject:       t.subject || "",
        body_html:     t.body_html || "",
        offset_days:   Number.isFinite(Number(t.offset_days)) ? Number(t.offset_days) : 0,
        send_time:     t.send_time || "09:00",
      }));
    } else {
      let query = supabase
        .from("email_templates")
        .select("*")
        .eq("mode", mode)
        .eq("active", true);

      if (mode === "Offline") {
        if (!batch_type) {
          return res.status(400).json({ error: "Batch type is required for Offline mode" });
        }
        query = query.eq("batch_type", batch_type);
      } else {
        query = query.is("batch_type", null);
      }

      const { data: dbTemplates, error: templateError } = await query;
      if (templateError) {
        console.error("Error fetching email templates:", templateError);
        return res.status(500).json({ error: "Failed to fetch email templates" });
      }
      templates = dbTemplates;
    }

    if (!templates || templates.length === 0) {
      return res.status(404).json({ error: "No templates found for this batch/mode" });
    }

    // ── Google Form (Offline only) ────────────────────────────────
    let form_url  = null;
    let sheet_url = null;
    if (mode === "Offline") {
      const { data: existingForm, error: formError } = await supabase
        .from("batch_forms")
        .select("*")
        .eq("batch_no", batch_no)
        .maybeSingle();

      if (formError) console.error("Error fetching batch form:", formError);

      if (!existingForm) {
        try {
          const formResult = await createBatchForm(batch_no, formattedStartDate);
          form_url  = formResult.form_url;
          sheet_url = formResult.sheet_url;
          await supabase.from("batch_forms").insert({
            batch_no, form_url, sheet_url,
            created_at: new Date().toISOString(),
          });
        } catch (formErr) {
          console.error("Failed to create batch form:", formErr);
        }
      } else {
        form_url  = existingForm.form_url;
        sheet_url = existingForm.sheet_url;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 1. TEMPLATE-BASED EMAILS
    // ═══════════════════════════════════════════════════════════════
    let scheduledCount = 0;
    console.log(`\n📧 Template emails | batch=${batch_no} startDate=${startDateStr}`);

    for (const template of templates) {
      const offsetDays = template.offset_days ?? 0;
      const sendTime   = template.send_time || "09:00";

      let scheduledAtISO;
      try {
        scheduledAtISO = scheduleIST(startDateStr, offsetDays, sendTime);
      } catch (e) {
        console.error(`  ❌ scheduleIST failed for template ${template.id}:`, e.message);
        continue;
      }

      for (const learner of learners) {
        try {
          // Deduplicate
          const { data: existing } = await supabase
            .from("scheduled_emails")
            .select("id")
            .eq("recipient_email", learner.email)
            .eq("template_id",     template.id)
            .eq("batch_no",        batch_no)
            .eq("scheduled_at",    scheduledAtISO)
            .maybeSingle();
          if (existing) continue;

          const personalizedSubject = (template.subject || "")
            .replace(/{{batch_no}}/g,   batch_no)
            .replace(/{{name}}/g,       learner.name || "Learner")
            .replace(/{{start_date}}/g, formattedStartDate);

          const personalizedBody = (template.body_html || "")
            .replace(/{{batch_no}}/g,   batch_no)
            .replace(/{{start_date}}/g, formattedStartDate)
            .replace(/{{class_name}}/g, class_room || "")
            .replace(/{{name}}/g,       learner.name || "Learner");

          const { error: insertError } = await supabase
            .from("scheduled_emails")
            .insert({
              batch_no,
              template_id:     template.id,
              template_name:   template.template_name,
              subject:         personalizedSubject,
              body_html:       personalizedBody,
              recipient_email: learner.email,
              scheduled_at:    scheduledAtISO,
              status:          "scheduled",
              retry_count:     "0",          // ← FIX: must be "0" not NULL
              mode,
              batch_type:      batch_type || null,
              source:          "email_templates",
              created_at:      new Date().toISOString(),
            });

          if (insertError) {
            console.error(`  ❌ Insert failed for ${learner.email}:`, insertError.message);
          } else {
            scheduledCount++;
          }
        } catch (err) {
          console.error(`  ❌ Error scheduling for ${learner.email}:`, err.message);
        }
      }
    }
    console.log(`✅ Template emails scheduled: ${scheduledCount}`);

    // ═══════════════════════════════════════════════════════════════
    // 2. MOCK INTERVIEW REMINDERS
    // ═══════════════════════════════════════════════════════════════
    console.log("\n╔════════════════════════════════════════════════╗");
    console.log("║   MOCK INTERVIEW REMINDER SCHEDULING           ║");
    console.log("╚════════════════════════════════════════════════╝");

    const TRAINER_MAIL_TIME          = "15:50";
    const MOCK_INTERVIEW_OFFSET_DAYS = -7;

    const { data: mockTopics, error: mockTopicsError } = await supabase
      .from("course_planner_data")
      .select("id, batch_no, topic_name, date, trainer_name, trainer_email, mode")
      .eq("batch_no", batch_no)
      .ilike("topic_name", "%Mock Interview%")
      .order("date", { ascending: true });

    if (mockTopicsError) {
      console.error("❌ Error fetching mock interview topics:", mockTopicsError);
      return res.status(500).json({ error: "Failed to fetch mock interview planner data" });
    }

    let mockScheduledCount = 0;
    console.log(`  Found ${mockTopics?.length || 0} mock interview topic(s)`);

    for (let i = 0; i < (mockTopics?.length || 0); i++) {
      const row = mockTopics[i];
      console.log(`\n  Mock ${i + 1}/${mockTopics.length}: "${row.topic_name}" on ${row.date}`);

      if (!row.trainer_email || !row.date || !row.mode) {
        console.log("  ⚠️  Skipped — missing trainer_email, date, or mode");
        continue;
      }

      let scheduledAtISO;
      try {
        scheduledAtISO = scheduleIST(row.date, MOCK_INTERVIEW_OFFSET_DAYS, TRAINER_MAIL_TIME);
      } catch (e) {
        console.error("  ❌ scheduleIST error:", e.message);
        continue;
      }

      const { data: existing } = await supabase
        .from("scheduled_emails")
        .select("id")
        .eq("batch_no",        row.batch_no)
        .eq("recipient_email", row.trainer_email)
        .eq("template_name",   "mock_interview_trainer_confirmation")
        .eq("scheduled_at",    scheduledAtISO)
        .maybeSingle();

      if (existing) {
        console.log(`  ⚠️  Already scheduled (id=${existing.id}), skipping`);
        continue;
      }

      const formattedDate = formatDate(row.date);
      const confirmUrl    = `${process.env.REACT_APP_API_URL || "http://localhost:5000"}/api/confirm-mock-interview?planner_id=${row.id}&batch_no=${row.batch_no}`;

      const emailHtml = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#2c3e50;">Mock Interview Confirmation Required</h2>
          <p>Dear ${row.trainer_name},</p>
          <p>The mock interview <strong>${row.topic_name}</strong> for batch <strong>${row.batch_no}</strong>
             has been scheduled on <strong>${formattedDate}</strong>.</p>
          <p>Please confirm the date by clicking the Confirm button below.<br>
             If there is any change in the date, please select a new date and then click Confirm.</p>
          <form action="${confirmUrl}" method="POST" style="margin:20px 0;">
            <div style="margin-bottom:15px;">
              <label style="display:block;margin-bottom:5px;font-weight:bold;">Change Date (if needed):</label>
              <input type="date" name="confirmed_date" value="${row.date}" required
                     style="padding:8px;border:1px solid #ddd;border-radius:4px;width:200px;">
            </div>
            <button type="submit"
                    style="background:#4CAF50;color:white;padding:12px 30px;border:none;
                           border-radius:5px;cursor:pointer;font-size:16px;font-weight:bold;">
              ✓ Confirm Mock Interview
            </button>
          </form>
          <p style="color:#666;font-size:14px;">Thanks,<br>Kowshika | Learning Coordinator,<br>📞 9606056288</p>
        </div>`;

      const { error: insertError } = await supabase.from("scheduled_emails").insert({
        batch_no:        row.batch_no,
        template_id:     null,
        template_name:   "mock_interview_trainer_confirmation",
        subject:         `Please confirm Mock Interview (${row.topic_name}) for Batch ${row.batch_no}`,
        body_html:       emailHtml,
        recipient_email: row.trainer_email,
        scheduled_at:    scheduledAtISO,
        status:          "scheduled",
        retry_count:     "0",              // ← FIX: must be "0" not NULL
        role:            "Trainer",
        source:          "mock_interview_scheduler",
        created_at:      new Date().toISOString(),
        mode:            row.mode,
      });

      if (insertError) {
        console.error("  ❌ Insert failed:", insertError.message);
      } else {
        mockScheduledCount++;
        console.log(`  ✅ Reminder #${mockScheduledCount} inserted`);
      }
    }

    console.log(`\n  Mock interview reminders scheduled: ${mockScheduledCount}`);

    // ═══════════════════════════════════════════════════════════════
    // 3. SOFT SKILLS REMINDERS
    // ═══════════════════════════════════════════════════════════════
    console.log("\n╔════════════════════════════════════════════════╗");
    console.log("║   SOFT SKILLS REMINDER SCHEDULING              ║");
    console.log("╚════════════════════════════════════════════════╝");

    const TRAINER_SOFT_SKILLS_REMINDER_TIME = "09:00"; // IST
    const LEARNER_SOFT_SKILLS_REMINDER_TIME = "09:00"; // IST
    const nowIso = new Date().toISOString();

    const { data: softSkillsSessions, error: softSkillsError } = await supabase
      .from("course_planner_data")
      .select("id, batch_no, topic_name, date, topic_status, trainer_name, trainer_email, mode")
      .ilike("topic_name", "%Soft Skills%")
      .neq("topic_status", "Completed")
      .eq("batch_no", batch_no);

    if (softSkillsError) {
      console.error("Error fetching soft skills sessions:", softSkillsError);
      return res.status(500).json({ error: "Failed to fetch soft skills data" });
    }

    const groupedByTrainer = {};
    for (const session of (softSkillsSessions || [])) {
      if (!groupedByTrainer[session.trainer_email]) groupedByTrainer[session.trainer_email] = [];
      groupedByTrainer[session.trainer_email].push(session);
    }

    let softSkillsMonthlyCount = 0;
    let softSkillsOneWeekCount = 0;

    for (const trainerEmail in groupedByTrainer) {
      const topics           = groupedByTrainer[trainerEmail];
      const monthlyEmailHtml = generateSoftSkillSummaryEmail(topics, trainerEmail);

      // Monthly summary — send immediately
      const { error: insertMonthlyError } = await supabase
        .from("scheduled_emails")
        .insert({
          batch_no,
          mode,
          recipient_email: trainerEmail,
          subject:         "Monthly Soft Skills Sessions – Please Confirm Dates",
          body_html:       monthlyEmailHtml,
          scheduled_at:    nowIso,
          status:          "scheduled",
          retry_count:     "0",            // ← FIX: must be "0" not NULL
          template_name:   "soft_skills_monthly_summary",
          created_at:      nowIso,
          role:            "Trainer",
        });

      if (insertMonthlyError) {
        console.error(`  ❌ Monthly reminder failed for ${trainerEmail}:`, insertMonthlyError.message);
      } else {
        softSkillsMonthlyCount++;
      }

      // 1-week prior reminders per topic
      for (const topic of topics) {
        let trainerReminderAt, learnerReminderAt;
        try {
          trainerReminderAt = scheduleIST(topic.date, -7, TRAINER_SOFT_SKILLS_REMINDER_TIME);
          learnerReminderAt = scheduleIST(topic.date, -7, LEARNER_SOFT_SKILLS_REMINDER_TIME);
        } catch (e) {
          console.error(`  ❌ scheduleIST error for topic ${topic.id}:`, e.message);
          continue;
        }

        // Trainer 1-week reminder
        const { error: insertTrainerErr } = await supabase
          .from("scheduled_emails")
          .insert({
            batch_no,
            mode,
            recipient_email: trainerEmail,
            subject:         `Reminder: Soft Skills Session "${topic.topic_name}" for Batch ${batch_no}`,
            body_html:       `<p>Dear ${topic.trainer_name},</p><p>This is a reminder for your Soft Skills session "${topic.topic_name}" scheduled on <strong>${dayjs(topic.date).format("DD-MMM-YYYY")}</strong>.</p>`,
            scheduled_at:    trainerReminderAt,
            status:          "scheduled",
            retry_count:     "0",          // ← FIX: must be "0" not NULL
            template_name:   "soft_skills_1week_trainer",
            created_at:      nowIso,
            role:            "Trainer",
          });

        if (insertTrainerErr) {
          console.error(`  ❌ Trainer 1-week insert failed for ${trainerEmail}:`, insertTrainerErr.message);
        } else {
          softSkillsOneWeekCount++;
        }

        // Learner 1-week reminders
        const { data: topicLearners, error: learnerError } = await supabase
          .from("learners_data")
          .select("email, name")
          .eq("batch_no", batch_no);

        if (learnerError) {
          console.error(`  ❌ Error fetching learners for ${batch_no}:`, learnerError.message);
          continue;
        }

        for (const learner of (topicLearners || [])) {
          const { error: insertLearnerErr } = await supabase
            .from("scheduled_emails")
            .insert({
              batch_no,
              mode,
              recipient_email: learner.email,
              subject:         `Reminder: Soft Skills Session for Batch ${batch_no}`,
              body_html:       `<p>Dear ${learner.name},</p><p>This is a reminder for the Soft Skills session "${topic.topic_name}" scheduled on <strong>${dayjs(topic.date).format("DD-MMM-YYYY")}</strong>.</p>`,
              scheduled_at:    learnerReminderAt,
              status:          "scheduled",
              retry_count:     "0",        // ← FIX: must be "0" not NULL
              template_name:   "soft_skills_1week_learner",
              created_at:      nowIso,
              role:            "Learner",
            });

          if (insertLearnerErr) {
            console.error(`  ❌ Learner reminder failed for ${learner.email}:`, insertLearnerErr.message);
          } else {
            softSkillsOneWeekCount++;
          }
        }
      }
    }

    console.log(`  Soft skills monthly: ${softSkillsMonthlyCount} | 1-week: ${softSkillsOneWeekCount}`);

    return res.json({
      success:                            true,
      batch_no,
      start_date:                         formattedStartDate,
      scheduled:                          scheduledCount,
      mock_interview_reminders_scheduled: mockScheduledCount,
      soft_skills_monthly_reminders:      softSkillsMonthlyCount,
      soft_skills_1week_reminders:        softSkillsOneWeekCount,
      message:                            `Emails scheduled for batch ${batch_no}`,
    });

  } catch (err) {
    console.error("❌ /api/schedule-email fatal error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


// ==================== 2. TRAINER CONFIRMATION ENDPOINT ====================
app.post("/api/confirm-mock-interview", async (req, res) => {
  try {
    const { planner_id, batch_no } = req.query;
    const { confirmed_date } = req.body;

    console.log('👨‍🏫 [Trainer Confirmation] Received:', { 
      planner_id, 
      batch_no, 
      confirmed_date,
      body: req.body,
      query: req.query 
    });

    if (!planner_id || !batch_no) {
      console.error('❌ Missing planner_id or batch_no');
      return res.status(400).send(`
        <html><head><style>body{font-family:Arial;padding:50px;text-align:center}.error{color:#f44336;font-size:20px}</style></head>
        <body><div class="error">❌ Invalid Request</div><p>Missing required parameters</p></body></html>
      `);
    }

    if (!confirmed_date) {
      console.error('❌ Missing confirmed_date');
      return res.status(400).send(`
        <html><head><style>body{font-family:Arial;padding:50px;text-align:center}.error{color:#f44336;font-size:20px}</style></head>
        <body><div class="error">❌ Date Required</div><p>Please select a date</p></body></html>
      `);
    }

    // 1. Get planner row
    const { data: plannerRow, error: plannerError } = await supabase
      .from("course_planner_data")
      .select("*")
      .eq("id", planner_id)
      .maybeSingle();

    if (plannerError || !plannerRow) {
      console.error('❌ [Trainer Confirmation] Planner not found:', plannerError);
      return res.status(404).send(`
        <html><head><style>body{font-family:Arial;padding:50px;text-align:center}.error{color:#f44336;font-size:20px}</style></head>
        <body><div class="error">❌ Invalid Entry</div><p>Mock interview entry not found in the system</p></body></html>
      `);
    }

    const oldDate = plannerRow.date;
    const newDate = confirmed_date;

    console.log('📅 [Trainer Confirmation] Dates:', { oldDate, newDate, changed: oldDate !== newDate });

    // 2. Update planner date if changed
    if (newDate !== oldDate) {
      const { error: updateError } = await supabase
        .from("course_planner_data")
        .update({ date: newDate })
        .eq("id", planner_id);
      
      if (updateError) {
        console.error('❌ Error updating date:', updateError);
      } else {
        console.log('✅ [Trainer Confirmation] Updated planner date from', oldDate, 'to', newDate);
      }
    }

    // 3. Update scheduled_emails for trainer confirmation
    const { error: emailUpdateError } = await supabase
      .from("scheduled_emails")
      .update({
        status: "trainer_confirmed",
        updated_at: new Date().toISOString()
      })
      .eq("batch_no", batch_no)
      .eq("role", "Trainer")
      .eq("template_name", "mock_interview_trainer_confirmation")
      .eq("recipient_email", plannerRow.trainer_email);

    if (emailUpdateError) {
      console.error('⚠️ [Trainer Confirmation] Error updating trainer email status:', emailUpdateError);
    }

    // 4. Find coordinator
    const { data: coordinators, error: coordError } = await supabase
      .from("internal_users")
      .select("name, email")
      .eq("role", "Coordinator")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (coordError || !coordinators) {
      console.error('❌ [Trainer Confirmation] Coordinator not found:', coordError);
      return res.status(404).send(`
        <html><head><style>body{font-family:Arial;padding:50px;text-align:center}.error{color:#f44336;font-size:20px}</style></head>
        <body><div class="error">❌ Coordinator not found</div><p>Please ensure a coordinator is added in the system with active status.</p></body></html>
      `);
    }

    console.log('✅ [Trainer Confirmation] Coordinator found:', coordinators.email);

    // 5. Compose coordinator email
    const API_BASE = process.env.REACT_APP_API_URL || "http://192.168.1.2:5000/";
    let mailHtml = "";
    let subject = "";
    
    if (newDate === oldDate) {
      subject = `✓ Trainer Confirmed Mock Interview (${plannerRow.topic_name})`;
      mailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #4CAF50;">✓ Mock Interview Confirmed</h2>
          <p>Dear ${coordinators.name},</p>
          <p>The trainer <strong>${plannerRow.trainer_name}</strong> from batch <strong>${batch_no}</strong> has <strong style="color: #4CAF50;">confirmed</strong> the mock interview <strong>${plannerRow.topic_name}</strong> on date <strong>${formatDate(newDate)}</strong>.</p>
          <p>Please review and click the button below to send confirmation emails to all learners and trainers.</p>
          <form action="${API_BASE}/api/send-mock-confirmation" method="POST" style="margin: 25px 0;">
            <input type="hidden" name="planner_id" value="${planner_id}">
            <input type="hidden" name="batch_no" value="${batch_no}">
            <input type="hidden" name="confirmed_date" value="${newDate}">
            <button type="submit" style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; padding: 15px 40px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);">
              📧 Send Confirmation Emails to All
            </button>
          </form>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px;">
            <p style="margin: 5px 0;"><strong>Batch:</strong> ${batch_no}</p>
            <p style="margin: 5px 0;"><strong>Topic:</strong> ${plannerRow.topic_name}</p>
            <p style="margin: 5px 0;"><strong>Date:</strong> ${formatDate(newDate)}</p>
            <p style="margin: 5px 0;"><strong>Trainer:</strong> ${plannerRow.trainer_name}</p>
          </div>
          <p style="color: #666; margin-top: 20px;">Thanks,<br>Kowshika | Learning Coordinator,<br>📞 9606056288</p>
        </div>
      `;
    } else {
      subject = `📅 Trainer Requested Date Change for Mock Interview`;
      mailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ff9800; border-radius: 8px;">
          <h2 style="color: #ff9800;">📅 Date Change Request</h2>
          <p>Dear ${coordinators.name},</p>
          <p>The trainer <strong>${plannerRow.trainer_name}</strong> from batch <strong>${batch_no}</strong> has requested to <strong style="color: #ff9800;">change</strong> the mock interview <strong>${plannerRow.topic_name}</strong>:</p>
          <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p style="margin: 5px 0;"><strong>Original Date:</strong> <span style="text-decoration: line-through; color: #f44336;">${formatDate(oldDate)}</span></p>
            <p style="margin: 5px 0;"><strong>New Date:</strong> <span style="color: #4CAF50; font-weight: bold;">${formatDate(newDate)}</span></p>
          </div>
          <p>The date has been updated in the system. Please review and confirm to send emails to learners and trainers.</p>
          <form action="${API_BASE}/api/send-mock-confirmation" method="POST" style="margin: 25px 0;">
            <input type="hidden" name="planner_id" value="${planner_id}">
            <input type="hidden" name="batch_no" value="${batch_no}">
            <input type="hidden" name="confirmed_date" value="${newDate}">
            <button type="submit" style="background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%); color: white; padding: 15px 40px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; box-shadow: 0 4px 15px rgba(33, 150, 243, 0.3);">
              📧 Send Confirmation Emails to All
            </button>
          </form>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px;">
            <p style="margin: 5px 0;"><strong>Batch:</strong> ${batch_no}</p>
            <p style="margin: 5px 0;"><strong>Topic:</strong> ${plannerRow.topic_name}</p>
            <p style="margin: 5px 0;"><strong>Trainer:</strong> ${plannerRow.trainer_name}</p>
          </div>
          <p style="color: #666; margin-top: 20px;">Thanks,<br>Kowshika | Learning Coordinator,<br>📞 9606056288</p>
        </div>
      `;
    }

    // 6. Send email to coordinator IMMEDIATELY
    try {
      await sendRawEmail({
        to: coordinators.email,
        subject: subject,
        html: mailHtml
      });
      
      console.log('✅ [Trainer Confirmation] Coordinator email sent to:', coordinators.email);
      
      // Log in scheduled_emails for tracking
      await supabase.from("scheduled_emails").insert({
        batch_no,
        template_id: null,
        template_name: "mock_interview_coordinator_confirmation",
        subject,
        body_html: mailHtml,
        recipient_email: coordinators.email,
        scheduled_at: new Date().toISOString(),
        status: "sent",
        role: "Coordinator",
        source: "mock_interview_scheduler",
        created_at: new Date().toISOString(),
        sent_at: new Date().toISOString()
      });
      
    } catch (emailError) {
      console.error('❌ [Trainer Confirmation] Failed to send coordinator email:', emailError);
      return res.status(500).send(`
        <html><head><style>body{font-family:Arial;padding:50px;text-align:center}.error{color:#f44336;font-size:20px}</style></head>
        <body><div class="error">❌ Failed to send coordinator email</div><p>${emailError.message}</p></body></html>
      `);
    }

    res.send(`
      <html>
        <head>
          <style>
            body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;padding:50px;text-align:center;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center}
            .container{background:white;padding:40px;border-radius:15px;box-shadow:0 10px 40px rgba(0,0,0,0.2);max-width:500px}
            .success{color:#4CAF50;font-size:28px;font-weight:bold;margin-bottom:20px}
            .info{color:#666;margin-top:20px;line-height:1.6}
            .checkmark{font-size:60px;color:#4CAF50;margin-bottom:20px}
          </style>
        </head>
        <body>
          <div class="container">
            <div class="checkmark">✓</div>
            <div class="success">Confirmation Received!</div>
            <div class="info">
              <p>Thank you for confirming the mock interview details.</p>
              <p><strong>Batch:</strong> ${batch_no}</p>
              <p><strong>Topic:</strong> ${plannerRow.topic_name}</p>
              <p><strong>Date:</strong> ${formatDate(newDate)}</p>
              <hr style="margin:20px 0;border:none;border-top:1px solid #eee">
              <p style="font-size:14px">The coordinator has been notified and will send confirmation emails to all participants shortly.</p>
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('❌ [Trainer Confirmation] Error:', err);
    res.status(500).send(`
      <html><head><style>body{font-family:Arial;padding:50px;text-align:center}.error{color:#f44336;font-size:20px}</style></head>
      <body><div class="error">❌ Error confirming trainer</div><p>${err.message}</p></body></html>
    `);
  }
});

// ==================== 3. COORDINATOR CONFIRMATION PAGE (GET) ====================
app.get('/api/confirm-coordinator', (req, res) => {
  const { plannerid, batchno } = req.query;

  if (!plannerid || !batchno) {
    return res.status(400).send(`
      <html><body style="font-family:Arial; text-align:center; margin-top: 50px;">
        <h2 style="color:#f44336;">Invalid Request</h2>
        <p>Missing required parameters.</p>
      </body></html>`);
  }

  res.send(`
    <html>
      <head>
        <title>Mock Interview Confirmation</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f5f8fa; padding: 40px; }
          .container { max-width: 400px; margin: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.1);}
          h2 { color: #1976d2; margin-bottom: 20px; }
          button { background-color: #1976d2; color: white; border: none; padding: 12px 30px; border-radius: 4px; font-size: 16px; cursor: pointer; font-weight: 600;}
          button:hover { background-color: #105a9e; }
          p { font-size: 14px; color: #555; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Confirm Mock Interview</h2>
          <p>Please confirm the mock interview for batch <strong>${batchno}</strong>.</p>
          <form method="POST" action="/api/send-mock-confirmation" >
            <input type="hidden" name="planner_id" value="${plannerid}" />
            <input type="hidden" name="batch_no" value="${batchno}" />
            <input type="hidden" name="confirmed_date" value="${new Date().toISOString().slice(0,10)}" />
            <button type="submit">Confirm</button>
          </form>
        </div>
      </body>
    </html>
  `);
});


// ==================== 4. COORDINATOR CONFIRMATION SUBMISSION (POST) ====================
app.post("/api/send-mock-confirmation", async (req, res) => {
  try {
    const { planner_id, batch_no, confirmed_date } = req.body;

    console.log('👔 [Coordinator] Sending confirmations:', { planner_id, batch_no, confirmed_date, body: req.body });

    if (!planner_id || !batch_no || !confirmed_date) {
      return res.status(400).send("Missing required parameters");
    }

    // 1. Get planner row
    const { data: plannerRow, error: plannerError } = await supabase
      .from("course_planner_data")
      .select("*")
      .eq("id", planner_id)
      .maybeSingle();

    if (plannerError || !plannerRow) {
      console.error('❌ [Coordinator] Planner not found:', plannerError);
      return res.status(404).send("Planner entry not found");
    }

    // 2. Get learners for batch
    const { data: learners, error: learnersErr } = await supabase
      .from("learners_data")
      .select("name, email")
      .eq("batch_no", batch_no);

    if (learnersErr) {
      console.error('❌ [Coordinator] Learners fetch error:', learnersErr);
      return res.status(500).send("Failed to fetch learners data");
    }

    // 3. Get unique trainers for batch
    const { data: trainersData, error: trainersErr } = await supabase
      .from("course_planner_data")
      .select("trainer_name, trainer_email")
      .eq("batch_no", batch_no);

    if (trainersErr) {
      console.error('❌ [Coordinator] Trainers fetch error:', trainersErr);
      return res.status(500).send("Failed to fetch trainers data");
    }

    // Unique trainers by email
    const uniqueTrainers = [];
    const seenEmails = new Set();
    trainersData?.forEach(t => {
      if (t.trainer_email && !seenEmails.has(t.trainer_email)) {
        uniqueTrainers.push(t);
        seenEmails.add(t.trainer_email);
      }
    });

    console.log('📊 [Coordinator] Recipients:', { learners: learners.length, trainers: uniqueTrainers.length });

    // 4. Compose final email
    const finalDate = confirmed_date || plannerRow.date;
    const subject = `Mock Interview Scheduled for Batch ${batch_no}`;
    
    const baseHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #4CAF50; border-radius: 8px;">
        <h2 style="color: #4CAF50;">📅 Mock Interview Confirmation</h2>
        <div style="background: #e8f5e9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 8px 0;"><strong>Mock Interview:</strong> ${plannerRow.topic_name}</p>
          <p style="margin: 8px 0;"><strong>Batch:</strong> ${batch_no}</p>
          <p style="margin: 8px 0;"><strong>Date:</strong> <span style="color: #4CAF50; font-weight: bold; font-size: 18px;">${formatDate(finalDate)}</span></p>
          <p style="margin: 8px 0;"><strong>Trainer:</strong> ${plannerRow.trainer_name}</p>
        </div>
        <p>Kindly be present on this date and time.</p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">Thanks,<br>Kowshika | Learning Coordinator,<br>📞 9606056288</p>
      </div>
    `;

    // 5. Send emails immediately to learners
    let sentCount = 0;
    let failedCount = 0;
    
    for (const learner of learners || []) {
      try {
        const personalizedHtml = `<p>Dear ${learner.name},</p>` + baseHtml;
        
        await sendRawEmail({
          to: learner.email,
          subject: subject,
          html: personalizedHtml
        });

        // Log in scheduled_emails
        await supabase.from("scheduled_emails").insert({
          batch_no,
          template_id: null,
          template_name: "mock_interview_final_confirmation",
          subject,
          body_html: personalizedHtml,
          recipient_email: learner.email,
          scheduled_at: new Date().toISOString(),
          status: "sent",
          role: "Learner",
          source: "mock_interview_scheduler",
          created_at: new Date().toISOString(),
          sent_at: new Date().toISOString()
        });

        sentCount++;
        console.log(`✅ [Coordinator] Sent to learner: ${learner.email}`);
      } catch (err) {
        failedCount++;
        console.error(`❌ [Coordinator] Failed to send to learner ${learner.email}:`, err);
      }
    }

    // 6. Send emails to trainers
    for (const trainer of uniqueTrainers) {
      try {
        const personalizedHtml = `<p>Dear ${trainer.trainer_name},</p>` + baseHtml;
        
        await sendRawEmail({
          to: trainer.trainer_email,
          subject: subject,
          html: personalizedHtml
        });

        // Log in scheduled_emails
        await supabase.from("scheduled_emails").insert({
          batch_no,
          template_id: null,
          template_name: "mock_interview_final_confirmation",
          subject,
          body_html: personalizedHtml,
          recipient_email: trainer.trainer_email,
          scheduled_at: new Date().toISOString(),
          status: "sent",
          role: "Trainer",
          source: "mock_interview_scheduler",
          created_at: new Date().toISOString(),
          sent_at: new Date().toISOString()
        });

        sentCount++;
        console.log(`✅ [Coordinator] Sent to trainer: ${trainer.trainer_email}`);
      } catch (err) {
        failedCount++;
        console.error(`❌ [Coordinator] Failed to send to trainer ${trainer.trainer_email}:`, err);
      }
    }

    // 7. Update coordinator email status
    await supabase.from("scheduled_emails")
      .update({ 
        status: "coordinator_confirmed", 
        updated_at: new Date().toISOString() 
      })
      .eq("batch_no", batch_no)
      .eq("role", "Coordinator")
      .eq("template_name", "mock_interview_coordinator_confirmation");

    console.log(`✅ [Coordinator] Successfully sent ${sentCount} emails (${failedCount} failed)`);

    res.send(`
      <html>
        <head>
          <style>
            body {
              font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
              padding:50px;
              text-align:center;
              background:linear-gradient(135deg,#4CAF50 0%,#45a049 100%);
              min-height:100vh;
              margin:0;
              display:flex;
              align-items:center;
              justify-content:center;
            }
            .container {
              background:white;
              padding:40px;
              border-radius:15px;
              box-shadow:0 10px 40px rgba(0,0,0,0.2);
              max-width:500px;
            }
            .success { color:#4CAF50; font-size:28px; font-weight:bold; margin-bottom:20px; }
            .info { color:#666; margin-top:20px; line-height:1.8; }
            .checkmark { font-size:60px; color:#4CAF50; margin-bottom:20px; }
            .stats { background:#f5f5f5; padding:20px; border-radius:8px; margin-top:20px; }
            .stat-item { margin:10px 0; font-size:16px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="checkmark">✓</div>
            <div class="success">Emails Sent Successfully!</div>
            <div class="stats">
              <div class="stat-item"><strong>Total Sent:</strong> ${sentCount}</div>
              ${failedCount > 0 ? `<div class="stat-item" style="color:#f44336"><strong>Failed:</strong> ${failedCount}</div>` : ''}
              <div class="stat-item"><strong>Batch:</strong> ${batch_no}</div>
              <div class="stat-item"><strong>Topic:</strong> ${plannerRow.topic_name}</div>
              <div class="stat-item"><strong>Date:</strong> ${formatDate(finalDate)}</div>
            </div>
            <div class="info">
              <p>All learners and trainers have been notified about the mock interview schedule.</p>
            </div>
          </div>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('❌ [Coordinator] Error:', err);
    res.status(500).send(`
      <html><head><style>body{font-family:Arial;padding:50px;text-align:center}.error{color:#f44336;font-size:20px}</style></head>
      <body><div class="error">❌ Error sending confirmation emails</div><p>${err.message}</p></body></html>
    `);
  }
});


//=== Schedule all needed mails for Soft Skills ===
app.post('/api/schedule-soft-skills-reminders', async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from('course_planner_data')
      .select('id, batch_no, topic_name, date, topic_status, trainer_name, trainer_email')
      .ilike('topic_name', '%Soft Skills%')
      .neq('topic_status', 'Completed');

    if (error) return res.status(500).json({ error: error.message });

    const grouped = {};
    for (const session of sessions) {
      if (!grouped[session.trainer_email]) grouped[session.trainer_email] = [];
      grouped[session.trainer_email].push(session);
    }

    let scheduled = 0;
    for (const trainerEmail in grouped) {
      const topics = grouped[trainerEmail];
      const monthlyEmailHtml = generateSoftSkillSummaryEmail(topics, trainerEmail);

      // Immediately schedule monthly summary reminder for trainer
      await supabase.from('scheduled_emails').insert({
        recipient_email: trainerEmail,
        subject: 'Monthly Soft Skills Sessions – Date Confirmation',
        body_html: monthlyEmailHtml,
        scheduled_at: new Date().toISOString(),
        status: "scheduled",
        template_name: "soft_skills_summary_mail",
        created_at: new Date().toISOString(),
        role: "Trainer",
      });
      scheduled++;

      // Schedule 1-week prior reminders for trainer and learners with configurable times
      for (const topic of topics) {
        const trainerReminderAt = dayjs(topic.date).subtract(7, 'day').hour(parseInt(TRAINER_SOFT_SKILLS_REMINDER_TIME.split(':')[0])).minute(parseInt(TRAINER_SOFT_SKILLS_REMINDER_TIME.split(':')[1])).second(0).millisecond(0).toISOString();
        const learnerReminderAt = dayjs(topic.date).subtract(7, 'day').hour(parseInt(LEARNER_SOFT_SKILLS_REMINDER_TIME.split(':')[0])).minute(parseInt(LEARNER_SOFT_SKILLS_REMINDER_TIME.split(':')[1])).second(0).millisecond(0).toISOString();

        // Trainer reminder email
        await supabase.from('scheduled_emails').insert({
          recipient_email: trainerEmail,
          subject: `Reminder: Soft Skills Session "${topic.topic_name}" for Batch ${topic.batch_no}`,
          body_html: `<p>Dear ${topic.trainer_name},<br>Your Soft Skills session "${topic.topic_name}" for batch ${topic.batch_no} is scheduled for ${dayjs(topic.date).format('DD-MMM-YYYY')}. This is a 1-week reminder.</p>`,
          scheduled_at: trainerReminderAt,
          status: "scheduled",
          template_name: "soft_skills_1week_trainer",
          created_at: new Date().toISOString(),
          role: "Trainer",
        });

        // Learner reminders
        const { data: learners } = await supabase
          .from("learners_data")
          .select("email, name")
          .eq("batch_no", topic.batch_no);

        for (const learner of (learners || [])) {
          await supabase.from('scheduled_emails').insert({
            recipient_email: learner.email,
            subject: `Reminder: Soft Skills Session for Batch ${topic.batch_no}`,
            body_html: `<p>Dear ${learner.name},<br>This is a reminder for the Soft Skills session "${topic.topic_name}" scheduled on ${dayjs(topic.date).format('DD-MMM-YYYY')}.</p>`,
            scheduled_at: learnerReminderAt,
            status: "scheduled",
            template_name: "soft_skills_1week_learner",
            created_at: new Date().toISOString(),
            role: "Learner",
          });
        }
      }
    }

    res.json({ success: true, message: `Scheduled ${scheduled} monthly & 1-week-prior Soft Skills reminders with configurable times.` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

//=== Handle Trainer's Confirmation and Reschedule reminders
app.post('/api/soft-skills-trainer-confirmation', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const trainerEmail = req.query.trainer_email;
    const formData = req.body;

    if (!trainerEmail) {
      return res.status(400).send("Missing query parameter: trainer_email");
    }

    // Collect changed dates for reporting
    const changes = [];

    for (const key in formData) {
      if (key.startsWith('date_')) {
        const id = key.slice(5);
        const newDate = formData[key];
        const topicId = formData[`id_${id}`];

        if (!topicId) continue;

        const { data: oldTopic, error: fetchError } = await supabase
          .from('course_planner_data')
          .select('date, batch_no, topic_name, trainer_name, trainer_email')
          .eq('id', topicId)
          .single();

        if (fetchError || !oldTopic) {
          console.error(`Error fetching topic id ${topicId}:`, fetchError);
          continue;
        }

        if (!oldTopic.date || oldTopic.date.slice(0, 10) !== newDate) {
          const { error: updateError } = await supabase
            .from('course_planner_data')
            .update({ date: newDate })
            .eq('id', topicId);

          if (updateError) {
            console.error(`Error updating date for topic ${topicId}:`, updateError);
            continue;
          }

          changes.push({
            topicId,
            topic_name: oldTopic.topic_name,
            batch_no: oldTopic.batch_no,
            oldDate: oldTopic.date.slice(0, 10),
            newDate,
            trainer_name: oldTopic.trainer_name,
            trainer_email: oldTopic.trainer_email,
          });
        }
      }
    }

    if (changes.length === 0) {
      return res.send("<h3>No changes detected. Dates remain the same. Thank you!</h3>");
    }

    // Fetch active coordinator and managers emails/names
    const { data: recipients, error: recpError } = await supabase
      .from('internal_users')
      .select('email, name, role')
      .in('role', ['Coordinator', 'Manager'])
      .eq('is_active', true);

    if (recpError || !recipients?.length) {
      console.error('No coordinators or managers found or error:', recpError);
      return res.status(500).send('Failed to find coordinators or managers to notify.');
    }

    // Separate coordinator emails and manager emails for proper TO and CC
    const coordinatorEmails = recipients.filter(r => r.role === 'Coordinator').map(r => r.email);
    const managerEmails = recipients.filter(r => r.role === 'Manager').map(r => r.email);

    if (coordinatorEmails.length === 0) {
      console.error('No active coordinator emails found.');
      return res.status(500).send('No active coordinator emails found.');
    }

    // Compose email content
    let htmlRows = '';
    const csvRows = ["Batch No,Topic,Old Date,New Date"];
    for (const chg of changes) {
      htmlRows += `<tr>
        <td>${chg.batch_no}</td>
        <td>${chg.topic_name}</td>
        <td>${chg.oldDate}</td>
        <td>${chg.newDate}</td>
      </tr>`;
      csvRows.push(`"${chg.batch_no}","${chg.topic_name}","${chg.oldDate}","${chg.newDate}"`);
    }

    const htmlSummary = `
      <p>Dear ${coordinatorEmails.join(', ')},</p>
      <p>The following Soft Skills session dates have been updated by trainer ${trainerEmail}:</p>
      <table border="1" cellpadding="5" style="border-collapse:collapse;">
        <thead><tr><th>Batch No</th><th>Topic</th><th>Old Date</th><th>New Date</th></tr></thead>
        <tbody>${htmlRows}</tbody>
      </table>
      <p>Please find attached the detailed CSV report.</p>
    `;

    const csvContent = csvRows.join('\n');

    await sendRawEmail({
      to: [...coordinatorEmails, ...managerEmails].join(','),
      subject: `Soft Skills Session Dates Updated by Trainer ${trainerEmail}`,
      html: htmlSummary,
      attachments: [
        {
          filename: `soft_skills_date_changes_${trainerEmail}.csv`,
          content: Buffer.from(csvContent),
        }
      ]
    });

    // Reschedule 1-week reminders for trainers and learners...
    const nowIso = new Date().toISOString();
    for (const chg of changes) {
      const trainerReminderDate = dayjs(chg.newDate)
        .subtract(7, 'day')
        .hour(10)
        .minute(0)
        .second(0)
        .millisecond(0)
        .toISOString();

      const learnerReminderDate = dayjs(chg.newDate)
        .subtract(7, 'day')
        .hour(9)
        .minute(0)
        .second(0)
        .millisecond(0)
        .toISOString();

      // Delete old reminders for this batch and recipient emails
      await supabase.from('scheduled_emails').delete()
        .or(`template_name.eq.soft_skills_1week_trainer,template_name.eq.soft_skills_1week_learner`)
        .eq('batch_no', chg.batch_no)
        .or(`recipient_email.eq.${chg.trainer_email},recipient_email.in.${(await supabase.from('learners_data').select('email').eq('batch_no', chg.batch_no).then(r => r.data.map(l => l.email))).join(',')}`);

      // Insert trainer reminder
      await supabase.from('scheduled_emails').insert({
        recipient_email: chg.trainer_email,
        subject: `Reminder: Soft Skills Session "${chg.topic_name}" for Batch ${chg.batch_no}`,
        body_html: `<p>Dear ${chg.trainer_name},<br>Your Soft Skills session "${chg.topic_name}" for batch ${chg.batch_no} is scheduled on ${dayjs(chg.newDate).format('DD-MMM-YYYY')}.</p>`,
        scheduled_at: trainerReminderDate,
        status: 'scheduled',
        template_name: 'soft_skills_1week_trainer',
        created_at: nowIso,
        role: 'Trainer',
      });

      // Insert learner reminders
      const { data: learners } = await supabase.from('learners_data').select('email, name').eq('batch_no', chg.batch_no);
      for (const learner of learners || []) {
        await supabase.from('scheduled_emails').insert({
          recipient_email: learner.email,
          subject: `Reminder: Soft Skills Session for Batch ${chg.batch_no}`,
          body_html: `<p>Dear ${learner.name},<br>This is a reminder for the Soft Skills session "${chg.topic_name}" scheduled on ${dayjs(chg.newDate).format('DD-MMM-YYYY')}.</p>`,
          scheduled_at: learnerReminderDate,
          status: 'scheduled',
          template_name: 'soft_skills_1week_learner',
          created_at: nowIso,
          role: 'Learner',
        });
      }
    }

    res.send(`
      <html><head><style>
        body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
        .success { color: green; font-size: 24px; margin-bottom: 20px; }
      </style></head><body>
        <div class="success">Soft Skills Dates Confirmed Successfully!</div>
        <p>The coordinator and managers have been notified.</p>
      </body></html>
    `);

  } catch (err) {
    console.error('Error in soft-skills-trainer-confirmation:', err);
    res.status(500).send('Internal Server Error');
  }
});

//===Resend the failed emails===
// Resend Failed Emails API
app.post("/api/resend-failed-emails", async (req, res) => {
  try {
    const { batch_no } = req.body || {};

    let query = supabase
      .from("scheduled_emails")
      .select("*")
      .eq("status", "failed");

    if (batch_no) {
      query = query.eq("batch_no", batch_no);
    }

    const { data: failedEmails, error } = await query;

    if (error) {
      throw error;
    }
    if (!failedEmails || failedEmails.length === 0) {
      return res.json({ message: "No failed emails found" });
    }

    const newScheduledAt = dayjs().add(1, 'minute').toISOString();

    const idsToRetry = failedEmails.map(e => e.id);

    const { error: updateError } = await supabase
      .from("scheduled_emails")
      .update({
        status: "scheduled",
        retry_count: 0,
        error: null,
        scheduled_at: newScheduledAt,
        updated_at: dayjs().toISOString(),
      })
      .in("id", idsToRetry);

    if (updateError) {
      throw updateError;
    }

    res.json({
      message: `Reset ${idsToRetry.length} failed emails with new scheduled_at: ${newScheduledAt}`,
      count: idsToRetry.length
    });

  } catch (err) {
    console.error("Failed to resend emails:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// Filter emails by batch_no and/or recipient_email
app.get('/api/mail-dashboard/list', async (req, res) => {
  const { batch_no, recipient_email } = req.query;
  
  try {
    let query = supabase.from('scheduled_emails').select('*');
    
    if (batch_no) query = query.eq('batch_no', batch_no);
    if (recipient_email) query = query.ilike('recipient_email', `%${recipient_email}%`);
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Ensure ID field is included
    const formattedData = data.map(row => ({
      ...row,
      id: row.id || row.mail_id, // Ensure ID is present
    }));
    
    res.json(formattedData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update recipient email
// Update recipient email in both scheduled_emails and learners_data tables
app.post('/api/mail/update-email', async (req, res) => {
  const { mail_id, new_email } = req.body;
  
  console.log('[API] Updating email for mail_id:', mail_id, 'to:', new_email);
  
  if (!mail_id || !new_email) {
    return res.status(400).json({ 
      success: false, 
      error: 'mail_id and new_email are required' 
    });
  }
  
  try {
    // Step 1: Get the current email and batch_no from scheduled_emails
    const { data: currentEmail, error: fetchError } = await supabase
      .from('scheduled_emails')
      .select('recipient_email, batch_no')
      .eq('id', mail_id)
      .single();
    
    if (fetchError) {
      console.error('[API] Error fetching current email:', fetchError);
      return res.status(500).json({ success: false, error: fetchError.message });
    }
    
    if (!currentEmail) {
      return res.status(404).json({ success: false, error: 'Email record not found' });
    }
    
    const oldEmail = currentEmail.recipient_email;
    const batchNo = currentEmail.batch_no;
    
    console.log('[API] Old email:', oldEmail);
    console.log('[API] Batch No:', batchNo);
    
    // Step 2: Update scheduled_emails table
    const { data: scheduledData, error: scheduledError } = await supabase
      .from('scheduled_emails')
      .update({ recipient_email: new_email })
      .eq('id', mail_id)
      .select();
    
    if (scheduledError) {
      console.error('[API] Supabase scheduled_emails update error:', scheduledError);
      return res.status(500).json({ success: false, error: scheduledError.message });
    }
    
    console.log('[API] scheduled_emails updated successfully');
    
    // Step 3: Update learners_data table
    // Find the learner with the old email and same batch_no
    const { data: learnerData, error: learnerUpdateError } = await supabase
      .from('learners_data')
      .update({ email: new_email })
      .eq('email', oldEmail)
      .eq('batch_no', batchNo)
      .select();
    
    if (learnerUpdateError) {
      console.error('[API] learners_data update error:', learnerUpdateError);
      // Email was updated in scheduled_emails but failed in learners_data
      return res.json({ 
        success: true, 
        message: 'Email updated in scheduled_emails, but failed to update learners_data',
        warning: learnerUpdateError.message,
        data: scheduledData
      });
    }
    
    if (!learnerData || learnerData.length === 0) {
      console.log('[API] No matching learner found in learners_data table');
      return res.json({ 
        success: true, 
        message: 'Email updated in scheduled_emails, but no matching learner found',
        warning: 'Learner not found in learners_data table',
        data: scheduledData
      });
    }
    
    console.log('[API] learners_data updated successfully:', learnerData);
    
    res.json({ 
      success: true, 
      message: 'Email updated successfully in both tables', 
      data: {
        scheduled_emails: scheduledData,
        learners_data: learnerData
      }
    });
  } catch (err) {
    console.error('[API] Error updating email:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update actual date - Supabase version
app.post("/api/update-actual-date", async (req, res) => {
  try {
    const { topic_id, actual_date, changed_by } = req.body;

    // 1. Get planned date and batch/topic info
    const { data: topicData, error: topicError } = await supabase
      .from("course_planner_data")
      .select("date, topic_name, batch_no")
      .eq("id", topic_id)
      .single();

    if (topicError || !topicData) {
      console.error("Error fetching topic:", topicError);
      return res.json({ success: false, error: "Topic not found" });
    }

    const plannedDate = new Date(topicData.date);
    const actualDateObj = new Date(actual_date);

    // 2. Calculate difference in days (can be +, -, or 0)
    const timeDiff = actualDateObj - plannedDate;
    const daysDiff = Math.round(timeDiff / (1000 * 60 * 60 * 24));

    // 3. Update course_planner_data
    const { error: updateError } = await supabase
      .from("course_planner_data")
      .update({
        actual_date: actual_date,
        date_difference: daysDiff,          // important: store 0 for on-time
        date_changed_by: changed_by,
        date_changed_at: new Date().toISOString(),
      })
      .eq("id", topic_id);

    if (updateError) {
      console.error("Error updating course_planner_data:", updateError);
      return res.json({ success: false, error: updateError.message });
    }

    // 4. Insert into audit table (for detailed report)
    const { error: auditError } = await supabase
      .from("date_change_audit")
      .insert({
        topic_id: topic_id,
        batch_no: topicData.batch_no,
        topic_name: topicData.topic_name,
        planned_date: topicData.date,
        actual_date: actual_date,
        date_difference: daysDiff,          // again, 0 is stored for on-time
        changed_by: changed_by,
        changed_at: new Date().toISOString(),
      });

    if (auditError) {
      console.error("Error inserting audit record:", auditError);
      // Do not fail the main request if audit logging fails
    }

    // 5. Human‑readable message
    const message =
      daysDiff > 0
        ? `Topic completed ${daysDiff} day(s) later than planned`
        : daysDiff < 0
        ? `Topic completed ${Math.abs(daysDiff)} day(s) earlier than planned`
        : "Topic completed on planned date (On time)";

    return res.json({
      success: true,
      date_difference: daysDiff,
      message,
    });
  } catch (error) {
    console.error("Error updating actual date:", error);
    return res.json({ success: false, error: error.message });
  }
});

// Get date change report for a batch - Supabase version
app.get("/api/date-change-report/:batch_no", async (req, res) => {
  try {
    const { batch_no } = req.params;

    const { data, error } = await supabase
      .from("date_change_audit")
      .select(`
        id,
        topic_name,
        planned_date,
        actual_date,
        date_difference,
        changed_by,
        changed_at,
        topic_id
      `)
      .eq("batch_no", batch_no)
      .order("changed_at", { ascending: false });

    if (error) {
      console.error("Error fetching report:", error);
      return res.json({ error: error.message });
    }

    const enrichedData = await Promise.all(
      (data || []).map(async (item) => {
        const { data: topicData, error: topicError } = await supabase
          .from("course_planner_data")
          .select(
            "module_name, trainer_name, trainer_email, topic_status, remarks"
          )
          .eq("id", item.topic_id)
          .single();

        if (topicError) {
          console.error("Error fetching topic details:", topicError);
        }

        return {
          id: item.id,
          topic_name: item.topic_name,
          planned_date: item.planned_date,
          actual_date: item.actual_date,
          date_difference: item.date_difference, // +, -, or 0
          changed_by: item.changed_by,
          changed_at: item.changed_at,
          module_name: topicData?.module_name || "N/A",
          trainer_name: topicData?.trainer_name || "N/A",
          trainer_email: topicData?.trainer_email || "N/A",
          topic_status: topicData?.topic_status || "N/A",
          remarks: topicData?.remarks || "",
        };
      })
    );

    return res.json(enrichedData);
  } catch (error) {
    console.error("Error fetching date change report:", error);
    return res.json({ error: error.message });
  }
});


// Get summary statistics for a batch - Supabase version
app.get("/api/batch-date-summary/:batch_no", async (req, res) => {
  try {
    const { batch_no } = req.params;

    // Only topics where actual_date is set are considered "completed"
    const { data, error } = await supabase
      .from("course_planner_data")
      .select("date_difference")
      .eq("batch_no", batch_no)
      .not("actual_date", "is", null);

    if (error) {
      console.error("Error fetching summary:", error);
      return res.json({ error: error.message });
    }

    let delayed_count = 0;
    let early_count = 0;
    let ontime_count = 0;
    let sum_difference = 0;
    let max_delay = 0;
    let max_early = 0;

    (data || []).forEach((item) => {
      // If date_difference is NULL in DB, treat as 0 (on time)
      const diff =
        typeof item.date_difference === "number"
          ? item.date_difference
          : 0;

      if (diff > 0) {
        delayed_count += 1;
        if (diff > max_delay) max_delay = diff;
      } else if (diff < 0) {
        early_count += 1;
        if (diff < max_early) max_early = diff;
      } else {
        // diff === 0 → on time
        ontime_count += 1;
      }

      sum_difference += diff;
    });

    const avg_difference =
      data && data.length > 0 ? sum_difference / data.length : 0;

    return res.json({
      delayed_count,
      early_count,
      ontime_count,                 // this drives the "On Time" card
      avg_difference: avg_difference.toFixed(2),
      max_delay,
      max_early,
    });
  } catch (error) {
    console.error("Error fetching batch summary:", error);
    return res.json({ error: error.message });
  }
});

// Weekly date-change report for a batch & week
// ROUTE 1: JSON data for table display (MUST have this first)
app.get("/api/weekly-date-report/:batch_no", async (req, res) => {
  try {
    const { batch_no } = req.params;
    const { week_no } = req.query;

    if (!week_no) {
      return res.status(400).json({ error: "week_no query parameter is required" });
    }

    const { data: topics, error: topicsError } = await supabase
      .from("course_planner_data")
      .select(`
        id,
        batch_no,
        week_no,
        module_name,
        topic_name,
        trainer_name,
        trainer_email,
        topic_status,
        remarks,
        date,
        actual_date,
        date_difference,
        date_changed_by,
        date_changed_at
      `)
      .eq("batch_no", batch_no)
      .eq("week_no", week_no)
      .order("date", { ascending: true });

    if (topicsError) {
      console.error("Topics error:", topicsError);
      return res.status(500).json({ error: topicsError.message });
    }

    if (!topics?.length) return res.json([]);

    const topicIds = topics.map(t => t.id);
    const { data: audits } = await supabase
      .from("date_change_audit")
      .select("id, topic_id, batch_no, topic_name, planned_date, actual_date, date_difference, changed_by, changed_at")
      .in("topic_id", topicIds)
      .order("changed_at", { ascending: false });

    const latestAuditByTopic = {};
    audits?.forEach(row => {
      if (!latestAuditByTopic[row.topic_id]) {
        latestAuditByTopic[row.topic_id] = row;
      }
    });

    const result = topics.map(t => {
      const audit = latestAuditByTopic[t.id];
      return {
        id: audit?.id || t.id,
        topic_id: t.id,
        batch_no: t.batch_no,
        week_no: t.week_no,
        module_name: t.module_name || "N/A",
        topic_name: audit?.topic_name || t.topic_name,
        trainer_name: t.trainer_name || "N/A",
        planned_date: audit?.planned_date || t.date,
        actual_date: audit?.actual_date || t.actual_date || t.date,
        date_difference: Number(audit?.date_difference ?? t.date_difference ?? 0),
        topic_status: t.topic_status || "N/A",
        changed_by: audit?.changed_by || t.date_changed_by || null,
        changed_at: audit?.changed_at || t.date_changed_at || null,
        remarks: t.remarks || "",
      };
    });

    res.json(result);
  } catch (error) {
    console.error("Weekly report error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ROUTE 2: PDF download (install pdfkit first: npm install pdfkit)
app.get("/api/weekly-date-report/:batch_no/pdf", async (req, res) => {
  try {
    const { batch_no } = req.params;
    const { week_no } = req.query;

    if (!week_no) {
      return res.status(400).json({ error: "week_no query parameter is required" });
    }

    const { data: topics } = await supabase
      .from("course_planner_data")
      .select(`
        id,
        batch_no,
        week_no,
        module_name,
        topic_name,
        trainer_name,
        trainer_email,
        topic_status,
        remarks,
        date,
        actual_date,
        date_difference,
        date_changed_by,
        date_changed_at
      `)
      .eq("batch_no", batch_no)
      .eq("week_no", week_no)
      .order("date", { ascending: true });

    if (!topics?.length) {
      return res.status(404).json({ error: "No data found" });
    }

    const topicIds = topics.map(t => t.id);
    const { data: audits } = await supabase
      .from("date_change_audit")
      .select("id, topic_id, batch_no, topic_name, planned_date, actual_date, date_difference, changed_by, changed_at")
      .in("topic_id", topicIds)
      .order("changed_at", { ascending: false });

    const latestAuditByTopic = {};
    audits?.forEach(row => {
      if (!latestAuditByTopic[row.topic_id]) {
        latestAuditByTopic[row.topic_id] = row;
      }
    });

    const rows = topics.map(t => {
      const audit = latestAuditByTopic[t.id];
      return {
        module_name: t.module_name || "N/A",
        topic_name: audit?.topic_name || t.topic_name,
        planned_date: new Date(audit?.planned_date || t.date).toLocaleDateString("en-IN"),
        actual_date: new Date(audit?.actual_date || t.actual_date || t.date).toLocaleDateString("en-IN"),
        date_difference: Number(audit?.date_difference ?? t.date_difference ?? 0),
        topic_status: t.topic_status || "N/A",
        changed_by: audit?.changed_by || t.date_changed_by || "N/A",
        changed_at: audit?.changed_at ? new Date(audit.changed_at).toLocaleDateString("en-IN") : "-",
      };
    });

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Weekly_Report_${batch_no}_Week${week_no}.pdf"`
    );
    doc.pipe(res);

    // Header band
    doc.rect(40, 40, 515, 80).fill("#1f5a6b");
    doc.fontSize(24).font("Helvetica-Bold").fillColor("white")
      .text("Weekly Date Change Report", 50, 55);
    doc.fontSize(11).font("Helvetica").fillColor("#e8f4f8")
      .text(`Batch: ${batch_no}  |  Week: ${week_no}`, 50, 85);
    doc.fontSize(9).font("Helvetica").fillColor("#e8f4f8")
      .text(`Generated: ${new Date().toLocaleString("en-IN")}`, 380, 85, { align: "right" });
    doc.fillColor("#000000");

    doc.moveDown(3);

    // Wider columns + wrapping for Module / Topic
    const headers = ["Module", "Topic", "Planned", "Actual", "Difference", "Status", "Changed By", "Date"];
    const colWidths = [80, 150, 55, 55, 60, 55, 70, 50]; // wider Module/Topic
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);
    const margin = 40;
    let y = doc.y + 15;

    const rowPaddingY = 6;

    const drawHeader = () => {
      doc.rect(margin, y, tableWidth, 22).fill("#2d7a8a");
      doc.fontSize(10).font("Helvetica-Bold").fillColor("white");
      let x = margin + 5;
      headers.forEach((h, i) => {
        doc.text(h, x, y + 6, { width: colWidths[i] - 8 });
        x += colWidths[i];
      });
      doc.fillColor("#000000");
      y += 22;
    };

    const ensureSpace = (rowHeight) => {
      if (y + rowHeight > 780) {
        doc.addPage();
        y = 40;
        drawHeader();
      }
    };

    drawHeader();

    rows.forEach((row, idx) => {
      // Estimate multi-line height for module & topic
      doc.fontSize(9).font("Helvetica");
      const moduleHeight = doc.heightOfString(row.module_name, {
        width: colWidths[0] - 8,
      });
      const topicHeight = doc.heightOfString(row.topic_name, {
        width: colWidths[1] - 8,
      });
      const contentHeight = Math.max(moduleHeight, topicHeight, 10);
      const rowHeight = contentHeight + rowPaddingY * 2;

      ensureSpace(rowHeight);

      const bg = idx % 2 === 0 ? "#f9f9f9" : "#ffffff";
      doc.rect(margin, y, tableWidth, rowHeight).fill(bg).stroke("#d0d0d0");
      let x = margin + 5;
      const textY = y + rowPaddingY;

      // Module (wrapped)
      doc.fillColor("#000000").text(row.module_name, x, textY, {
        width: colWidths[0] - 8,
      });
      x += colWidths[0];

      // Topic (wrapped)
      doc.text(row.topic_name, x, textY, {
        width: colWidths[1] - 8,
      });
      x += colWidths[1];

      // Planned
      doc.text(row.planned_date, x, textY, {
        width: colWidths[2] - 8,
        align: "center",
      });
      x += colWidths[2];

      // Actual
      doc.text(row.actual_date, x, textY, {
        width: colWidths[3] - 8,
        align: "center",
      });
      x += colWidths[3];

      // Difference badge
      const diff = row.date_difference;
      const diffStr = diff > 0 ? `+${diff} d` : diff < 0 ? `${diff} d` : "0 d";
      const badgeBg =
        diff > 0 ? "#ff9800" : diff < 0 ? "#4caf50" : "#9e9e9e";
      doc.rect(x + 5, textY, 50, 12).fill(badgeBg);
      doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold").text(
        diffStr,
        x + 5,
        textY + 2,
        { width: 50, align: "center" }
      );
      doc.fillColor("#000000").fontSize(9).font("Helvetica");
      x += colWidths[4];

      // Status
      doc.text(row.topic_status, x, textY, {
        width: colWidths[5] - 8,
        align: "center",
      });
      x += colWidths[5];

      // Changed By
      doc.text(row.changed_by, x, textY, {
        width: colWidths[6] - 8,
        align: "center",
      });
      x += colWidths[6];

      // Date
      doc.text(row.changed_at, x, textY, {
        width: colWidths[7] - 8,
        align: "center",
      });

      y += rowHeight;
    });

    doc.fontSize(8).fillColor("#888888").text(
      `Total Records: ${rows.length}`,
      margin,
      780
    );

    doc.end();
  } catch (err) {
    console.error("PDF error:", err);
    res.status(500).json({ error: err.message });
  }
});


// Get email content for viewing/editing
app.get('/api/mail/content', async (req, res) => {
  const { mail_id } = req.query;
  
  console.log('[API] Fetching email content for mail_id:', mail_id);
  
  if (!mail_id) {
    return res.status(400).json({ success: false, error: 'mail_id is required' });
  }
  
  try {
    const { data, error } = await supabase
      .from('scheduled_emails')
      .select('id, batch_no, recipient_email, template_name, subject, body_html, status')
      .eq('id', mail_id)
      .single();
    
    if (error) {
      console.error('[API] Supabase error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
    
    if (!data) {
      return res.status(404).json({ success: false, error: 'Email not found' });
    }
    
    console.log('[API] Email data found:', {
      id: data.id,
      subject: data.subject,
      hasBody: !!data.body_html,
      bodyLength: data.body_html ? data.body_html.length : 0,
    });
    
    res.json({ 
      success: true, 
      email: {
        id: data.id,
        recipient_email: data.recipient_email,
        subject: data.subject || `Email for ${data.template_name}`,
        body: data.body_html || 'No email body found',
        template_name: data.template_name,
        batch_no: data.batch_no,
        status: data.status,
      }
    });
  } catch (err) {
    console.error('[API] Error fetching email content:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Resend email with edited content
app.post('/api/mail/resend', async (req, res) => {
  const { mail_id, recipient_email, subject, body } = req.body;
  
  console.log('[API] Resending email for mail_id:', mail_id);
  
  if (!mail_id || !recipient_email || !subject || !body) {
    return res.status(400).json({ 
      success: false, 
      error: 'mail_id, recipient_email, subject, and body are required' 
    });
  }
  
  try {
    // Send email using nodemailer
    await mailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to: recipient_email,
      subject: subject,
      html: body,
    });
    
    console.log('[API] Email sent successfully to:', recipient_email);
    
    // Update database with new content and sent timestamp
    const { data, error } = await supabase
      .from('scheduled_emails')
      .update({ 
        subject: subject,
        body_html: body,
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', mail_id)
      .select();
    
    if (error) {
      console.error('[API] Database update error:', error);
      // Email was sent but DB update failed
      return res.json({ 
        success: true, 
        message: 'Email sent but database update failed',
        warning: error.message 
      });
    }
    
    console.log('[API] Database updated successfully');
    res.json({ 
      success: true, 
      message: 'Email resent successfully',
      data 
    });
  } catch (err) {
    console.error('[API] Error resending email:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

//===Reply to the emails of that template
app.post("/api/mail/reply", async (req, res) => {
  const { batch_no, mode, template_name, email_body } = req.body;

  if (!template_name || !email_body || typeof email_body !== "string") {
    return res.status(400).json({ error: "Missing or invalid required fields" });
  }

  try {
    // 1. Find the template_id for the given template_name from scheduled_emails (using the first match)
    const { data: templateRows, error: templateError } = await supabase
      .from("scheduled_emails")
      .select("template_id")
      .eq("template_name", template_name)
      .not("template_id", "is", null)
      .limit(1);

    if (templateError) {
      console.error("Error fetching template_id from scheduled_emails:", templateError);
      return res.status(500).json({ error: "Failed to fetch template_id" });
    }
    if (!templateRows || templateRows.length === 0) {
      return res.status(404).json({ error: "No template_id found for selected template_name" });
    }

    const template_id = templateRows[0].template_id;

    // 2. Lookup all sent emails for that template_id and template_name (and optionally by batch/mode)
    let scheduledQuery = supabase
      .from("scheduled_emails")
      .select("id, recipient_email, message_id, template_id")
      .eq("template_id", template_id)
      .eq("template_name", template_name)
      .eq("status", "sent");

    if (batch_no) scheduledQuery = scheduledQuery.eq("batch_no", batch_no);
    if (mode) scheduledQuery = scheduledQuery.eq("mode", mode);

    const { data: sentEmails, error: sentError } = await scheduledQuery;

    if (sentError) {
      console.error("Error fetching sent emails:", sentError);
      return res.status(500).json({ error: "Failed to fetch sent emails" });
    }
    if (!sentEmails || sentEmails.length === 0) {
      return res.status(404).json({ error: "No previously sent emails found for this template to reply to." });
    }

    // 3. Prepare a mapping recipient_email -> (most recent) message_id
    // If multiple emails per recipient, pick the latest (higher id or later sent_at)
    const recipientToOriginal = {};
    sentEmails.forEach(email => {
      // If needed, can prioritize by sent_at or id
      recipientToOriginal[email.recipient_email] = email.message_id;
    });

    // 4. Reply to each thread only if we have the original message_id
    let sentCount = 0;
    const sendPromises = Object.entries(recipientToOriginal).map(async ([to, originalMessageId]) => {
      if (!to || !originalMessageId) {
        console.warn("Skipping reply to", to, "due to missing messageId");
        return;
      }

      const sendResult = await sendRawEmail({
        to,
        subject: `Reply: ${template_name}`,
        html: `<p>${email_body}</p>`,
        inReplyTo: originalMessageId,
        references: originalMessageId,
      });

      if (sendResult.success) {
        sentCount++;
        // Optionally log or write reply info
      } else {
        console.error("Failed to send reply to", to, sendResult.error);
      }
    });

    await Promise.all(sendPromises);

    res.json({ success: true, message: `Reply emails sent successfully to ${sentCount} threads for template '${template_name}'.` });
  } catch (err) {
    console.error("Error in reply-to-sent-mail threading:", err);
    res.status(500).json({ error: "Failed to send threaded reply emails" });
  }
});

//===Update the offset values===
app.post("/api/update-offsets", async (req, res) => {
  const { mode, batch_type, base_offset } = req.body;

  if (mode == null || base_offset == null) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    // Fetch templates filtered by mode and batch_type only
    const { data: templates, error } = await supabase
      .from("email_templates")
      .select("id, offset_days")
      .eq("mode", mode)
      .eq("batch_type", batch_type || "")
      .order("offset_days", { ascending: true });

    if (error) throw error;
    if (!templates || templates.length === 0) {
      return res.status(404).json({ error: "No templates found for given mode and batch_type" });
    }

    const currentMin = templates[0].offset_days;
    const delta = base_offset - currentMin;

    // Update offset_days one by one
    for (const t of templates) {
      const newOffset = t.offset_days + delta;
      const { error: updateError } = await supabase
        .from("email_templates")
        .update({ offset_days: newOffset })
        .eq("id", t.id);

      if (updateError) throw updateError;
    }

    res.json({ message: `Offsets updated for ${templates.length} templates.` });
  } catch (err) {
    console.error("Error updating offsets:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

//===Fetch the topics for the selected batch for the Trainer Dashboard
app.get('/api/topics/:batch_no', async (req, res) => {
  const batchNo = req.params.batch_no;
  const weekNo = req.query.week_no;

  if (!batchNo) {
    return res.status(400).json({ error: "Batch number is required" });
  }

  try {
    // Query topics from your course_planner_data table filtered by batch_no, optionally by week_no
    let query = supabase
      .from('course_planner_data')
      .select('id, topic_name, module_name, date, remarks, topic_status, week_no')
      .eq('batch_no', batchNo);

    if (weekNo) {
      query = query.eq('week_no', weekNo);
    }

    // Order by date ascending to have topics in chronological order
    const { data, error } = await query.order('date', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('Error fetching topics:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

//===Load the week no before the topics===
app.get('/api/weeks/:batch_no', async (req, res) => {
  const batch_no = req.params.batch_no;

  const { data, error } = await supabase
    .from('course_planner_data')
    .select('week_no')
    .eq('batch_no', batch_no)
    .order('week_no', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Extract distinct week_nos
  const distinctWeeks = [...new Set(data.map(d => d.week_no))].filter(w => w !== null && w !== undefined);

  res.json(distinctWeeks);
});


//===Update the topic status in the Trainer Dashboard===
app.post("/api/update-topic-status", async (req, res) => {
  const { topic_id, status } = req.body;
  if (!topic_id || !status) {
    return res.status(400).json({ success: false, error: "Topic ID and status are required" });
  }
  try {
    const { error } = await supabase
      .from("course_planner_data")
      .update({ topic_status: status })
      .eq("id", topic_id);
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    return res.json({ success: true, topic_id, status });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});


//===Update the topic remarks in the Trainer Dashboard===
app.post("/api/update-remarks", async (req, res) => {
  const { topic_id, remarks } = req.body;
  if (!topic_id) {
    return res.status(400).json({ success: false, error: "Topic ID is required" });
  }

  try {
    const { error } = await supabase
      .from("course_planner_data")
      .update({ remarks })
      .eq("id", topic_id);

    if (error) {
      console.error("Error updating remarks:", error);
      return res.status(500).json({ success: false, error: "Failed to update remarks" });
    }

    return res.json({ success: true, message: "Remarks updated" });
  } catch (err) {
    console.error("Exception updating remarks:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// === Mock Interview Scheduling ===
app.post("/api/mock-interview-schedule", async (req, res) => {
  try {
    const { batch_no, interview_date } = req.body;
    if (!batch_no || !interview_date) {
      return res.status(400).json({ error: "batch_no and interview_date required" });
    }

    const { data: learners, error: learnerErr } = await supabase
      .from("learners_data")
      .select("email, name")
      .eq("batch_no", batch_no);
    if (learnerErr) throw learnerErr;

    const { data: batchInfo, error: batchErr } = await supabase
      .from("course_planner_data")
      .select("trainer_email, trainer_name")
      .eq("batch_no", batch_no)
      .not("trainer_email", "is", null)
      .limit(1)
      .maybeSingle();
    if (batchErr) throw batchErr;

    const trainerEmail = batchInfo?.trainer_email;
    const trainerName = batchInfo?.trainer_name || "Trainer";
    if (!trainerEmail) {
      return res.status(404).json({ error: "Trainer email not found for batch" });
    }

    const learnerTime = process.env.MOCK_INTERVIEW_LEARNER_TIME || "09:00";
    const trainerTime = process.env.MOCK_INTERVIEW_TRAINER_TIME || "09:00";

    const learnerScheduledAt = computeTodayISO(learnerTime);
    const trainerScheduledAt = computeTodayISO(trainerTime);

    // Learner emails
    for (const learner of learners) {
      await supabase.from("scheduled_emails").insert({
        batch_no,
        recipient_email: learner.email,
        subject: `Mock Interview Scheduled for batch ${batch_no}`,
        body_html: `<p>Dear ${learner.name || "Learner"},</p>
                    <p>Your mock interview for batch <strong>${batch_no}</strong> 
                    has been scheduled on <b>${interview_date}</b>.</p>`,
        scheduled_at: learnerScheduledAt,
        status: "scheduled",
        mode: "Online",
        template_name: "Mock Interview Learner Notification",
        source: "mock_interview",
        created_at: new Date().toISOString(),
      });
    }

    // Trainer email
    await supabase.from("scheduled_emails").insert({
      batch_no,
      recipient_email: trainerEmail,
      subject: `Mock Interview Scheduled for batch ${batch_no}`,
      body_html: `<p>Dear ${trainerName},</p>
                  <p>The mock interview for batch <strong>${batch_no}</strong> 
                  is scheduled on <b>${interview_date}</b>.</p>`,
      scheduled_at: trainerScheduledAt,
      status: "scheduled",
      mode: "Offline",
      template_name: "Mock Interview Trainer Notification",
      source: "mock_interview",
      created_at: new Date().toISOString(),
    });

    // Coordinator email (hardcoded)
    const coordinatorEmail = "coordinator@chipedge.com";
    const coordinatorName = "Kowshika";

    await supabase.from("scheduled_emails").insert({
      batch_no,
      recipient_email: coordinatorEmail,
      subject: `Mock Interview Scheduled for batch ${batch_no}`,
      body_html: `<p>Dear ${coordinatorName},</p>
                  <p>The mock interview for batch <strong>${batch_no}</strong> 
                  has been scheduled on <b>${interview_date}</b> with <strong>${trainerName}</strong>.</p>`,
      scheduled_at: trainerScheduledAt,
      status: "scheduled",
      mode: "Notification",
      template_name: "Mock Interview Coordinator Notification",
      source: "mock_interview",
      created_at: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: `Scheduled ${learners.length + 2} emails successfully`,
      scheduled: learners.length + 2,
      batch_no,
      interview_date,
      learner_time: learnerTime,
      trainer_time: trainerTime,
      learner_scheduled_at: learnerScheduledAt,
      trainer_scheduled_at: trainerScheduledAt,
    });
  } catch (err) {
    console.error("❌ Error scheduling mock interview:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Soft Skill Announcement Scheduling API
app.post("/api/soft-skill-announcement", async (req, res) => {
  try {
    const { batch_no, date } = req.body;
    if (!batch_no || !date) {
      return res.status(400).json({ error: "batch_no and date required" });
    }

    // Fetch learners of the batch
    const { data: learners, error: learnerErr } = await supabase
      .from("learners_data")
      .select("email, name")
      .eq("batch_no", batch_no);
    if (learnerErr) throw learnerErr;

    // Fetch trainer info of the batch
    const { data: trainerData, error: trainerErr } = await supabase
      .from("course_planner_data")
      .select("trainer_email, trainer_name")
      .eq("batch_no", batch_no)
      .not("trainer_email", "is", null)
      .limit(1)
      .maybeSingle();
    if (trainerErr) throw trainerErr;

    const trainerEmail = trainerData?.trainer_email;
    const trainerName = trainerData?.trainer_name || "Trainer";

    // Schedule email time: immediately (can be changed if needed)
    const scheduledAt = new Date().toISOString();

    // Insert emails for learners
    for (const learner of learners) {
      await supabase.from("scheduled_emails").insert({
        batch_no,
        recipient_email: learner.email,
        subject: `Soft Skills Class Scheduled for batch ${batch_no}`,
        body_html: `<p>Dear ${learner.name || "Learner"},</p>
                    <p>The soft skills class has been scheduled on the date <b>${date}</b>.</p>`,
        scheduled_at: scheduledAt,
        status: "scheduled",
        mode: "Online",
        template_name: "Soft Skills Learner Announcement",
        source: "soft_skill_announcement",
        created_at: new Date().toISOString(),
      });
    }

    // Insert email for trainer
    if (trainerEmail) {
      await supabase.from("scheduled_emails").insert({
        batch_no,
        recipient_email: trainerEmail,
        subject: `Soft Skills Class Scheduled for batch ${batch_no}`,
        body_html: `<p>Dear ${trainerName},</p>
                    <p>The soft skills class has been scheduled on the date <b>${date}</b>.</p>`,
        scheduled_at: scheduledAt,
        status: "scheduled",
        mode: "Offline",
        template_name: "Soft Skills Trainer Announcement",
        source: "soft_skill_announcement",
        created_at: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: `Emails scheduled for batch ${batch_no} on date ${date}`,
      batch_no,
      date,
      learner_count: learners.length,
      trainer_email_sent: !!trainerEmail,
    });
  } catch (err) {
    console.error("❌ Error scheduling soft skill announcement:", err.message);
    res.status(500).json({ error: err.message });
  }
});


//===Course Closure Announcement===
app.post("/api/course-closure", async (req, res) => {
  try {
    const { batch_no, end_date } = req.body;
    if (!batch_no || !end_date) {
      return res.status(400).json({ error: "Batch No and End Date are required" });
    }

    // 1️⃣ Fetch learners for the batch
    const { data: learners, error: learnersErr } = await supabase
      .from("learners_data")
      .select("email, name")
      .eq("batch_no", batch_no);

    if (learnersErr) throw learnersErr;
    if (!learners || learners.length === 0) {
      return res.status(404).json({ error: "No learners found for this batch" });
    }

    // 2️⃣ Fetch admin users
    const { data: admins, error: adminErr } = await supabase
      .from("users")
      .select("email, name")
      .eq("role", "admin");

    if (adminErr) throw adminErr;
    if (!admins || admins.length === 0) {
      return res.status(404).json({ error: "No admins found" });
    }

    // 🔔 Push the closure alert to admins (and Management) too.
    notify(admins.map((a) => a.email), {
      title: "Course closing soon",
      body: `${batch_no} ends on ${end_date}. Kindly disable VPN access.`,
      data: { type: "course_closure", batch_no: String(batch_no) },
    });
    notify(getRoleEmails(["Management"]), {
      title: "Course closing soon",
      body: `${batch_no} ends on ${end_date}.`,
      data: { type: "course_closure", batch_no: String(batch_no) },
    });

    // 3️⃣ Send emails to admins (you can reuse your sendRawEmail function)
    let sentCount = 0;
    for (const admin of admins) {
      const subject = `Course Closure Notification - ${batch_no}`;
      const body = `<p>Hi ${admin.name || "Admin"},</p>
                    <p>The course for <strong>${batch_no}</strong> is going to end on <strong>${end_date}</strong>.</p>
                    <p>Kindly disable the VPN access for this batch.</p>`;

      const sendResult = await sendRawEmail({
        to: admin.email,
        subject,
        html: body,
        text: body.replace(/<[^>]+>/g, ""), // plain text fallback
      });

      if (sendResult.success) sentCount++;
      else console.error(`Failed to send to ${admin.email}:`, sendResult.error);
    }

    res.json({
      success: true,
      message: `✅ Emails sent to ${sentCount} admin(s) for batch ${batch_no}`,
    });
  } catch (err) {
    console.error("Course closure error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === Upload Mock Interview Feedback and Schedule Emails ===
app.post("/api/mock-interview-feedback", upload.single("file"), async (req, res) => {
  try {
    const { batch_no } = req.body;
    const file = req.file;

    if (!batch_no || !file) {
      return res.status(400).json({ error: "Batch and file are required" });
    }

    // Get learners for this batch
    const { data: learners, error: learnersErr } = await supabase
      .from("learners_data")
      .select("email, name")
      .eq("batch_no", batch_no);

    if (learnersErr) throw learnersErr;
    if (!learners.length) return res.status(404).json({ error: "No learners found for this batch" });

    // Read file content as attachment
    const fileBuffer = fs.readFileSync(file.path);
    const originalName = file.originalname;

    // Schedule email for each learner
    const nowISO = new Date().toISOString();
    let scheduledCount = 0;

    for (const learner of learners) {
      const { error: insertError } = await supabase.from("scheduled_emails").insert({
        batch_no,
        recipient_email: learner.email,
        subject: `Your Mock Interview Feedback - Batch ${batch_no}`,
        body_html: `<p>Dear ${learner.name || "Learner"},</p>
                    <p>Here is your feedback for the mock interview conducted for batch <strong>${batch_no}</strong>.</p>
                    <p>Please find the attached file.</p>`,
        attachment_name: originalName,
        attachment_data: fileBuffer.toString("base64"), // store as base64
        scheduled_at: nowISO,
        status: "scheduled",
        mode: "Online",
        template_name: "Mock Interview Feedback",
        source: "mock_interview_feedback",
        created_at: nowISO,
      });

      if (!insertError) scheduledCount++;
      else console.error(`❌ Failed for ${learner.email}:`, insertError.message);
    }

    // Clean up uploaded file
    fs.unlinkSync(file.path);

    res.json({
      success: true,
      message: `Scheduled ${scheduledCount} feedback emails for batch ${batch_no}`,
      scheduled: scheduledCount,
    });
  } catch (err) {
    console.error("❌ Error scheduling feedback emails:", err.message);
    res.status(500).json({ error: err.message });
  }
});

//===Internal Email Communication based on the roles and template from the internal_email_templates table===
app.post("/api/internal/schedule", async (req, res) => {
  try {
    const { role, batchNo, startDate, domain } = req.body;

    // Validate required
    if (!role || !batchNo || !startDate) {
      return res.status(400).json({ error: "role, batchNo, startDate are required" });
    }

    const rolesArray = Array.isArray(role) ? role : [role];
    let totalScheduled = 0;
    let details = [];

    // Log incoming request info
    console.log("Request to schedule internal emails");
    console.log("Roles:", rolesArray);
    console.log("BatchNo:", batchNo);
    console.log("StartDate:", startDate);
    console.log("Domain:", domain);

    for (const r of rolesArray) {
      // Fetch active templates for the role
      const { data: templates, error: fetchError } = await supabase
        .from("internal_email_templates")
        .select("*")
        .eq("role", r)
        .eq("active", true);

      if (fetchError) {
        console.error(`Error fetching templates for role '${r}':`, fetchError);
        details.push({ role: r, error: fetchError.message });
        continue;
      }

      if (!templates || templates.length === 0) {
        details.push({ role: r, warning: "No active templates found" });
        continue;
      }

      console.log(`Found ${templates.length} active template(s) for role '${r}'`);

      for (const tmpl of templates) {
        // Validate recipients
        if (!tmpl.recipient_email || tmpl.recipient_email.trim() === "") {
          details.push({ role: r, template: tmpl.template_name, warning: "No recipient_email specified" });
          continue;
        }

        const recipients = tmpl.recipient_email
          .split(",")
          .map(e => e.trim())
          .filter(e => e.length > 0);

        if (recipients.length === 0) {
          details.push({ role: r, template: tmpl.template_name, warning: "No valid recipient emails found" });
          continue;
        }

        // Compose email subject and body with substitutions
        const scheduledAt = computeScheduledAtISO(
          startDate,
          tmpl.offset_days || 0,
          tmpl.send_time || "09:00"
        );

        const subj = (tmpl.subject || "")
          .replace(/{{batch_no}}/g, batchNo)
          .replace(/{{start_date}}/g, formatDate(startDate))
          .replace(/{{domain}}/g, domain || "");

        const body = (tmpl.body_html || "")
          .replace(/{{batch_no}}/g, batchNo)
          .replace(/{{start_date}}/g, formatDate(startDate))
          .replace(/{{domain}}/g, domain || "");

        // Schedule emails for each recipient
        for (const email of recipients) {
          const { error: insertErr } = await supabase.from("scheduled_emails").insert({
            batch_no: batchNo,
            template_id: tmpl.id,
            template_name: tmpl.template_name,
            recipient_email: email,
            subject: subj,
            body_html: body,
            scheduled_at: scheduledAt,
            status: "scheduled",
            mode: "Internal",
            batch_type: null,
            source: "internal_email_templates",
            role: r,
            created_at: new Date().toISOString(),
          });

          if (insertErr) {
            details.push({ role: r, recipient: email, template: tmpl.template_name, error: insertErr.message });
          } else {
            totalScheduled++;
            details.push({ role: r, recipient: email, template: tmpl.template_name, status: "scheduled" });
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Scheduled ${totalScheduled} emails successfully`,
      details,
    });
  } catch (error) {
    console.error("Error in /api/internal/schedule:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});


//===Share the feedback to the learners with the attachment===
app.post("/api/internal/feedback-share", upload.single("file"), async (req, res) => {
  try {
    const { batchNo, roles, feedbackType } = req.body;
    const file = req.file;

    if (!batchNo || !roles || !feedbackType || !file) {
      return res.status(400).json({ error: "All fields and file are required" });
    }

    // Parse roles array
    const rolesArr = JSON.parse(roles);

    // Read original Excel/CSV file
    const workbook = xlsx.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    let jsonData = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

    // Remove first 4 columns (learner details)
    jsonData = jsonData.map(row => {
      const keys = Object.keys(row);
      const newRow = {};
      for (let i = 4; i < keys.length; i++) {
        newRow[keys[i]] = row[keys[i]];
      }
      return newRow;
    });

    // Convert trimmed data back to sheet
    const newSheet = xlsx.utils.json_to_sheet(jsonData);
    const newWb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(newWb, newSheet, sheetName);
    const tempFilePath = file.path + "-trimmed" + path.extname(file.originalname);
    xlsx.writeFile(newWb, tempFilePath);

    // Read the trimmed file into buffer for email attachment
    const fileBuffer = fs.readFileSync(tempFilePath);
    const base64Data = fileBuffer.toString("base64");
    const filename = file.originalname;

    // Map roles to roles array
    const rolesToSend = rolesArr; // You sent actual roles like "Trainer", "Management", etc.

    // Fetch recipients based on roles
    let recipients = [];

    for (const role of rolesToSend) {
      if (role === "Trainer") {
        // Trainers in the batch
        const { data: trainers, error: trainerErr } = await supabase
          .from("course_planner_data")
          .select("trainer_name")
          .eq("batch_no", batchNo);
        if (trainerErr) continue;

        for (const trainer of trainers || []) {
          if (!trainer.trainer_name) continue;
          const { data: user, error: userErr } = await supabase
            .from("internal_users")
            .select("name,email,is_active")
            .eq("name", trainer.trainer_name)
            .eq("role", "Trainer")
            .eq("is_active", true)
            .single();

          if (user && user.email && user.is_active) {
            recipients.push(user);
          }
        }
      } else if (role === "Management") {
        // Both Management and Manager
        const { data: users, error: mgErr } = await supabase
          .from("internal_users")
          .select("name,email,is_active")
          .in("role", ["Management", "Manager"])
          .eq("is_active", true);
        if (users) recipients.push(...users.filter(u => u.email && u.is_active));
      } else if (role === "Learning Coordinator") {
        // Role 'Coordinator'
        const { data: coords, error: coordErr } = await supabase
          .from("internal_users")
          .select("name,email,is_active")
          .eq("role", "Coordinator")
          .eq("is_active", true);
        if (coords) recipients.push(...coords.filter(u => u.email && u.is_active));
      } else {
        // Other roles
        const { data: users, error: userErr } = await supabase
          .from("internal_users")
          .select("name,email,is_active")
          .eq("role", role)
          .eq("is_active", true);
        if (users) recipients.push(...users.filter(u => u.email && u.is_active));
      }
    }

    // Remove duplicates
    recipients = Array.from(
      new Map(
        recipients
          .filter(u => u.email && u.is_active)
          .map(u => [u.email.toLowerCase().trim(), u])
      ).values()
    );

    if (recipients.length === 0) {
      // Cleanup temp files
      fs.unlinkSync(file.path);
      fs.unlinkSync(tempFilePath);
      return res.status(404).json({ error: "No valid recipients found." });
    }

    // Send emails (immediately)
    let successCount = 0;
    let errorList = [];
    for (const user of recipients) {
      try {
        // Use your preferred email SMTP method here (Nodemailer, SendGrid, etc.)
        await sendRawEmail({
          to: user.email,
          subject: `${feedbackType} for Batch: ${batchNo}`,
          html: `<p>Hello ${user.name},</p><p>PFA for the ${feedbackType} for Batch: ${batchNo}</p>`,
          attachments: [{ filename: filename, content: fileBuffer }],
        });
        successCount++;
      } catch (err) {
        errorList.push({ email: user.email, error: err.message });
        console.error(`Failed to send email to ${user.email}:`, err);
      }
    }

    // Cleanup temp files
    fs.unlinkSync(file.path);
    fs.unlinkSync(tempFilePath);

    // Send response
    res.json({
      success: true,
      message: `Sent ${successCount} emails`,
      errors: errorList,
    });
  } catch (err) {
    console.error("Error in /api/internal/feedback-share:", err);
    res.status(500).json({ error: err.message });
  }
});

// API endpoint: POST /api/attendance/send
app.post("/api/attendance/upload", upload.single("file"), async (req, res) => {
  try {
    const { file } = req;

    if (!file) {
      return res.status(400).json({ message: "No file uploaded!" });
    }

    let filePath = file.path;

    // If uploaded file is .xlsx, convert it to CSV
    if (path.extname(file.originalname).toLowerCase() === ".xlsx") {
      const workbook = XLSX.readFile(file.path);
      const csvFile = `uploads/${path.basename(file.originalname, ".xlsx")}.csv`;
      XLSX.writeFile(workbook, csvFile, { bookType: "csv" });
      filePath = csvFile;
    }

    const resultMessage = await processAttendanceFile(filePath);

    // Cleanup after processing
    fs.unlinkSync(filePath);
    res.json({ message: resultMessage });
  } catch (err) {
    console.error("Error processing attendance file:", err);
    res.status(500).json({ message: "Error processing attendance file" });
  }
});


// Optional: root route for testing API status
app.get("/", (req, res) => {
  res.send("Backend is running");
});

// Other endpoints (examples)
app.get("/api/hello", (req, res) => {
  res.json({ success: true, msg: "Hello from backend!" });
});

// === UNIFIED Background Worker (FIXED) ===
const MAX_RETRIES = 3;
const BATCH_SIZE  = 10;

// Run EVERY MINUTE (was */2 — changed to *)
cron.schedule("* * * * *", async () => {
  const nowUTC = new Date().toISOString();
  const nowIST = new Date(Date.now() + 5.5 * 3600000)
    .toISOString().replace("T", " ").slice(0, 19) + " IST";

  console.log(`\n⏱ [Cron] Tick | UTC: ${nowUTC} | IST: ${nowIST}`);

  try {
    const { data: emails, error: fetchError } = await supabase
      .from("scheduled_emails")
      .select("*")
      .in("status", ["scheduled", "failed"])
      .lte("scheduled_at", nowUTC)
      .or(`retry_count.is.null,retry_count.lt.${MAX_RETRIES}`)
      .order("scheduled_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("❌ [Cron] Fetch error:", fetchError.message);
      return;
    }

    if (!emails || emails.length === 0) {
      console.log("📭 [Cron] No emails due.");
      return;
    }

    console.log(`📨 [Cron] ${emails.length} email(s) due.`);

    for (const email of emails) {
      const currentRetry = Number(email.retry_count) || 0;
      console.log(`\n  → id=${email.id} to=${email.recipient_email} retry=${currentRetry} scheduled_at=${email.scheduled_at}`);

      // Optimistic lock — only proceed if we actually updated the row
      const { data: locked, error: lockError } = await supabase
        .from("scheduled_emails")
        .update({
          status:          "processing",
          retry_count:     String(currentRetry + 1),
          last_attempt_at: nowUTC,
          updated_at:      nowUTC,
        })
        .eq("id", email.id)
        .in("status", ["scheduled", "failed"])
        .select("id");

      if (lockError) {
        console.warn(`  ⚠️  Lock error id=${email.id}:`, lockError.message);
        continue;
      }
      if (!locked || locked.length === 0) {
        console.log(`  ⚠️  id=${email.id} already locked by another tick — skipping`);
        continue;
      }

      // ── Send ───────────────────────────────────────────────────
      let result = { success: false, error: "sendRawEmail never called" };
      try {
        if (!email.recipient_email || !email.recipient_email.includes("@")) {
          throw new Error(`Invalid recipient: "${email.recipient_email}"`);
        }

        const attachments = [];
        if (email.attachment_name && email.attachment_data) {
          attachments.push({
            filename: email.attachment_name,
            content:  Buffer.from(email.attachment_data, "base64"),
          });
        }

        result = await sendRawEmail({
          to:      email.recipient_email,
          subject: email.subject || "(No Subject)",
          html:    email.body_html || "",
          text:    (email.body_html || "").replace(/<[^>]+>/g, ""),
          attachments,
        });

      } catch (callErr) {
        result = { success: false, error: callErr.message };
      }

      // ── Log the FULL result object — this is what tells us the truth ──
      console.log(`  📬 sendRawEmail result:`, JSON.stringify(result));

      const doneAt = new Date().toISOString();

      if (result.success === true) {
        // Only mark sent if result.success is literally true
        await supabase
          .from("scheduled_emails")
          .update({ status: "sent", sent_at: doneAt, error: null, updated_at: doneAt })
          .eq("id", email.id);
        console.log(`  ✅ SENT id=${email.id}`);
      } else {
        const newRetry  = currentRetry + 1;
        const newStatus = newRetry >= MAX_RETRIES ? "permanently_failed" : "failed";
        await supabase
          .from("scheduled_emails")
          .update({ status: newStatus, error: result.error || "unknown", updated_at: doneAt })
          .eq("id", email.id);
        console.error(`  ❌ FAILED id=${email.id}: ${result.error} → status=${newStatus}`);
      }

      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`\n[Cron] Batch complete.`);

  } catch (fatalErr) {
    console.error("🚨 [Cron] Fatal:", fatalErr.message, fatalErr.stack);
  }
});

// ── Keep-alive ping ──────────────────────────────────────────
if (process.env.RENDER_EXTERNAL_URL) {
  cron.schedule("*/10 * * * *", async () => {
    try {
      await fetch(`${process.env.RENDER_EXTERNAL_URL}/api/health`);
      console.log("🏓 Keep-alive ping sent");
    } catch (e) {
      console.warn("Keep-alive ping failed:", e.message);
    }
  });
}


// === Get Scheduled Emails (Debug endpoint) ===
app.get("/api/debug/scheduled-emails", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("scheduled_emails")
      .select("*")
      .order("scheduled_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("❌ Debug endpoint error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === Send Course Closure Announcement Emails to Learners Immediately ===
app.post("/api/course-closure-to-learners", async (req, res) => {
  try {
    const { batch_no, end_date } = req.body;
    if (!batch_no || !end_date) {
      return res.status(400).json({ error: "Batch No and End Date are required" });
    }

    // Fetch learners in the batch
    const { data: learners, error: learnersErr } = await supabase
      .from("learners_data")
      .select("email, name")
      .eq("batch_no", batch_no);

    if (learnersErr) throw learnersErr;
    if (!learners || learners.length === 0) {
      return res.status(404).json({ error: "No learners found for this batch" });
    }

    let sentCount = 0;
    const failed = [];

    // Send personalized emails to each learner
    for (const learner of learners) {
      const subject = `Course Closure - Batch ${batch_no}`;
      const bodyHtml = `
        <p>Dear ${learner.name || "Learner"},</p>
        <p>Thanks for choosing chipedge. The course will end on the date <strong>${end_date}</strong>.</p>
        <p>All the best for your career.</p>
        <br/>
        <p>Best regards,<br/>ChipEdge Team</p>
      `;

      const result = await sendRawEmail({
        to: learner.email,
        subject,
        html: bodyHtml,
      });

      if (result.success) {
        sentCount++;
      } else {
        failed.push({ email: learner.email, error: result.error });
        console.error(`Failed to send email to ${learner.email}:`, result.error);
      }
    }

    res.json({
      success: failed.length === 0,
      message: `Emails sent to ${sentCount} learners successfully.`,
      failed,
    });
  } catch (err) {
    console.error("Error sending course closure emails to learners:", err);
    res.status(500).json({ error: err.message });
  }
});

// === Final Assessment APIs ===

// Get only "Final Assessment" topics for a batch (Improved match)
app.get("/api/final-assessments/:batch_no", async (req, res) => {
  try {
    const { batch_no } = req.params;

    const { data, error } = await supabase
      .from("course_planner_data")
      .select("*")
      .eq("batch_no", batch_no)
      .ilike("topic_name", "%Final Assessment%"); // This matches anywhere

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("❌ Error fetching final assessments:", err.message);
    res.status(500).json({ error: "Failed to fetch final assessments" });
  }
});

// Update date for a topic
app.put("/api/final-assessments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.body;

    const { data, error } = await supabase
      .from("course_planner_data")
      .update({ date })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Topic not found" });

    // 🔔 Notify the batch's trainers of the assessment date change.
    if (data.batch_no) {
      notify(getDistinctTrainersForBatch(data.batch_no), {
        title: "Assessment date updated",
        body: `A final-assessment date for ${data.batch_no} was updated.`,
        data: { type: "final_assessment_updated", batch_no: String(data.batch_no) },
      });
    }
    res.json({ message: "✅ Date updated", topic: data });
  } catch (err) {
    console.error("❌ Error updating final assessment:", err.message);
    res.status(500).json({ error: "Failed to update final assessment" });
  }
});

// Send email for a batch (Final Assessment Notification)
app.post("/api/send-final-assessment-email", async (req, res) => {
  try {
    const { batch_no } = req.body;
    if (!batch_no) return res.status(400).json({ error: "Batch No required" });

    // 1️⃣ Get learners of this batch
    const { data: learners, error: learnersErr } = await supabase
      .from("learners_data")
      .select("email, name")
      .eq("batch_no", batch_no);

    if (learnersErr) throw learnersErr;
    if (!learners || learners.length === 0)
      return res.status(404).json({ error: "No learners found" });

    // 2️⃣ Get assessment topics
    const { data: topics, error: topicsErr } = await supabase
      .from("course_planner_data")
      .select("topic_name, date, start_time, end_time")
      .eq("batch_no", batch_no)
      .ilike("topic_name", "%Final Assessment%");

    if (topicsErr) throw topicsErr;

    // 3️⃣ Format email
    const rows = topics
      .map(
        t =>
          `<tr><td>${t.topic_name}</td><td>${formatDate(t.date)}</td><td>${t.start_time || "-"}</td><td>${t.end_time || "-"}</td></tr>`
      )
      .join("");

    const html = `
      <p>Dear Learner,</p>
      <p>Please find below the final assessment schedule for batch <strong>${batch_no}</strong>:</p>
      <table border="1" cellpadding="5" cellspacing="0">
        <tr><th>Topic</th><th>Date</th><th>Start Time</th><th>End Time</th></tr>
        ${rows}
      </table>
      <p>All the best!</p>
    `;

    // 4️⃣ Send emails immediately
    let sentCount = 0;
    for (const learner of learners) {
      const sendResult = await sendRawEmail({
        to: learner.email,
        subject: `Final Assessment Schedule - Batch ${batch_no}`,
        html,
        text: html.replace(/<[^>]+>/g, ""), // plain text fallback
      });

      if (sendResult.success) sentCount++;
      else console.error(`❌ Failed for ${learner.email}:`, sendResult.error);
    }

    res.json({ success: true, message: `✅ Sent schedule to ${sentCount} learners` });
  } catch (err) {
    console.error("❌ Final assessment email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Add this endpoint to check batch ownership
app.get('/api/course_planner_data', async (req, res) => {
  try {
    const { batch_no } = req.query;
    const { data, error } = await supabase
      .from('course_planner_data')
      .select('*')
      .eq('batch_no', batch_no);
    
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch course planner data' });
  }
});

// New API: Get max course date for a batch
app.get("/api/course_planner_data/max-date/:batch_no", async (req, res) => {
  try {
    const batch_no = req.params.batch_no;
    const { data, error } = await supabase
      .from("course_planner_data")
      .select("date")
      .eq("batch_no", batch_no)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Batch not found" });

    res.json({ max_date: data.date });
  } catch (err) {
    console.error("Error in /api/course_planner_data/max-date:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

//===Schedule Access Card Emails to Learners===
app.post("/api/schedule-access-card-email", async (req, res) => {
  try {
    const { batch_no, assessment_date } = req.body;

    if (!batch_no || !assessment_date) {
      return res.status(400).json({ error: "Batch No and assessment date are required" });
    }

    // Fetch all mode records for the batch
    const { data: batchDataArray, error: batchError } = await supabase
      .from("course_planner_data")
      .select("mode")
      .eq("batch_no", batch_no);

    if (batchError) {
      console.error("Error fetching batch mode:", batchError);
      return res.status(500).json({ error: "Failed to fetch batch info" });
    }

    if (!batchDataArray || batchDataArray.length === 0) {
      return res.status(404).json({ error: "Batch not found" });
    }

    // Check for unique modes from all rows
    const uniqueModes = [...new Set(batchDataArray.map(row => row.mode))];

    if (uniqueModes.length > 1) {
      return res.status(400).json({ error: "Batch has multiple modes; cannot determine single mode" });
    }

    const mode = uniqueModes[0];

    // Only proceed if mode is Offline
    if (mode !== "Offline") {
      return res.status(200).json({ message: "Batch is not Offline mode - skipping access card emails" });
    }

    // Fetch learners for the batch
    const { data: learners, error: learnersError } = await supabase
      .from("learners_data")
      .select("email, name")
      .eq("batch_no", batch_no);

    if (learnersError) {
      console.error("Error fetching learners:", learnersError);
      return res.status(500).json({ error: "Failed to fetch batch learners" });
    }

    if (!learners || learners.length === 0) {
      return res.status(404).json({ error: "No learners found for this batch" });
    }

    // Calculate scheduled date/time 7 days before assessment_date at 12:22 PM
    const scheduledAtISO = dayjs(assessment_date)
      .subtract(7, "day")
      .hour(12)
      .minute(22)
      .second(0)
      .millisecond(0)
      .toISOString();

    let scheduledCount = 0;
    for (const learner of learners) {
      // Insert scheduled access card reminder email
      const { error: insertError } = await supabase.from("scheduled_emails").insert({
        batch_no,
        recipient_email: learner.email,
        subject: `Reminder: Submit Your Access Card for Final Assessment`,
        body_html: `<p>Dear ${learner.name || "Learner"},</p>
                    <p>Please submit your access card at least 1 week before the Final Assessment scheduled on <strong>${dayjs(assessment_date).format("DD-MMM-YYYY")}</strong>.</p>`,
        scheduled_at: scheduledAtISO,
        status: "scheduled",
        mode: "Notification",
        template_name: "Access Card Reminder",
        source: "access_card_reminder",
        created_at: new Date().toISOString(),
      });

      if (!insertError) scheduledCount++;
      else
        console.error(`Failed to schedule access card email for ${learner.email}:`, insertError.message);
    }

    res.json({
      success: true,
      message: `Scheduled access card reminder emails for ${scheduledCount} learners in Offline batch ${batch_no}`,
      scheduled: scheduledCount,
    });
  } catch (err) {
    console.error("Error in /api/schedule-access-card-email:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ==================== TUTORS APIs ====================

// Get all trainers
app.get('/api/tutors', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('internal_users')
      .select('id, name, email, role, created_at, is_active')
      .eq('role', 'Trainer')
      .order('name');
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching tutors:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add new trainer (PLAIN TEXT PASSWORD - NOT RECOMMENDED FOR PRODUCTION)
app.post('/api/tutors/add', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // ✅ Store password as plain text (no hashing)
    const { data, error } = await supabase
      .from('internal_users')
      .insert([{
        name,
        email,
        role: 'Trainer',
        password_hash: password,  // ✅ Store plain text password directly
        is_active: true
      }])
      .select();
    
    if (error) throw error;
    // 🔔 Welcome the new trainer and inform approvers.
    if (email) {
      notify(email, {
        title: "Account created",
        body: `Welcome ${name || ""}! Your trainer account is ready.`,
        data: { type: "account_created" },
      });
    }
    notify(getApproverEmails(), {
      title: "New trainer added",
      body: `${name || email} was added as a Trainer.`,
      data: { type: "trainer_added" },
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error adding tutor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update tutor by id (optionally accept password change too)
app.put("/api/tutors/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, is_active, domain, password } = req.body || {};

    if (!id) return res.status(400).json({ success: false, error: "Missing id" });

    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (role !== undefined) patch.role = role || "Trainer";
    if (typeof is_active === "boolean") patch.is_active = is_active;
    if (domain !== undefined) patch.domain = domain ? String(domain).trim() : null;

    if (password) patch.password_hash = password;

    const { data, error } = await supabase
      .from("internal_users")
      .update(patch)
      .eq("id", id)
      .select("id, created_at, name, email, role, is_active, domain")
      .single();

    if (error) {
      console.error("PUT /api/tutors/:id error:", error);
      return res.status(500).json({ success: false, error: "Update failed" });
    }

    // 🔔 Notify the affected user their account was updated.
    if (data?.email) {
      notify(data.email, {
        title: "Account updated",
        body: "Your account details were updated.",
        data: { type: "account_updated" },
      });
    }
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Unhandled error in PUT /api/tutors/:id:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

/**
 * DELETE /api/tutors/:id
 * default => soft delete (is_active=false)
 * ?hard=true => hard delete row
 */
app.delete("/api/tutors/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const hard = String(req.query.hard || "").toLowerCase() === "true";

    if (!id) return res.status(400).json({ success: false, error: "Missing id" });

    if (hard) {
      const { error } = await supabase.from("internal_users").delete().eq("id", id);
      if (error) {
        console.error("DELETE hard /api/tutors/:id error:", error);
        return res.status(500).json({ success: false, error: "Hard delete failed" });
      }
      return res.status(200).json({ success: true, hard: true });
    }

    const { data, error } = await supabase
      .from("internal_users")
      .update({ is_active: false })
      .eq("id", id)
      .select("id, name, email, is_active")
      .single();

    if (error) {
      console.error("DELETE soft /api/tutors/:id error:", error);
      return res.status(500).json({ success: false, error: "Soft delete failed" });
    }

    return res.status(200).json({ success: true, hard: false, data });
  } catch (err) {
    console.error("Unhandled error in DELETE /api/tutors/:id:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

/**
 * Optional fallback (if you still want delete-by-email):
 * DELETE /api/tutors?email=someone@mail.com  => soft delete
 */
app.delete("/api/tutors", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: "email is required" });

    const { data, error } = await supabase
      .from("internal_users")
      .update({ is_active: false })
      .eq("email", String(email).trim())
      .select("id, name, email, is_active");

    if (error) {
      console.error("DELETE /api/tutors?email error:", error);
      return res.status(500).json({ success: false, error: "Soft delete failed" });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Unhandled error in DELETE /api/tutors:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// Get batches for a trainer
app.get('/api/tutors/batches/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const { data, error } = await supabase
      .from('course_planner_data')
      .select('batch_no')
      .eq('trainer_email', email)
      .order('batch_no');
    
    if (error) throw error;
    
    // Get unique batch numbers
    const uniqueBatches = [...new Set(data.map(item => item.batch_no))];
    res.json(uniqueBatches);
  } catch (error) {
    console.error('Error fetching trainer batches:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get modules for a trainer in a specific batch
app.get('/api/tutors/modules/:email/:batch_no', async (req, res) => {
  try {
    const { email, batch_no } = req.params;
    
    const { data, error } = await supabase
      .from('course_planner_data')
      .select('module_name, topic_name, date, topic_status')
      .eq('trainer_email', email)
      .eq('batch_no', batch_no)
      .order('date');
    
    if (error) throw error;
    
    // Group by module
    const moduleGroups = {};
    data.forEach(item => {
      if (!moduleGroups[item.module_name]) {
        moduleGroups[item.module_name] = [];
      }
      moduleGroups[item.module_name].push(item);
    });
    
    res.json(moduleGroups);
  } catch (error) {
    console.error('Error fetching trainer modules:', error);
    res.status(500).json({ error: error.message });
  }
});

//dashboard learners fetch
app.get('/api/learners-dashboard-data', async (req, res) => {
  try {
    const { batch_no } = req.query;
    
    let query = supabase
      .from("learners_data")
      .select("id, name, email, phone, batch_no, status")
      .order("name", { ascending: true });

    if (batch_no) {
      query = query.eq("batch_no", batch_no);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Learners error:", error);
      return res.status(200).json([]);
    }

    const normalized = (data || []).map(row => ({
      id: row.id,
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      batchno: row.batch_no || "",
      batch_no: row.batch_no || "",
      status: row.status || "Enabled",
    })).filter(row => row.name && row.email);

    res.json(normalized);
  } catch (err) {
    console.error("Learners CRASH:", err);
    res.status(200).json([]);
  }
});

// ==================== LEARNERS APIs ====================
// GET all learners from learners_data table
app.get('/api/learners', async (req, res) => {
  try {
    console.log('🔍 /api/learners → learners_data');
    
    const { batch_no } = req.query;
    let query = supabase
      .from('learners_data')
      .select('id, name, email, phone, batch_no, status')
      .order('name');

    if (batch_no) {
      query = query.eq('batch_no', batch_no);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ learners error:', error);
      return res.status(500).json([]);
    }

    console.log(`✅ learners: ${data?.length || 0} rows${batch_no ? ` for ${batch_no}` : ''}`);
    res.json(data || []);
  } catch (err) {
    console.error('🚨 learners CRASH:', err);
    res.status(500).json([]);
  }
});

// GET learners by batch_no
app.get("/api/getlearners", async (req, res) => {
  try {
    const batchno = req.query.batchno;
    if (!batchno) {
      return res.status(400).json({ error: "batchno required" });
    }

    const { data, error } = await supabase
      .from("learners_data")  // ✅ Correct table name
      .select("id, name, email, phone, batch_no, status")
      .eq("batch_no", batchno);  // ✅ Query by batch_no

    if (error) {
      console.error(`GET /api/getlearners?batchno=${batchno} error:`, error);
      return res.status(200).json([]);
    }

    const normalized = (data || []).map((row) => ({
      id: row.id,
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      batchno: row.batch_no || batchno,
      batch_no: row.batch_no || batchno,
      status: row.status || "Enabled",
    })).filter(row => row.name && row.email);

    console.log(`GET /api/getlearners?batchno=${batchno}: found ${normalized.length}`);
    return res.status(200).json(normalized);
  } catch (err) {
    console.error("GET /api/getlearners CRASH:", err);
    return res.status(200).json([]);
  }
});

// POST add learner
app.post("/api/learners/add", async (req, res) => {
  try {
    const { name, email, phone, batchno, batch_no } = req.body;
    
    const normalized = {
      name: (name || "").trim(),
      email: (email || "").trim().toLowerCase(),
      phone: (phone || "").trim(),
      batch_no: (batchno || batch_no || "").trim(),  // ✅ Use batch_no
    };

    if (!normalized.name || !normalized.email || !normalized.batch_no) {
      return res.status(400).json({ 
        success: false, 
        error: "name, email, batch_no required" 
      });
    }

    const { data, error } = await supabase
      .from("learners_data")  // ✅ Correct table name
      .insert({
        name: normalized.name,
        email: normalized.email,
        phone: normalized.phone || null,
        batch_no: normalized.batch_no,  // ✅ Insert to batch_no
        status: "Enabled",
      })
      .select()
      .single();

    if (error) {
      console.error("POST /api/learners/add:", error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }

    const added = {
      id: data.id,
      name: normalized.name,
      email: normalized.email,
      phone: normalized.phone,
      batchno: normalized.batch_no,
      batch_no: normalized.batch_no,
      status: "Enabled",
    };

    console.log("Added learner:", added);
    // 🔔 Notify the batch's trainers a learner was added.
    notify(getDistinctTrainersForBatch(normalized.batch_no), {
      title: "New learner added",
      body: `${normalized.name} was added to ${normalized.batch_no}.`,
      data: { type: "learner_added", batch_no: normalized.batch_no },
    });
    return res.json({ success: true, data: added });
  } catch (err) {
    console.error("POST /api/learners/add CRASH:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT update status
app.put("/api/learners/status", async (req, res) => {
  try {
    const learneremail = req.body.learneremail || req.body.email;
    const batch_no = req.body.batchno || req.body.batch_no;
    const status = req.body.status;

    if (!learneremail || !batch_no || !status) {
      return res.status(400).json({ 
        success: false, 
        error: "learneremail, batch_no, status required" 
      });
    }

    const validStatuses = ["Enabled", "Disabled", "Dropout", "Batch Movement"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }

    const { error } = await supabase
      .from("learners_data")  // ✅ Correct table name
      .update({ status })
      .eq("email", learneremail)
      .eq("batch_no", batch_no);  // ✅ Update by batch_no

    if (error) {
      console.error("PUT /api/learners/status:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    console.log(`Status updated: ${learneremail} / ${batch_no} → ${status}`);
    // 🔔 Notify the batch's trainers of the learner status change.
    notify(getDistinctTrainersForBatch(batch_no), {
      title: "Learner status updated",
      body: `${learneremail} in ${batch_no} is now ${status}.`,
      data: { type: "learner_status", batch_no: String(batch_no) },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/learners/status CRASH:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// Get learner by email
app.get('/api/learners/email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const { data, error } = await supabase
      .from('learners_data')
      .select('id, name, email, phone, batch_no')
      .eq('email', email)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching learner:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/debug/routes-test", (req, res) => {
  res.json({ ok: true, message: "Backend is deploying the correct file" });
});

// NEW ENDPOINT - Attendance Report (THIS IS THE KEY)
app.get('/api/attendance-report', authMiddleware, async (req, res) => {
  try {
    const { batch_no } = req.query;
    
    const [rows] = await pool.execute(`
      SELECT 
        la.learner_email,
        la.status,
        la.date
      FROM learner_attendance la
      WHERE la.batch_no = ?
      ORDER BY la.learner_email, la.date
    `, [batch_no || '']);
    
    res.json(rows);
  } catch (error) {
    console.error('Attendance report error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance data' });
  }
});

// Fix the existing broken endpoint (optional)
app.get('/api/attendance/by_batch', async (req, res) => {
  try {
    const { batch_no } = req.query;
    const { data, error } = await supabase
      .from('learner_attendance')
      .select('*')
      .eq('batch_no', batch_no);
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Attendance by batch error:', error);
    res.status(500).json({ error: error.message });
  }
});


// Start local server only when running outside Vercel
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Backend listening on http://localhost:${PORT}`);
    console.log(`✅ Email scheduler is running - checking every minute for due emails`);
  });
}

export default app;