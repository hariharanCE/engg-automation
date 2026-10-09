// frontend/src/components/DashboardLayout.js
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, Outlet, useLocation } from "react-router-dom";
import {
  Home as HomeIcon,
  School as TrainerIcon,
  CalendarMonth as ScheduleIcon,
  Chat as CommunicationIcon,
  Assignment as AssessmentIcon,
  Campaign as AnnouncementIcon,
  Email as EmailIcon,
  GroupAdd as AttendanceIcon,
  TrendingUp as ProgressIcon,
  Menu as MenuIcon,
  People as PeopleIcon,
  Logout as LogoutIcon,
  // Additional icons for complete coverage
  Dashboard as DashboardIcon,
  Assessment as MarksIcon,
  EventNote as ReportIcon,
  WorkspacePremium as ClassroomIcon,
  PersonAdd as TrainerAssignmentIcon,
  EditCalendar as CoursePlannerIcon,
  ListAlt as GeneratedPlannersIcon,
  AccountCircle as ProfileIcon,
} from "@mui/icons-material";

// Updated Icon mapping for all menu items
const ICON_MAP = {
  "/home": <HomeIcon />,
  "/trainer-dashboard": <TrainerIcon />,
  "/mock-interview-schedule": <ScheduleIcon />,
  "/internal": <CommunicationIcon />,
  "/final-assessments": <AssessmentIcon />,
  "/soft-skill-announcement": <AnnouncementIcon />,
  "/mail-status": <EmailIcon />,
  "/attendance-mailer": <AttendanceIcon />,
  "/date-change-report": <ProgressIcon />,
  "/users": <PeopleIcon />,
  "/course-progress": <ProgressIcon />,
  "/schedule": <ScheduleIcon />,
  "/matrix": <ScheduleIcon />,
  "/attendance": <AttendanceIcon />,
  "marks/entry": <MarksIcon />,
  "/mock-interview": <PeopleIcon />,
  "/announcement": <AnnouncementIcon />,
  "/classroom-planner": <ClassroomIcon />,
  "/trainer/leaves": <PeopleIcon />,
  "/manager/leaves": <PeopleIcon />,
  "/trainer-assignment": <TrainerAssignmentIcon />,
  "/reports": <ReportIcon />,
  "/leave-apply": <PeopleIcon />,
  "/course-planner-generator": <CoursePlannerIcon />,
  "/generated-course-planners": <GeneratedPlannersIcon />,
};

// Define menus that match the routes in App.js
const MENUS_BY_ROLE = {
  admin: [
    { id: 1, name: "Classroom Planner", path: "/classroom-planner" },
    { id: 16, name: "Classroom Occupancy", path: "/classroom-matrix" },
    { id: 2, name: "Internal Communication", path: "/internal" },
    { id: 3, name: "Home", path: "/home" },
    { id: 15, name: "Trainer Dashboards", path: "/trainer-dashboard" },
    { id: 20, name: "Mock Interview Dashboard", path: "/mock-interview" },
    { id: 5, name: "Course Progress", path: "/course-progress" },
    { id: 6, name: "Trainer Assignment Dashboard", path: "/trainer-assignment" },
    { id: 7, name: "Mail Status Check", path: "/mail-status" },
    { id: 8, name: "Attendance Mailer", path: "/attendance-mailer" },
    { id: 9, name: "Report", path: "/reports" },
    { id: 10, name: "User Dashboard", path: "/users" },
    { id: 13, name: "Manager Leave Dashboard", path: "/manager/leaves" },
    { id: 14, name: "Announcement", path: "/announcement" },
    { id: 18, name: "Course Planner Generator", path: "/course-planner-generator" },
    { id: 19, name: "Generated Course Planners", path: "/generated-course-planners" },
    { id: 17, name: "Apply Leave", path: "/leave-apply" },
  ],
  manager: [
    { id: 1, name: "Classroom Planner", path: "/classroom-planner" },
    { id: 2, name: "Internal Communication", path: "/internal" },
    { id: 3, name: "Home", path: "/home" },
    { id: 13, name: "Trainer Dashboards", path: "/trainer-dashboard" },
    { id: 17, name: "Mock Interview Dashboard", path: "/mock-interview" },
    { id: 5, name: "Course Progress", path: "/course-progress" },
    { id: 6, name: "Manager Leave Dashboard", path: "/manager/leaves" },
    { id: 7, name: "Mail Status Check", path: "/mail-status" },
    { id: 8, name: "Report", path: "/reports" },
    { id: 9, name: "User Dashboard", path: "/users" },
    { id: 12, name: "Announcement", path: "/announcement" },
    { id: 15, name: "Course Planner Generator", path: "/course-planner-generator" },
    { id: 16, name: "Generated Course Planners", path: "/generated-course-planners" },
    { id: 14, name: "Apply Leave", path: "/leave-apply" },
  ],
  trainer: [
    { id: 1, name: "Trainer Dashboards", path: "/trainer-dashboard" },
    { id: 2, name: "Attendance", path: "/attendance" },
    { id: 3, name: "Mark Entry", path: "marks/entry"},
    { id: 4, name: "Mock Interview Dashboard", path: "/mock-interview" },
    { id: 5, name: "Course Planner Generator", path: "/course-planner-generator" },
  ],
  coordinator: [
    { id: 1, name: "Internal Communication", path: "/internal" },
    { id: 2, name: "Home", path: "/home" },
    { id: 3, name: "User Dashboard", path: "/users" },
    { id: 4, name: "Mail Status Check", path: "/mail-status" },
    { id: 5, name: "Course Progress", path: "/course-progress" },
    { id: 6, name: "Trainer Dashboards", path: "/trainer-dashboard" },
    { id: 11, name: "Mock Interview Dashboard", path: "/mock-interview" },
    { id: 7, name: "Announcement", path: "/announcement" },
    { id: 9, name: "Course Planner Generator", path: "/course-planner-generator" },
    { id: 10, name: "Generated Course Planners", path: "/generated-course-planners" },
    { id: 8, name: "Apply Leave", path: "/leave-apply" },
  ],
  sales: [
    { id: 1, name: "Notify Leave", path: "/leave-apply" },
  ],
  it: [
    { id: 1, name: "Notify Leave", path: "/leave-apply" },
  ],
};

export default function DashboardLayout({ user, logout, children }) {
  const [menu, setMenu] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const contentRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Track phone-sized viewports (drives the mobile nav + card tables).
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // ── Auto-label table cells for the mobile "card" view ──
  // On phones the CSS hides table headers and stacks each row as a card;
  // this copies each column's header text onto its cells (data-label) so
  // every card reads "Label: Value". Runs on every page, no per-page edits.
  useEffect(() => {
    if (!isMobile) return;
    const root = contentRef.current;
    if (!root) return;

    const stamp = () => {
      root.querySelectorAll("table").forEach((table) => {
        const heads = table.querySelectorAll("thead th");
        if (!heads.length) return;
        const labels = Array.from(heads).map((th) =>
          (th.textContent || "").trim()
        );
        table.querySelectorAll("tbody tr").forEach((tr) => {
          let i = 0;
          Array.from(tr.children).forEach((cell) => {
            if (cell.tagName === "TD") {
              cell.setAttribute("data-label", labels[i] || "");
              i += 1;
            }
          });
        });
      });
    };

    stamp();
    const observer = new MutationObserver(() =>
      window.requestAnimationFrame(stamp)
    );
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isMobile, location.pathname]);

  useEffect(() => {
    console.log("User object in DashboardLayout:", user);
    if (user && user.role) {
      const menuItems = MENUS_BY_ROLE[user.role] || [];
      setMenu(menuItems);
      console.log("[DashboardLayout] Role:", user.role);
      console.log("[DashboardLayout] menu items loaded:", menuItems);
    } else {
      console.warn("[DashboardLayout] No user or role found");
      setMenu([]);
    }
  }, [user]);

  const handleLogout = () => {
    logout();
  };

  const isActivePath = (path) => location.pathname === path;

  // ── Display helpers for the user profile badge (graphic element) ──
  const displayName =
    user?.name || (user?.email ? user.email.split("@")[0] : "User");
  const roleLabel = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : "";
  const initials =
    (displayName || "U")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => (p[0] || "").toUpperCase())
      .join("") || "U";

  // Inline styles for guaranteed rendering
  const containerStyle = {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    height: "100dvh",
    backgroundColor: "#749fcaff",
  };

  const sidebarStyle = {
    width: isExpanded ? "270px" : "84px",
    background:
      "linear-gradient(160deg, #075399 0%, #0a3e74 55%, #0f2747 100%)",
    color: "white",
    boxShadow: "8px 0 32px -8px rgba(0, 21, 90, 0.55)",
    display: "flex",
    flexDirection: "column",
    transition: "width 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
    position: "relative",
    zIndex: 10,
    overflow: "hidden",
  };

  const headerStyle = {
    padding: "18px 16px",
    borderBottom: "1px solid rgba(120, 160, 230, 0.18)",
    display: "flex",
    alignItems: "center",
    justifyContent: isExpanded ? "flex-start" : "center",
    gap: "12px",
  };

  const navStyle = {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "14px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  };

  const menuButtonStyle = (isActive) => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: isExpanded ? "flex-start" : "center",
    padding: "12px 14px",
    borderRadius: "12px",
    background: isActive
      ? "linear-gradient(135deg, rgba(9,109,202,0.95), rgba(7,83,153,0.85))"
      : "transparent",
    boxShadow: isActive ? "0 6px 18px rgba(7,83,153,0.45)" : "none",
    cursor: "pointer",
    transition: "all 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
    border: "none",
    color: "white",
    fontSize: "14px",
    fontWeight: isActive ? 700 : 500,
    position: "relative",
    transform: "translateX(0)",
  });

  const logoutContainerStyle = {
    padding: "16px 12px",
    borderTop: "1px solid rgba(120, 160, 230, 0.18)",
  };

  const logoutButtonStyle = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: isExpanded ? "flex-start" : "center",
    padding: "12px 14px",
    background: "linear-gradient(135deg, #ff4d4d, #d40000)",
    borderRadius: "12px",
    cursor: "pointer",
    transition: "all 0.22s ease-in-out",
    border: "none",
    color: "white",
    fontWeight: 600,
    boxShadow: "0 6px 16px rgba(212,0,0,0.4)",
  };

  const mainStyle = {
    flex: 1,
    overflowY: "auto",
    position: "relative",
    background:
      "radial-gradient(1200px circle at top left, #dbeafe, #eff6ff 40%, #f0f9ff)",
  };

  const contentStyle = {
    position: "relative",
    zIndex: 1,
    padding: "24px",
  };

  return (
    <div style={containerStyle}>
      {/* Keyframes + micro-interaction styles for the layout */}
      <style>{`
        @keyframes eaPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(252,91,50,0.55); }
          50% { box-shadow: 0 0 0 7px rgba(252,91,50,0); }
        }
        @keyframes eaFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-16px); }
        }
        @keyframes eaSpinSlow { to { transform: rotate(360deg); } }
        @keyframes eaSlideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        .ea-sidebar nav::-webkit-scrollbar { width: 6px; }
        .ea-sidebar nav::-webkit-scrollbar-thumb {
          background: rgba(120,160,230,0.35); border-radius: 6px;
        }
        .ea-menu-btn .ea-icon { transition: transform 0.25s ease; display: flex; }
        .ea-menu-btn:hover .ea-icon { transform: scale(1.22) rotate(-6deg); }
        .ea-menu-btn:hover { transform: translateX(4px); }
        .ea-logo-badge { transition: transform 0.3s ease; }
        .ea-logo-badge:hover { transform: rotate(-8deg) scale(1.05); }
      `}</style>

      {/* ── Mobile top app bar (phones only) ── */}
      {isMobile && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "calc(10px + var(--ea-safe-top)) 14px 10px",
            background: "linear-gradient(160deg, #075399 0%, #0a3e74 100%)",
            color: "#fff",
            boxShadow: "0 2px 12px rgba(0, 21, 90, 0.35)",
            zIndex: 20,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              padding: "6px",
            }}
          >
            <MenuIcon style={{ fontSize: "28px" }} />
          </button>
          <span
            style={{
              fontWeight: 700,
              fontSize: "16px",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Engineering Automation
          </span>
          <button
            onClick={handleLogout}
            aria-label="Logout"
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              padding: "6px",
            }}
          >
            <LogoutIcon />
          </button>
        </header>
      )}

      {/* ── Mobile slide-in drawer (phones only) ── */}
      {isMobile && drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2, 17, 46, 0.5)",
              zIndex: 30,
            }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              width: "82%",
              maxWidth: "300px",
              background:
                "linear-gradient(160deg, #075399 0%, #0a3e74 55%, #0f2747 100%)",
              color: "#fff",
              zIndex: 31,
              display: "flex",
              flexDirection: "column",
              paddingTop: "var(--ea-safe-top)",
              boxShadow: "8px 0 32px -8px rgba(0, 21, 90, 0.55)",
              animation: "eaSlideIn 0.25s ease",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "16px",
                borderBottom: "1px solid rgba(120,160,230,0.18)",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  background: "linear-gradient(135deg, #096dca, #fc5b32)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <MenuIcon style={{ color: "#fff", fontSize: "24px" }} />
              </div>
              <span style={{ fontWeight: "bold", fontSize: "16px", flex: 1 }}>
                Engineering Automation
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "22px",
                  lineHeight: 1,
                  padding: "4px 8px",
                }}
              >
                ✕
              </button>
            </div>

            {/* Profile badge */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px 16px",
                margin: "12px",
                borderRadius: "16px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(120,160,230,0.18)",
              }}
            >
              <div
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "15px",
                  color: "#fff",
                  background: "linear-gradient(135deg, #ff8160, #fc5b32)",
                }}
              >
                {initials}
              </div>
              <div style={{ overflow: "hidden" }}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {displayName}
                </div>
                {roleLabel && (
                  <span
                    style={{
                      display: "inline-block",
                      marginTop: "3px",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: "20px",
                      color: "#bfd3ff",
                      background: "rgba(9,109,202,0.25)",
                      border: "1px solid rgba(9,109,202,0.4)",
                    }}
                  >
                    {roleLabel}
                  </span>
                )}
              </div>
            </div>

            {/* Menu items */}
            <nav
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "8px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {menu.map((item) => {
                const active = isActivePath(item.path);
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      navigate(item.path);
                      setDrawerOpen(false);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      padding: "13px 14px",
                      borderRadius: "12px",
                      background: active
                        ? "linear-gradient(135deg, rgba(9,109,202,0.95), rgba(7,83,153,0.85))"
                        : "transparent",
                      border: "none",
                      color: "#fff",
                      fontSize: "15px",
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ display: "flex", flexShrink: 0 }}>
                      {ICON_MAP[item.path] || <HomeIcon />}
                    </span>
                    <span style={{ marginLeft: "16px" }}>{item.name}</span>
                  </button>
                );
              })}
            </nav>

            {/* Logout */}
            <div
              style={{
                padding: "16px 12px",
                borderTop: "1px solid rgba(120,160,230,0.18)",
              }}
            >
              <button onClick={handleLogout} style={logoutButtonStyle}>
                <LogoutIcon />
                <span style={{ marginLeft: "16px" }}>Logout</span>
              </button>
            </div>
          </aside>
        </>
      )}

      {/* Collapsible Sidebar (desktop only) */}
      {!isMobile && (
      <aside
        className="ea-sidebar"
        style={sidebarStyle}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
      >
        {/* Header / Brand */}
        <div style={headerStyle}>
          <div
            className="ea-logo-badge"
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #096dca, #fc5b32)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 6px 16px rgba(7,83,153,0.5)",
            }}
          >
            <MenuIcon style={{ color: "white", fontSize: "26px" }} />
          </div>
          {isExpanded && (
            <span
              style={{
                fontWeight: "bold",
                fontSize: "17px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                background: "linear-gradient(90deg, #ffffff, #bfd3ff)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Engineering Automation
            </span>
          )}
        </div>

        {/* User profile badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: isExpanded ? "flex-start" : "center",
            gap: "12px",
            padding: isExpanded ? "16px 18px" : "16px 0",
            margin: "12px",
            borderRadius: "16px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(120,160,230,0.18)",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "42px",
              height: "42px",
              borderRadius: "50%",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "15px",
              color: "#ffffff",
              background: "linear-gradient(135deg, #ff8160, #fc5b32)",
              boxShadow: "0 4px 12px rgba(252,91,50,0.5)",
            }}
            title={!isExpanded ? `${displayName}${roleLabel ? " · " + roleLabel : ""}` : ""}
          >
            {initials}
            <span
              style={{
                position: "absolute",
                bottom: "1px",
                right: "1px",
                width: "11px",
                height: "11px",
                borderRadius: "50%",
                background: "#22c55e",
                border: "2px solid #16234f",
                animation: "eaPulse 2.4s ease-in-out infinite",
              }}
            />
          </div>
          {isExpanded && (
            <div style={{ overflow: "hidden" }}>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "150px",
                }}
              >
                {displayName}
              </div>
              {roleLabel && (
                <span
                  style={{
                    display: "inline-block",
                    marginTop: "3px",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "2px 8px",
                    borderRadius: "20px",
                    color: "#bfd3ff",
                    background: "rgba(9,109,202,0.25)",
                    border: "1px solid rgba(9,109,202,0.4)",
                  }}
                >
                  {roleLabel}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Menu Items */}
        <nav style={navStyle}>
          {menu.length === 0 ? (
            <div
              style={{
                padding: "16px",
                color: "#d1d5db",
                textAlign: "center",
                fontSize: "14px",
              }}
            >
              {isExpanded ? "No menu items" : ""}
            </div>
          ) : (
            menu.map((item) => {
              const active = isActivePath(item.path);
              return (
                <button
                  key={item.id}
                  className="ea-menu-btn"
                  onClick={() => navigate(item.path)}
                  style={menuButtonStyle(active)}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background =
                        "rgba(9,109,202,0.22)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                  title={!isExpanded ? item.name : ""}
                >
                  {active && isExpanded && (
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: "4px",
                        height: "60%",
                        borderRadius: "0 4px 4px 0",
                        background: "#fc5b32",
                        boxShadow: "0 0 10px #fc5b32",
                      }}
                    />
                  )}
                  <span
                    className="ea-icon"
                    style={{ flexShrink: 0, display: "flex", alignItems: "center" }}
                  >
                    {ICON_MAP[item.path] || <HomeIcon />}
                  </span>
                  {isExpanded && (
                    <span
                      style={{
                        marginLeft: "16px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        transition: "opacity 0.3s",
                      }}
                    >
                      {item.name}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </nav>

        {/* Logout Button */}
        <div style={logoutContainerStyle}>
          <button
            onClick={handleLogout}
            style={logoutButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow =
                "0 10px 22px rgba(212,0,0,0.55)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow =
                "0 6px 16px rgba(212,0,0,0.4)";
            }}
            title={!isExpanded ? "Logout" : ""}
          >
            <LogoutIcon />
            {isExpanded && (
              <span style={{ marginLeft: "16px", transition: "opacity 0.3s" }}>
                Logout
              </span>
            )}
          </button>
        </div>
      </aside>
      )}

      {/* Main Content */}
      <main style={mainStyle}>
        {/* Decorative floating graphic orbs */}
        <div
          style={{
            position: "absolute",
            top: "-80px",
            right: "-60px",
            width: "260px",
            height: "260px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 30% 30%, rgba(96,165,250,0.25), rgba(96,165,250,0))",
            filter: "blur(6px)",
            animation: "eaFloat 12s ease-in-out infinite",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-90px",
            left: "10%",
            width: "200px",
            height: "200px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 70% 70%, rgba(252,91,50,0.28), rgba(252,91,50,0))",
            filter: "blur(8px)",
            animation: "eaFloat 16s ease-in-out infinite",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div style={contentStyle} className="ea-content" ref={contentRef}>
          {children}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
