import React, { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "./AuthContext";
import { jwtDecode } from "jwt-decode";

const PrivateRoute = ({ children, adminOnly = false }) => {
  const { token } = useContext(AuthContext);
  if (!token) return <Navigate to={adminOnly ? "/admin/login" : "/login"} replace />;

  if (adminOnly) {
    try {
      const decoded = jwtDecode(token);
      if (decoded.role !== "admin") {
        return <Navigate to="/admin/login" replace />;
      }
    } catch (err) {
      return <Navigate to="/admin/login" replace />;
    }
  }

  return children;
};

export default PrivateRoute;
