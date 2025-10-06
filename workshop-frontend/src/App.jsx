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
  Eye,
  Settings,
  Shield,
  Activity,
  Mail,
  Phone,
  Calendar,
  TrendingUp,
} from "lucide-react";
import "./App.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const App = () => {
  // Auth state
  const [view, setView] = useState("home");
  const [loginType, setLoginType] = useState(null);
  const [role, setRole] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("token") || null);
  const [staffInfo, setStaffInfo] = useState(
    JSON.parse(localStorage.getItem("staffInfo") || "null")
  );

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // UI state
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  // Dashboard state
  const [dashboardData, setDashboardData] = useState(null);
  const [adminDashboard, setAdminDashboard] = useState(null);

  // Registration form
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    mobile: "",
    batch: "",
  });

  // CSV state
  const [csvFile, setCsvFile] = useState(null);
  const [csvPreview, setCsvPreview] = useState([]);

  // Scanner state
  const [scannerActive, setScannerActive] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const scannerRef = useRef(null);

  // Admin state
  const [staffList, setStaffList] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [staffFormData, setStaffFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "staff"
  });

  // Auto-login check
  useEffect(() => {
    console.log("Checking auto-login:", { token, staffInfo });
    if (token && staffInfo) {
      setRole(staffInfo.role);
      setView(staffInfo.role === "admin" ? "admin" : "staff");
    }
  }, []);

  // Helpers
  const showNotification = (message, type = "success") => {
    console.log("Notification:", message, type);
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const apiCall = async (endpoint, options = {}) => {
    // FIXED: Use token directly without modification
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };
    
    console.log(`API Call: ${API_BASE_URL}/api${endpoint}`, { 
      token: token?.substring(0, 20) + "...", 
      endpoint,
      method: options.method || "GET"
    });
    
    const resp = await fetch(`${API_BASE_URL}/api${endpoint}`, {
      ...options,
      headers,
    });
    
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`API Error: ${resp.status} ${text}`);
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    
    const ct = resp.headers.get("content-type") || "";
    return ct.includes("application/json") ? resp.json() : null;
  };

  // Dashboard
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

  // ---- LOGIN ----
  const handleLogin = async (email, password) => {
    console.log("Login attempt:", { email, loginType });
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/staff/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error("Login error response:", errorText);
        throw new Error(`Login failed: ${errorText}`);
      }
      
      const data = await res.json();
      console.log("Login success:", data);
      
      setToken(data.token);
      setRole(data.role);
      setStaffInfo(data);
      localStorage.setItem("token", data.token);
      localStorage.setItem("staffInfo", JSON.stringify(data));
      
      // Check if user role matches the intended login type
      if (loginType === "admin" && data.role !== "admin") {
        throw new Error("You don't have admin privileges. Please use Staff Login.");
      }
      
      setView(data.role === "admin" ? "admin" : "staff");
      showNotification(`Welcome ${data.name}! Logged in as ${data.role}`);
      setLoginEmail("");
      setLoginPassword("");
      
    } catch (err) {
      console.error("Login error:", err);
      showNotification(err.message || "Login failed. Please check your credentials.", "error");
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

  // ---- Registration ----
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

  // ---- CSV Upload ----
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

  // ---- QR Scanner ----
  const startScanner = async () => {
    setScannerActive(true);
    setTimeout(async () => {
      try {
        const mod = await import("html5-qrcode");
        const Html5QrcodeScanner = mod.Html5QrcodeScanner;
        const scanner = new Html5QrcodeScanner("qr-reader", { 
          fps: 10, 
          qrbox: 250,
          rememberLastUsedCamera: true
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
              showNotification("Invalid QR code or already scanned", "error");
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

  // ---- ADMIN FUNCTIONS ----
  const loadStaffList = async () => {
    console.log("Loading staff list...");
    try {
      setIsLoading(true);
      const data = await apiCall("/admin/staff");
      console.log("Staff list loaded:", data);
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

  const handleExportAttendees = async () => {
    console.log("Exporting attendees to Excel...");
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/export-attendees`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

      // Get the blob from response
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get("Content-Disposition");
      const filename = contentDisposition
        ? contentDisposition.split("filename=")[1].replace(/"/g, "")
        : `attendees_report_${new Date().toISOString().split('T')[0]}.xlsx`;
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      showNotification("Attendees report downloaded successfully!");
    } catch (err) {
      console.error("Export error:", err);
      showNotification(`Failed to export attendees: ${err.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    console.log("Effect triggered:", { view, activeTab });
    if (view === "admin") {
      if (activeTab === "staff") {
        console.log("Loading staff list from effect...");
        loadStaffList();
      }
      if (activeTab === "logs") loadAuditLogs();
    }
  }, [activeTab, view]);

  const handleStaffFormChange = (field, value) => {
    setStaffFormData(prev => ({ ...prev, [field]: value }));
  };

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
    
    console.log("Creating staff with data:", { name, email, role });
    setIsLoading(true);
    
    try {
      const result = await apiCall("/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      
      console.log("Staff creation result:", result);
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
    if (!confirm(`Are you sure you want to ${permanent ? 'permanently delete' : 'deactivate'} this staff member?`)) return;
    
    console.log("Deleting staff:", staffId);
    setIsLoading(true);
    
    try {
      await apiCall(`/admin/staff/${staffId}?permanent=${permanent}`, {
        method: "DELETE",
      });
      showNotification(`Staff member ${permanent ? 'deleted' : 'deactivated'} successfully!`);
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
      role: staff.role
    });
    setShowStaffForm(true);
  };

  // ---- RENDER ----
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
                onKeyPress={(e) => e.key === 'Enter' && handleLogin(loginEmail, loginPassword)}
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
                  console.log("Going back to home");
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
            { id: "register", label: "Register", icon: UserPlus },
            { id: "upload", label: "Bulk Upload", icon: Upload },
            { id: "scanner", label: "Scanner", icon: Camera },
          ];

    return (
      <div className="app-root">
        <header className="app-header">
          <div className="container flex-between">
            <h1 className="brand">Workshop Attendance</h1>
            <div className="flex-between" style={{gap: '12px'}}>
              <span className="muted">{staffInfo?.name} ({staffInfo?.role})</span>
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
                  onClick={() => {
                    console.log("Tab clicked:", tab.id);
                    setActiveTab(tab.id);
                  }}
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
                        <p className="big">{adminDashboard.staff_stats.total_staff}</p>
                        <p className="muted">Total Staff</p>
                        <p className="muted-light">{adminDashboard.staff_stats.active_staff} active</p>
                      </div>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-left">
                      <div className="icon-wrap icon-green">
                        <TrendingUp />
                      </div>
                      <div>
                        <p className="big">{adminDashboard.communication_stats.email_sent}</p>
                        <p className="muted">Emails Sent</p>
                        <p className="muted-light">{adminDashboard.communication_stats.whatsapp_sent} WhatsApp</p>
                      </div>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-left">
                      <div className="icon-wrap icon-purple">
                        <Activity />
                      </div>
                      <div>
                        <p className="big">{adminDashboard.attendee_stats.attendance_rate}%</p>
                        <p className="muted">Attendance Rate</p>
                        <p className="muted-light">{adminDashboard.attendee_stats.total_attended}/{adminDashboard.attendee_stats.total_registered}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Regular Dashboard */}
              {dashboardData && (
                <div>
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
                  
                  {/* Export Button for Admin */}
                  {view === "admin" && dashboardData.total_attendees > 0 && (
                    <div style={{marginBottom: '16px', textAlign: 'right'}}>
                      <button 
                        className="btn-primary"
                        onClick={handleExportAttendees}
                        disabled={isLoading}
                        style={{display: 'inline-flex', alignItems: 'center', gap: '8px'}}
                      >
                        <Upload size={16} />
                        {isLoading ? "Exporting..." : "Export Attendees to Excel"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Batch-wise Table */}
              {dashboardData?.batch_wise_data && dashboardData.batch_wise_data.length > 0 && (
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
                            <td><strong>{batch.batch}</strong></td>
                            <td>{batch.total_registered}</td>
                            <td>{batch.total_attended}</td>
                            <td>
                              {batch.total_registered > 0 
                                ? Math.round((batch.total_attended / batch.total_registered) * 100) 
                                : 0}%
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

          {/* REGISTER - Only for Staff */}
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

          {/* BULK UPLOAD - Only for Staff */}
          {view === "staff" && activeTab === "upload" && (
            <div className="card-panel">
              <h2>Bulk Upload Attendees</h2>
              <div className="info-box">
                <div className="info-left">
                  <AlertCircle />
                </div>
                <div>
                  <p><strong>CSV Format Required:</strong></p>
                  <p>Columns: name, email, mobile, batch (exact headers, lowercase)</p>
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
                      <button className="btn-secondary" onClick={() => {
                        setCsvFile(null);
                        setCsvPreview([]);
                      }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* QR SCANNER - Only for Staff */}
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
                <div className="success-card card" style={{marginTop: '16px'}}>
                  <div className="success-head">
                    <CheckCircle2 size={20} style={{color: 'var(--accent-green)'}} />
                    <strong>Last Successful Scan</strong>
                  </div>
                  <div className="last-scan">
                    <p><strong>Name:</strong> {lastScan.name}</p>
                    <p><strong>Batch:</strong> {lastScan.batch}</p>
                    <p><strong>Time:</strong> {new Date(lastScan.entry_time).toLocaleString()}</p>
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
                    onClick={() => {
                      console.log("Add Staff button clicked");
                      setShowStaffForm(true);
                    }}
                  >
                    <Plus className="icon" />
                    Add New Staff
                  </button>
                </div>

                {/* Create/Edit Staff Form */}
                {showStaffForm && (
                  <div className="form" style={{marginTop: '16px', padding: '20px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0'}}>
                    <h4 style={{margin: '0 0 16px 0', color: '#1e293b'}}>
                      {editingStaff ? "Edit Staff Member" : "Create New Staff Member"}
                    </h4>
                    
                    <div>
                      <label>Full Name *</label>
                      <input
                        type="text"
                        placeholder="Enter full name"
                        value={staffFormData.name}
                        onChange={(e) => handleStaffFormChange("name", e.target.value)}
                        required
                      />
                    </div>
                    
                    <div>
                      <label>Email Address *</label>
                      <input
                        type="email"
                        placeholder="Enter email address"
                        value={staffFormData.email}
                        onChange={(e) => handleStaffFormChange("email", e.target.value)}
                        required
                      />
                    </div>
                    
                    <div>
                      <label>Password {editingStaff ? "(leave blank to keep current)" : "*"}</label>
                      <input
                        type="password"
                        placeholder={editingStaff ? "Enter new password (optional)" : "Enter password"}
                        value={staffFormData.password}
                        onChange={(e) => handleStaffFormChange("password", e.target.value)}
                        required={!editingStaff}
                      />
                    </div>
                    
                    <div>
                      <label>Role *</label>
                      <select
                        value={staffFormData.role}
                        onChange={(e) => handleStaffFormChange("role", e.target.value)}
                        required
                      >
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    
                    <div className="form-actions">
                      <button 
                        className="btn-primary"
                        onClick={() => {
                          console.log("Form submit clicked", { editingStaff, staffFormData });
                          editingStaff ? handleUpdateStaff() : handleCreateStaff();
                        }}
                        disabled={isLoading || !staffFormData.name || !staffFormData.email || (!editingStaff && !staffFormData.password)}
                      >
                        {isLoading ? "Saving..." : (editingStaff ? "Update Staff Member" : "Create Staff Member")}
                      </button>
                      <button 
                        className="btn-secondary" 
                        onClick={() => {
                          console.log("Cancel clicked");
                          resetStaffForm();
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Staff List Table */}
              <div className="table-card">
                <div className="table-head">
                  <div className="flex-between">
                    <h3 style={{ margin: 0 }}>All Staff Members</h3>
                    <span className="muted">{staffList.length} total staff</span>
                  </div>
                </div>
                <div className="table-wrap">
                  {staffList.length > 0 ? (
                    <table className="att-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Created Date</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffList.map((staff) => (
                          <tr key={staff.id}>
                            <td>
                              <div>
                                <strong>{staff.name}</strong>
                                {staff.id === staffInfo?.staff_id && (
                                  <span style={{color: 'var(--accent-blue)', fontSize: '12px'}}> (You)</span>
                                )}
                              </div>
                            </td>
                            <td>{staff.email}</td>
                            <td>
                              <span className={`role-badge ${staff.role}`}>
                                {staff.role.toUpperCase()}
                              </span>
                            </td>
                            <td>
                              <span className={`status-badge ${staff.is_active ? 'active' : 'inactive'}`}>
                                {staff.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td>{new Date(staff.created_at).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}</td>
                            <td>
                              <div className="action-buttons">
                                <button
                                  className="btn-icon"
                                  onClick={() => {
                                    console.log("Edit staff clicked", staff);
                                    startEditStaff(staff);
                                  }}
                                  title="Edit Staff Member"
                                >
                                  <Edit3 size={16} />
                                </button>
                                <button
                                  className="btn-icon btn-danger"
                                  onClick={() => {
                                    console.log("Delete staff clicked", staff.id);
                                    handleDeleteStaff(staff.id, false);
                                  }}
                                  title="Deactivate Staff Member"
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
                  ) : (
                    <div className="center-block">
                      <div className="empty-card" style={{margin: '20px'}}>
                        <Users size={32} color="var(--muted)" />
                        <p>No staff members found</p>
                        <p className="muted">Click "Add New Staff" to create the first staff member</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
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
                              <span className={`action-badge ${log.action.toLowerCase()}`}>
                                {log.action}
                              </span>
                            </td>
                            <td>{log.qr_data || '-'}</td>
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
                            <td>{log.qr_last_error ? (
                              <span className="error-text" title={log.qr_last_error}>
                                {log.qr_last_error.substring(0, 50)}...
                              </span>
                            ) : '-'}</td>
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
              {notification.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
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