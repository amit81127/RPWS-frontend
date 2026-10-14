import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import Navbar from "./Navbar";
import { AuthContext } from "./AuthContext";

const mockNavigate = jest.fn();
jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ to, children, className, style }) => (
      <a href={to} className={className} style={style}>
        {children}
      </a>
    ),
    useNavigate: () => mockNavigate,
  }),
  { virtual: true }
);

// Helper to create mock JWT tokens readable by jwtDecode
function createMockJwt(payload) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.mockSignature`;
}

describe("Navbar Authentication & Navigation", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  const studentToken = createMockJwt({
    id: "60d0fe4f5311236168a109ca",
    email: "student@aitm.edu.in",
    role: "student",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const adminToken = createMockJwt({
    id: "60d0fe4f5311236168a109cb",
    email: "admin@aitm.edu.in",
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  test("Renders public navigation links and Login/Signup buttons when unauthenticated", () => {
    render(
      <AuthContext.Provider value={{ token: "", logout: jest.fn() }}>
        <Navbar />
      </AuthContext.Provider>
    );

    // Public links
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByText("Participants")).toBeInTheDocument();
    expect(screen.getByText("Winners")).toBeInTheDocument();
    expect(screen.getByText("Contact")).toBeInTheDocument();

    // Auth buttons
    const loginLink = screen.getByRole("link", { name: "Login" });
    expect(loginLink).toBeInTheDocument();
    expect(loginLink).toHaveAttribute("href", "/login");

    const signupLink = screen.getByRole("link", { name: "Sign Up" });
    expect(signupLink).toBeInTheDocument();
    expect(signupLink).toHaveAttribute("href", "/signup");

    // No logout button when unauthenticated
    expect(screen.queryByText("Logout")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Admin Menu")).not.toBeInTheDocument();
  });

  test("Renders Logout button and hides Login/Signup when authenticated as student", () => {
    const mockLogout = jest.fn();

    render(
      <AuthContext.Provider value={{ token: studentToken, logout: mockLogout }}>
        <Navbar />
      </AuthContext.Provider>
    );

    // Login/Signup must not be visible
    expect(screen.queryByRole("link", { name: "Login" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign Up" })).not.toBeInTheDocument();

    // Logout button is present
    const logoutBtn = screen.getByRole("button", { name: "Logout" });
    expect(logoutBtn).toBeInTheDocument();

    // Clicking logout invokes the logout function and navigates to /login
    fireEvent.click(logoutBtn);
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  test("Renders Admin avatar and dropdown when authenticated as admin", () => {
    const mockLogout = jest.fn();

    render(
      <AuthContext.Provider value={{ token: adminToken, logout: mockLogout }}>
        <Navbar />
      </AuthContext.Provider>
    );

    // Admin trigger button
    const adminAvatar = screen.getByLabelText("Admin Menu");
    expect(adminAvatar).toBeInTheDocument();

    // Click to open dropdown
    fireEvent.click(adminAvatar);

    // Dropdown contains Admin Panel and Logout
    expect(screen.getByText("Admin Panel")).toBeInTheDocument();
    const dropdownLogout = screen.getByText("Logout");
    expect(dropdownLogout).toBeInTheDocument();

    fireEvent.click(dropdownLogout);
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });
});
