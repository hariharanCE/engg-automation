import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
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
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Chip,
  Tooltip,
} from "@mui/material";
import {
  Visibility as ViewIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
} from "@mui/icons-material";

const API_BASE =
  process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

// Lists course planners produced by the "Generate Course Planner" flow (run by
// trainers) and lets Admin / Manager / Coordinator view or download each one.
export default function GeneratedCoursePlanners() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState({ open: false, title: "", html: "", loading: false });

  const downloadUrl = (id) => `${API_BASE}/api/course-planner/download/${id}/xlsx`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axios.get(`${API_BASE}/api/course-planner/list`);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Failed to load planners");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleView = async (item) => {
    setViewer({ open: true, title: item.filename || item.batchNo, html: "", loading: true });
    try {
      const res = await axios.get(downloadUrl(item.id), { responseType: "arraybuffer" });
      const wb = XLSX.read(new Uint8Array(res.data), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const html = XLSX.utils.sheet_to_html(ws, { editable: false });
      setViewer((v) => ({ ...v, html, loading: false }));
    } catch (e) {
      setViewer((v) => ({
        ...v,
        loading: false,
        html: '<p style="color:#c00">Could not load the preview for this planner.</p>',
      }));
    }
  };

  const closeViewer = () => setViewer({ open: false, title: "", html: "", loading: false });

  const fmtDate = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <Box sx={{ maxWidth: 1000, mx: "auto", p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            Generated Course Planners
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Course planners created with the “Generate Course Planner” tool. View or
            download any planner below.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          onClick={load}
          startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />}
          disabled={loading}
        >
          Refresh
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ my: 2 }}>
          {error}
        </Alert>
      )}

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : items.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
              No generated course planners yet.
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Batch No</strong></TableCell>
                    <TableCell><strong>Domain</strong></TableCell>
                    <TableCell><strong>File</strong></TableCell>
                    <TableCell><strong>Generated On</strong></TableCell>
                    <TableCell align="right"><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} hover>
                      <TableCell>{item.batchNo || "—"}</TableCell>
                      <TableCell>
                        {item.domain ? <Chip size="small" label={item.domain} /> : "—"}
                      </TableCell>
                      <TableCell>{item.filename}</TableCell>
                      <TableCell>{fmtDate(item.createdAt)}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Tooltip title="View">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<ViewIcon />}
                              onClick={() => handleView(item)}
                            >
                              View
                            </Button>
                          </Tooltip>
                          <Tooltip title="Download .xlsx">
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              startIcon={<DownloadIcon />}
                              href={downloadUrl(item.id)}
                            >
                              Download
                            </Button>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* In-browser preview of the selected planner */}
      <Dialog open={viewer.open} onClose={closeViewer} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          {viewer.title || "Course Planner"}
          <IconButton
            onClick={closeViewer}
            sx={{ position: "absolute", right: 8, top: 8 }}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {viewer.loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box
              sx={{
                overflow: "auto",
                "& table": { borderCollapse: "collapse", fontSize: 12 },
                "& td, & th": { border: "1px solid #ddd", padding: "2px 6px", whiteSpace: "nowrap" },
              }}
              dangerouslySetInnerHTML={{ __html: viewer.html }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
