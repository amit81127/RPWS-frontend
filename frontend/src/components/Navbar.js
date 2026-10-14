import React, { useContext, useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthContext } from "./AuthContext";
import { jwtDecode } from "jwt-decode";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";

const Navbar = () => {
  const { token, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef();

  let userRole = null;
  if (token) {
    try {
      const decoded = jwtDecode(token);
      userRole = decoded.role;
    } catch (e) {
      userRole = null;
    }
  }

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <nav className="navbar navbar-expand-lg navbar-custom sticky-top">
      <div className="container">
        {/* Brand Section */}
        <Link
          className="navbar-brand d-flex align-items-center gap-3"
          to="/"
          style={{ textDecoration: "none" }}
        >
          <img
            src="axislogo-removebg-preview.png"
            alt="AITM Logo"
            className="aitm-logo"
            style={{
              width: "50px",
              height: "50px",
              borderRadius: "50%",
              objectFit: "contain",
              background: "white",
              padding: "2px",
              border: "2px solid var(--accent-gold)",
            }}
          />
          <div className="d-flex flex-column">
            <span className="fw-bold fs-5 text-white" style={{ letterSpacing: "1px" }}>
              AITM
            </span>
            <span className="fs-6 text-gold" style={{ fontSize: "0.8rem", fontWeight: "500" }}>
              Rating System
            </span>
          </div>
        </Link>

        {/* Toggle Button */}
        <button
          className="navbar-toggler border-0"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navbarNav"
          aria-controls="navbarNav"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon"></span>
        </button>

        {/* Navbar Links */}
        <div className="collapse navbar-collapse" id="navbarNav">
          <ul className="navbar-nav ms-auto align-items-center gap-3">
            {/* Navigation Links */}
            <li className="nav-item">
              <Link className="nav-link" to="/">
                Home
              </Link>
            </li>

            <li className="nav-item">
              <Link className="nav-link" to="/about">
                About
              </Link>
            </li>

            <li className="nav-item">
              <Link className="nav-link" to="/participants">
                Participants
              </Link>
            </li>

            <li className="nav-item">
              <Link className="nav-link" to="/winners">
                Winners
              </Link>
            </li>

            <li className="nav-item">
              <Link className="nav-link" to="/contact">
                Contact
              </Link>
            </li>

            {/* Unauthenticated: Login & Sign Up buttons */}
            {!token && (
              <>
                <li className="nav-item">
                  <Link className="btn btn-outline-light btn-sm px-3" to="/login">
                    Login
                  </Link>
                </li>
                <li className="nav-item">
                  <Link className="btn btn-gold-custom btn-sm px-3" to="/signup">
                    Sign Up
                  </Link>
                </li>
              </>
            )}

            {/* Authenticated Admin Dropdown */}
            {token && userRole === "admin" && (
              <li className="nav-item dropdown" ref={dropdownRef}>
                <button
                  type="button"
                  aria-label="Admin Menu"
                  className="btn btn-gold-custom btn-sm rounded-circle d-flex align-items-center justify-content-center"
                  style={{
                    width: "35px",
                    height: "35px",
                    fontWeight: "bold",
                  }}
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  A
                </button>

                {dropdownOpen && (
                  <ul
                    className="dropdown-menu dropdown-menu-end show mt-2 shadow border-0"
                    style={{
                      borderRadius: "8px",
                      position: "absolute",
                      right: 0,
                      minWidth: "150px",
                    }}
                  >
                    <li>
                      <button
                        type="button"
                        className="dropdown-item"
                        onClick={() => {
                          navigate("/admin");
                          setDropdownOpen(false);
                        }}
                      >
                        Admin Panel
                      </button>
                    </li>
                    <li>
                      <hr className="dropdown-divider" />
                    </li>
                    <li>
                      <button
                        type="button"
                        className="dropdown-item text-danger"
                        onClick={handleLogout}
                      >
                        Logout
                      </button>
                    </li>
                  </ul>
                )}
              </li>
            )}

            {/* Authenticated Student / Non-Admin Logout */}
            {token && userRole !== "admin" && (
              <li className="nav-item">
                <button
                  type="button"
                  className="btn btn-outline-light btn-sm px-3"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
