import React, { useState, useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { AuthContext } from "../components/AuthContext";
import API_URL from "../api";

const Signup = () => {
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);
  const [formData, setFormData] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const validateForm = () => {
    if (!formData.name.trim()) {
      toast.error("Full name is required");
      return false;
    }
    let email = formData.email.trim().toLowerCase();
    if (!email.includes("@")) {
      email = `${email}@axiscolleges.in`;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Please enter a valid college email format (e.g. 2023bcs108@axiscolleges.in)");
      return false;
    }
    if (formData.password.length < 6) {
      toast.error("Password must be at least 6 characters long");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    let email = formData.email.trim().toLowerCase();
    if (!email.includes("@")) {
      email = `${email}@axiscolleges.in`;
    }

    setLoading(true);
    try {
      const payload = {
        name: formData.name.trim(),
        email,
        password: formData.password,
      };
      const { data } = await axios.post(`${API_URL}/signup`, payload);
      login(data.token);
      toast.success("Account created successfully! Welcome to ExpoVote.");
      setTimeout(() => navigate("/participants"), 1000);
    } catch (err) {
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Registration failed. Please try again.";
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
              backgroundColor: "var(--accent-gold, #FFD700)",
              color: "var(--primary-blue, #003366)",
              fontSize: "28px",
              boxShadow: "0 4px 10px rgba(255, 215, 0, 0.3)",
            }}
          >
            ✨
          </div>
          <h2 className="fw-bold mb-1" style={{ color: "var(--primary-blue, #003366)" }}>
            Student Sign Up
          </h2>
          <p className="text-muted small mb-0">
            Create an account to participate and vote in the exhibition
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label fw-semibold small text-secondary">
              Full Name
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              placeholder="e.g. Alex Johnson"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="name"
              required
            />
          </div>

          <div className="mb-3">
            <label className="form-label fw-semibold small text-secondary">
              College Email / Roll ID
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
              placeholder="At least 6 characters"
              className="form-control form-control-lg fs-6"
              onChange={handleChange}
              autoComplete="new-password"
              required
            />
            <small className="form-text text-muted">
              Must be at least 6 characters long
            </small>
          </div>

          <button
            type="submit"
            className="btn btn-gold-custom w-100 py-2 fs-6 shadow-sm"
            style={{
              borderRadius: "8px",
            }}
            disabled={loading}
          >
            {loading ? (
              <span className="d-flex align-items-center justify-content-center gap-2">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Creating account...
              </span>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        <div className="text-center mt-4 pt-2 border-top">
          <p className="mb-0 text-muted small">
            Already have an account?{" "}
            <Link
              to="/login"
              className="fw-bold"
              style={{ color: "var(--primary-blue, #003366)", textDecoration: "none" }}
            >
              Sign In
            </Link>
          </p>
          <div className="mt-2">
            <Link
              to="/admin/signup"
              className="text-secondary small text-decoration-none"
              style={{ fontSize: "0.82rem" }}
            >
              🛡️ Event Organizer or Faculty? Sign Up as Admin &rarr;
            </Link>
          </div>
        </div>
      </div>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
};

export default Signup;
