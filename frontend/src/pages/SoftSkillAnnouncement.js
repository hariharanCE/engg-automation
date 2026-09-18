import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Paper,
  Typography,
  Button,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  Box,
  TextField,
  Alert,
  Fade,
} from "@mui/material";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app";

export default function SoftSkillAnnouncement({ user }) {
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState("");
  const [announcementDate, setAnnouncementDate] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

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
      } finally {
        setLoading(false);
      }
    };
    fetchBatches();
  }, []);

  const handleSendEmail = async () => {
    if (!selectedBatch || !announcementDate) {
      setMessage("⚠️ Please select batch and announcement date");
      return;
    }

    try {
      const res = await axios.post(`${API_BASE}/api/soft-skill-announcement`, {
        batch_no: selectedBatch,
        date: announcementDate,
      });

      if (res.data.success) {
        setMessage(
          `✅ Emails scheduled for batch ${res.data.batch_no} on ${res.data.date}`
        );
      } else {
        setMessage("❌ Failed to schedule emails");
      }
    } catch (error) {
      console.error("Error sending soft skill announcement:", error);
      setMessage("Error sending emails. See console for details.");
    }
  };

  // Role-based title and welcome
  const roleTitle = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Dashboard";
  const welcomeName = user?.name || "User";

  return (
    <Box sx={{ maxWidth: 520, mx: "auto", my: 3 }}>
      <Paper elevation={5} sx={{ p: 4, borderRadius: 3 }}>
        <Typography variant="h4" color="primary" gutterBottom>
          {roleTitle} Dashboard
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" mb={2}>
          Welcome, {welcomeName}!
        </Typography>

        <Typography variant="h6" color="primary" sx={{ mb: 3 }}>
          📢 Soft Skill Announcement
        </Typography>
        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel>Select Batch</InputLabel>
          <Select
            label="Select Batch"
            value={selectedBatch}
            onChange={(e) => setSelectedBatch(e.target.value)}
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
        <FormControl fullWidth sx={{ mb: 3 }}>
          <TextField
            label="Announcement Date"
            type="date"
            InputLabelProps={{ shrink: true }}
            value={announcementDate}
            onChange={(e) => setAnnouncementDate(e.target.value)}
          />
        </FormControl>
        <Button
          variant="contained"
          color="primary"
          fullWidth
          onClick={handleSendEmail}
          sx={{ py: 1.5, fontWeight: "bold", mb: 2, fontSize: "1rem", boxShadow: 4 }}
        >
          📤 Send Email
        </Button>
        <Fade in={!!message}>
          <Box>
            {message && (
              <Alert severity={message.startsWith("✅") ? "success" : "info"}>
                {message}
              </Alert>
            )}
          </Box>
        </Fade>
      </Paper>
    </Box>
  );
}
