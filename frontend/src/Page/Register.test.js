import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockAxiosPost = jest.fn();
jest.mock(
  "axios",
  () => ({
    __esModule: true,
    default: {
      post: (...args) => mockAxiosPost(...args),
      get: jest.fn(),
    },
    post: (...args) => mockAxiosPost(...args),
    get: jest.fn(),
  }),
  { virtual: true }
);

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ to, children }) => <a href={to}>{children}</a>,
  }),
  { virtual: true }
);

import Register from "./Register";

describe("Register Component - Project Name and Department Field Mapping", () => {
  beforeEach(() => {
    mockAxiosPost.mockClear();
    window.alert = jest.fn();
  });

  test("Renders distinct inputs for Project Name and Department", () => {
    render(<Register />);

    expect(screen.getByRole("textbox", { name: "Project Name" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Department" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Team Name" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Team Number" })).toBeInTheDocument();
  });

  test("Submits distinct projectName and department values in FormData without overwriting", async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        message: "Participant added",
        data: {
          _id: "mock123",
          name: "Team CyberShield",
          projectName: "Quantum Encryption Gateway",
          department: "Cyber Security",
          teamNo: 77,
        },
      },
    });

    render(<Register />);

    // Fill form fields
    fireEvent.change(screen.getByRole("textbox", { name: "Team Number" }), {
      target: { value: "77" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Team Name" }), {
      target: { value: "Team CyberShield" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Project Name" }), {
      target: { value: "Quantum Encryption Gateway" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Department" }), {
      target: { value: "Cyber Security" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Email Address" }), {
      target: { value: "cybershield@aitm.edu.in" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Project Description / Participation Details" }), {
      target: { value: "Post-quantum security gateway" },
    });

    // Submit form
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => {
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    });

    const [calledUrl, calledData] = mockAxiosPost.mock.calls[0];
    expect(calledUrl).toMatch(/\/addParticipants$/);
    expect(calledData).toBeInstanceOf(FormData);

    // Verify distinct field values in FormData
    expect(calledData.get("projectName")).toBe("Quantum Encryption Gateway");
    expect(calledData.get("department")).toBe("Cyber Security");
    expect(calledData.get("projectName")).not.toBe(calledData.get("department"));
    expect(calledData.get("name")).toBe("Team CyberShield");
    expect(calledData.get("teamNo")).toBe("77");
  });
});
