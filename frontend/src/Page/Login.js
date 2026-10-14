import React, { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import { jwtDecode } from "jwt-decode";
import { AuthContext } from "../components/AuthContext";
import "react-toastify/dist/ReactToastify.css";
import API_URL from "../api";

const Login = () => {
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email.trim() || !formData.password) {
      toast.error("Please enter both username/email and password.");
      return;
    }

    let email = formData.email.trim().toLowerCase();
    // Automatically append college domain if student enters roll number directly
    if (!email.includes("@")) {
      email = `${email}@axiscolleges.in`;
    }

    setLoading(true);
    try {
      const { data } = await axios.post(`${API_URL}/login`, {
        email,
        password: formData.password,
      });

      login(data.token);
      toast.success("Login successful! Welcome back.");

      let role = "student";
      try {
        const decoded = jwtDecode(data.token);
        role = decoded.role || "student";
      } catch (_) {}

      setTimeout(() => {
        if (role === "admin") {
          navigate("/admin");
        } else {
          navigate("/participants");
        }
      }, 800);
    } catch (err) {
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Login failed. Please check your credentials.";
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="d-flex align-items-center justify-content-center py-5"
      style={{
        minHeight: "85vh",
        background: "linear-gradient(135deg, rgba(0, 51, 102, 0.05) 0%, rgba(255, 215, 0, 0.05) 100%)",
      }}
    >
      <div
        className="card shadow-lg p-4 p-md-5"
        style={{
          width: "100%",
          maxWidth: "440px",
          borderRadius: "16px",
          border: "1px solid rgba(0, 51, 102, 0.1)",
        }}
      >
        <div className="text-center mb-4">
          <div
            className="d-inline-flex align-items-center justify-content-center mb-3"
            style={{
              width: "60px",
              height: "60px",
              borderRadius: "50%",
              backgroundColor: "var(--primary-blue, #003366)",
              color: "#FFD700",
              fontSize: "28px",
              boxShadow: "0 4px 10px rgba(0, 51, 102, 0.2)",
            }}
          >
            🎓
          </div>
          <h2 className="fw-bold mb-1" style={{ color: "var(--primary-blue, #003366)" }}>
            Student Login
          </h2>
          <p className="text-muted small mb-0">
            Sign in to vote for projects and explore participants
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label fw-semibold small text-secondary">
              College Email / Username
            </label>
            <input
              type="text"
              name="email"
              value={formData.email}
              placeholder="e.g. 2023bcs108@axiscolleges.in"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="username"
              required
            />
            <small className="text-muted d-block mt-1" style={{ fontSize: "0.8rem" }}>
              Format: <strong>2023bcs108@axiscolleges.in</strong> (or enter your Roll ID)
            </small>
          </div>

          <div className="mb-4">
            <label className="form-label fw-semibold small text-secondary">
              Password
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              placeholder="Enter your password"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary-custom w-100 py-2 fs-6 shadow-sm"
            style={{
              backgroundColor: "var(--primary-blue, #003366)",
              color: "#fff",
              borderRadius: "8px",
            }}
            disabled={loading}
          >
            {loading ? (
              <span className="d-flex align-items-center justify-content-center gap-2">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Signing in...
              </span>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <div className="text-center mt-4 pt-2 border-top">
          <p className="mb-0 text-muted small">
            Don't have a student account?{" "}
            <Link
              to="/signup"
              className="fw-bold"
              style={{ color: "var(--primary-blue, #003366)", textDecoration: "none" }}
            >
              Sign Up
            </Link>
          </p>
          <div className="mt-2">
            <Link
              to="/admin/login"
              className="text-secondary small text-decoration-none"
              style={{ fontSize: "0.82rem" }}
            >
              🛡️ Authorized Administrator Login &rarr;
            </Link>
          </div>
        </div>
      </div>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
};

export default Login;
