import React, { useState } from "react";
import axios from "axios";
import { Button } from "@mui/material";

const API_BASE =
  process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

function HolidayUpload() {
  const [file, setFile] = useState(null);

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    await axios.post(`${API_BASE}/api/holidays/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  };

  return (
    <>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <Button onClick={handleUpload} variant="contained">
        Upload Holiday List
      </Button>
    </>
  );
}

export default HolidayUpload;
