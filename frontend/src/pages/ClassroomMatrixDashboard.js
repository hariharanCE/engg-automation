import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Chip,
  Divider,
} from "@mui/material";

const API_BASE =
  process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";

const colorPalette = [
  "#edc7cf", "#bdd9bf", "#c7ceea", "#ffeebb",
  "#a4c2f4", "#a1eafb", "#e6c7e3", "#f7cac9",
  "#ffe066", "#f8b195", "#80ced6", "#d5f4e6",
  "#f0a6ca", "#b5ead7", "#ead3d7", "#ffe0ac",
  "#b3cdd1", "#eec9e6",
];

const slotDisplayMap = {
  morning: "Morning",
  evening: "Evening",
};

function getWeeksInRange(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const weeks = [];
  let cur = new Date(startDate);
  cur.setDate(cur.getDate() - cur.getDay());

  while (cur <= endDate) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const weekNum = Math.ceil(
      (cur.getDate() + 1 - new Date(y, m, 1).getDay()) / 7
    );

    weeks.push({
      year: y,
      month: cur.toLocaleString("default", { month: "short" }),
      weekNum,
      weekStart: new Date(cur),
    });

    cur.setDate(cur.getDate() + 7);
  }

  return weeks;
}

function isDateOverlap(start1, end1, start2, end2) {
  return !(
    new Date(end1) < new Date(start2) ||
    new Date(start1) > new Date(end2)
  );
}

function getBatchColorMap(table) {
  const batchSet = new Set();
  table.forEach((row) =>
    row.forEach((cell) => {
      if (Array.isArray(cell)) {
        cell.forEach((bn) => batchSet.add(bn));
      }
    })
  );

  const batchArr = Array.from(batchSet).filter(Boolean).sort();
  const batchColorMap = {};

  batchArr.forEach((bn, idx) => {
    batchColorMap[bn] = colorPalette[idx % colorPalette.length];
  });

  return batchColorMap;
}

export default function ClassroomMatrixDashboard() {
  const [plans, setPlans] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadMatrix = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await fetch(`${API_BASE}/api/get-classroom-matrix`);

      if (!res.ok) {
        throw new Error("No saved classroom matrix found.");
      }

      const data = await res.json();
      const { occupancyRows } = data || {};

      if (!occupancyRows?.length) {
        setPlans([]);
        setWeeks([]);
        return;
      }

      const normalizedPlans = occupancyRows.map((r) => ({
        batch_no: r.batch_no,
        classroom_name: r.classroom_name,
        slot: r.slot,
        a_start: r.occupancy_start,
        a_end: r.occupancy_end,
      }));

      setPlans(normalizedPlans);

      const allDates = normalizedPlans.flatMap((p) => [
        p.a_start,
        p.a_end,
      ]);

      const start = allDates.reduce((a, b) => (a < b ? a : b));
      const end = allDates.reduce((a, b) => (a > b ? a : b));

      setWeeks(getWeeksInRange(start, end));
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  const classrooms = useMemo(
    () => [...new Set(plans.map((p) => p.classroom_name))],
    [plans]
  );

  const slots = ["morning", "evening"];

  const table = useMemo(() => {
    const t = [];

    classrooms.forEach((room) => {
      slots.forEach((slot) => {
        const row = [room, slot];

        weeks.forEach((week) => {
          const weekStart = week.weekStart;
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);

          const startIso = weekStart.toISOString().slice(0, 10);
          const endIso = weekEnd.toISOString().slice(0, 10);

          const batches = plans
            .filter(
              (p) =>
                p.classroom_name === room &&
                p.slot === slot &&
                isDateOverlap(p.a_start, p.a_end, startIso, endIso)
            )
            .map((p) => p.batch_no);

          row.push(batches);
        });

        t.push(row);
      });
    });

    return t;
  }, [plans, classrooms, weeks]);

  const batchColorMap = useMemo(() => getBatchColorMap(table), [table]);

  return (
    <Box sx={{ maxWidth: "98vw", mx: "auto", my: 4 }}>
      <Paper elevation={4} sx={{ p: 4, borderRadius: 3 }}>
        <Typography variant="h4" fontWeight="bold" gutterBottom>
          Classroom Occupancy Dashboard
        </Typography>

        <Divider sx={{ mb: 3 }} />

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : !plans.length ? (
          <Alert severity="info">
            No classroom occupancy data found.
          </Alert>
        ) : (
          <TableContainer sx={{ maxHeight: 600 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell><strong>Classroom</strong></TableCell>
                  <TableCell><strong>Slot</strong></TableCell>
                  {weeks.map((w, idx) => (
                    <TableCell key={idx} align="center">
                      {w.month} W{w.weekNum}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>

              <TableBody>
                {table.map((row, idx) => (
                  <TableRow key={idx}>
                    {row.map((cell, jdx) =>
                      jdx < 2 ? (
                        <TableCell key={jdx}>
                          {jdx === 1
                            ? slotDisplayMap[cell] || cell
                            : cell}
                        </TableCell>
                      ) : (
                        <TableCell key={jdx} align="center">
                          {Array.isArray(cell) &&
                            cell.map((batch, i) => (
                              <Chip
                                key={i}
                                label={batch}
                                size="small"
                                sx={{
                                  backgroundColor:
                                    batchColorMap[batch] || "#e0e0e0",
                                  fontWeight: 600,
                                  m: 0.3,
                                }}
                              />
                            ))}
                        </TableCell>
                      )
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}
