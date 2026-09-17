import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
  TableContainer,
  Alert,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  InputAdornment,
  Tooltip,
} from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import SchoolIcon from "@mui/icons-material/School";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

const API_BASE =
  process.env.REACT_APP_API_URL || "http://192.168.1.2:5000/";

export default function TutorsDashboard({ user, token }) {
  const [tutors, setTutors] = useState([]);
  const [selectedTutor, setSelectedTutor] = useState("");
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState("");
  const [modules, setModules] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Add tutor dialog
  const [openAddDialog, setOpenAddDialog] = useState(false);
  const [newTutor, setNewTutor] = useState({
    name: "",
    email: "",
    password: "",
    role: "Trainer",
    is_active: true,
    domain: "",
  });

  // Edit tutor dialog
  const [openEditDialog, setOpenEditDialog] = useState(false);
  const [editTutor, setEditTutor] = useState({
    id: null,
    name: "",
    email: "",
    role: "Trainer",
    is_active: true,
    domain: "",
  });

  // Delete confirmation dialog
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [tutorToDelete, setTutorToDelete] = useState(null);

  useEffect(() => {
    loadTutors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedTutor) {
      loadBatches(selectedTutor);
    } else {
      setBatches([]);
      setSelectedBatch("");
      setModules({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTutor]);

  useEffect(() => {
    if (selectedTutor && selectedBatch) {
      loadModules(selectedTutor, selectedBatch);
    } else {
      setModules({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatch, selectedTutor]);

  function authHeaders() {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadTutors() {
    try {
      const res = await axios.get(`${API_BASE}/api/tutors`, {
        headers: authHeaders(),
      });
      setTutors(res.data || []);
    } catch (error) {
      console.error("Error loading tutors:", error);
      setMessage("Error loading tutors");
    }
  }

  async function loadBatches(trainerEmail) {
    setLoading(true);
    try {
      const res = await axios.get(
        `${API_BASE}/api/tutors/batches/${encodeURIComponent(trainerEmail)}`,
        { headers: authHeaders() }
      );
      setBatches(res.data || []);
    } catch (error) {
      console.error("Error loading batches:", error);
      setMessage("Error loading batches");
    } finally {
      setLoading(false);
    }
  }

  async function loadModules(trainerEmail, batchNo) {
    setLoading(true);
    try {
      const res = await axios.get(
        `${API_BASE}/api/tutors/modules/${encodeURIComponent(
          trainerEmail
        )}/${encodeURIComponent(batchNo)}`,
        { headers: authHeaders() }
      );
      setModules(res.data || {});
    } catch (error) {
      console.error("Error loading modules:", error);
      setMessage("Error loading modules");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddTutor() {
    if (!newTutor.name || !newTutor.email || !newTutor.password) {
      setMessage("Please fill all required fields");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: newTutor.name.trim(),
        email: newTutor.email.trim(),
        password: newTutor.password,
        role: newTutor.role || "Trainer",
        is_active: !!newTutor.is_active,
        domain: newTutor.domain?.trim() || null,
      };

      const res = await axios.post(`${API_BASE}/api/tutors/add`, payload, {
        headers: authHeaders(),
      });

      if (res.data?.success) {
        setMessage("✅ Tutor added successfully");
        setOpenAddDialog(false);
        setNewTutor({
          name: "",
          email: "",
          password: "",
          role: "Trainer",
          is_active: true,
          domain: "",
        });
        await loadTutors();
      } else {
        setMessage("❌ Failed to add tutor: " + (res.data?.error || ""));
      }
    } catch (error) {
      setMessage("❌ Error adding tutor");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateTutor() {
    if (!editTutor.id || !editTutor.name || !editTutor.email) {
      setMessage("Please fill all required fields for edit");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: editTutor.name.trim(),
        role: editTutor.role || "Trainer",
        is_active: !!editTutor.is_active,
        domain: editTutor.domain?.trim() || null,
      };

      const res = await axios.put(
        `${API_BASE}/api/tutors/${editTutor.id}`,
        payload,
        { headers: authHeaders() }
      );

      if (res.data?.success) {
        setMessage("✅ Tutor updated successfully");
        setOpenEditDialog(false);
        setEditTutor({
          id: null,
          name: "",
          email: "",
          role: "Trainer",
          is_active: true,
          domain: "",
        });
        await loadTutors();
      } else {
        setMessage("❌ Failed to update tutor: " + (res.data?.error || ""));
      }
    } catch (error) {
      setMessage("❌ Error updating tutor");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmDeleteTutor() {
    if (!tutorToDelete?.id) {
      setMessage("❌ Cannot delete: missing tutor id");
      return;
    }

    setLoading(true);
    try {
      // Soft delete endpoint (backend sets is_active=false)
      await axios.delete(`${API_BASE}/api/tutors/${tutorToDelete.id}`, {
        headers: authHeaders(),
      });

      setMessage("✅ Tutor deleted (deactivated) successfully");
      setOpenDeleteDialog(false);

      if (selectedTutor === tutorToDelete.email) {
        setSelectedTutor("");
        setSelectedBatch("");
        setBatches([]);
        setModules({});
      }

      setTutorToDelete(null);
      await loadTutors();
    } catch (error) {
      setMessage("❌ Error deleting tutor");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setSelectedTutor("");
    setSelectedBatch("");
    setBatches([]);
    setModules({});
    setMessage("");
  }

  const selectedTutorData = tutors.find((t) => t.email === selectedTutor);

  function openEditForTutor(tutor) {
    setEditTutor({
      id: tutor.id,
      name: tutor.name || "",
      email: tutor.email || "",
      role: tutor.role || "Trainer",
      is_active: !!tutor.is_active,
      domain: tutor.domain || "",
    });
    setOpenEditDialog(true);
  }

  function openDeleteForTutor(tutor) {
    setTutorToDelete(tutor);
    setOpenDeleteDialog(true);
  }

  return (
    <Box sx={{ maxWidth: 1400, mx: "auto", my: 3, px: 2 }}>
      <Paper
        elevation={4}
        sx={{
          p: 3,
          borderRadius: 3,
          background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Box display="flex" alignItems="center" gap={2}>
            <SchoolIcon sx={{ fontSize: 40, color: "#667eea" }} />
            <Typography variant="h4" fontWeight="bold" color="#333">
              Tutors Management
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            onClick={() => setOpenAddDialog(true)}
            sx={{
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              px: 3,
              py: 1.5,
              borderRadius: 2,
              textTransform: "none",
              fontSize: 16,
              fontWeight: "bold",
            }}
          >
            Add New Tutor
          </Button>
        </Box>

        <Grid container spacing={2} mb={3}>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Select Tutor</InputLabel>
              <Select
                value={selectedTutor}
                label="Select Tutor"
                onChange={(e) => setSelectedTutor(e.target.value)}
                sx={{ bgcolor: "white", borderRadius: 2 }}
              >
                <MenuItem value="">
                  <em>Choose a tutor...</em>
                </MenuItem>
                {tutors.map((tutor) => (
                  <MenuItem key={tutor.id || tutor.email} value={tutor.email}>
                    {tutor.name} ({tutor.email})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={4}>
            {batches.length > 0 && (
              <FormControl fullWidth>
                <InputLabel>Select Batch</InputLabel>
                <Select
                  value={selectedBatch}
                  label="Select Batch"
                  onChange={(e) => setSelectedBatch(e.target.value)}
                  sx={{ bgcolor: "white", borderRadius: 2 }}
                >
                  <MenuItem value="">
                    <em>Choose a batch...</em>
                  </MenuItem>
                  {batches.map((batch) => (
                    <MenuItem key={batch} value={batch}>
                      {batch}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Grid>

          <Grid item xs={12} sm={2}>
            <Button
              variant="outlined"
              fullWidth
              startIcon={<RestartAltIcon />}
              onClick={handleReset}
              sx={{ height: "56px", borderRadius: 2 }}
            >
              Reset
            </Button>
          </Grid>
        </Grid>

        {message && (
          <Alert
            severity={message.startsWith("✅") ? "success" : "warning"}
            sx={{ mb: 2, borderRadius: 2 }}
          >
            {message}
          </Alert>
        )}

        <Box mb={3}>
          <Typography variant="h6" fontWeight="bold" color="#333" mb={1}>
            All Tutors
          </Typography>
          <TableContainer component={Paper} sx={{ borderRadius: 2, overflow: "hidden" }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: "#fafafa" }}>
                  <TableCell><strong>Name</strong></TableCell>
                  <TableCell><strong>Email</strong></TableCell>
                  <TableCell><strong>Role</strong></TableCell>
                  <TableCell><strong>Domain</strong></TableCell>
                  <TableCell><strong>Status</strong></TableCell>
                  <TableCell align="right"><strong>Actions</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tutors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No tutors found.
                    </TableCell>
                  </TableRow>
                )}

                {tutors.map((tutor) => (
                  <TableRow key={tutor.id || tutor.email}>
                    <TableCell>{tutor.name}</TableCell>
                    <TableCell>{tutor.email}</TableCell>
                    <TableCell>{tutor.role || "Trainer"}</TableCell>
                    <TableCell>{tutor.domain || "-"}</TableCell>
                    <TableCell>
                      <Chip
                        label={tutor.is_active ? "Active" : "Inactive"}
                        color={tutor.is_active ? "success" : "default"}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit tutor">
                        <IconButton size="small" onClick={() => openEditForTutor(tutor)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete tutor">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => openDeleteForTutor(tutor)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        {selectedTutorData && (
          <Card
            sx={{
              mb: 3,
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "white",
              borderRadius: 3,
            }}
          >
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight="bold">
                Tutor Details
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={3}>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Name
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {selectedTutorData.name}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Email
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {selectedTutorData.email}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={2}>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Role
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {selectedTutorData.role || "Trainer"}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={2}>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Domain
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {selectedTutorData.domain || "-"}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={2}>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Total Batches
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {batches.length}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {Object.keys(modules).length > 0 && (
          <Box>
            <Typography variant="h6" gutterBottom fontWeight="bold" color="#333">
              Modules Handled
            </Typography>
            {Object.entries(modules).map(([moduleName, topics]) => (
              <Accordion key={moduleName} sx={{ mb: 2, borderRadius: 2 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography fontWeight="bold">
                    {moduleName}{" "}
                    <Chip label={`${topics.length} topics`} size="small" sx={{ ml: 2 }} />
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>Topic Name</strong></TableCell>
                          <TableCell><strong>Date</strong></TableCell>
                          <TableCell><strong>Status</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {topics.map((topic, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{topic.topic_name}</TableCell>
                            <TableCell>{topic.date}</TableCell>
                            <TableCell>
                              <Chip
                                label={topic.topic_status}
                                size="small"
                                color={
                                  topic.topic_status === "Completed"
                                    ? "success"
                                    : topic.topic_status === "In Progress"
                                    ? "primary"
                                    : "default"
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        )}

        {selectedTutor && batches.length === 0 && !loading && (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            This tutor has no batches assigned yet.
          </Alert>
        )}
      </Paper>

      {/* Add Tutor Dialog */}
      <Dialog open={openAddDialog} onClose={() => setOpenAddDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle
          sx={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            fontWeight: "bold",
          }}
        >
          Add New Tutor
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Name"
              value={newTutor.name}
              onChange={(e) => setNewTutor({ ...newTutor, name: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={newTutor.email}
              onChange={(e) => setNewTutor({ ...newTutor, email: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Password"
              type={showPassword ? "text" : "password"}
              value={newTutor.password}
              onChange={(e) => setNewTutor({ ...newTutor, password: e.target.value })}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Role</InputLabel>
              <Select
                label="Role"
                value={newTutor.role}
                onChange={(e) => setNewTutor({ ...newTutor, role: e.target.value })}
              >
                <MenuItem value="Trainer">Trainer</MenuItem>
                <MenuItem value="Admin">Admin</MenuItem>
                <MenuItem value="Coordinator">Coordinator</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={newTutor.is_active ? "active" : "inactive"}
                onChange={(e) =>
                  setNewTutor({ ...newTutor, is_active: e.target.value === "active" })
                }
              >
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="Domain (optional)"
              value={newTutor.domain}
              onChange={(e) => setNewTutor({ ...newTutor, domain: e.target.value })}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpenAddDialog(false)}>Cancel</Button>
          <Button onClick={handleAddTutor} variant="contained" disabled={loading}>
            {loading ? "Adding..." : "Add Tutor"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Tutor Dialog */}
      <Dialog open={openEditDialog} onClose={() => setOpenEditDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle
          sx={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            fontWeight: "bold",
          }}
        >
          Edit Tutor
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Name"
              value={editTutor.name}
              onChange={(e) => setEditTutor({ ...editTutor, name: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField fullWidth label="Email" value={editTutor.email} disabled sx={{ mb: 2 }} />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Role</InputLabel>
              <Select
                label="Role"
                value={editTutor.role}
                onChange={(e) => setEditTutor({ ...editTutor, role: e.target.value })}
              >
                <MenuItem value="Trainer">Trainer</MenuItem>
                <MenuItem value="Admin">Admin</MenuItem>
                <MenuItem value="Coordinator">Coordinator</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={editTutor.is_active ? "active" : "inactive"}
                onChange={(e) =>
                  setEditTutor({ ...editTutor, is_active: e.target.value === "active" })
                }
              >
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="Domain (optional)"
              value={editTutor.domain}
              onChange={(e) => setEditTutor({ ...editTutor, domain: e.target.value })}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpenEditDialog(false)}>Cancel</Button>
          <Button onClick={handleUpdateTutor} variant="contained" disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Tutor Confirmation Dialog */}
      <Dialog open={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle fontWeight="bold">Delete Tutor</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>{tutorToDelete?.name}</strong> (
            {tutorToDelete?.email})? This will deactivate the user.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpenDeleteDialog(false)}>Cancel</Button>
          <Button
            onClick={handleConfirmDeleteTutor}
            color="error"
            variant="contained"
            disabled={loading}
          >
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
