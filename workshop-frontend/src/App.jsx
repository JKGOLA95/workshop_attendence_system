import React, { useEffect, useRef, useState } from "react";
import {
  Users,
  Upload,
  Camera,
  BarChart3,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  Plus,
  Edit3,
  Trash2,
  Shield,
  Activity,
  TrendingUp,
  Download,
  Search,
  Mail,
  Phone,
} from "lucide-react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const App = () => {
  // ====================== AUTH / APP STATE ======================
  const [view, setView] = useState("home"); // home | login-admin | login-staff | admin | staff
  const [loginType, setLoginType] = useState(null); // 'admin' | 'staff'
  const [role, setRole] = useState(null); // 'admin' | 'staff'
  const [token, setToken] = useState(localStorage.getItem("token") || null);
  const [staffInfo, setStaffInfo] = useState(
    JSON.parse(localStorage.getItem("staffInfo") || "null")
  );

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [activeTab, setActiveTab] = useState("dashboard");
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  // ====================== DASHBOARD STATE ======================
  const [dashboardData, setDashboardData] = useState(null);
  const [adminDashboard, setAdminDashboard] = useState(null);

  // ====================== LIVE TRACKING STATE ======================
  const [liveAttendees, setLiveAttendees] = useState([]);
  const [eventSource, setEventSource] = useState(null);
  const [liveSearch, setLiveSearch] = useState("");

  // ====================== REGISTRATION STATE ======================
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    mobile: "",
    batch: "",
  });

  // ====================== CSV UPLOAD STATE ======================
  const [csvFile, setCsvFile] = useState(null);
  const [csvPreview, setCsvPreview] = useState([]);

  // ====================== SCANNER STATE ======================
  const [scannerActive, setScannerActive] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const scannerRef = useRef(null);

  // ====================== ADMIN STATE ======================
  const [staffList, setStaffList] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [staffFormData, setStaffFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "staff",
  });

  // ====================== AUTO LOGIN ======================
  useEffect(() => {
    if (token && staffInfo) {
      setRole(staffInfo.role);
      setView(staffInfo.role === "admin" ? "admin" : "staff");
    }
  }, []);

  // ====================== HELPERS ======================
  const showNotification = (message, type = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // All API calls go through here. We keep /api prefix inside code.
  const apiCall = async (endpoint, options = {}) => {
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };
    const resp = await fetch(`${API_BASE_URL}/api${endpoint}`, {
      ...options,
      headers,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    const ct = resp.headers.get("content-type") || "";
    return ct.includes("application/json") ? resp.json() : null;
  };

  // ====================== DASHBOARD LOADERS ======================
  const loadDashboard = async () => {
    try {
      setIsLoading(true);
      const data = await apiCall("/attendance/dashboard");
      setDashboardData(data);
    } catch (err) {
      console.error("Dashboard error:", err);
      showNotification("Failed to load dashboard", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const loadAdminDashboard = async () => {
    try {
      setIsLoading(true);
      const data = await apiCall("/admin/dashboard");
      setAdminDashboard(data);
    } catch (err) {
      console.error("Admin dashboard error:", err);
      showNotification("Failed to load admin dashboard", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "dashboard") {
      if (view === "admin") {
        loadAdminDashboard();
        loadDashboard();
      } else if (view === "staff") {
        loadDashboard();
      }
    }
  }, [activeTab, view]);

  // ====================== LIVE TRACKING ======================
  const loadLiveAttendees = async () => {
    try {
      setIsLoading(true);
      const data = await apiCall("/attendees/live");
      setLiveAttendees(data?.attendees || []);
    } catch (err) {
      console.error("Live list error:", err);
      showNotification("Failed to load live attendees", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const connectLiveStream = () => {
    try {
      if (!token) return;

      // close existing stream if any
      if (eventSource) {
        try {
          eventSource.close();
        } catch {}
      }

      // token via query (EventSource cannot send Authorization header)
      const url = `${API_BASE_URL}/api/attendees/stream?token=${encodeURIComponent(
        token
      )}`;
      const es = new EventSource(url);
      setEventSource(es);

      es.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.type === "connected") return;
          if (msg && msg.id) {
            // Merge incremental update
            setLiveAttendees((prev) => {
              const idx = prev.findIndex((a) => a.id === msg.id);
              if (idx === -1) return prev;
              const updated = [...prev];
              updated[idx] = { ...updated[idx], ...msg };
              return updated;
            });
          }
        } catch {
          // ignore keepalive/comments
        }
      };

      es.onerror = () => {
        try {
          es.close();
        } catch {}
        setEventSource(null);
        // Try reconnecting after 5s
        setTimeout(connectLiveStream, 5000);
      };
    } catch (err) {
      console.error("SSE connect error:", err);
      showNotification("Live stream failed to connect", "error");
    }
  };

  useEffect(() => {
    if (view === "staff" && activeTab === "live" && token) {
      loadLiveAttendees();
      connectLiveStream();
    }
    // Cleanup when leaving tab or logout
    return () => {
      if (eventSource) {
        try {
          eventSource.close();
        } catch {}
        setEventSource(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, view, token]);

  const filteredLive = liveAttendees.filter((a) => {
    if (!liveSearch.trim()) return true;
    const q = liveSearch.toLowerCase();
    return (
      (a.name || "").toLowerCase().includes(q) ||
      (a.mobile || "").toLowerCase().includes(q)
    );
  });

  const exportCSV = () => {
    try {
      const rows = [
        [
          "Name",
          "Email",
          "Mobile",
          "Batch",
          "Status",
          "Entry Time",
          "QR Email",
          "QR WhatsApp",
          "Entry Email",
          "Entry WhatsApp",
        ],
        ...filteredLive.map((a) => [
          a.name || "",
          a.email || "",
          a.mobile || "",
          a.batch || "",
          a.attendance_status === "P" ? "Present" : "Absent",
          a.entry_time ? new Date(a.entry_time).toLocaleString() : "",
          a.qr_email_status || "",
          a.qr_whatsapp_status || "",
          a.entry_email_status || "",
          a.entry_whatsapp_status || "",
        ]),
      ];

      const csv = rows
        .map((r) =>
          r
            .map((cell) => {
              const s = String(cell ?? "");
              // escape double quotes
              return `"${s.replace(/"/g, '""')}"`;
            })
            .join(",")
        )
        .join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendees_${new Date().toISOString().slice(0, 19)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification("Exported attendees CSV");
    } catch (e) {
      console.error("CSV export error:", e);
      showNotification("Export failed", "error");
    }
  };

  // ====================== LOGIN / LOGOUT ======================
  const handleLogin = async (email, password) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/staff/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Login failed: ${errorText}`);
      }

      const data = await res.json();
      setToken(data.token);
      setRole(data.role);
      setStaffInfo(data);
      localStorage.setItem("token", data.token);
      localStorage.setItem("staffInfo", JSON.stringify(data));

      if (loginType === "admin" && data.role !== "admin") {
        throw new Error("You don't have admin privileges. Please use Staff Login.");
      }

      setView(data.role === "admin" ? "admin" : "staff");
      showNotification(`Welcome ${data.name}! Logged in as ${data.role}`);
      setLoginEmail("");
      setLoginPassword("");
    } catch (err) {
      console.error("Login error:", err);
      showNotification(err.message || "Login failed.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setRole(null);
    setStaffInfo(null);
    setLoginType(null);
    localStorage.removeItem("token");
    localStorage.removeItem("staffInfo");
    setView("home");
    setActiveTab("dashboard");
    setLoginEmail("");
    setLoginPassword("");
    showNotification("Logged out successfully");
  };

  // ====================== REGISTRATION ======================
  const handleInputChange = (field, value) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const resetForm = () =>
    setFormData({ name: "", email: "", mobile: "", batch: "" });

  const handleRegistration = async () => {
    const { name, email, mobile, batch } = formData;
    if (!name || !email || !mobile || !batch) {
      showNotification("Please fill all fields", "error");
      return;
    }
    setIsLoading(true);
    try {
      await apiCall("/register/single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      showNotification("Attendee registered successfully!");
      resetForm();
      await loadDashboard();
    } catch (err) {
      console.error("Registration error:", err);
      showNotification("Registration failed", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ====================== CSV UPLOAD ======================
  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    try {
      const text = await file.text();
      const rows = text
        .split(/\r?\n/)
        .map((row) => row.split(","))
        .filter((r) => r.length > 1);
      setCsvPreview(rows.slice(0, 4));
    } catch {
      showNotification("Error reading CSV", "error");
    }
  };

  const processCsv = async () => {
    if (!csvFile) return;
    setIsLoading(true);
    const form = new FormData();
    form.append("file", csvFile);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/upload/csv`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!resp.ok) throw new Error("Upload failed");
      showNotification("CSV processed successfully!");
      setCsvFile(null);
      setCsvPreview([]);
      await loadDashboard();
    } catch (err) {
      console.error("CSV error:", err);
      showNotification("CSV upload failed", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ====================== QR SCANNER ======================
  const startScanner = async () => {
    setScannerActive(true);
    setTimeout(async () => {
      try {
        const mod = await import("html5-qrcode");
        const Html5QrcodeScanner = mod.Html5QrcodeScanner;
        const scanner = new Html5QrcodeScanner("qr-reader", {
          fps: 10,
          qrbox: 250,
          rememberLastUsedCamera: true,
        });
        scanner.render(
          async (decodedText) => {
            try {
              const result = await apiCall("/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qr_code: decodedText }),
              });
              setLastScan(result.attendee);
              showNotification(`Attendance marked for ${result.attendee.name}!`);
              await loadDashboard();
            } catch (err) {
              console.error("Scan error:", err);
              showNotification(
                "Invalid QR code or already scanned",
                "error"
              );
            } finally {
              try {
                await scanner.clear();
              } catch {}
              setScannerActive(false);
            }
          },
          () => {}
        );
        scannerRef.current = scanner;
      } catch (err) {
        console.error("Scanner error:", err);
        showNotification("Scanner initialization failed", "error");
        setScannerActive(false);
      }
    }, 100);
  };

  // ====================== ADMIN: STAFF & LOGS ======================
  const loadStaffList = async () => {
    try {
      setIsLoading(true);
      const data = await apiCall("/admin/staff");
      setStaffList(data);
    } catch (err) {
      console.error("Staff list error:", err);
      showNotification(`Failed to load staff list: ${err.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      setIsLoading(true);
      const data = await apiCall("/admin/audit-logs?limit=50");
      setAuditLogs(data.logs || []);
    } catch (err) {
      console.error("Audit logs error:", err);
      showNotification("Failed to load audit logs", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (view === "admin") {
      if (activeTab === "staff") loadStaffList();
      if (activeTab === "logs") loadAuditLogs();
    }
  }, [activeTab, view]);

  const handleStaffFormChange = (field, value) =>
    setStaffFormData((prev) => ({ ...prev, [field]: value }));

  const resetStaffForm = () => {
    setStaffFormData({ name: "", email: "", password: "", role: "staff" });
    setEditingStaff(null);
    setShowStaffForm(false);
  };

  const handleCreateStaff = async () => {
    const { name, email, password, role } = staffFormData;
    if (!name || !email || !password) {
      showNotification("Please fill all required fields", "error");
      return;
    }
    setIsLoading(true);
    try {
      await apiCall("/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      showNotification("Staff member created successfully!");
      resetStaffForm();
      await loadStaffList();
    } catch (err) {
      console.error("Create staff error:", err);
      showNotification(`Failed to create staff member: ${err.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateStaff = async () => {
    if (!editingStaff) return;
    setIsLoading(true);
    try {
      const updateData = {};
      if (staffFormData.name) updateData.name = staffFormData.name;
      if (staffFormData.email) updateData.email = staffFormData.email;
      if (staffFormData.password) updateData.password = staffFormData.password;
      if (staffFormData.role) updateData.role = staffFormData.role;

      await apiCall(`/admin/staff/${editingStaff.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      showNotification("Staff member updated successfully!");
      resetStaffForm();
      await loadStaffList();
    } catch (err) {
      console.error("Update staff error:", err);
      showNotification(`Failed to update staff member: ${err.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteStaff = async (staffId, permanent = false) => {
    if (
      !confirm(
        `Are you sure you want to ${
          permanent ? "permanently delete" : "deactivate"
        } this staff member?`
      )
    )
      return;
    setIsLoading(true);
    try {
      await apiCall(`/admin/staff/${staffId}?permanent=${permanent}`, {
        method: "DELETE",
      });
      showNotification(
        `Staff member ${permanent ? "deleted" : "deactivated"} successfully!`
      );
      await loadStaffList();
    } catch (err) {
      console.error("Delete staff error:", err);
      showNotification(`Failed to delete staff member: ${err.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const startEditStaff = (staff) => {
    setEditingStaff(staff);
    setStaffFormData({
      name: staff.name,
      email: staff.email,
      password: "",
      role: staff.role,
    });
    setShowStaffForm(true);
  };

  // ====================== RENDER ======================
 /*
  if (view === "home") {
    return (
      <div className="center-block">
        <div className="empty-card">
          <h1 className="brand">Workshop Attendance System</h1>
          <p className="muted">Choose your login type</p>
          <div className="form-actions">
            <button
              className="btn-primary"
              onClick={() => {
                setLoginType("admin");
                setView("login-admin");
              }}
            >
              <Shield className="icon" />
              Admin Login
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setLoginType("staff");
                setView("login-staff");
              }}
            >
              <Users className="icon" />
              Staff Login
            </button>
          </div>
        </div>
      </div>
    );
  }*/


  console.log("Current view:", view, "Active tab:", activeTab);

  if (view === "home") {
  return (
    <div>
      {/* 🔹 Full-width banner at the top */}
      <div style={{ width: "100%", marginBottom: "20px" }}>
        <img
          src="/Website Banner-01_0.jpg"   // ✅ correct reference
          alt="Workshop Banner"
          style={{
            display: "block",
            width: "100%",     // always fit to screen width
            height: "auto",    // keep aspect ratio
            maxWidth: "100%",
          }}
        />
      </div>

      {/* 🔹 Centered login card below the banner */}
      <div className="center-block">
        <div className="empty-card">
          <h1 className="brand">Workshop Attendance System</h1>
          <p className="muted">Choose your login type</p>
          <div className="form-actions">
            <button
              className="btn-primary"
              onClick={() => {
                setLoginType("admin");
                setView("login-admin");
              }}
            >
              <Shield className="icon" />
              Admin Login
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setLoginType("staff");
                setView("login-staff");
              }}
            >
              <Users className="icon" />
              Staff Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

  if (view === "login-admin" || view === "login-staff") {
    return (
      <div className="center-block">
        <div className="empty-card">
          <h2>{view === "login-admin" ? "Admin Login" : "Staff Login"}</h2>
          <p className="muted">
            {view === "login-admin"
              ? "Enter admin credentials to access system management"
              : "Enter staff credentials to access attendance features"}
          </p>
          <div className="form">
            <div>
              <label>Email Address</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="Enter your email"
                disabled={isLoading}
              />
            </div>
            <div>
              <label>Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={isLoading}
                onKeyDown={(e) =>
                  e.key === "Enter" && handleLogin(loginEmail, loginPassword)
                }
              />
            </div>
            <div className="form-actions">
              <button
                className="btn-primary"
                disabled={isLoading || !loginEmail || !loginPassword}
                onClick={() => handleLogin(loginEmail, loginPassword)}
              >
                {isLoading ? "Logging in..." : "Login"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setView("home");
                  setLoginType(null);
                  setLoginEmail("");
                  setLoginPassword("");
                }}
              >
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "admin" || view === "staff") {
    const tabs =
      view === "admin"
        ? [
            { id: "dashboard", label: "Dashboard", icon: BarChart3 },
            { id: "staff", label: "Staff Management", icon: Users },
            { id: "logs", label: "Audit Logs", icon: ClipboardList },
          ]
        : [
            { id: "dashboard", label: "Dashboard", icon: BarChart3 },
            { id: "live", label: "Live Tracking", icon: Activity },
            { id: "register", label: "Register", icon: UserPlus },
            { id: "upload", label: "Bulk Upload", icon: Upload },
            { id: "scanner", label: "Scanner", icon: Camera },
          ];

    return (
      <div className="app-root">
        <header className="app-header">
          <div className="container flex-between">
            <h1 className="brand">Workshop Attendance</h1>
            <div className="flex-between" style={{ gap: "12px" }}>
              <span className="muted">
                {staffInfo?.name} ({staffInfo?.role})
              </span>
              <button className="btn-secondary" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </header>

        <div className="container tabs-row">
          <div className="tabs no-scrollbar">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
                >
                  <Icon className="icon" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <main className="container">
          {/* DASHBOARD */}
          {activeTab === "dashboard" && (
            <div>
              {/* Admin Dashboard */}
              {view === "admin" && adminDashboard && (
                <div className="grid-3">
                  <div className="card">
                    <div className="card-left">
                      <div className="icon-wrap icon-blue">
                        <Users />
                      </div>
                      <div>
                        <p className="big">
                          {adminDashboard.staff_stats.total_staff}
                        </p>
                        <p className="muted">Total Staff</p>
                        <p className="muted-light">
                          {adminDashboard.staff_stats.active_staff} active
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-left">
                      <div className="icon-wrap icon-green">
                        <TrendingUp />
                      </div>
                      <div>
                        <p className="big">
                          {adminDashboard.communication_stats.email_sent}
                        </p>
                        <p className="muted">Emails Sent</p>
                        <p className="muted-light">
                          {adminDashboard.communication_stats.whatsapp_sent} WhatsApp
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-left">
                      <div className="icon-wrap icon-purple">
                        <Activity />
                      </div>
                      <div>
                        <p className="big">
                          {adminDashboard.attendee_stats.attendance_rate}%
                        </p>
                        <p className="muted">Attendance Rate</p>
                        <p className="muted-light">
                          {adminDashboard.attendee_stats.total_attended}/
                          {adminDashboard.attendee_stats.total_registered}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Regular Dashboard */}
              {dashboardData && (
                <div className="grid-3">
                  <div className="card">
                    <div className="card-left">
                      <div className="icon-wrap icon-blue">
                        <Users />
                      </div>
                      <div>
                        <p className="big">{dashboardData.total_attendees}</p>
                        <p className="muted">Total Registered</p>
                      </div>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-left">
                      <div className="icon-wrap icon-green">
                        <CheckCircle2 />
                      </div>
                      <div>
                        <p className="big">{dashboardData.marked_attendance}</p>
                        <p className="muted">Attended</p>
                      </div>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-left">
                      <div className="icon-wrap icon-purple">
                        <BarChart3 />
                      </div>
                      <div>
                        <p className="big">{dashboardData.attendance_rate}%</p>
                        <p className="muted">Attendance Rate</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Batch-wise Table */}
              {dashboardData?.batch_wise_data &&
                dashboardData.batch_wise_data.length > 0 && (
                  <div className="table-card">
                    <div className="table-head">
                      <h3 style={{ margin: 0 }}>Batch-wise Statistics</h3>
                    </div>
                    <div className="table-wrap">
                      <table className="att-table">
                        <thead>
                          <tr>
                            <th>Batch</th>
                            <th>Registered</th>
                            <th>Attended</th>
                            <th>Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboardData.batch_wise_data.map((batch, idx) => (
                            <tr key={idx}>
                              <td>
                                <strong>{batch.batch}</strong>
                              </td>
                              <td>{batch.total_registered}</td>
                              <td>{batch.total_attended}</td>
                              <td>
                                {batch.total_registered > 0
                                  ? Math.round(
                                      (batch.total_attended /
                                        batch.total_registered) *
                                        100
                                    )
                                  : 0}
                                %
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
            </div>
          )}

          {/* LIVE TRACKING (STAFF) */}
          {view === "staff" && activeTab === "live" && (
            <div className="card-panel">
              <div className="flex-between" style={{ marginBottom: 12 }}>
                <h2>Live Tracking</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    title={eventSource ? "Stream connected" : "Stream disconnected"}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: eventSource ? "#16a34a" : "#dc2626",
                    }}
                  />
                  <span className="muted">
                    {eventSource ? "Connected" : "Disconnected"}
                  </span>
                  <button className="btn-secondary" onClick={loadLiveAttendees}>
                    Refresh
                  </button>
                  <button className="btn-primary" onClick={exportCSV}>
                    <Download className="icon" />
                    Export
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div
                className="card"
                style={{
                  padding: 12,
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Search size={18} className="muted" />
                <input
                  type="text"
                  placeholder="Search by name or mobile..."
                  value={liveSearch}
                  onChange={(e) => setLiveSearch(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              {filteredLive.length > 0 ? (
                <div className="table-card">
                  <div className="table-wrap">
                    <table className="att-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Mobile</th>
                          <th>Batch</th>
                          <th>Status</th>
                          <th>Entry Time</th>
                          <th colSpan={2}>QR Sent</th>
                          <th colSpan={2}>Entry Pass</th>
                        </tr>
                        <tr>
                          <th colSpan={6}></th>
                          <th>
                            <span className="mini-badge">
                              <Mail size={12} /> Email
                            </span>
                          </th>
                          <th>
                            <span className="mini-badge">
                              <Phone size={12} /> WhatsApp
                            </span>
                          </th>
                          <th>
                            <span className="mini-badge">
                              <Mail size={12} /> Email
                            </span>
                          </th>
                          <th>
                            <span className="mini-badge">
                              <Phone size={12} /> WhatsApp
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLive.map((a) => (
                          <tr
                            key={a.id}
                            style={{
                              background:
                                a.attendance_status === "P" ? "#f0fdf4" : "white",
                            }}
                          >
                            <td>
                              <strong>{a.name}</strong>
                            </td>
                            <td>{a.email}</td>
                            <td>{a.mobile}</td>
                            <td>{a.batch}</td>
                            <td>
                              {a.attendance_status === "P" ? "Present" : "Absent"}
                            </td>
                            <td>
                              {a.entry_time
                                ? new Date(a.entry_time).toLocaleString()
                                : "-"}
                            </td>
                            {/* QR statuses */}
                            <td>
                              <span
                                className={`mini-badge ${
                                  (a.qr_email_status || "pending").toLowerCase()
                                }`}
                              >
                                {a.qr_email_status || "pending"}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`mini-badge ${
                                  (a.qr_whatsapp_status || "pending").toLowerCase()
                                }`}
                              >
                                {a.qr_whatsapp_status || "pending"}
                              </span>
                            </td>
                            {/* Entry pass statuses */}
                            <td>
                              <span
                                className={`mini-badge ${
                                  (a.entry_email_status || "pending").toLowerCase()
                                }`}
                              >
                                {a.entry_email_status || "pending"}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`mini-badge ${
                                  (a.entry_whatsapp_status || "pending").toLowerCase()
                                }`}
                              >
                                {a.entry_whatsapp_status || "pending"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="center-block">
                  <div className="empty-card">
                    <Users size={32} color="var(--muted)" />
                    <p>No attendees match your search</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* REGISTER (STAFF) */}
          {view === "staff" && activeTab === "register" && (
            <div className="card-panel">
              <h2>Register New Attendee</h2>
              <div className="form">
                <div>
                  <label>Full Name</label>
                  <input
                    type="text"
                    placeholder="Enter full name"
                    value={formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                  />
                </div>
                <div>
                  <label>Email Address</label>
                  <input
                    type="email"
                    placeholder="Enter email address"
                    value={formData.email}
                    onChange={(e) => handleInputChange("email", e.target.value)}
                  />
                </div>
                <div>
                  <label>Mobile Number</label>
                  <input
                    type="tel"
                    placeholder="Enter mobile number"
                    value={formData.mobile}
                    onChange={(e) => handleInputChange("mobile", e.target.value)}
                  />
                </div>
                <div>
                  <label>Batch/Group</label>
                  <input
                    type="text"
                    placeholder="Enter batch or group name"
                    value={formData.batch}
                    onChange={(e) => handleInputChange("batch", e.target.value)}
                  />
                </div>
                <div className="form-actions">
                  <button
                    className="btn-primary"
                    onClick={handleRegistration}
                    disabled={isLoading}
                  >
                    {isLoading ? "Registering..." : "Register Attendee"}
                  </button>
                  <button className="btn-secondary" onClick={resetForm}>
                    Clear Form
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* BULK UPLOAD (STAFF & ADMIN) */}
          {activeTab === "upload" && (
            <div className="card-panel">
              <h2>Bulk Upload Attendees</h2>
              <div className="info-box">
                <div className="info-left">
                  <AlertCircle />
                </div>
                <div>
                  <p>
                    <strong>CSV Format Required:</strong>
                  </p>
                  <p>Columns: name, email, mobile, batch (exact headers)</p>
                </div>
              </div>

              <div className="form">
                <div>
                  <label>Select CSV File</label>
                  <input type="file" accept=".csv" onChange={handleCsvUpload} />
                </div>

                {csvPreview.length > 0 && (
                  <div className="csv-preview">
                    <h4>Preview:</h4>
                    <div className="csv-table-wrap">
                      <table className="csv-table">
                        <tbody>
                          {csvPreview.map((row, i) => (
                            <tr key={i} className={i === 0 ? "bold-row" : ""}>
                              {row.map((cell, j) => (
                                <td key={j}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="form-actions">
                      <button
                        className="btn-primary"
                        onClick={processCsv}
                        disabled={isLoading}
                      >
                        {isLoading ? "Processing..." : "Process CSV"}
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setCsvFile(null);
                          setCsvPreview([]);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SCANNER (STAFF) */}
          {view === "staff" && activeTab === "scanner" && (
            <div className="card-panel">
              <h2>QR Code Scanner</h2>

              {!scannerActive ? (
                <div className="text-center">
                  <div className="scanner-icon">
                    <Camera size={32} />
                  </div>
                  <p>Click to start scanning QR codes</p>
                  <button className="btn-primary" onClick={startScanner}>
                    Start Scanner
                  </button>
                </div>
              ) : (
                <div>
                  <div id="qr-reader" className="qr-reader-box"></div>
                  <div className="text-center">
                    <p className="muted">Position QR code within the frame</p>
                  </div>
                </div>
              )}

              {lastScan && (
                <div className="success-card card" style={{ marginTop: "16px" }}>
                  <div className="success-head">
                    <CheckCircle2
                      size={20}
                      style={{ color: "var(--accent-green)" }}
                    />
                    <strong>Last Successful Scan</strong>
                  </div>
                  <div className="last-scan">
                    <p>
                      <strong>Name:</strong> {lastScan.name}
                    </p>
                    <p>
                      <strong>Batch:</strong> {lastScan.batch}
                    </p>
                    <p>
                      <strong>Time:</strong>{" "}
                      {new Date(lastScan.entry_time).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ADMIN: STAFF MANAGEMENT */}
          {view === "admin" && activeTab === "staff" && (
            <div>
              <div className="card-panel">
                <div className="flex-between">
                  <h2>Staff Management</h2>
                  <button
                    className="btn-primary"
                    onClick={() => setShowStaffForm(true)}
                  >
                    <Plus className="icon" />
                    Add Staff
                  </button>
                </div>

                {showStaffForm && (
                  <div
                    className="form"
                    style={{
                      marginTop: "16px",
                      padding: "16px",
                      background: "#f8fafc",
                      borderRadius: "8px",
                    }}
                  >
                    <h4>
                      {editingStaff ? "Edit Staff Member" : "Create New Staff Member"}
                    </h4>
                    <div>
                      <label>Full Name *</label>
                      <input
                        type="text"
                        placeholder="Enter full name"
                        value={staffFormData.name}
                        onChange={(e) =>
                          handleStaffFormChange("name", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label>Email Address *</label>
                      <input
                        type="email"
                        placeholder="Enter email address"
                        value={staffFormData.email}
                        onChange={(e) =>
                          handleStaffFormChange("email", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label>
                        Password {editingStaff ? "(leave blank to keep current)" : "*"}
                      </label>
                      <input
                        type="password"
                        placeholder="Enter password"
                        value={staffFormData.password}
                        onChange={(e) =>
                          handleStaffFormChange("password", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label>Role</label>
                      <select
                        value={staffFormData.role}
                        onChange={(e) =>
                          handleStaffFormChange("role", e.target.value)
                        }
                      >
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div className="form-actions">
                      <button
                        className="btn-primary"
                        onClick={editingStaff ? handleUpdateStaff : handleCreateStaff}
                        disabled={isLoading}
                      >
                        {isLoading ? "Saving..." : editingStaff ? "Update Staff" : "Create Staff"}
                      </button>
                      <button className="btn-secondary" onClick={resetStaffForm}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Staff List */}
              {staffList.length > 0 && (
                <div className="table-card">
                  <div className="table-head">
                    <h3 style={{ margin: 0 }}>Staff Members</h3>
                  </div>
                  <div className="table-wrap">
                    <table className="att-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffList.map((staff) => (
                          <tr key={staff.id}>
                            <td>
                              <strong>{staff.name}</strong>
                            </td>
                            <td>{staff.email}</td>
                            <td>
                              <span className={`role-badge ${staff.role}`}>
                                {staff.role}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`status-badge ${
                                  staff.is_active ? "active" : "inactive"
                                }`}
                              >
                                {staff.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td>
                              {new Date(staff.created_at).toLocaleDateString()}
                            </td>
                            <td>
                              <div className="action-buttons">
                                <button
                                  className="btn-icon"
                                  onClick={() => startEditStaff(staff)}
                                  title="Edit"
                                >
                                  <Edit3 size={16} />
                                </button>
                                <button
                                  className="btn-icon btn-danger"
                                  onClick={() => handleDeleteStaff(staff.id, false)}
                                  title="Deactivate"
                                  disabled={staff.email === staffInfo?.email}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ADMIN: AUDIT LOGS */}
          {view === "admin" && activeTab === "logs" && (
            <div className="card-panel">
              <h2>System Audit Logs</h2>
              {auditLogs.length > 0 ? (
                <div className="table-card">
                  <div className="table-wrap">
                    <table className="att-table">
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Action</th>
                          <th>Details</th>
                          <th>Status</th>
                          <th>Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log, idx) => (
                          <tr key={idx}>
                            <td>{new Date(log.created_at).toLocaleString()}</td>
                            <td>
                              <span
                                className={`action-badge ${log.action.toLowerCase()}`}
                              >
                                {log.action}
                              </span>
                            </td>
                            <td>{log.qr_data || "-"}</td>
                            <td>
                              <div className="status-indicators">
                                {log.qr_email_status && (
                                  <span className={`mini-badge ${log.qr_email_status}`}>
                                    📧 {log.qr_email_status}
                                  </span>
                                )}
                                {log.qr_whatsapp_status && (
                                  <span className={`mini-badge ${log.qr_whatsapp_status}`}>
                                    📱 {log.qr_whatsapp_status}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              {log.qr_last_error ? (
                                <span className="error-text" title={log.qr_last_error}>
                                  {log.qr_last_error.substring(0, 50)}...
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="center-block">
                  <div className="empty-card">
                    <ClipboardList size={32} color="var(--muted)" />
                    <p>No audit logs available</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Loading overlay */}
        {isLoading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
          </div>
        )}

        {/* Notification */}
        {notification && (
          <div className={`notification ${notification.type}`}>
            <div className="notification-inner">
              {notification.type === "success" ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <span className="notification-text">{notification.message}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default App;
