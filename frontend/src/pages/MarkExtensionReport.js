import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Stack,
  Alert,
  Chip,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import {
  Refresh as RefreshIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
} from "@mui/icons-material";

const API_BASE =
  process.env.REACT_APP_API_URL || "http://192.168.1.2:5000/";

// Admin / Manager / Coordinator review mark-entry extension requests raised by
// trainers. Approving opens the window for that assessment until 11:59 PM of the
// next day.
export default function MarkExtensionReport({ user }) {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const decidedBy = user?.email || user?.name || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axios.get(
        `${API_BASE}/api/mark-extension/list`,
        { params: { status: statusFilter } }
      );
      setRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Failed to load requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id, action) => {
    setBusyId(id);
    setMessage("");
    setError("");
    try {
      const { data } = await axios.post(
        `${API_BASE}/api/mark-extension/${id}/${action}`,
        { decided_by: decidedBy }
      );
      if (action === "approve") {
        const till = data?.extended_until ? new Date(data.extended_until).toLocaleString() : "";
        setMessage(`✅ Approved — mark entry window opened${till ? ` till ${till}` : ""}.`);
      } else {
        setMessage("✅ Request rejected.");
      }
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const fmt = (iso) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  const statusChip = (s) => {
    const color = s === "approved" ? "success" : s === "rejected" ? "error" : "warning";
    return <Chip size="small" color={color} label={s} sx={{ textTransform: "capitalize" }} />;
  };

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1, flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            Mark Extension Requests
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Approve a request to open the mark entry window for that assessment until 11:59 PM tomorrow.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={statusFilter}
            onChange={(e, v) => v && setStatusFilter(v)}
          >
            <ToggleButton value="pending">Pending</ToggleButton>
            <ToggleButton value="approved">Approved</ToggleButton>
            <ToggleButton value="rejected">Rejected</ToggleButton>
            <ToggleButton value="all">All</ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="outlined"
            onClick={load}
            startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />}
            disabled={loading}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success" sx={{ my: 2 }} onClose={() => setMessage("")}>{message}</Alert>}
      {error && <Alert severity="error" sx={{ my: 2 }} onClose={() => setError("")}>{error}</Alert>}

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : requests.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
              No {statusFilter === "all" ? "" : statusFilter} requests.
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Batch</strong></TableCell>
                    <TableCell><strong>Assessment</strong></TableCell>
                    <TableCell><strong>Date</strong></TableCell>
                    <TableCell><strong>Week</strong></TableCell>
                    <TableCell><strong>Trainer</strong></TableCell>
                    <TableCell><strong>Requested</strong></TableCell>
                    <TableCell><strong>Status</strong></TableCell>
                    <TableCell align="right"><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell>{r.batch_no}</TableCell>
                      <TableCell>{r.assessment_type}</TableCell>
                      <TableCell>{r.assessment_date}</TableCell>
                      <TableCell>{r.week_no ?? "—"}</TableCell>
                      <TableCell>
                        {r.trainer_name || r.trainer_email || "—"}
                        {r.trainer_name && r.trainer_email && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {r.trainer_email}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{fmt(r.created_at)}</TableCell>
                      <TableCell>{statusChip(r.status)}</TableCell>
                      <TableCell align="right">
                        {r.status === "pending" ? (
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              startIcon={<ApproveIcon />}
                              disabled={busyId === r.id}
                              onClick={() => decide(r.id, "approve")}
                            >
                              Approve
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              startIcon={<RejectIcon />}
                              disabled={busyId === r.id}
                              onClick={() => decide(r.id, "reject")}
                            >
                              Reject
                            </Button>
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            {r.decided_by ? `by ${r.decided_by}` : ""}
                            {r.decided_at ? ` · ${fmt(r.decided_at)}` : ""}
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
