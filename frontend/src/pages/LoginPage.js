import React, { useState } from "react";
import {
  Box,
  TextField,
  Button,
  Paper,
  Typography,
  InputAdornment,
  IconButton,
  Fade,
  Grow,
  Collapse,
  Alert,
} from "@mui/material";
import {
  Email as EmailIcon,
  Lock as LockIcon,
  Visibility,
  VisibilityOff,
  AutoAwesome as BrandIcon,
  LoginRounded as LoginRoundedIcon,
  LockResetRounded as LockResetIcon,
} from "@mui/icons-material";

export default function LoginPage({ onLogin }) {
  const BACKEND_URL = "https://engg-automation.vercel.app/"; // ✅ FIXED

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Reset Password state
  const [resetMode, setResetMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  // ======================================================
  // LOGIN SUBMIT
  // ======================================================
  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Email and password required");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      // Avoid JSON parse crash
      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        setError("Invalid server response");
        setLoading(false);
        return;
      }

      setLoading(false);

      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }

      if (!data.success || !data.user) {
        setError("Invalid login details");
        return;
      }

      // Final correct session format
      const userSession = {
        id: data.user.id,
        role: data.user.role,
        name: data.user.name,
        email: data.user.email,
        token: data.token,
        loginTime: Date.now(),
      };

      localStorage.setItem("userSession", JSON.stringify(userSession));
      onLogin(userSession);

    } catch (err) {
      console.error("Login error", err);
      setLoading(false);
      setError("Network error");
    }
  }

  // ======================================================
  // RESET PASSWORD SUBMIT
  // ======================================================
  async function handleResetSubmit(e) {
    e.preventDefault();
    setResetError("");

    if (!email) return setResetError("Enter your email");
    if (!newPassword) return setResetError("Enter new password");
    if (!confirmNewPassword) return setResetError("Confirm new password");
    if (newPassword !== confirmNewPassword)
      return setResetError("Passwords do not match");

    setResetLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, new_password: newPassword }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        setResetError("Invalid server response");
        setResetLoading(false);
        return;
      }

      if (!res.ok) {
        setResetError(data.error || "Reset failed");
        setResetLoading(false);
        return;
      }

      setResetSuccess(true);

      setTimeout(() => {
        localStorage.removeItem("userSession");
        window.location.reload();
      }, 2500);

    } catch (err) {
      setResetError("Network error");
    } finally {
      setResetLoading(false);
    }
  }

  // ======================================================
  // UI
  // ======================================================
  // Shared styling for the glassy, glowing input fields
  const fieldSx = {
    "& .MuiOutlinedInput-root": {
      borderRadius: 2.5,
      background: "rgba(255,255,255,0.65)",
      backdropFilter: "blur(6px)",
      transition: "box-shadow .25s ease, transform .25s ease",
      "& fieldset": { borderColor: "rgba(9,109,202,0.25)", transition: "border-color .25s" },
      "&:hover fieldset": { borderColor: "#fc5b32" },
      "&:hover": { transform: "translateY(-1px)" },
      "&.Mui-focused fieldset": { borderColor: "#fc5b32", borderWidth: 2 },
      "&.Mui-focused": { boxShadow: "0 0 0 4px rgba(9,109,202,0.15)" },
    },
    "& .MuiInputLabel-root.Mui-focused": { color: "#fc5b32" },
  };

  return (
    <Box
      sx={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        px: 2,
        background:
          "linear-gradient(135deg, #096dca 0%, #fc5b32 55%, #d8401c 100%)",
        backgroundSize: "220% 220%",
        animation: "bgShift 16s ease infinite",
        "@keyframes bgShift": {
          "0%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
          "100%": { backgroundPosition: "0% 50%" },
        },
        "@keyframes floatA": {
          "0%,100%": { transform: "translate(0,0) scale(1)" },
          "50%": { transform: "translate(30px,-40px) scale(1.08)" },
        },
        "@keyframes floatB": {
          "0%,100%": { transform: "translate(0,0) scale(1)" },
          "50%": { transform: "translate(-35px,30px) scale(1.12)" },
        },
        "@keyframes logoGlow": {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(255,255,255,0.45)" },
          "50%": { boxShadow: "0 0 0 14px rgba(255,255,255,0)" },
        },
      }}
    >
      {/* ── Decorative floating graphic blobs ── */}
      <Box
        sx={{
          position: "absolute",
          top: "-120px",
          left: "-100px",
          width: 360,
          height: 360,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.35), rgba(255,255,255,0))",
          filter: "blur(8px)",
          animation: "floatA 13s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          bottom: "-140px",
          right: "-90px",
          width: 420,
          height: 420,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 70% 70%, rgba(9,109,202,0.55), rgba(9,109,202,0))",
          filter: "blur(10px)",
          animation: "floatB 17s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          top: "40%",
          right: "12%",
          width: 140,
          height: 140,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(252,91,50,0.5), rgba(252,91,50,0))",
          filter: "blur(6px)",
          animation: "floatA 11s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />

      <Grow in={true} timeout={800}>
        <Paper
          elevation={24}
          sx={{
            position: "relative",
            zIndex: 1,
            width: { xs: "100%", sm: 450 },
            p: { xs: 3.5, sm: 5 },
            pt: 7,
            borderRadius: 5,
            background: "rgba(255,255,255,0.82)",
            backdropFilter: "blur(18px)",
            border: "1px solid rgba(255,255,255,0.6)",
            boxShadow:
              "0 24px 60px rgba(31,38,135,0.35), inset 0 1px 0 rgba(255,255,255,0.7)",
            transition: "transform .35s ease, box-shadow .35s ease",
            "&:hover": {
              transform: "translateY(-4px)",
              boxShadow:
                "0 32px 80px rgba(31,38,135,0.45), inset 0 1px 0 rgba(255,255,255,0.7)",
            },
          }}
        >
          {/* ── Floating brand logo badge ── */}
          <Box
            sx={{
              position: "absolute",
              top: -36,
              left: "50%",
              transform: "translateX(-50%)",
              width: 72,
              height: 72,
              borderRadius: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #096dca 0%, #fc5b32 100%)",
              boxShadow: "0 10px 24px rgba(9,109,202,0.5)",
              animation: "logoGlow 2.8s ease-in-out infinite",
              transition: "transform .3s ease",
              "&:hover": { transform: "translateX(-50%) rotate(-8deg) scale(1.06)" },
            }}
          >
            {resetMode ? (
              <LockResetIcon sx={{ color: "#fff", fontSize: 38 }} />
            ) : (
              <BrandIcon sx={{ color: "#fff", fontSize: 36 }} />
            )}
          </Box>

          <Box sx={{ textAlign: "center", mb: 4 }}>
            <Typography
              variant="h4"
              fontWeight="bold"
              sx={{
                background: "linear-gradient(135deg, #096dca, #fc5b32)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                letterSpacing: "-0.02em",
              }}
            >
              {resetMode ? "Reset Password" : "Welcome Back"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {resetMode
                ? "Reset your password below"
                : "Sign in to access your dashboard"}
            </Typography>
          </Box>

          {resetSuccess && (
            <Collapse in={resetSuccess}>
              <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
                Password reset successful! Logging out...
              </Alert>
            </Collapse>
          )}

          {!resetSuccess && (
            <form onSubmit={resetMode ? handleResetSubmit : handleSubmit}>
              {/* Email */}
              <TextField
                label="Email Address"
                fullWidth
                margin="normal"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                sx={fieldSx}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <EmailIcon sx={{ color: "#fc5b32" }} />
                    </InputAdornment>
                  ),
                }}
                required
              />

              {/* Password */}
              {!resetMode && (
                <TextField
                  label="Password"
                  fullWidth
                  margin="normal"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  sx={fieldSx}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockIcon sx={{ color: "#fc5b32" }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  required
                />
              )}

              {/* Reset Mode Fields */}
              {resetMode && (
                <>
                  <TextField
                    label="New Password"
                    fullWidth
                    margin="normal"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    sx={fieldSx}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockIcon sx={{ color: "#fc5b32" }} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            edge="end"
                          >
                            {showNewPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                    required
                  />

                  <TextField
                    label="Confirm New Password"
                    fullWidth
                    margin="normal"
                    type={showConfirmNewPassword ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    sx={fieldSx}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockIcon sx={{ color: "#fc5b32" }} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() =>
                              setShowConfirmNewPassword(!showConfirmNewPassword)
                            }
                            edge="end"
                          >
                            {showConfirmNewPassword ? (
                              <VisibilityOff />
                            ) : (
                              <Visibility />
                            )}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                    required
                  />
                </>
              )}

              {/* Error Box */}
              {(error || resetError) && (
                <Fade in={true}>
                  <Box sx={{ mt: 2 }}>
                    <Typography
                      color="error"
                      variant="body2"
                      textAlign="center"
                    >
                      {resetMode ? resetError : error}
                    </Typography>
                  </Box>
                </Fade>
              )}

              <Button
                type="submit"
                fullWidth
                variant="contained"
                disableElevation
                startIcon={
                  resetMode ? <LockResetIcon /> : <LoginRoundedIcon />
                }
                sx={{
                  mt: 3,
                  py: 1.4,
                  borderRadius: 2.5,
                  fontWeight: 700,
                  fontSize: 15,
                  textTransform: "none",
                  letterSpacing: "0.02em",
                  background:
                    "linear-gradient(135deg, #096dca 0%, #fc5b32 100%)",
                  backgroundSize: "200% 200%",
                  boxShadow: "0 8px 20px rgba(9,109,202,0.45)",
                  transition: "all .3s ease",
                  "&:hover": {
                    backgroundPosition: "100% 0",
                    transform: "translateY(-2px)",
                    boxShadow: "0 12px 28px rgba(9,109,202,0.6)",
                  },
                  "&:active": { transform: "translateY(0)" },
                  "&.Mui-disabled": {
                    background: "rgba(9,109,202,0.35)",
                    color: "rgba(255,255,255,0.8)",
                  },
                }}
                disabled={loading || resetLoading}
              >
                {resetMode
                  ? resetLoading
                    ? "Resetting..."
                    : "Reset Password"
                  : loading
                  ? "Signing in..."
                  : "Login"}
              </Button>

              {/* Toggle reset mode */}
              <Button
                fullWidth
                sx={{
                  mt: 2,
                  textTransform: "none",
                  fontWeight: 600,
                  color: "#fc5b32",
                  borderRadius: 2,
                  "&:hover": { background: "rgba(9,109,202,0.08)" },
                }}
                onClick={() => {
                  setResetMode(!resetMode);
                  setError("");
                  setResetError("");
                }}
              >
                {resetMode ? "← Back to Login" : "Forgot Password?"}
              </Button>
            </form>
          )}
        </Paper>
      </Grow>
    </Box>
  );
}
