import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  MenuItem,
  Autocomplete,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
} from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SearchIcon from "@mui/icons-material/Search";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import EditIcon from "@mui/icons-material/Edit";
import { isInactiveLearnerStatus } from "../utils/learnerStatus";

const API_BASE = "http://192.168.1.2:5000/";

function normalizeLearner(raw) {
  return {
    ...raw,
    batchno: raw.batch_no || raw.batchno || "",
    batch_no: raw.batch_no || raw.batchno || "",
    email: (raw.email || "").trim().toLowerCase(),
    name: (raw.name || "").trim(),
    phone: raw.phone || "",
    status: raw.status || "Enabled",
  };
}

export default function LearnersDashboard({ user, token }) {
  const [searchType, setSearchType] = useState("email");
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [allLearners, setAllLearners] = useState([]);
  const [distinctBatches, setDistinctBatches] = useState([]);
  const [batchLearners, setBatchLearners] = useState([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);

  const [openAddDialog, setOpenAddDialog] = useState(false);
  const [newLearner, setNewLearner] = useState({
    name: "",
    email: "",
    phone: "",
    batch_no: "",
  });

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [selectedLearner, setSelectedLearner] = useState(null);
  const [newStatus, setNewStatus] = useState("");

  const isManagerOrAdmin = ["manager", "admin"].includes(
    (user?.role || "").toLowerCase()
  );

  const getStatusColor = (status) => {
    switch ((status || "").toLowerCase()) {
      case "enabled":
        return "success";
      case "disabled":
        return "warning";
      case "dropout":
        return "default";
      case "batch movement":
        return "default";
      default:
        return "default";
    }
  };

  const filteredLearners = useMemo(() => {
    if (statusFilter === "all") return allLearners;
    return allLearners.filter(
      (l) => (l.status || "Enabled").toLowerCase() === statusFilter.toLowerCase()
    );
  }, [allLearners, statusFilter]);

  useEffect(() => {
    loadLearnersData();
  }, []);

  async function loadLearnersData() {
    setLoading(true);
    setMessage("Loading learners...");

    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.get(`${API_BASE}/api/learners-dashboard-data`, { headers });

      const raw = Array.isArray(res.data) ? res.data : [];
      const normalized = raw.map(normalizeLearner);

      const unique = normalized.filter(
        (l, i, arr) =>
          arr.findIndex(
            (l2) => l2.email === l.email && l2.batch_no === l.batch_no
          ) === i
      );

      setAllLearners(unique);

      const batches = [
        ...new Set(unique.map((l) => l.batch_no).filter(Boolean)),
      ].sort();
      setDistinctBatches(batches);

      setMessage(
        `✅ Loaded ${unique.length} learners from ${batches.length} batches`
      );
    } catch (err) {
      console.error("Load error:", err);
      setAllLearners([]);
      setMessage("⚠️ No learners loaded");
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    const value = searchText.trim();
    if (!value) {
      setBatchLearners(filteredLearners);
      return;
    }

    let results = [];
    if (searchType === "email") {
      results = filteredLearners.filter((l) =>
        l.email.includes(value.toLowerCase())
      );
    } else if (searchType === "name") {
      results = filteredLearners.filter((l) =>
        l.name.toLowerCase().includes(value.toLowerCase())
      );
    } else {
      results = filteredLearners.filter((l) => l.batch_no === value);
    }

    setBatchLearners(results);
  }

  async function handleAddLearner() {
    const { name, email, phone, batch_no } = newLearner;
    if (!name?.trim() || !email?.trim() || !batch_no?.trim()) {
      setMessage("❌ Fill all required fields");
      return;
    }

    setLoading(true);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        batchno: batch_no.trim(),
      };

      const res = await axios.post(`${API_BASE}/api/learners/add`, payload, {
        headers,
      });

      if (res.data?.success) {
        const added = normalizeLearner(res.data.data);
        setAllLearners((prev) => [added, ...prev]);

        if (!distinctBatches.includes(added.batch_no)) {
          setDistinctBatches((prev) => [...prev, added.batch_no].sort());
        }

        setMessage("✅ Learner added");
        setOpenAddDialog(false);
        setNewLearner({ name: "", email: "", phone: "", batch_no: "" });
      } else {
        setMessage(`❌ ${res.data?.error || "Failed to add learner"}`);
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Add failed");
    } finally {
      setLoading(false);
    }
  }

  // ✅ Minimal fix: define handleStatusChange used in onClick
  function handleStatusChange(learner) {
    const normalized = normalizeLearner(learner);
    setSelectedLearner(normalized);
    setNewStatus(normalized.status || "Enabled");
    setStatusDialogOpen(true);
  }

  async function handleStatusChangeConfirm() {
    if (!selectedLearner || !newStatus) return;

    setStatusUpdating(true);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = {
        learneremail: selectedLearner.email,
        batchno: selectedLearner.batch_no,
        status: newStatus,
      };

      const res = await axios.put(
        `${API_BASE}/api/learners/status`,
        payload,
        { headers }
      );

      if (res.data?.success) {
        const match = (l) =>
          l.email === selectedLearner.email &&
          (l.batch_no || l.batchno) === selectedLearner.batch_no;

        setAllLearners((prev) =>
          prev.map((l) => (match(l) ? { ...l, status: newStatus } : l))
        );
        setBatchLearners((prev) =>
          prev.map((l) => (match(l) ? { ...l, status: newStatus } : l))
        );
        setMessage(`✅ Status changed to "${newStatus}"`);
        setStatusDialogOpen(false);
      } else {
        setMessage(`❌ ${res.data?.error || "Status update failed"}`);
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Status update failed");
    } finally {
      setStatusUpdating(false);
    }
  }

  function handleReset() {
    setSearchText("");
    setBatchLearners([]);
    setMessage("");
  }

  const searchOptions =
    searchType === "email"
      ? filteredLearners.map((l) => l.email)
      : searchType === "name"
      ? filteredLearners.map((l) => l.name)
      : distinctBatches;

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", p: 3 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box display="flex" justifyContent="space-between" mb={3}>
          <Box display="flex" alignItems="center" gap={2}>
            <MenuBookIcon sx={{ fontSize: 40 }} />
            <Typography variant="h4" fontWeight="bold">
              Learners Dashboard ({allLearners.length} total)
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            onClick={() => setOpenAddDialog(true)}
          >
            Add Learner
          </Button>
        </Box>

        <Grid container spacing={2} mb={3}>
          <Grid item xs={12} md={2}>
            <TextField
              select
              fullWidth
              label="Search By"
              value={searchType}
              onChange={(e) => setSearchType(e.target.value)}
            >
              <MenuItem value="email">Email</MenuItem>
              <MenuItem value="name">Name</MenuItem>
              <MenuItem value="batch">Batch No</MenuItem>
            </TextField>
          </Grid>


          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="Enabled">Enabled</MenuItem>
                <MenuItem value="Disabled">Disabled</MenuItem>
                <MenuItem value="Dropout">Dropout</MenuItem>
                <MenuItem value="Batch Movement">Batch Movement</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={6}>
            <Autocomplete
              freeSolo
              options={searchOptions}
              value={searchText}
              onChange={(e, v) => setSearchText(v || "")}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={
                    searchType === "batch"
                      ? "Batch No"
                      : searchType === "email"
                      ? "Email"
                      : "Name"
                  }
                  onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                  fullWidth
                />
              )}
            />
          </Grid>

          <Grid item xs={12} md={2}>
            <Button
              fullWidth
              variant="contained"
              onClick={handleSearch}
              disabled={loading}
              sx={{ height: 56 }}
            >
              {loading ? <CircularProgress size={20} /> : <SearchIcon />}
            </Button>
          </Grid>
        </Grid>

        <Alert severity="info" sx={{ mb: 2 }}>
          Total: {allLearners.length} | Filtered: {filteredLearners.length} |
          Showing: {batchLearners.length}
        </Alert>

        {message && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {message}
          </Alert>
        )}

        {batchLearners.length ? (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Batch No</TableCell>
                  <TableCell>Status</TableCell>
                  {isManagerOrAdmin && <TableCell>Action</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {batchLearners.map((raw, i) => {
                  const l = normalizeLearner(raw);
                  const isInactive = isInactiveLearnerStatus(l.status);
                  return (
                    <TableRow
                      key={`${l.email}-${l.batch_no}`}
                      hover
                      sx={isInactive ? { opacity: 0.55, background: "#f3f4f6" } : undefined}
                    >
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{l.name}</TableCell>
                      <TableCell>{l.email}</TableCell>
                      <TableCell>{l.phone || "-"}</TableCell>
                      <TableCell>{l.batch_no}</TableCell>
                      <TableCell>
                        <Chip
                          label={l.status}
                          color={getStatusColor(l.status)}
                          size="small"
                        />
                      </TableCell>
                      {isManagerOrAdmin && (
                        <TableCell>
                          <Tooltip title="Change Status">
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => handleStatusChange(l)}
                                disabled={statusUpdating}
                              >
                                <EditIcon />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography>No learners to display</Typography>
            <Button onClick={loadLearnersData} variant="contained" sx={{ mt: 2 }}>
              {loading ? "Loading..." : "Reload"}
            </Button>
          </Paper>
        )}

        {/* Add Dialog */}
        <Dialog
          open={openAddDialog}
          onClose={() => setOpenAddDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Add Learner</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Name *"
              value={newLearner.name}
              onChange={(e) =>
                setNewLearner({ ...newLearner, name: e.target.value })
              }
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Email *"
              type="email"
              value={newLearner.email}
              onChange={(e) =>
                setNewLearner({ ...newLearner, email: e.target.value })
              }
              sx={{ mb: 2 }}
            />
            <Autocomplete
              freeSolo
              options={distinctBatches}
              value={newLearner.batch_no}
              onChange={(e, v) =>
                setNewLearner({ ...newLearner, batch_no: v || "" })
              }
              renderInput={(params) => (
                <TextField {...params} label="Batch No *" sx={{ mb: 2 }} />
              )}
            />
            <TextField
              fullWidth
              label="Phone"
              value={newLearner.phone}
              onChange={(e) =>
                setNewLearner({ ...newLearner, phone: e.target.value })
              }
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenAddDialog(false)}>Cancel</Button>
            <Button
              onClick={handleAddLearner}
              disabled={loading}
              variant="contained"
            >
              Add
            </Button>
          </DialogActions>
        </Dialog>

        {/* Status Dialog */}
        <Dialog
          open={statusDialogOpen}
          onClose={() => setStatusDialogOpen(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Update Status</DialogTitle>
          <DialogContent>
            <Typography>{selectedLearner?.name}</Typography>
            <Typography variant="body2" color="gray">
              {selectedLearner?.email} / {selectedLearner?.batch_no}
            </Typography>
            <TextField
              select
              fullWidth
              label="Status"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              sx={{ mt: 2 }}
            >
              <MenuItem value="Enabled">Enabled</MenuItem>
              <MenuItem value="Disabled">Disabled</MenuItem>
              <MenuItem value="Dropout">Dropout</MenuItem>
              <MenuItem value="Batch Movement">Batch Movement</MenuItem>
            </TextField>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleStatusChangeConfirm}
              disabled={statusUpdating}
            >
              {statusUpdating ? "Updating..." : "Update"}
            </Button>
          </DialogActions>
        </Dialog>
      </Paper>
    </Box>
  );
}
