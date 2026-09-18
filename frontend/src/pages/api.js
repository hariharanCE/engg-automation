// frontend/src/api.js
const API_BASE = process.env.REACT_APP_API_URL || "https://engg-automation.vercel.app/";

// Helper to safely parse JSON (handles empty / invalid responses)
async function safeJson(res) {
  const text = await res.text();

  if (!text) {
    return { success: false, error: `Empty response from server (HTTP ${res.status})` };
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Invalid JSON response:", text);
    return { success: false, error: `Invalid JSON from server (HTTP ${res.status})` };
  }
}

export async function login(email, password) {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    return await safeJson(res);
  } catch (err) {
    console.error("Network error calling /auth/login:", err);
    return { success: false, error: "Network error. Please try again." };
  }
}

export async function fetchBatches(token) {
  try {
    const res = await fetch(`${API_BASE}/trainer/batches`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return await safeJson(res);
  } catch (err) {
    console.error("Network error calling /trainer/batches:", err);
    return { success: false, error: "Network error while fetching batches." };
  }
}

export async function fetchTopics(token, batchNo) {
  try {
    const res = await fetch(
      `${API_BASE}/trainer/topics/${encodeURIComponent(batchNo)}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    return await safeJson(res);
  } catch (err) {
    console.error("Network error calling /trainer/topics:", err);
    return { success: false, error: "Network error while fetching topics." };
  }
}

export async function completeTopic(token, topicId) {
  try {
    const res = await fetch(`${API_BASE}/trainer/topics/${topicId}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });

    return await safeJson(res);
  } catch (err) {
    console.error("Network error calling /trainer/topics/:id/complete:", err);
    return { success: false, error: "Network error while completing topic." };
  }
}
