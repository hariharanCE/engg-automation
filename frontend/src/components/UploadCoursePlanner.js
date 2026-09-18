import React, { useState } from "react";
import Papa from "papaparse";
import axios from "axios";
import DashboardLayout from "../components/DashboardLayout";
import {
  Box,
  Paper,
  Typography,
  Button,
  Fade,
  Alert,
} from "@mui/material";

const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

export default function UploadCoursePlanner() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  const onChange = (e) => setFile(e.target.files[0]);

  const handleUpload = () => {
    setMessage("");
    if (!file) return setMessage("❌ Please choose CSV file");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const parsed = results.data.map((r, index) => ({
          classroom_name: r.classroom_name || r.classroom || "",
          batch_no: r.batch_no || r.Batch || r.batch || "",
          domain: r.domain || "",
          mode: r.mode || "",
          week_no: r.week_no || r.week || "",
          date: r.date || r.Date || "",
          start_time: r.start_time || r["start time"] || r.StartTime || "",
          end_time: r.end_time || "",
          module_name: r.module_name || "",
          topic_name: r.topic_name || "",
          trainer_name: r.trainer_name || "",
          trainer_email: r.trainer_email || "",
          topic_status: r.topic_status || "",
          remarks: r.remarks || "",
          batch_type: r.batch_type || "",
          actual_date: r.actual_date || "",
          date_difference: r.date_difference || "",
          date_changed_by: r.date_changed_by || "",
          date_changed_at: r.date_changed_at || "",
          __rowIndex: index + 2,
        }));

        setRows(parsed);          // for preview
        setShowPreview(false);    // only show when user clicks VIEW

        try {
          const res = await axios.post(`${API_BASE}/upload-course-planner`, { courses: parsed });
          const data = res.data || {};
          setMessage(data.message || "✅ Uploaded successfully");
        } catch (err) {
          setMessage("❌ Upload failed: " + (err.response?.data?.error || err.message));
        }
      },
      error: (err) => setMessage("CSV parse error: " + err.message),
    });
  };

  return (
    <DashboardLayout>
      <Box maxWidth={900} mx="auto" my={2}>
        <Paper elevation={4} sx={{ p: 4 }}>
          <Typography variant="h6" color="primary" gutterBottom>
            Upload Course Planner
          </Typography>
          <Box mb={2}>
            <input type="file" accept=".csv" onChange={onChange} />
          </Box>
          <Box display="flex" gap={2}>
            <Button variant="contained" onClick={handleUpload}>
              Upload
            </Button>
            <Button
              variant="outlined"
              disabled={rows.length === 0}
              onClick={() => setShowPreview(true)}
            >
              View Uploaded List
            </Button>
          </Box>

          <Fade in={!!message}>
            <Box mt={2}>
              {message && (
                <Alert severity={message.startsWith("✅") ? "success" : "error"}>
                  {message}
                </Alert>
              )}
            </Box>
          </Fade>

          {showPreview && rows.length > 0 && (
            <Box mt={3} sx={{ maxHeight: 350, overflow: "auto" }}>
              <Typography variant="subtitle1" gutterBottom>
                Uploaded Course Planner Preview
              </Typography>
              <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                <Box component="thead" sx={{ bgcolor: "#f5f5f5" }}>
                  <Box component="tr">
                    {[
                      "Row",
                      "Classroom",
                      "Batch No",
                      "Mode",
                      "Week",
                      "Date",
                      "Start",
                      "End",
                      "Module",
                      "Topic",
                      "Trainer",
                    ].map((h) => (
                      <Box
                        key={h}
                        component="th"
                        sx={{ border: "1px solid #ddd", p: 1, fontSize: 13 }}
                      >
                        {h}
                      </Box>
                    ))}
                  </Box>
                </Box>
                <Box component="tbody">
                  {rows.map((row, idx) => (
                    <Box key={idx} component="tr">
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.__rowIndex}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.classroom_name}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.batch_no}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.mode}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.week_no}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.date}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.start_time}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.end_time}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.module_name}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.topic_name}
                      </Box>
                      <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                        {row.trainer_name}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          )}
        </Paper>
      </Box>
    </DashboardLayout>
  );
}
