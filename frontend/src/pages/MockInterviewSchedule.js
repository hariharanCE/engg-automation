import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Fade,
  Alert,
  Divider
} from "@mui/material";
import axios from "axios";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";

export default function MockInterviewSchedule({ user }) {
  const [batches, setBatches] = useState([]);
  const [selectedBatchSchedule, setSelectedBatchSchedule] = useState("");
  const [interviewDate, setInterviewDate] = useState("");
  const [selectedBatchFeedback, setSelectedBatchFeedback] = useState("");
  const [feedbackFile, setFeedbackFile] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const fetchBatches = async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/batches`);
        if (res.data && Array.isArray(res.data)) {
          setBatches(res.data);
        } else {
          setMessage("No batches found");
        }
      } catch (error) {
        console.error("Failed to fetch batches:", error);
        setMessage("Error loading batches. See console for details.");
      }
    };
    fetchBatches();
  }, []);

  const handleSchedule = async () => {
    if (!selectedBatchSchedule || !interviewDate) {
      setMessage("⚠️ Please select batch and interview date");
      return;
    }
    try {
      const res = await axios.post(`${API_BASE}/api/mock-interview-schedule`, {
        batch_no: selectedBatchSchedule,
        interview_date: interviewDate,
      });
      if (res.data.success) {
        setMessage(
          `✅ Scheduled ${res.data.scheduled} emails for Batch ${res.data.batch_no} on ${res.data.interview_date}`
        );
      } else {
        setMessage("❌ Failed to schedule mock interview emails");
      }
    } catch (error) {
      console.error("Error scheduling mock interview:", error);
      setMessage("Error scheduling mock interview. See console for details.");
    }
  };

  const handleUploadFeedback = async () => {
    if (!selectedBatchFeedback || !feedbackFile) {
      setMessage("⚠️ Please select batch and feedback file");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("batch_no", selectedBatchFeedback);
      formData.append("file", feedbackFile);
      const res = await axios.post(
        `${API_BASE}/api/mock-interview-feedback`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      if (res.data.success) {
        setMessage(
          `✅ Feedback uploaded and emails sent to learners of batch ${selectedBatchFeedback}`
        );
      } else {
        setMessage("❌ Failed to send feedback emails");
      }
    } catch (error) {
      console.error("Error uploading feedback:", error);
      setMessage("Error uploading feedback. See console for details.");
    }
  };

  // Role-based title and welcome
  const roleTitle =
    user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Dashboard";
  const welcomeName = user?.name || "User";

  return (
    <Box maxWidth={600} mx="auto" my={3}>
      <Paper elevation={4} sx={{ p: 3, borderRadius: 3 }}>
        <Typography variant="h4" color="primary" gutterBottom>
          {roleTitle} Dashboard
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" mb={2}>
          Welcome, {welcomeName}!
        </Typography>

        {/* ---- Section 1: Schedule Interview ---- */}
        <Typography variant="h6" color="primary" sx={{ mb: 2 }}>
          📅 Schedule Mock Interview
        </Typography>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Select Batch (for scheduling)</InputLabel>
          <Select
            label="Select Batch (for scheduling)"
            value={selectedBatchSchedule}
            onChange={(e) => setSelectedBatchSchedule(e.target.value)}
          >
            <MenuItem value="">-- Select Batch --</MenuItem>
            {batches.length > 0 &&
              batches.map((b, idx) => (
                <MenuItem key={idx} value={b.batch_no}>
                  {b.batch_no} ({b.start_date})
                </MenuItem>
              ))}
          </Select>
        </FormControl>
        <TextField
          label="Select Interview Date"
          type="date"
          fullWidth
          value={interviewDate}
          onChange={(e) => setInterviewDate(e.target.value)}
          sx={{ mb: 2 }}
          InputLabelProps={{ shrink: true }}
        />
        <Button
          onClick={handleSchedule}
          variant="contained"
          color="primary"
          fullWidth
          sx={{ mb: 2, fontWeight: "bold", py: 1.2, fontSize: "1rem" }}
        >
          📧 Schedule Emails
        </Button>

        <Divider sx={{ my: 3 }} />

        {/* ---- Section 2: Upload Feedback ---- */}
        <Typography variant="h6" color="secondary" gutterBottom sx={{ mb: 2 }}>
          📤 Upload Mock Interview Feedback
        </Typography>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Select Batch (for feedback upload)</InputLabel>
          <Select
            label="Select Batch (for feedback upload)"
            value={selectedBatchFeedback}
            onChange={(e) => setSelectedBatchFeedback(e.target.value)}
          >
            <MenuItem value="">-- Select Batch --</MenuItem>
            {batches.length > 0 &&
              batches.map((b, idx) => (
                <MenuItem key={idx} value={b.batch_no}>
                  {b.batch_no} ({b.start_date})
                </MenuItem>
              ))}
          </Select>
        </FormControl>
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => setFeedbackFile(e.target.files[0])}
          style={{ display: "block", marginBottom: "12px" }}
        />
        <Button
          onClick={handleUploadFeedback}
          variant="contained"
          color="success"
          fullWidth
          sx={{ fontWeight: "bold", py: 1.2, fontSize: "1rem" }}
        >
          📤 Upload Feedback & Send Emails
        </Button>

        <Fade in={!!message}>
          <Box mt={3}>
            {message && (
              <Alert severity={message.startsWith("✅") ? "success" : "warning"}>
                {message}
              </Alert>
            )}
          </Box>
        </Fade>
      </Paper>
    </Box>
  );
}
