import React, { useState, useEffect } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  Select,
  MenuItem,
  TextField,
  Alert,
  Fade,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TableHead,
  FormControl,
  InputLabel,
} from "@mui/material";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

export default function FinalAssessmentSchedule({ user }) {
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState("");
  const [topics, setTopics] = useState([]);
  const [message, setMessage] = useState("");
  const [learnerClosureBatch, setLearnerClosureBatch] = useState("");
  const [learnerClosureDate, setLearnerClosureDate] = useState("");
  const [learnerClosureMessage, setLearnerClosureMessage] = useState("");

  // load batches
  useEffect(() => {
    fetch(`${API_BASE}/api/batches`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setBatches(Array.isArray(data) ? data : []))
      .catch((err) => setMessage("Failed to load batches: " + err.message));
  }, []);

  // load topics for selected batch
  useEffect(() => {
    if (!selectedBatch) {
      setTopics([]);
      return;
    }
    fetch(`${API_BASE}/api/final-assessments/${selectedBatch}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const normalized = (Array.isArray(data) ? data : []).map((t) => ({
          ...t,
          date: t.date ? new Date(t.date).toISOString().slice(0, 10) : "",
        }));
        setTopics(normalized);
      })
      .catch((err) => setMessage("Failed to load topics: " + err.message));
  }, [selectedBatch]);

  const handleBatchChange = (e) => {
    setSelectedBatch(e.target.value);
    setMessage("");
  };

  const handleDateChange = (topicName, newDate) => {
    setTopics((old) =>
      old.map((t) => (t.topic_name === topicName ? { ...t, date: newDate } : t))
    );
  };

  const saveDateChanges = async () => {
    try {
      for (const topic of topics) {
        const res = await fetch(
          `${API_BASE}/api/final-assessments/${topic.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: topic.date }),
          }
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to update");
        }
      }
      setMessage("✅ Dates updated successfully");
    } catch (err) {
      setMessage("❌ Update failed: " + err.message);
    }
  };

  const sendEmail = async () => {
    if (!selectedBatch) {
      setMessage("⚠️ Please select a batch");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/send-final-assessment-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_no: selectedBatch }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok)
        setMessage(result.message || "✅ Email sent successfully");
      else
        setMessage(
          "❌ Email sending failed: " + (result.error || "Unknown error")
        );

      // schedule access-card reminder based on earliest date
      const validDates = topics
        .map((t) => t.date)
        .filter((d) => !!d)
        .sort();
      if (validDates.length === 0) return;

      const earliestDate = validDates[0];

      const scheduleRes = await fetch(
        `${API_BASE}/api/schedule-access-card-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batch_no: selectedBatch,
            assessment_date: earliestDate,
          }),
        }
      );
      const scheduleResult = await scheduleRes.json().catch(() => ({}));

      if (scheduleRes.ok) {
        setMessage((prev) =>
          (prev ? prev + "\n" : "") +
          (scheduleResult.message || "✅ Access card reminder scheduled")
        );
      } else {
        setMessage((prev) =>
          (prev ? prev + "\n" : "") +
          "❌ Access card reminder scheduling failed: " +
          (scheduleResult.error || "Unknown error")
        );
      }
    } catch (err) {
      setMessage("❌ Network error: " + err.message);
    }
  };

  const handleLearnerClosureAnnounce = async () => {
    if (!learnerClosureBatch || !learnerClosureDate) {
      setLearnerClosureMessage("⚠️ Please select batch and date");
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/api/course-closure-to-learners`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batch_no: learnerClosureBatch,
            end_date: learnerClosureDate,
          }),
        }
      );
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const result = await res.json();
        if (res.ok) {
          setLearnerClosureMessage(
            result.message || "✅ Emails sent successfully."
          );
        } else {
          setLearnerClosureMessage(
            "❌ Failed: " + (result.error || "Unknown error")
          );
        }
      } else {
        const text = await res.text();
        console.error("Non-JSON response:", text);
        setLearnerClosureMessage("❌ Server error or invalid response.");
      }
    } catch (err) {
      setLearnerClosureMessage("❌ Network error: " + err.message);
    }
  };

  const roleTitle = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : "Dashboard";
  const welcomeName = user?.name || "User";

  return (
    <Box maxWidth={960} mx="auto" my={3}>
      <Paper elevation={4} sx={{ p: 3, borderRadius: 3, mb: 3 }}>
        <Typography variant="h4" color="primary" gutterBottom>
          {roleTitle} Dashboard
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" mb={2}>
          Welcome, {welcomeName}!
        </Typography>

        {/* Course Closure Announcement to Learners */}
        <Typography variant="h6" color="primary" gutterBottom>
          📣 Course Closure Announcement to Learners
        </Typography>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Batch No</InputLabel>
          <Select
            value={learnerClosureBatch}
            label="Batch No"
            onChange={(e) => setLearnerClosureBatch(e.target.value)}
          >
            <MenuItem value="">--select--</MenuItem>
            {batches.map((b) => (
              <MenuItem key={b.batch_no} value={b.batch_no}>
                {b.batch_no}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="End Date"
          type="date"
          value={learnerClosureDate}
          InputLabelProps={{ shrink: true }}
          onChange={(e) => setLearnerClosureDate(e.target.value)}
          sx={{ mb: 2 }}
          fullWidth
        />
        <Button variant="contained" onClick={handleLearnerClosureAnnounce}>
          📤 Send Emails
        </Button>
        {learnerClosureMessage && (
          <Fade in={!!learnerClosureMessage}>
            <Box mt={2}>
              <Alert
                severity={
                  learnerClosureMessage.startsWith("✅")
                    ? "success"
                    : "warning"
                }
              >
                {learnerClosureMessage}
              </Alert>
            </Box>
          </Fade>
        )}

        <Divider sx={{ my: 3 }} />

        {/* Final Assessment Schedule */}
        <Typography variant="h6" color="primary" gutterBottom>
          Final Assessment Schedule
        </Typography>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Batch No</InputLabel>
          <Select
            label="Batch No"
            value={selectedBatch}
            onChange={handleBatchChange}
          >
            <MenuItem value="">--select--</MenuItem>
            {batches.map((b) => (
              <MenuItem key={b.batch_no} value={b.batch_no}>
                {b.batch_no}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {topics.length > 0 && (
          <>
            <TableContainer component={Box} sx={{ mt: 2 }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Topic Name</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Start Time</TableCell>
                    <TableCell>End Time</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {topics.map(
                    ({ id, topic_name, date, start_time, end_time }) => (
                      <TableRow key={id}>
                        <TableCell>{topic_name}</TableCell>
                        <TableCell>
                          <TextField
                            type="date"
                            size="small"
                            value={date}
                            onChange={(e) =>
                              handleDateChange(topic_name, e.target.value)
                            }
                          />
                        </TableCell>
                        <TableCell>{start_time || "-"}</TableCell>
                        <TableCell>{end_time || "-"}</TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <Box mt={2}>
              <Button
                variant="contained"
                color="primary"
                onClick={saveDateChanges}
              >
                💾 Save Date Changes
              </Button>
              <Button
                variant="contained"
                color="secondary"
                onClick={sendEmail}
                sx={{ ml: 2 }}
              >
                📧 Send Email
              </Button>
            </Box>
          </>
        )}

        {message && (
          <Fade in={!!message}>
            <Box mt={2}>
              <Alert
                severity={
                  message.startsWith("✅") ? "success" : "warning"
                }
              >
                {message}
              </Alert>
            </Box>
          </Fade>
        )}
      </Paper>
    </Box>
  );
}
