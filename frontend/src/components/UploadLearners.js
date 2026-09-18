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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  return !!email && emailRegex.test(email);
}

function validatePhone(phone) {
  if (!phone) return false;
  
  const normalized = String(phone).replace(/[\s\-\(\)]/g, '');
  
  // Pattern 1: International format - + followed by 1-4 digits (country code) then 6-15 digits total after +
  if (/^\+[1-9]\d{6,14}$/.test(normalized)) return true;
  
  // Pattern 2: Indian mobile - 10 digits starting with 6-9 (no +)
  if (/^[6-9]\d{9}$/.test(normalized)) return true;
  
  // Pattern 3: US/Canada 10-digit (starts with 2-9 for valid area/mobile)
  if (/^[2-9]\d{9}$/.test(normalized)) return true;
  
  // Pattern 4: Shorter international plain numbers (7-15 digits, common for some countries)
  if (/^\d{7,15}$/.test(normalized)) return true;
  
  return false;
}

export default function UploadLearners() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  const onChange = (e) => setFile(e.target.files[0]);

  const handleUpload = () => {
    setMessage("");
    // do not auto-open preview
    if (!file) {
      setMessage("❌ Please choose CSV file");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const parsed = results.data.map((r, index) => {
          const row = {
            name: r.name || r.Name || r["Learner Name"] || "",
            email: r.email || r.Email || "",
            phone: r.phone || r.Phone || "",
            batch_no: r.batch_no || r.Batch || r.batch || "",
            status: r.status || r.Status || "",
            server_id: r.server_id || r.ServerID || r["Server ID"] || r["Server Id"] || "",
            __rowIndex: index + 2,
          };

          const errors = [];
          if (!row.name) errors.push("Name required");
          if (!row.batch_no) errors.push("Batch no required");
          if (!validateEmail(row.email)) errors.push("Invalid email");
          if (!validatePhone(row.phone)) errors.push("Invalid phone");

          return { ...row, __errors: errors, __duplicate: null };
        });

        setRows(parsed);

        const validRows = parsed.filter(r => !r.__errors || r.__errors.length === 0);

        if (validRows.length === 0) {
          setMessage("❌ All rows have validation errors; fix and reupload");
          return;
        }

        try {
          const res = await axios.post(`${API_BASE}/upload-learners`, { learners: validRows });
          const data = res.data || {};
          setMessage(data.message || "✅ Uploaded successfully");

          const alreadyInDb = data.alreadyInDb || [];
          if (alreadyInDb.length) {
            const key = (l) =>
              `${(l.name || '').trim().toLowerCase()}|${(l.email || '').trim().toLowerCase()}|${(l.batch_no || '').trim()}`;

            const duplicateMap = new Set(alreadyInDb.map(key));

            setRows(prev =>
              prev.map(r =>
                duplicateMap.has(key(r))
                  ? { ...r, __duplicate: "Already in database" }
                  : r
              )
            );
          }
        } catch (err) {
          setMessage("❌ Upload failed: " + (err.response?.data?.error || err.message));
        }
      },
      error: (err) => setMessage("CSV parse error: " + err.message),
    });
  };

  return (
    <DashboardLayout>
      <Box maxWidth={800} mx="auto" my={2}>
        <Paper elevation={4} sx={{ p: 4 }}>
          <Typography variant="h6" color="primary" gutterBottom>
            Upload Learners
          </Typography>

          <Box mb={2}>
            <input type="file" accept=".csv" onChange={onChange} />
          </Box>

          <Box display="flex" gap={2} mb={2}>
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
            <Box mt={1}>
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
                Uploaded Learners Preview
              </Typography>
              <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                <Box component="thead" sx={{ bgcolor: "#f5f5f5" }}>
                  <Box component="tr">
                    {["Row", "Name", "Email", "Phone", "Batch No", "Status", "Server ID", "Errors", "Duplicate"].map(h => (
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
                  {rows.map((row, idx) => {
                    const hasErrors = row.__errors && row.__errors.length > 0;
                    const isDup = !!row.__duplicate;
                    return (
                      <Box
                        key={idx}
                        component="tr"
                        sx={{
                          bgcolor: hasErrors
                            ? "#ffebee"
                            : isDup
                            ? "#fff3e0"
                            : "inherit",
                        }}
                      >
                        <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                          {row.__rowIndex}
                        </Box>
                        <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                          {row.name}
                        </Box>
                        <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                          {row.email}
                        </Box>
                        <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                          {row.phone}
                        </Box>
                        <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                          {row.batch_no}
                        </Box>
                        <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                          {row.status}
                        </Box>
                        <Box component="td" sx={{ border: "1px solid #eee", p: 1, fontSize: 13 }}>
                          {row.server_id}
                        </Box>
                        <Box
                          component="td"
                          sx={{ border: "1px solid #eee", p: 1, fontSize: 13, color: "error.main" }}
                        >
                          {row.__errors?.join(", ")}
                        </Box>
                        <Box
                          component="td"
                          sx={{ border: "1px solid #eee", p: 1, fontSize: 13, color: "warning.main" }}
                        >
                          {row.__duplicate || ""}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </Box>
          )}
        </Paper>
      </Box>
    </DashboardLayout>
  );
}
