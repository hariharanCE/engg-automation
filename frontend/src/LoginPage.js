// frontend/src/LoginPage.js
import React, { useState } from "react";

const API_BASE = process.env.REACT_APP_API_URL || "http://192.168.1.2:5000/";

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg("Logging in...");

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const text = await res.text();        // NEVER res.json() directly
      console.log("Login raw response:", res.status, text);

      if (!text) {
        setMsg(`Empty response from server (HTTP ${res.status})`);
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        setMsg(`Invalid JSON from server (HTTP ${res.status})`);
        return;
      }

      if (data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user || {}));
        setMsg("Login success");
        if (onLogin) onLogin(data.token);
      } else {
        setMsg(data.error || "Login failed");
      }
    } catch (err) {
      console.error("Login fetch error:", err);
      setMsg("Network or server error during login.");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Login</h2>
      <div>
        <input
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <button type="submit">Login</button>
      {msg && <p>{msg}</p>}
    </form>
  );
}
