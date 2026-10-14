import React, { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import { jwtDecode } from "jwt-decode";
import { AuthContext } from "../components/AuthContext";
import "react-toastify/dist/ReactToastify.css";
import API_URL from "../api";

const AdminLogin = () => {
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email.trim() || !formData.password) {
      toast.error("Please enter your administrator email and password.");
      return;
    }

    setLoading(true);
    try {
      const { data } = await axios.post(`${API_URL}/login`, {
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
      });

      // Strict client-side verification of administrator role
      let role = "student";
      try {
        const decoded = jwtDecode(data.token);
        role = decoded.role || "student";
      } catch (_) {}

      if (role !== "admin") {
        toast.error("Access Denied: You do not have administrator privileges. Please use the Student Login.");
        setLoading(false);
        return;
      }

      login(data.token);
      toast.success("Administrator authentication verified! Accessing dashboard...");

      setTimeout(() => {
        navigate("/admin");
      }, 700);
    } catch (err) {
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Invalid administrator credentials.";
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="d-flex align-items-center justify-content-center py-5"
      style={{
        minHeight: "88vh",
        background: "linear-gradient(135deg, #0b192c 0%, #1e3e62 100%)",
        color: "#fff",
      }}
    >
      <div
        className="card shadow-lg p-4 p-md-5"
        style={{
          width: "100%",
          maxWidth: "460px",
          borderRadius: "16px",
          backgroundColor: "#ffffff",
          color: "#1e293b",
          border: "1px solid rgba(255, 255, 255, 0.2)",
        }}
      >
        <div className="text-center mb-4">
          <div
            className="d-inline-flex align-items-center justify-content-center mb-3"
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              backgroundColor: "#003366",
              color: "#FFD700",
              fontSize: "30px",
              boxShadow: "0 4px 12px rgba(0, 51, 102, 0.3)",
            }}
          >
            🛡️
          </div>
          <h2 className="fw-bold mb-1" style={{ color: "#003366" }}>
            Administrator Login
          </h2>
          <p className="text-muted small mb-0">
            Secure Portal for Authorized Organizers & Faculty
          </p>
        </div>

        {/* Security Notice with Signup Link */}
        <div
          className="alert alert-info py-2 px-3 mb-4 small d-flex align-items-start gap-2"
          style={{
            backgroundColor: "rgba(0, 51, 102, 0.08)",
            borderColor: "rgba(0, 51, 102, 0.2)",
            color: "#003366",
            borderRadius: "8px",
          }}
        >
          <span style={{ fontSize: "16px" }}>🔒</span>
          <div>
            <strong>Authorized Personnel:</strong> Enter your administrator credentials below or{" "}
            <Link
              to="/admin/signup"
              className="fw-bold"
              style={{ color: "#003366", textDecoration: "underline" }}
            >
              Sign Up as Administrator &rarr;
            </Link>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label fw-semibold small text-secondary">
              Administrator Email
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              placeholder="admin@aitm.edu"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="email"
              required
            />
          </div>

          <div className="mb-4">
            <label className="form-label fw-semibold small text-secondary">
              Password
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              placeholder="Enter admin password"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn w-100 py-2 fs-6 shadow-sm fw-bold"
            style={{
              backgroundColor: "#003366",
              color: "#FFD700",
              borderRadius: "8px",
              border: "none",
            }}
            disabled={loading}
          >
            {loading ? (
              <span className="d-flex align-items-center justify-content-center gap-2">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Verifying Credentials...
              </span>
            ) : (
              "Sign In to Admin Dashboard"
            )}
          </button>
        </form>

        <div className="text-center mt-4 pt-3 border-top">
          <p className="mb-1 text-muted small">
            Need an administrator account?{" "}
            <Link
              to="/admin/signup"
              className="fw-bold"
              style={{ color: "#003366", textDecoration: "none" }}
            >
              Sign Up as Admin
            </Link>
          </p>
          <div className="mt-2">
            <Link
              to="/login"
              className="text-secondary small text-decoration-none"
              style={{ fontSize: "0.82rem" }}
            >
              Student Portal &rarr;
            </Link>
          </div>
        </div>
      </div>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
};

export default AdminLogin;
