import React, { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import { AuthContext } from "../components/AuthContext";
import "react-toastify/dist/ReactToastify.css";
import API_URL from "../api";

const AdminSignup = () => {
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    adminKey: "",
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const validateForm = () => {
    if (!formData.name.trim()) {
      toast.error("Administrator name is required.");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email.trim() || !emailRegex.test(formData.email.trim())) {
      toast.error("Please enter a valid administrator email address.");
      return false;
    }
    if (formData.password.length < 6) {
      toast.error("Password must be at least 6 characters long.");
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      toast.error("Passwords do not match. Please verify.");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    try {
      const payload = {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        adminKey: formData.adminKey.trim(),
      };

      const { data } = await axios.post(`${API_URL}/admin/signup`, payload);

      if (data.token) {
        login(data.token);
      }

      toast.success(data.message || "Administrator account created successfully!");

      setTimeout(() => {
        navigate("/admin");
      }, 900);
    } catch (err) {
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Registration failed. Please check your credentials and try again.";
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
          maxWidth: "480px",
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
            Admin Registration
          </h2>
          <p className="text-muted small mb-0">
            Create an Administrator Account for ExpoVote
          </p>
        </div>

        {/* Security badge notice */}
        <div
          className="alert alert-info py-2 px-3 mb-4 small d-flex align-items-start gap-2"
          style={{
            backgroundColor: "rgba(0, 51, 102, 0.08)",
            borderColor: "rgba(0, 51, 102, 0.2)",
            color: "#003366",
            borderRadius: "8px",
          }}
        >
          <span style={{ fontSize: "16px" }}>⚡</span>
          <div>
            <strong>Administrator Access:</strong> Provides governance control over voting windows, participant records, and live leaderboards.
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label fw-semibold small text-secondary">
              Administrator Full Name
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              placeholder="e.g. Dr. Ramesh Kumar"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="name"
              required
            />
          </div>

          <div className="mb-3">
            <label className="form-label fw-semibold small text-secondary">
              Official Email Address
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

          <div className="mb-3">
            <label className="form-label fw-semibold small text-secondary">
              Password
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              placeholder="Minimum 6 characters"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="mb-3">
            <label className="form-label fw-semibold small text-secondary">
              Confirm Password
            </label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              placeholder="Re-type password"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="mb-4">
            <div className="d-flex justify-content-between align-items-center mb-1">
              <label className="form-label fw-semibold small text-secondary mb-0">
                Security Passcode
              </label>
              <span className="text-muted small" style={{ fontSize: "0.75rem" }}>
                (Optional / If configured)
              </span>
            </div>
            <input
              type="password"
              name="adminKey"
              value={formData.adminKey}
              placeholder="Leave blank unless passcode is required"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="off"
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
                Registering Administrator...
              </span>
            ) : (
              "Create Admin Account"
            )}
          </button>
        </form>

        <div className="text-center mt-4 pt-3 border-top">
          <p className="mb-1 text-muted small">
            Already have an administrator account?{" "}
            <Link
              to="/admin/login"
              className="fw-bold"
              style={{ color: "#003366", textDecoration: "none" }}
            >
              Sign In Here
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

export default AdminSignup;
