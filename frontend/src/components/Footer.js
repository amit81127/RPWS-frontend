import React from "react";
import { Link } from "react-router-dom";
import { FaFacebookF, FaTwitter, FaInstagram, FaLinkedinIn, FaPhoneAlt, FaEnvelope, FaMapMarkerAlt } from "react-icons/fa";

const Footer = () => {
  return (
    <footer className="footer-custom mt-auto">
      <div className="container">
        <div className="row g-4">
          {/* Brand Section */}
          <div className="col-lg-4 col-md-6">
            <div className="d-flex align-items-center gap-2 mb-3">
              <div
                className="d-inline-flex align-items-center gap-2 py-1 px-2 rounded-3"
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.18)",
                }}
              >
                <img 
                  src="/aitm-logo-cropped.png" 
                  alt="AITM Logo" 
                  style={{ height: "28px", width: "auto", objectFit: "contain" }} 
                />
                <span style={{ color: "var(--accent-gold, #ffc107)", fontWeight: "bold", fontSize: "0.95rem" }}>✕</span>
                <div style={{ background: "rgba(255, 255, 255, 0.95)", borderRadius: "6px", padding: "2px 5px", display: "flex", alignItems: "center" }}>
                  <img 
                    src="/sanganakshila-logo-cropped.png" 
                    alt="Sanganak Shila Logo" 
                    style={{ height: "24px", width: "auto", objectFit: "contain" }} 
                  />
                </div>
              </div>
            </div>
            <h5 className="fw-bold mb-1 text-white">AITM ✕ Sanganak Shila</h5>
            <p className="text-gold small mb-2 fw-semibold">ExpoVote Rating & Project Review Platform</p>
            <p className="text-white-50 small">
              The official platform for evaluating, rating, and celebrating innovative projects, technical events, and exhibitions at Axis Institute of Technology and Management in collaboration with Sanganak Shila.
            </p>
            <div className="d-flex gap-3 mt-3">
              <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="text-white social-icon-hover"><FaFacebookF /></a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter" className="text-white social-icon-hover"><FaTwitter /></a>
              <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="text-white social-icon-hover"><FaInstagram /></a>
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="text-white social-icon-hover"><FaLinkedinIn /></a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="col-lg-2 col-md-6">
            <h6 className="fw-bold text-gold mb-3">Quick Links</h6>
            <ul className="list-unstyled">
              <li className="mb-2"><Link className="text-white-50 text-decoration-none hover-white" to="/">Home</Link></li>
              <li className="mb-2"><Link className="text-white-50 text-decoration-none hover-white" to="/about">About Us</Link></li>
              <li className="mb-2"><Link className="text-white-50 text-decoration-none hover-white" to="/participants">Participants</Link></li>
              <li className="mb-2"><Link className="text-white-50 text-decoration-none hover-white" to="/contact">Contact</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div className="col-lg-2 col-md-6">
            <h6 className="fw-bold text-gold mb-3">Resources</h6>
            <ul className="list-unstyled">
              <li className="mb-2"><Link className="text-white-50 text-decoration-none hover-white" to="/admin/login">Admin Login</Link></li>
              <li className="mb-2"><Link className="text-white-50 text-decoration-none hover-white" to="/register">Student Registration</Link></li>
              <li className="mb-2"><span className="text-white-50">Privacy Policy</span></li>
              <li className="mb-2"><span className="text-white-50">Terms of Service</span></li>
            </ul>
          </div>

          {/* Contact Info */}
          <div className="col-lg-4 col-md-6">
            <h6 className="fw-bold text-gold mb-3">Contact Us</h6>
            <ul className="list-unstyled text-white-50">
              <li className="mb-3 d-flex gap-2">
                <FaMapMarkerAlt className="mt-1 text-gold" />
                <span>Angadi Institute of Technology and Management,<br />Savagaon Road, Belagavi, Karnataka 590009</span>
              </li>
              <li className="mb-3 d-flex gap-2">
                <FaPhoneAlt className="mt-1 text-gold" />
                <a href="tel:+911234567890" className="text-white-50 text-decoration-none hover-white">+91 831 243 8100</a>
              </li>
              <li className="mb-3 d-flex gap-2">
                <FaEnvelope className="mt-1 text-gold" />
                <a href="mailto:info@aitm.edu.in" className="text-white-50 text-decoration-none hover-white">info@aitm.edu.in</a>
              </li>
            </ul>
          </div>
        </div>

        <hr className="border-secondary my-4" />

        <div className="row align-items-center">
          <div className="col-md-6 text-center text-md-start">
            <p className="mb-0 text-white-50 small">&copy; {new Date().getFullYear()} AITM Rating System. All rights reserved.</p>
          </div>
          <div className="col-md-6 text-center text-md-end">
            <p className="mb-0 text-white-50 small">Designed & Developed by RPWS Team</p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
