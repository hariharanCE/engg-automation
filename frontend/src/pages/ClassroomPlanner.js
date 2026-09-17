import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Typography, Button, Fade, Box, Table, TableBody, TableCell,
  TableHead, TableRow, TableContainer, TextField, CircularProgress, Chip, Tooltip,
} from "@mui/material";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import UploadFileIcon   from "@mui/icons-material/UploadFile";
import DownloadIcon     from "@mui/icons-material/Download";
import SaveIcon         from "@mui/icons-material/Save";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import MeetingRoomIcon  from "@mui/icons-material/MeetingRoom";
import PersonIcon       from "@mui/icons-material/Person";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CheckCircleIcon  from "@mui/icons-material/CheckCircle";
import SwapHorizIcon    from "@mui/icons-material/SwapHoriz";

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
  success:     { fill: "#10b981", light: "#d1fae5", text: "#065f46" },
  warning:     { fill: "#f59e0b", light: "#fef3c7", text: "#92400e" },
  error:       { fill: "#ef4444", light: "#fee2e2", text: "#991b1b" },
  info:        { fill: "#6366f1", light: "#eef2ff", text: "#3730a3" },
};

const cardSx = {
  background: TOKENS.surface, border: `1px solid ${TOKENS.border}`,
  borderRadius: "16px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden",
};
const labelSx = {
  fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700,
  letterSpacing: "0.08em", textTransform: "uppercase", color: TOKENS.textSub,
};
const tableCellSx = {
  fontFamily: "'DM Sans', sans-serif", fontSize: 12,
  color: TOKENS.text, borderBottom: `1px solid ${TOKENS.border}`,
};
const tableHeadSx = {
  ...labelSx, background: TOKENS.surfaceAlt,
  borderBottom: `2px solid ${TOKENS.border}`, py: 1.2, whiteSpace: "nowrap",
};

function SectionHeader({ icon, title, subtitle, right }) {
  return (
    <Box sx={{ px: 3, py: 2.5, background: `linear-gradient(135deg, ${TOKENS.accent}0d 0%, ${TOKENS.accentLight} 100%)`, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box sx={{ color: TOKENS.accent, display: "flex" }}>{icon}</Box>
        <Box>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.02em" }}>{title}</Typography>
          {subtitle && <Typography sx={{ ...labelSx, fontSize: 10, mt: 0.2 }}>{subtitle}</Typography>}
        </Box>
      </Box>
      {right && <Box>{right}</Box>}
    </Box>
  );
}

/* ─── Constants ─────────────────────────────────────────────────────────── */
const colorPalette = ["#edc7cf","#bdd9bf","#c7ceea","#ffeebb","#a4c2f4","#a1eafb","#e6c7e3","#f7cac9","#ffe066","#f8b195","#80ced6","#d5f4e6","#f0a6ca","#b5ead7","#ead3d7","#ffe0ac","#b3cdd1","#eec9e6"];
const slotDisplayMap = { morning: "morning", evening: "evening", Shift_1: "morning", Shift_2: "evening" };

// ─── CLASSROOMS definition ────────────────────────────────────────────────
const CLASSROOMS = [
  { name: "Ganga",   capacity: 50 },
  { name: "Yamuna",  capacity: 35 },
  { name: "Cauvery", capacity: 35 },
];
const SLOTS = ["morning", "evening"];

/* ─────────────────────────────────────────────────────────────────────────
   PURE UTILITY HELPERS
──────────────────────────────────────────────────────────────────────────── */

function getDomainFromBatch(batchNo) {
  if (!batchNo || typeof batchNo !== "string") return "";
  const up = batchNo.toUpperCase();
  if (up.startsWith("DFTFT") || up.startsWith("DFT")) return "DFT";
  if (up.startsWith("DVFT")  || up.startsWith("DV"))  return "DV";
  if (up.startsWith("PDFT")  || up.startsWith("PD"))  return "PD";
  return "OTHER";
}

function parseExcelDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date((value - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s);
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split(".");
    return new Date(`${yyyy}-${mm}-${dd}`);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toISO(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** occupancy window = start + 5 months + 14 days */
function computeOccupancyEnd(startDate) {
  if (!(startDate instanceof Date) || isNaN(startDate.getTime())) return null;
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + 5);
  d.setDate(d.getDate() + 14);
  return d;
}

/** how many days between two ISO date strings */
function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoB) - new Date(isoA)) / 86400000);
}

/** strict overlap: [s1,e1] overlaps [s2,e2] */
function overlaps(s1, e1, s2, e2) {
  if (!s1 || !e1 || !s2 || !e2) return false;
  return new Date(s1) <= new Date(e2) && new Date(s2) <= new Date(e1);
}

function normalizeRowKeys(row) {
  const o = {};
  Object.keys(row).forEach(k => { o[k.trim()] = row[k]; });
  return o;
}

function getWeeksInRange(start, end) {
  const startDate = new Date(start), endDate = new Date(end);
  const weeks = [];
  let cur = new Date(startDate);
  cur.setDate(cur.getDate() - cur.getDay());
  while (cur <= endDate) {
    const y = cur.getFullYear(), m = cur.getMonth();
    const weekNum = Math.ceil((cur.getDate() + 1 - new Date(y, m, 1).getDay()) / 7);
    weeks.push({ year: y, month: cur.toLocaleString("default", { month: "long" }), monthNum: m, weekNum, weekStart: new Date(cur), key: `${y}-${m + 1}-W${weekNum}` });
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

function getBatchColorMap(allTable) {
  const batchSet = new Set();
  allTable.forEach(row => row.forEach(cell => { if (Array.isArray(cell)) cell.forEach(bn => batchSet.add(bn)); }));
  const map = {};
  Array.from(batchSet).filter(Boolean).sort().forEach((bn, idx) => { map[bn] = colorPalette[idx % colorPalette.length]; });
  return map;
}

function hexToRGB(hex) {
  const c = hex.replace("#", "");
  return { r: parseInt(c.slice(0, 2), 16), g: parseInt(c.slice(2, 4), 16), b: parseInt(c.slice(4, 6), 16) };
}

function normalizeLoadedRow(r, moduleTrainers, primaryTrainer) {
  const occEnd = r.occupancy_end || toISO(computeOccupancyEnd(parseExcelDate(r.occupancy_start)));
  return {
    batch_no: r.batch_no, classroom_name: r.classroom_name || "", slot: r.slot || "",
    a_start: r.occupancy_start || "", a_end: r.a_end || "", occupancy_end: occEnd,
    enrolled: r.enrolled || 0, capacity: r.capacity || r.enrolled || 0,
    mode: "OFFLINE", trainer_name: primaryTrainer, module_trainers: moduleTrainers,
    forced_classroom: r.forced_classroom || "", rearranged: false, rearrange_reason: "",
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   SMART CLASSROOM ALLOCATION ENGINE
   ─────────────────────────────────────────────────────────────────────────

   Rules:
   1. Two batches of the same domain CANNOT share the same slot at any
      overlapping time (license constraint).
   2. Classroom capacity must be ≥ enrolled count.
   3. If no slot is free for a batch, attempt REARRANGEMENT:
      - Find an existing batch in the target room+slot that is "close to
        finishing" (≤ REARRANGE_THRESHOLD_DAYS days remaining from today).
      - Look for any other free room+slot that covers the remaining days of
        that finishing batch.
      - If found, move the finishing batch there and free the slot for the
        incoming batch.
   4. Slot rotation per domain: batches of the same domain are assigned
      alternating slots (morning → evening → morning …) to spread load.

──────────────────────────────────────────────────────────────────────────── */

const REARRANGE_THRESHOLD_DAYS = 28; // consider moving if ≤ 4 weeks left

/**
 * Build a state object representing the occupancy index.
 * occupancyIndex[`roomName|slot`] = [ { batch_no, start, end, domain, enrolled } ]
 */
function buildOccupancyIndex(allocatedPlans) {
  const idx = {};
  CLASSROOMS.forEach(room => SLOTS.forEach(slot => { idx[`${room.name}|${slot}`] = []; }));
  allocatedPlans.forEach(p => {
    if (p.classroom_name && p.slot) {
      const key = `${p.classroom_name}|${p.slot}`;
      if (!idx[key]) idx[key] = [];
      idx[key].push({ batch_no: p.batch_no, start: p.a_start, end: p.occupancy_end || p.a_end, domain: getDomainFromBatch(p.batch_no), enrolled: p.enrolled });
    }
  });
  return idx;
}

/**
 * Check domain-slot conflict: returns true if placing `domain` in `slot`
 * during [newStart, newEnd] conflicts with existing slot occupants of the same domain.
 */
function hasDomainSlotConflict(occupancyIndex, slot, domain, newStart, newEnd, excludeBatch = null) {
  return CLASSROOMS.some(room => {
    const key = `${room.name}|${slot}`;
    return (occupancyIndex[key] || []).some(b =>
      b.batch_no !== excludeBatch &&
      b.domain === domain &&
      overlaps(newStart, newEnd, b.start, b.end)
    );
  });
}

/**
 * Check physical classroom conflict: returns true if the room+slot is taken
 * during [newStart, newEnd].
 */
function hasRoomConflict(occupancyIndex, roomName, slot, newStart, newEnd, excludeBatch = null) {
  const key = `${roomName}|${slot}`;
  return (occupancyIndex[key] || []).some(b =>
    b.batch_no !== excludeBatch &&
    overlaps(newStart, newEnd, b.start, b.end)
  );
}

/**
 * Try to find a room+slot for batch where:
 *  - room capacity ≥ enrolled
 *  - no physical room conflict
 *  - no domain-slot conflict
 * Returns { roomName, slot } or null.
 */
function findFreeRoomSlot(occupancyIndex, enrolled, domain, start, end, preferredSlot = null) {
  const slotsToTry = preferredSlot
    ? [preferredSlot, ...SLOTS.filter(s => s !== preferredSlot)]
    : SLOTS;

  for (const slot of slotsToTry) {
    // domain-slot conflict check first (cheapest)
    if (hasDomainSlotConflict(occupancyIndex, slot, domain, start, end)) continue;
    // find a room in this slot
    for (const room of CLASSROOMS) {
      if (room.capacity < enrolled) continue;
      if (!hasRoomConflict(occupancyIndex, room.name, slot, start, end)) {
        return { roomName: room.name, slot };
      }
    }
  }
  return null;
}

/**
 * Attempt rearrangement for a batch that couldn't be placed.
 *
 * Strategy:
 *  For each room+slot where the batch COULD physically fit capacity-wise:
 *    - Find occupants in that room+slot whose REMAINING time ≤ threshold.
 *    - For each such "finishing" batch, try to find another free slot that
 *      covers its remaining period (may be a different room or slot).
 *    - If we can relocate the finishing batch, we free the original slot for
 *      the incoming batch.
 *
 * Returns { success, roomName, slot, moves: [ { batch_no, from_room, from_slot, to_room, to_slot } ] }
 */
function attemptRearrangement(occupancyIndex, enrolled, domain, start, end, today, allPlansMap) {
  const todayStr = toISO(today);

  for (const slot of SLOTS) {
    // Check domain conflict for this slot — domain rule applies regardless of room
    if (hasDomainSlotConflict(occupancyIndex, slot, domain, start, end)) continue;

    for (const room of CLASSROOMS) {
      if (room.capacity < enrolled) continue;

      // This room+slot has a conflict. Check if any occupant is finishing soon.
      const key = `${room.name}|${slot}`;
      const occupants = (occupancyIndex[key] || []).filter(b =>
        overlaps(start, end, b.start, b.end)
      );
      if (!occupants.length) continue; // room is free already (should not reach here normally)

      const candidatesToMove = occupants.filter(b => {
        const remaining = daysBetween(todayStr, b.end);
        return remaining >= 0 && remaining <= REARRANGE_THRESHOLD_DAYS;
      });

      if (!candidatesToMove.length) continue;

      // Try to relocate ALL conflicting occupants in this slot
      // (usually just one per room-slot, but be safe)
      const moves = [];
      let canRelocateAll = true;
      const tempIndex = JSON.parse(JSON.stringify(occupancyIndex)); // deep clone

      for (const finishing of candidatesToMove) {
        // Remove it from its current position in temp index
        tempIndex[key] = tempIndex[key].filter(b => b.batch_no !== finishing.batch_no);

        // Find a new home for the finishing batch (exclude current slot to avoid loop)
        const newHome = findFreeRoomSlot(
          tempIndex,
          finishing.enrolled,
          finishing.domain,
          finishing.start,
          finishing.end,
          null // no slot preference — let it be flexible
        );

        if (!newHome) {
          canRelocateAll = false;
          break;
        }

        // Place finishing batch in new home inside tempIndex
        const newKey = `${newHome.roomName}|${newHome.slot}`;
        if (!tempIndex[newKey]) tempIndex[newKey] = [];
        tempIndex[newKey].push({ ...finishing });

        moves.push({
          batch_no:  finishing.batch_no,
          from_room: room.name,
          from_slot: slot,
          to_room:   newHome.roomName,
          to_slot:   newHome.slot,
          remaining_days: daysBetween(todayStr, finishing.end),
        });
      }

      if (!canRelocateAll) continue;

      // Verify the target room+slot is now free for the new batch in tempIndex
      if (!hasRoomConflict(tempIndex, room.name, slot, start, end)) {
        return { success: true, roomName: room.name, slot, moves, tempIndex };
      }
    }
  }

  return { success: false, moves: [] };
}

/* ─────────────────────────────────────────────────────────────────────────
   MAIN PLANNING FUNCTION
──────────────────────────────────────────────────────────────────────────── */

function smartPlanClassrooms(rows, today = new Date()) {

  // 1️⃣ Parse OFFLINE rows
  const parsed = rows
    .map(normalizeRowKeys)
    .filter(row => {
      const mode = (row["MODE"] || "").trim().toUpperCase();
      return row["COURSE"] && mode === "OFFLINE" && parseExcelDate(row["A.START DATE"]);
    })
    .map(row => {
      const startDt = parseExcelDate(row["A.START DATE"]);
      const occEndDt = computeOccupancyEnd(startDt);
      const dueDt = parseExcelDate(row["A.DUE DATE"]);

      return {
        batch_no: row["COURSE"],
        a_start: toISO(startDt),
        a_end: dueDt ? toISO(dueDt) : toISO(occEndDt),
        occupancy_end: toISO(occEndDt),
        enrolled: Number(row["ENROLLED"] || 0),
        capacity: Number(row["CAPACITY"] || 0),
        forced_classroom: (row["CLASS_ROOM"] || row["CLASSROOM"] || "").trim(),
        domain: getDomainFromBatch(row["COURSE"]),
        startDt
      };
    });

  // 2️⃣ STRICT CHRONOLOGICAL SORT (start → end → batch)
  parsed.sort((a, b) => {
    if (a.a_start !== b.a_start)
      return a.a_start.localeCompare(b.a_start);

    if (a.occupancy_end !== b.occupancy_end)
      return a.occupancy_end.localeCompare(b.occupancy_end);

    return a.batch_no.localeCompare(b.batch_no);
  });

  const domainSlotCounter = {};
  const plans = [];
  const unallocated = [];
  const rearrangements = [];
  const conflicts = [];

  const occupancyIndex = {};
  CLASSROOMS.forEach(room =>
    SLOTS.forEach(slot => {
      occupancyIndex[`${room.name}|${slot}`] = [];
    })
  );

  const allPlansMap = {};

  // 3️⃣ Allocate strictly one by one
  for (const batch of parsed) {

    const {
      batch_no,
      a_start,
      occupancy_end,
      a_end,
      enrolled,
      capacity,
      domain,
      forced_classroom
    } = batch;

    if (enrolled > capacity) {
      unallocated.push({
        ...batch,
        conflict_reason: `Enrolled (${enrolled}) > Capacity (${capacity})`
      });
      continue;
    }

    const count = domainSlotCounter[domain] || 0;
    const preferredSlot = SLOTS[count % SLOTS.length];

    let assigned = null;
    let rearrangeInfo = null;

    // 4️⃣ Forced classroom (validated against full date range)
    if (forced_classroom) {
      const parts = forced_classroom.match(/^(.+?)_(morning|evening|Shift_1|Shift_2)$/i);
      if (parts) {
        const forcedRoom = CLASSROOMS.find(r =>
          r.name.toLowerCase() === parts[1].toLowerCase()
        );
        const forcedSlot = slotDisplayMap[parts[2]] || parts[2].toLowerCase();

        if (
          forcedRoom &&
          !hasDomainSlotConflict(occupancyIndex, forcedSlot, domain, a_start, occupancy_end) &&
          !hasRoomConflict(occupancyIndex, forcedRoom.name, forcedSlot, a_start, occupancy_end)
        ) {
          assigned = { roomName: forcedRoom.name, slot: forcedSlot };
        } else {
          conflicts.push({
            batch_no,
            reason: `Forced classroom ${forced_classroom} conflicts in full date range`
          });
        }
      }
    }

    // 5️⃣ Strict date-based room search
    if (!assigned) {
      assigned = findFreeRoomSlot(
        occupancyIndex,
        enrolled,
        domain,
        a_start,
        occupancy_end,
        preferredSlot
      );
    }

    // 6️⃣ Rearrangement if required
    if (!assigned) {
      const result = attemptRearrangement(
        occupancyIndex,
        enrolled,
        domain,
        a_start,
        occupancy_end,
        today,
        allPlansMap
      );

      if (result.success) {
        result.moves.forEach(move => {
          const fromKey = `${move.from_room}|${move.from_slot}`;
          const entry = occupancyIndex[fromKey].find(b => b.batch_no === move.batch_no);

          if (entry) {
            occupancyIndex[fromKey] =
              occupancyIndex[fromKey].filter(b => b.batch_no !== move.batch_no);

            const toKey = `${move.to_room}|${move.to_slot}`;
            if (!occupancyIndex[toKey]) occupancyIndex[toKey] = [];
            occupancyIndex[toKey].push(entry);

            rearrangements.push({ ...move, freed_for: batch_no });
          }
        });

        assigned = { roomName: result.roomName, slot: result.slot };
        rearrangeInfo = result.moves;
      }
    }

    // 7️⃣ Still not possible
    if (!assigned) {
      unallocated.push({
        ...batch,
        conflict_reason: "No classroom available for full date range"
      });
      continue;
    }

    // 8️⃣ Register occupancy strictly for full range
    const key = `${assigned.roomName}|${assigned.slot}`;
    occupancyIndex[key].push({
      batch_no,
      start: a_start,
      end: occupancy_end,
      domain,
      enrolled
    });

    domainSlotCounter[domain] =
      (domainSlotCounter[domain] || 0) + 1;

    const roomDef = CLASSROOMS.find(r => r.name === assigned.roomName);

    const plan = {
      batch_no,
      mode: "OFFLINE",
      a_start,
      a_end,
      occupancy_end,
      enrolled,
      capacity,
      classroom_name: `${assigned.roomName} [${roomDef?.capacity || ""}]`,
      slot: assigned.slot,
      isAllocated: true,
      trainer_name: "UNASSIGNED",
      module_trainers: [],
      forced_classroom,
      rearranged: !!rearrangeInfo,
      rearrange_reason: rearrangeInfo
        ? rearrangeInfo.map(m =>
            `Moved ${m.batch_no} to ${m.to_room}/${m.to_slot}`
          ).join("; ")
        : "",
      domain
    };

    plans.push(plan);
    allPlansMap[batch_no] = plan;
  }

  return {
    plans,
    unallocated,
    rearrangements,
    conflicts
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   REACT COMPONENT
──────────────────────────────────────────────────────────────────────────── */

export default function ClassroomPlanner() {
  const [plans,              setPlans]              = useState([]);
  const [weeks,              setWeeks]              = useState([]);
  const [error,              setError]              = useState("");
  const [loading,            setLoading]            = useState(false);
  const [processingStatus,   setProcessingStatus]   = useState("");
  const [selectedBatch,      setSelectedBatch]      = useState(null);
  const [downloadFileName,   setDownloadFileName]   = useState("classroom_plan.xlsx");
  const [saveStatus,         setSaveStatus]         = useState("");
  const [saving,             setSaving]             = useState(false);
  const [licenses,           setLicenses]           = useState([]);
  const [licenseError,       setLicenseError]       = useState("");
  const [unallocatedBatches, setUnallocatedBatches] = useState([]);
  const [trainerOverlapInfo, setTrainerOverlapInfo] = useState({});
  const [rearrangements,     setRearrangements]     = useState([]);
  const [planConflicts,      setPlanConflicts]      = useState([]);
  const hasInMemoryData = useRef(false);

  const computeAndSetWeeks = useCallback((normalizedPlans) => {
    const allDates = normalizedPlans.flatMap(p => [p.a_start, p.occupancy_end || p.a_end]).filter(Boolean);
    if (allDates.length)
      setWeeks(getWeeksInRange(allDates.reduce((a, b) => a < b ? a : b), allDates.reduce((a, b) => a > b ? a : b)));
    else setWeeks([]);
  }, []);

  const applyLoadedData = useCallback((occupancyRows, moduleTrainerMap, savedOverlapInfo) => {
    const sortedRows = [...occupancyRows].sort((a, b) => {
      const sa = a.occupancy_start || "", sb = b.occupancy_start || "";
      if (sa !== sb) return sa.localeCompare(sb);
      const ea = a.occupancy_end || "", eb = b.occupancy_end || "";
      if (ea !== eb) return (ea + "").localeCompare(eb + "");
      return (a.batch_no || "").localeCompare(b.batch_no || "");
    });
    const normalizedPlans = sortedRows.map(r => {
      const moduleTrainers = moduleTrainerMap[r.batch_no] || [];
      const primaryTrainer = moduleTrainers.find(mt => mt.trainer_name && mt.trainer_name !== "UNASSIGNED")?.trainer_name || r.trainer_name || "UNASSIGNED";
      return normalizeLoadedRow(r, moduleTrainers, primaryTrainer);
    });
    const unallocated = normalizedPlans.filter(p => !p.classroom_name || !p.slot);
    hasInMemoryData.current = true;
    setPlans(normalizedPlans);
    setUnallocatedBatches(unallocated.map(p => ({
      batch_no: p.batch_no, enrolled: p.enrolled, a_start: p.a_start,
      a_end: p.a_end, occupancy_end: p.occupancy_end, conflict_reason: "Previously unallocated",
    })));
    setTrainerOverlapInfo(savedOverlapInfo);
    computeAndSetWeeks(normalizedPlans);
  }, [computeAndSetWeeks]);

  const loadExistingMatrix = useCallback(async (silent = false) => {
    try {
      if (!silent) { setLoading(true); setProcessingStatus("Loading saved matrix..."); }
      const res = await fetch(`${API_BASE}/api/get-classroom-matrix`);
      if (!res.ok) {
        if (!silent) { setProcessingStatus("Failed to load saved data."); setPlans([]); setWeeks([]); setUnallocatedBatches([]); setTrainerOverlapInfo({}); }
        return;
      }
      const data = await res.json();
      const { occupancyRows } = data || {};
      if (!occupancyRows?.length) {
        if (!silent) { setProcessingStatus("No saved data found."); setPlans([]); setWeeks([]); setUnallocatedBatches([]); setTrainerOverlapInfo({}); }
        return;
      }
      const batchNos = occupancyRows.map(r => r.batch_no).filter(Boolean);
      let moduleTrainerMap = {}, savedOverlapInfo = {};
      try {
        const mtRes = await fetch(`${API_BASE}/api/get-batch-module-trainers`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch_nos: batchNos }),
        });
        if (mtRes.ok) { const mtData = await mtRes.json(); moduleTrainerMap = mtData.moduleTrainerMap || {}; savedOverlapInfo = mtData.overlapInfo || {}; }
      } catch (e) { console.warn("Could not fetch module trainers:", e); }
      applyLoadedData(occupancyRows, moduleTrainerMap, savedOverlapInfo);
      if (!silent) setProcessingStatus(`Loaded ${occupancyRows.length} saved batches.`);
    } catch (e) {
      if (!silent) { setProcessingStatus("Error loading saved matrix."); setPlans([]); setWeeks([]); setUnallocatedBatches([]); setTrainerOverlapInfo({}); }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyLoadedData]);

  useEffect(() => {
    const loadLicenses = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/licenses`);
        if (!res.ok) return;
        const data = await res.json();
        setLicenses(Array.isArray(data) ? data : data.licenses || []);
      } catch (e) { setLicenseError("Failed to load licenses."); }
    };
    loadExistingMatrix(false);
    loadLicenses();
  }, [loadExistingMatrix]);

  /* ── Derived data ── */
  const classrooms = useMemo(() => {
    const rooms = [...new Set(plans.filter(p => p.classroom_name && p.slot).map(p => p.classroom_name))];
    if (unallocatedBatches.length > 0) rooms.push("UNALLOCATED");
    return rooms;
  }, [plans, unallocatedBatches]);

  const table = useMemo(() => {
    const t = [];
    classrooms.forEach(room => {
      const roomSlots = room === "UNALLOCATED" ? ["-"] : SLOTS;
      roomSlots.forEach(slot => {
        const row = [room, slot];
        weeks.forEach(week => {
          const ws = week.weekStart, we = new Date(ws); we.setDate(we.getDate() + 6);
          const si = ws.toISOString().slice(0, 10), ei = we.toISOString().slice(0, 10);
          let batches = [];
          if (room === "UNALLOCATED")
            batches = unallocatedBatches.filter(p => overlaps(p.a_start, p.occupancy_end || p.a_end, si, ei)).map(p => p.batch_no);
          else
            batches = plans.filter(p => p.classroom_name === room && p.slot === slot && overlaps(p.a_start, p.occupancy_end || p.a_end, si, ei)).map(p => p.batch_no);
          row.push(batches.filter(Boolean));
        });
        t.push(row);
      });
    });
    return t;
  }, [classrooms, weeks, plans, unallocatedBatches]);

  const trainers = useMemo(() => {
    const unique = new Set(); let hasUnassigned = false;
    plans.forEach(p => {
      if (p.module_trainers?.length)
        p.module_trainers.forEach(mt => { if (mt.trainer_name && mt.trainer_name !== "UNASSIGNED") unique.add(mt.trainer_name); else hasUnassigned = true; });
      else { if (p.trainer_name && p.trainer_name !== "UNASSIGNED") unique.add(p.trainer_name); else hasUnassigned = true; }
    });
    const sorted = Array.from(unique).sort();
    if (hasUnassigned) sorted.push("UNASSIGNED");
    return sorted;
  }, [plans]);

  const trainerTable = useMemo(() => {
    return trainers.map(trainer => {
      const row = [trainer];
      weeks.forEach(week => {
        const ws = week.weekStart, we = new Date(ws); we.setDate(we.getDate() + 6);
        const si = ws.toISOString().slice(0, 10), ei = we.toISOString().slice(0, 10);
        const batches = plans.filter(p => {
          if (!overlaps(p.a_start, p.occupancy_end || p.a_end, si, ei)) return false;
          if (p.module_trainers?.length) return p.module_trainers.some(mt => mt.trainer_name === trainer);
          return (p.trainer_name || "UNASSIGNED") === trainer;
        }).map(p => p.batch_no);
        row.push(batches.filter(Boolean));
      });
      return row;
    });
  }, [trainers, weeks, plans]);

  const batchColorMap      = useMemo(() => getBatchColorMap(table), [table]);
  const trainerBatchColorMap = useMemo(() => getBatchColorMap(trainerTable), [trainerTable]);
  const batchDetailMap     = useMemo(() => { const m = {}; plans.forEach(p => { m[p.batch_no] = p; }); return m; }, [plans]);

  const getLicenseInfoForBatch = (batchNo, classroomCapacity, enrolled) => {
    const domain = getDomainFromBatch(batchNo);
    if (!domain || !Array.isArray(licenses)) return [];
    const domainLicenses = licenses.filter(l => (l.domain || "").toString().toUpperCase() === domain);
    if (!domainLicenses.length) return [];
    return domainLicenses.map(lic => {
      const licenseCount = Number(lic.count || 0), required = Math.max(Number(enrolled || 0), Number(classroomCapacity || 0));
      return { license_name: lic.license_name, count: licenseCount, required, additional_needed: Math.max(0, required - licenseCount) };
    });
  };

  const handleBatchClick = (batch) => {
    if (!batch) return;
    const base = batchDetailMap[batch];
    if (!base) { setSelectedBatch(null); return; }
    setSelectedBatch({ ...base, licenseInfo: getLicenseInfoForBatch(base.batch_no, base.capacity, base.enrolled) });
  };

  const fetchModuleTrainersForBatches = async (batchNos, offlinePlans) => {
    try {
      const batch_date_ranges = {};
      (offlinePlans || []).forEach(p => {
        if (p.batch_no && p.a_start && p.occupancy_end)
          batch_date_ranges[p.batch_no] = { start: p.a_start, end: p.occupancy_end };
      });
      const res = await fetch(`${API_BASE}/api/assign-batch-trainers-by-module`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_nos: batchNos, batch_date_ranges }),
      });
      if (!res.ok) return { moduleTrainerMap: {}, overlapInfo: {} };
      const data = await res.json();
      return { moduleTrainerMap: data.moduleTrainerMap || {}, overlapInfo: data.overlapInfo || {} };
    } catch (e) { return { moduleTrainerMap: {}, overlapInfo: {} }; }
  };

  /* ── File Upload Handler ── */
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true); setError(""); setProcessingStatus("Reading file...");
    setPlans([]); setWeeks([]); setSelectedBatch(null); setSaveStatus("");
    setTrainerOverlapInfo({}); setRearrangements([]); setPlanConflicts([]);
    hasInMemoryData.current = false;

    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });

      setProcessingStatus("Running smart classroom allocation...");
      const today = new Date();
      const { plans: offlinePlans, unallocated, rearrangements: moves, conflicts: planCfls } = smartPlanClassrooms(rows, today);

      setProcessingStatus("Assigning trainers per module type...");
      const batchNos = offlinePlans.map(p => p.batch_no).filter(Boolean);
      const { moduleTrainerMap, overlapInfo } = await fetchModuleTrainersForBatches(batchNos, offlinePlans);
      setTrainerOverlapInfo(overlapInfo);

      const enrichedPlans = offlinePlans.map(p => {
        const moduleTrainers = moduleTrainerMap[p.batch_no] || [];
        return {
          ...p,
          trainer_name: moduleTrainers.find(mt => mt.trainer_name && mt.trainer_name !== "UNASSIGNED")?.trainer_name || "UNASSIGNED",
          module_trainers: moduleTrainers,
        };
      });

      const sortedPlans = [...enrichedPlans].sort((a, b) => {
        if (a.a_start !== b.a_start) return a.a_start.localeCompare(b.a_start);
        const ae = a.occupancy_end || a.a_end || "", be = b.occupancy_end || b.a_end || "";
        if (ae !== be) return ae.localeCompare(be);
        return (a.batch_no || "").localeCompare(b.batch_no || "");
      });

      hasInMemoryData.current = true;
      setPlans(sortedPlans);
      setRearrangements(moves);
      setPlanConflicts(planCfls);
      setUnallocatedBatches(unallocated.sort((a, b) => (a.a_start || "").localeCompare(b.a_start || "")));

      if (!offlinePlans.length) {
        setError("No OFFLINE batches found in the file.");
      } else {
        const allDates = offlinePlans.flatMap(p => [p.a_start, p.occupancy_end || p.a_end]).filter(Boolean);
        if (allDates.length)
          setWeeks(getWeeksInRange(allDates.reduce((a, b) => a < b ? a : b), allDates.reduce((a, b) => a > b ? a : b)));
        setProcessingStatus(
          `Done! ${offlinePlans.length} allocated · ${moves.length} rearranged · ${unallocated.length} unallocated`
        );
      }
    } catch (err) {
      setError(`Failed to process file: ${err.message || "Invalid file format"}`);
    } finally {
      setLoading(false);
    }
  };

  /* ── Download XLSX ── */
  const handleDownloadXlsx = async () => {
    if (!plans.length) { setError("No data to export."); return; }
    try {
      const workbook = new ExcelJS.Workbook();
      const matrixSheet = workbook.addWorksheet("Classroom Matrix");
      matrixSheet.addRow(["Classroom", "Slot", ...weeks.map(w => `${w.month} W${w.weekNum}`)]);
      const mh = matrixSheet.getRow(1);
      mh.font = { bold: true, color: { argb: "FFFFFFFF" } };
      mh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } };
      mh.alignment = { horizontal: "center", vertical: "center", wrapText: true };
      table.forEach(row => {
        const outRow = row.map((cell, idx) => idx < 2 ? (idx === 1 ? slotDisplayMap[cell] || cell : cell) : (Array.isArray(cell) ? cell.join(", ") : ""));
        const excelRow = matrixSheet.addRow(outRow);
        row.forEach((cell, colIdx) => {
          if (colIdx >= 2 && Array.isArray(cell) && cell.length > 0) {
            const hexColor = batchColorMap[cell[0]];
            if (hexColor) {
              const rgb = hexToRGB(hexColor);
              const argb = `FF${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b.toString(16).padStart(2, "0")}`.toUpperCase();
              const ec = excelRow.getCell(colIdx + 1);
              ec.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
              ec.font = { bold: true, color: { argb: "FF222222" } };
              ec.alignment = { horizontal: "center", vertical: "center", wrapText: true };
            }
          }
        });
        excelRow.getCell(1).font = { bold: true };
        excelRow.getCell(2).alignment = { horizontal: "center", vertical: "center" };
      });
      matrixSheet.columns = [{ width: 20 }, { width: 12 }, ...weeks.map(() => ({ width: 18 }))];

      // Rearrangements sheet
      if (rearrangements.length) {
        const rearrSheet = workbook.addWorksheet("Rearrangements");
        rearrSheet.addRow(["Batch Moved", "From Room", "From Slot", "To Room", "To Slot", "Days Remaining", "Freed For"]);
        rearrangements.forEach(r => rearrSheet.addRow([r.batch_no, r.from_room, r.from_slot, r.to_room, r.to_slot, r.remaining_days, r.freed_for]));
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = downloadFileName || "classroom_plan.xlsx"; link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) { setError(`Failed to download: ${err.message}`); }
  };

  /* ── Save Matrix ── */
  const handleSaveMatrix = async () => {
    if (!plans.length && !unallocatedBatches.length) { setError("No matrix to save."); return; }
    setSaving(true); setSaveStatus(""); setError("");
    try {
      const allRows = [
        ...plans,
        ...unallocatedBatches.map(u => ({
          batch_no: u.batch_no, classroom_name: null, slot: null,
          a_start: u.a_start, a_end: u.a_end, occupancy_end: u.occupancy_end,
          enrolled: u.enrolled, capacity: u.capacity || 0,
          trainer_name: null, module_trainers: [], forced_classroom: "",
        })),
      ].sort((a, b) => {
        const sa = a.a_start || "", sb = b.a_start || ""; if (sa !== sb) return sa.localeCompare(sb);
        const ea = a.occupancy_end || a.a_end || "", eb = b.occupancy_end || b.a_end || "";
        if (ea !== eb) return ea.localeCompare(eb);
        return (a.batch_no || "").localeCompare(b.batch_no || "");
      });
      const occupancyRows = allRows.map(p => ({
        batch_no: p.batch_no?.trim(), classroom_name: p.classroom_name || null, slot: p.slot || null,
        occupancy_start: p.a_start, occupancy_end: p.occupancy_end || p.a_end || null,
        enrolled: p.enrolled || 0, capacity: p.capacity || p.enrolled || 0,
        trainer_name: p.trainer_name || null, module_trainers: p.module_trainers || [],
        overlap_info: trainerOverlapInfo[p.batch_no] || [],
        forced_classroom: p.forced_classroom || null,
      }));
      const res = await fetch(`${API_BASE}/api/save-classroom-matrix`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occupancyRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const { inserted, updated, skipped } = data.summary || {};
      setSaveStatus(`✅ ${inserted || 0} NEW + ${updated || 0} UPDATED + ${skipped || 0} unchanged`);
      loadExistingMatrix(true);
    } catch (err) { setError(`Save failed: ${err.message}`); }
    finally { setSaving(false); }
  };

  /* ── RENDER ── */
  return (
    <Box sx={{ minHeight: "100vh", background: TOKENS.bg, p: { xs: 2, md: 4 }, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <Box sx={{ maxWidth: "98vw", mx: "auto" }}>

        {/* ── Page Header ── */}
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: TOKENS.text, letterSpacing: "-0.03em", mb: 0.5 }}>
            Classroom Planner
          </Typography>
          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: TOKENS.textSub }}>
            Smart auto-allocation · Domain-aware slot rotation · Internal rearrangement
          </Typography>
        </Box>

        {/* ── Controls Card ── */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <SectionHeader
            icon={<MeetingRoomIcon sx={{ fontSize: 20 }} />}
            title="Upload & Configure"
            subtitle="CSV / XLSX with COURSE, MODE, A.START DATE, A.DUE DATE, CAPACITY, ENROLLED, CLASS_ROOM"
          />
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-end", mb: 3 }}>
              <Button variant="contained" component="label" disabled={loading}
                startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <UploadFileIcon sx={{ fontSize: 18 }} />}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 3, py: 1.2, background: TOKENS.accent, "&:hover": { background: "#2a3fd4" } }}>
                {loading ? "Processing..." : "Upload File"}
                <input type="file" hidden accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={handleFileUpload} disabled={loading} />
              </Button>
              <Button variant="contained" onClick={handleDownloadXlsx} disabled={loading || !plans.length}
                startIcon={<DownloadIcon sx={{ fontSize: 18 }} />}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 3, py: 1.2, background: TOKENS.success.fill, "&:hover": { background: "#0a9668" }, "&:disabled": { opacity: 0.5 } }}>
                Download XLSX
              </Button>
              <Button variant="outlined" onClick={handleSaveMatrix} disabled={loading || saving || !plans.length}
                startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon sx={{ fontSize: 18 }} />}
                sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13, borderRadius: "10px", textTransform: "none", px: 3, py: 1.2, borderColor: TOKENS.border, color: TOKENS.textSub, "&:hover": { borderColor: TOKENS.accent, color: TOKENS.accent, background: TOKENS.accentLight }, "&:disabled": { opacity: 0.5 } }}>
                {saving ? "Saving..." : "Save Matrix"}
              </Button>
              <TextField label="Filename" value={downloadFileName} onChange={e => setDownloadFileName(e.target.value)} size="small" disabled={loading}
                InputProps={{ endAdornment: <Typography sx={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: TOKENS.textSub }}>.xlsx</Typography> }}
                sx={{ minWidth: 200, "& .MuiInputBase-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13, borderRadius: "10px" }, "& .MuiInputLabel-root": { fontFamily: "'DM Sans', sans-serif", fontSize: 13 } }} />
              {saveStatus && <Chip label={saveStatus} size="small" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.success.light, color: TOKENS.success.text, border: `1px solid ${TOKENS.success.fill}44` }} />}
            </Box>

            {/* Status banners */}
            {loading && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 2, borderRadius: "10px", background: TOKENS.accentLight, border: `1px solid ${TOKENS.accent}33` }}>
                <CircularProgress size={18} sx={{ color: TOKENS.accent }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: TOKENS.accent }}>{processingStatus || "Processing..."}</Typography>
              </Box>
            )}
            {!loading && processingStatus && (
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1, px: 2, py: 0.8, borderRadius: "8px", background: TOKENS.success.light, border: `1px solid ${TOKENS.success.fill}44` }}>
                <CheckCircleIcon sx={{ fontSize: 14, color: TOKENS.success.fill }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: TOKENS.success.text }}>{processingStatus}</Typography>
              </Box>
            )}
            <Fade in={!!error}>
              <Box>{error && (
                <Box sx={{ mt: 2, px: 2.5, py: 1.5, borderRadius: "10px", background: TOKENS.error.light, border: `1px solid ${TOKENS.error.fill}44` }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: TOKENS.error.text }}>{error}</Typography>
                </Box>
              )}</Box>
            </Fade>
            {licenseError && (
              <Box sx={{ mt: 2, px: 2.5, py: 1.5, borderRadius: "10px", background: TOKENS.warning.light, border: `1px solid ${TOKENS.warning.fill}44` }}>
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: TOKENS.warning.text }}>{licenseError}</Typography>
              </Box>
            )}

            {/* Batch Detail Panel */}
            <Fade in={!!selectedBatch}>
              <Box sx={{ mt: 3 }}>
                {selectedBatch && (
                  <Box sx={{ ...cardSx, border: `1.5px solid ${TOKENS.accent}44` }}>
                    <Box sx={{ px: 3, py: 2, background: TOKENS.accentLight, borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <InfoOutlinedIcon sx={{ fontSize: 16, color: TOKENS.accent }} />
                      <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: 14, color: TOKENS.accent }}>Batch Details: {selectedBatch.batch_no}</Typography>
                      {selectedBatch.forced_classroom && <Chip label={`📌 Forced: ${selectedBatch.forced_classroom}`} size="small" sx={{ ml: 1, fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.warning.light, color: TOKENS.warning.text }} />}
                      {selectedBatch.rearranged && <Chip label="🔀 Rearranged" size="small" sx={{ ml: 1, fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.info.light, color: TOKENS.info.text }} />}
                      <Chip label={`Domain: ${selectedBatch.domain || getDomainFromBatch(selectedBatch.batch_no)}`} size="small" sx={{ ml: 1, fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.accentLight, color: TOKENS.accent }} />
                    </Box>
                    <Box sx={{ p: 3, display: "flex", flexWrap: "wrap", gap: 2 }}>
                      {[
                        ["Capacity", selectedBatch.capacity],
                        ["Enrolled", selectedBatch.enrolled],
                        ["Domain", selectedBatch.domain || getDomainFromBatch(selectedBatch.batch_no)],
                        ["Start Date", selectedBatch.a_start],
                        ["Due Date", selectedBatch.a_end || "—"],
                        ["Occupancy End", selectedBatch.occupancy_end || "—"],
                        ["Classroom", selectedBatch.classroom_name || "Not assigned"],
                        ["Slot", slotDisplayMap[selectedBatch.slot] || selectedBatch.slot || "Not assigned"],
                      ].map(([label, val]) => (
                        <Box key={label} sx={{ px: 2, py: 1, borderRadius: "10px", background: TOKENS.surfaceAlt, border: `1px solid ${TOKENS.border}` }}>
                          <Typography sx={{ ...labelSx, fontSize: 10 }}>{label}</Typography>
                          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: TOKENS.text }}>{val}</Typography>
                        </Box>
                      ))}
                    </Box>
                    {selectedBatch.rearrange_reason && (
                      <Box sx={{ px: 3, pb: 2 }}>
                        <Box sx={{ px: 2, py: 1.5, borderRadius: "10px", background: TOKENS.info.light, border: `1px solid ${TOKENS.info.fill}44` }}>
                          <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: TOKENS.info.text }}>
                            🔀 {selectedBatch.rearrange_reason}
                          </Typography>
                        </Box>
                      </Box>
                    )}
                    {selectedBatch.module_trainers?.length > 0 && (
                      <Box sx={{ px: 3, pb: 3 }}>
                        <Typography sx={{ ...labelSx, mb: 1 }}>Trainers by Module Type</Typography>
                        <TableContainer sx={{ borderRadius: "10px", border: `1px solid ${TOKENS.border}`, maxWidth: 520 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>{["Module Type", "Module Name", "Trainer"].map(h => <TableCell key={h} sx={tableHeadSx}>{h}</TableCell>)}</TableRow>
                            </TableHead>
                            <TableBody>
                              {selectedBatch.module_trainers.map((mt, idx) => (
                                <TableRow key={idx} sx={{ "&:nth-of-type(even)": { background: TOKENS.surfaceAlt } }}>
                                  <TableCell sx={tableCellSx}>
                                    <Chip label={mt.module_type} size="small" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: mt.module_type === "CORE_THEORY" ? TOKENS.accentLight : mt.module_type === "CORE_LAB" ? "#f3e8ff" : TOKENS.surfaceAlt, color: mt.module_type === "CORE_THEORY" ? TOKENS.accent : mt.module_type === "CORE_LAB" ? "#7c3aed" : TOKENS.textSub }} />
                                  </TableCell>
                                  <TableCell sx={tableCellSx}>{mt.module_name || "-"}</TableCell>
                                  <TableCell sx={{ ...tableCellSx, fontWeight: 700, color: mt.trainer_name === "UNASSIGNED" ? TOKENS.error.fill : TOKENS.success.fill }}>{mt.trainer_name || "UNASSIGNED"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            </Fade>
          </Box>
        </Box>

        {/* ── Classroom Matrix ── */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <SectionHeader
            icon={<MeetingRoomIcon sx={{ fontSize: 20 }} />}
            title="Classroom Occupancy Matrix"
            subtitle={plans.length ? `${plans.length} batches · occupancy = start + 5 months + 2 weeks · click any batch chip for details` : ""}
            right={plans.length ? <Chip label={`${classrooms.length} classrooms`} size="small" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, background: TOKENS.accentLight, color: TOKENS.accent, border: `1px solid ${TOKENS.accent}33` }} /> : null}
          />
          <Box sx={{ p: 3 }}>
            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: 160, gap: 2 }}>
                <CircularProgress sx={{ color: TOKENS.accent }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>Loading matrix...</Typography>
              </Box>
            ) : !plans.length && !unallocatedBatches.length ? (
              <Box sx={{ textAlign: "center", py: 6 }}>
                <MeetingRoomIcon sx={{ fontSize: 40, color: TOKENS.border, mb: 1 }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>Upload a file or load saved data to see the classroom matrix.</Typography>
              </Box>
            ) : (
              <TableContainer sx={{ maxHeight: 450, borderRadius: "10px", border: `1px solid ${TOKENS.border}` }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={tableHeadSx}>Classroom</TableCell>
                      <TableCell sx={tableHeadSx}>Slot</TableCell>
                      {weeks.map((w, idx) => <TableCell key={idx} align="center" sx={tableHeadSx}>{w.month} {w.year} W{w.weekNum}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {table.map((row, idx) => (
                      <TableRow key={idx} hover sx={row[0] === "UNALLOCATED" ? { background: TOKENS.error.light } : { "&:nth-of-type(even)": { background: TOKENS.surfaceAlt } }}>
                        {row.map((cell, jdx) =>
                          jdx < 2 ? (
                            <TableCell key={jdx} sx={{ ...tableCellSx, fontWeight: jdx === 0 ? 800 : 500, minWidth: jdx === 0 ? 140 : 80, whiteSpace: "pre-wrap" }}>
                              {jdx === 1 ? slotDisplayMap[cell] || cell : cell}
                            </TableCell>
                          ) : (
                            <TableCell key={jdx} sx={{ minWidth: 80, p: 0.5, textAlign: "center", borderBottom: `1px solid ${TOKENS.border}` }}>
                              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.3 }}>
                                {Array.isArray(cell) && cell.filter(Boolean).map((batch, bid) => {
                                  const planEntry = batchDetailMap[batch];
                                  const isForced   = !!planEntry?.forced_classroom;
                                  const isRearranged = !!planEntry?.rearranged;
                                  const label = isForced ? `📌 ${batch}` : isRearranged ? `🔀 ${batch}` : batch;
                                  return (
                                    <Tooltip key={bid} title={
                                      isRearranged ? `Rearranged: ${planEntry?.rearrange_reason || ""}` :
                                      isForced ? `Forced: ${planEntry?.forced_classroom}` : batch
                                    } arrow>
                                      <Chip label={label} size="small"
                                        sx={{ backgroundColor: batchColorMap[batch] || "#e0e0e0", color: "#222", fontWeight: 700, height: 22, fontSize: "0.72rem", cursor: "pointer", border: isForced ? "1.5px solid #f57c00" : isRearranged ? "1.5px solid #6366f1" : "none", fontFamily: "'DM Mono', monospace" }}
                                        onClick={() => handleBatchClick(batch)}
                                      />
                                    </Tooltip>
                                  );
                                })}
                              </Box>
                            </TableCell>
                          )
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </Box>

        {/* ── Trainer Matrix ── */}
        <Box sx={{ ...cardSx, mb: 3 }}>
          <SectionHeader
            icon={<PersonIcon sx={{ fontSize: 20 }} />}
            title="Trainer Allocation Matrix"
            subtitle="Batches per trainer across BASIC · CORE_THEORY · CORE_LAB modules"
          />
          <Box sx={{ p: 3 }}>
            {!plans.length ? (
              <Box sx={{ textAlign: "center", py: 5 }}>
                <PersonIcon sx={{ fontSize: 40, color: TOKENS.border, mb: 1 }} />
                <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: TOKENS.textSub }}>Upload a file or load saved data to see trainer allocation.</Typography>
              </Box>
            ) : (
              <TableContainer sx={{ maxHeight: 450, borderRadius: "10px", border: `1px solid ${TOKENS.border}` }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={tableHeadSx}>Trainer</TableCell>
                      {weeks.map((w, idx) => <TableCell key={idx} align="center" sx={tableHeadSx}>{w.month} {w.year} W{w.weekNum}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {trainerTable.map((row, idx) => (
                      <TableRow key={idx} sx={row[0] === "UNASSIGNED" ? { background: TOKENS.error.light } : { "&:nth-of-type(even)": { background: TOKENS.surfaceAlt } }}>
                        {row.map((cell, jdx) =>
                          jdx === 0 ? (
                            <TableCell key={jdx} sx={{ ...tableCellSx, fontWeight: 700, minWidth: 140 }}>{cell}</TableCell>
                          ) : (
                            <TableCell key={jdx} sx={{ textAlign: "center", p: 0.5, borderBottom: `1px solid ${TOKENS.border}` }}>
                              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.3 }}>
                                {Array.isArray(cell) && cell.map((batch, bid) => (
                                  <Chip key={bid} label={batch} size="small"
                                    sx={{ backgroundColor: trainerBatchColorMap[batch] || "#e0e0e0", fontWeight: 700, cursor: "pointer", height: 22, fontSize: "0.72rem", fontFamily: "'DM Mono', monospace" }}
                                    onClick={() => handleBatchClick(batch)}
                                  />
                                ))}
                              </Box>
                            </TableCell>
                          )
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </Box>

        {/* ── Rearrangements Log ── */}
        {rearrangements.length > 0 && (
          <Box sx={{ ...cardSx, mb: 3, border: `1.5px solid ${TOKENS.info.fill}44` }}>
            <SectionHeader
              icon={<SwapHorizIcon sx={{ fontSize: 20, color: TOKENS.info.fill }} />}
              title="Internal Rearrangements"
              subtitle={`${rearrangements.length} batch${rearrangements.length > 1 ? "es" : ""} moved to free space for incoming batches`}
            />
            <Box sx={{ p: 3 }}>
              <TableContainer sx={{ borderRadius: "10px", border: `1px solid ${TOKENS.border}` }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>{["Batch Moved", "From", "To", "Days Remaining at Move", "Freed Slot For"].map(h =>
                      <TableCell key={h} sx={tableHeadSx}>{h}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rearrangements.map((r, idx) => (
                      <TableRow key={idx} sx={{ background: TOKENS.info.light, "&:nth-of-type(even)": { background: "#eef2ff" } }}>
                        <TableCell sx={{ ...tableCellSx, fontWeight: 700, color: TOKENS.info.text, fontFamily: "'DM Mono', monospace" }}>{r.batch_no}</TableCell>
                        <TableCell sx={tableCellSx}>{r.from_room} / {r.from_slot}</TableCell>
                        <TableCell sx={{ ...tableCellSx, fontWeight: 700, color: TOKENS.success.fill }}>{r.to_room} / {r.to_slot}</TableCell>
                        <TableCell sx={{ ...tableCellSx, color: r.remaining_days <= 14 ? TOKENS.warning.fill : TOKENS.text, fontWeight: 700 }}>{r.remaining_days}d</TableCell>
                        <TableCell sx={{ ...tableCellSx, fontFamily: "'DM Mono', monospace", color: TOKENS.accent, fontWeight: 700 }}>{r.freed_for}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Box>
        )}

        {/* ── Unallocated Batches (with conflict details) ── */}
        {unallocatedBatches.length > 0 && (
          <Box sx={{ ...cardSx, mb: 3, border: `1.5px solid ${TOKENS.error.fill}44` }}>
            <SectionHeader
              icon={<WarningAmberIcon sx={{ fontSize: 20, color: TOKENS.error.fill }} />}
              title="Unallocated Batches"
              subtitle={`${unallocatedBatches.length} batch${unallocatedBatches.length > 1 ? "es" : ""} could not be assigned — even after rearrangement`}
            />
            <Box sx={{ p: 3 }}>
              <TableContainer sx={{ borderRadius: "10px", border: `1px solid ${TOKENS.border}` }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>{["Batch", "Domain", "Enrolled", "Start Date", "Occupancy End", "Conflict Reason"].map(h =>
                      <TableCell key={h} sx={tableHeadSx}>{h}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {unallocatedBatches.map(u => (
                      <TableRow key={u.batch_no} sx={{ background: TOKENS.error.light }}>
                        <TableCell sx={{ ...tableCellSx, fontWeight: 700, color: TOKENS.error.text, fontFamily: "'DM Mono', monospace" }}>{u.batch_no}</TableCell>
                        <TableCell sx={tableCellSx}><Chip label={u.domain || getDomainFromBatch(u.batch_no)} size="small" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11 }} /></TableCell>
                        <TableCell sx={tableCellSx}>{u.enrolled}</TableCell>
                        <TableCell sx={tableCellSx}>{u.a_start}</TableCell>
                        <TableCell sx={{ ...tableCellSx, color: TOKENS.accent, fontWeight: 700 }}>{u.occupancy_end}</TableCell>
                        <TableCell sx={{ ...tableCellSx, color: TOKENS.error.text, fontSize: 11, maxWidth: 320 }}>{u.conflict_reason || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Box>
        )}

        {/* ── Forced Classroom Conflicts ── */}
        {planConflicts.length > 0 && (
          <Box sx={{ ...cardSx, mb: 3, border: `1.5px solid ${TOKENS.warning.fill}44` }}>
            <SectionHeader icon={<WarningAmberIcon sx={{ fontSize: 20, color: TOKENS.warning.fill }} />} title="Forced Classroom Overrides" subtitle="These batches had forced classrooms that conflicted — auto-assigned instead" />
            <Box sx={{ p: 3 }}>
              {planConflicts.map((c, idx) => (
                <Box key={idx} sx={{ mb: 1, px: 2, py: 1, borderRadius: "8px", background: TOKENS.warning.light, border: `1px solid ${TOKENS.warning.fill}44` }}>
                  <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: TOKENS.warning.text }}>
                    <strong>{c.batch_no}:</strong> {c.reason}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* ── Trainer Conflicts ── */}
        {Object.keys(trainerOverlapInfo).length > 0 && (
          <Box sx={{ ...cardSx, mb: 3, border: `1.5px solid ${TOKENS.error.fill}` }}>
            <SectionHeader icon={<WarningAmberIcon sx={{ fontSize: 20, color: TOKENS.error.fill }} />} title="Trainer Scheduling Conflicts" subtitle="Module types that could not be assigned a trainer" />
            <Box sx={{ p: 3 }}>
              <TableContainer sx={{ borderRadius: "10px", border: `1px solid ${TOKENS.border}` }}>
                <Table size="small">
                  <TableHead><TableRow>{["Batch", "Module Type", "Trainer", "Conflicting Batch", "Conflict Period"].map(h => <TableCell key={h} sx={tableHeadSx}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {Object.entries(trainerOverlapInfo).flatMap(([batchNo, moduleConflicts]) =>
                      (Array.isArray(moduleConflicts) ? moduleConflicts : []).flatMap((mc, i) =>
                        mc.conflicts?.length > 0
                          ? mc.conflicts.map((c, j) => (
                            <TableRow key={`${batchNo}-${i}-${j}`} sx={{ background: TOKENS.error.light }}>
                              <TableCell sx={{ ...tableCellSx, fontWeight: 700, color: TOKENS.error.text }}>{batchNo}</TableCell>
                              <TableCell sx={tableCellSx}><Chip label={mc.module_type || "-"} size="small" sx={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11 }} /></TableCell>
                              <TableCell sx={tableCellSx}>{mc.trainer}</TableCell>
                              <TableCell sx={tableCellSx}>{c.batch_no}</TableCell>
                              <TableCell sx={{ ...tableCellSx, color: TOKENS.error.text, fontFamily: "'DM Mono', monospace" }}>{String(c.start || "").slice(0, 10)} → {String(c.end || "").slice(0, 10)}</TableCell>
                            </TableRow>
                          ))
                          : [<TableRow key={`${batchNo}-${i}-none`} sx={{ background: TOKENS.error.light }}>
                            <TableCell sx={{ ...tableCellSx, fontWeight: 700, color: TOKENS.error.text }}>{batchNo}</TableCell>
                            <TableCell sx={tableCellSx}><Chip label={mc.module_type || "-"} size="small" /></TableCell>
                            <TableCell sx={tableCellSx}>{mc.trainer}</TableCell>
                            <TableCell colSpan={2} sx={{ ...tableCellSx, color: TOKENS.textSub, fontStyle: "italic" }}>No free slot found</TableCell>
                          </TableRow>]
                      )
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Box>
        )}

        {/* ── License Summary ── */}
        {plans.length > 0 && (
          <Box sx={{ ...cardSx }}>
            <SectionHeader icon={<CheckCircleIcon sx={{ fontSize: 20 }} />} title="License Requirement Summary" subtitle="Software license availability by batch" />
            <Box sx={{ p: 3 }}>
              {(() => {
                const issues = plans.filter(p => p.batch_no).map(p => ({
                  batch_no: p.batch_no,
                  shortages: getLicenseInfoForBatch(p.batch_no, p.capacity, p.enrolled).filter(l => l.additional_needed > 0),
                })).filter(p => p.shortages.length > 0);
                if (!issues.length) return (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2.5, py: 2, borderRadius: "10px", background: TOKENS.success.light, border: `1px solid ${TOKENS.success.fill}44` }}>
                    <CheckCircleIcon sx={{ fontSize: 18, color: TOKENS.success.fill }} />
                    <Typography sx={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: TOKENS.success.text }}>All licenses are sufficient for all batches.</Typography>
                  </Box>
                );
                return (
                  <TableContainer sx={{ borderRadius: "10px", border: `1px solid ${TOKENS.border}` }}>
                    <Table size="small">
                      <TableHead><TableRow>{["Batch", "License", "Available", "Required", "Additional Needed"].map(h => <TableCell key={h} sx={tableHeadSx}>{h}</TableCell>)}</TableRow></TableHead>
                      <TableBody>
                        {issues.map(issue => issue.shortages.map((lic, idx) => (
                          <TableRow key={`${issue.batch_no}-${idx}`} sx={{ background: TOKENS.error.light }}>
                            <TableCell sx={{ ...tableCellSx, fontWeight: 700, color: TOKENS.error.text }}>{issue.batch_no}</TableCell>
                            <TableCell sx={tableCellSx}>{lic.license_name}</TableCell>
                            <TableCell sx={tableCellSx}>{lic.count}</TableCell>
                            <TableCell sx={tableCellSx}>{lic.required}</TableCell>
                            <TableCell sx={{ ...tableCellSx, color: TOKENS.error.fill, fontWeight: 800 }}>{lic.additional_needed}</TableCell>
                          </TableRow>
                        )))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                );
              })()}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}