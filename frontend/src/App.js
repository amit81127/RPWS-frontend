import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { SWRConfig } from "swr";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import HomePage from "./Page/HomePage";
import Participants from "./Page/ParticipantsPage";
import Winner from "./Page/WinnerPage";
import Contact from "./Page/Contact";
import Register from "./Page/Register";
import Signup from "./Page/Signup";
import Login from "./Page/Login";
import AdminLogin from "./Page/AdminLogin";
import AdminSignup from "./Page/AdminSignup";
import { AuthProvider } from "./components/AuthContext";
import PrivateRoute from "./components/PrivateRoute";
import AdminPanel from "./Page/AdminPanel";
import About from "./Page/AboutPage";

const App = () => {
  return (
    <SWRConfig
      value={{
        dedupingInterval: 4000,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        shouldRetryOnError: false,
      }}
    >
      <AuthProvider>
        <Router>
          <Navbar />
          <div style={{ minHeight: "80vh" }}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/signup" element={<AdminSignup />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/about" element={<About />} />
            <Route path="/participants" element={<Participants />} />
            <Route
              path="/register"
              element={
                <PrivateRoute>
                  <Register />
                </PrivateRoute>
              }
            />

            {/* Admin only */}
            <Route
              path="/winners"
              element={
                <PrivateRoute adminOnly={true}>
                  <Winner />
                </PrivateRoute>
              }
            />
            <Route
              path="/winner"
              element={
                <PrivateRoute adminOnly={true}>
                  <Navigate to="/winners" replace />
                </PrivateRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <PrivateRoute adminOnly={true}>
                  <AdminPanel />
                </PrivateRoute>
              }
            />

            {/* Fallback */}
            <Route path="*" element={<HomePage />} />
          </Routes>
        </div>
        <Footer />
      </Router>
    </AuthProvider>
  </SWRConfig>
);
};

export default App;
