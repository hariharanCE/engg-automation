import React, { useState } from "react";
import axios from "axios";
import DashboardLayout from "../components/DashboardLayout";
import {
  Paper,
  Typography,
  Button,
  Box,
  Alert,
  Fade,
} from "@mui/material";

const API_BASE =  process.env.REACT_APP_API_URL || "http://192.168.1.2:5000/";

const AttendanceMail = () => {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  const handleFileChange = (e) => {
    if (e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setFileName(e.target.files[0].name);
      setMessage("");
    } else {
      setFile(null);
      setFileName("");
    }
  };

  const handleSendEmail = async (e) => {
    e.preventDefault();
    if (!file) {
      setMessage("⚠️ Please select a file before sending.");
      return;
    }
    setSending(true);
    setMessage("Uploading and sending emails...");
    const formData = new FormData();
    formData.append("attendance", file);

    try {
      const res = await axios.post(`${API_BASE}/api/attendance/send`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setMessage(`✅ ${res.data.message}`);
    } catch (err) {
      setMessage(
        `❌ ${err.response?.data?.message || "Error sending emails. Please check your file and try again."}`
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <DashboardLayout>
      <Box sx={{ maxWidth: 520, mx: "auto", mt: 4 }}>
        <Paper elevation={6} sx={{ p: 4, borderRadius: 3 }}>
          <Typography variant="h5" color="primary" sx={{ mb: 3 }}>
            📧 Attendance Email Sender
          </Typography>
          <Box component="form" onSubmit={handleSendEmail}>
            <Button
              variant="outlined"
              component="label"
              sx={{ mb: 2, fontWeight: "bold" }}
              fullWidth
            >
              {fileName ? `Selected: ${fileName}` : "Upload Attendance File (.csv or .xlsx)"}
              <input
                type="file"
                accept=".csv,.xlsx"
                hidden
                onChange={handleFileChange}
              />
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              fullWidth
              disabled={!file || sending}
              sx={{ py: 1.5, fontWeight: "bold", mb: 2, fontSize: "1rem", boxShadow: 3 }}
            >
              📤 Send Email
            </Button>
          </Box>
          <Fade in={!!message}>
            <Box>
              {message && (
                <Alert severity={message.startsWith("✅") ? "success" : message.startsWith("❌") ? "error" : "info"}>
                  {message}
                </Alert>
              )}
            </Box>
          </Fade>
        </Paper>
      </Box>
    </DashboardLayout>
  );
};

export default AttendanceMail;
