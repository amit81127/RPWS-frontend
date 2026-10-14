import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

let mockSwrState = {
  data: null,
  error: null,
  size: 1,
  setSize: jest.fn(),
  isLoading: false,
};

jest.mock("swr/infinite", () => {
  return {
    __esModule: true,
    default: () => mockSwrState,
  };
});

jest.mock(
  "axios",
  () => ({
    __esModule: true,
    default: {
      get: jest.fn(),
    },
    get: jest.fn(),
  }),
  { virtual: true }
);

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ to, children }) => require("react").createElement("a", { href: to }, children),
  }),
  { virtual: true }
);

import WinnersPage from "./WinnerPage";

describe("WinnerPage Component - Zero-Vote & Empty-Data Handlers", () => {
  beforeEach(() => {
    mockSwrState = {
      data: null,
      error: null,
      size: 1,
      setSize: jest.fn(),
      isLoading: false,
    };
  });

  test("1. Empty leaderboard renders the informative empty state", () => {
    mockSwrState = {
      data: [{ data: [] }],
      error: null,
      size: 1,
      setSize: jest.fn(),
      isLoading: false,
    };

    render(<WinnersPage />);

    expect(screen.getByText("No winners or votes recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  test("2. All-zero votes never produce NaN and progressbars receive finite value 0", () => {
    mockSwrState = {
      data: [
        {
          data: [
            { _id: "p1", name: "Zero Alpha", department: "Robotics", votes: 0, image: "img1.jpg" },
            { _id: "p2", name: "Zero Beta", department: "AI/ML", votes: 0, image: "img2.jpg" },
          ],
        },
      ],
      error: null,
      size: 1,
      setSize: jest.fn(),
      isLoading: false,
    };

    render(<WinnersPage />);

    const progressBars = screen.getAllByRole("progressbar");
    expect(progressBars).toHaveLength(2);

    progressBars.forEach((bar) => {
      const val = bar.getAttribute("aria-valuenow");
      expect(val).toBe("0");
      expect(val).not.toBe("NaN");
      expect(Number(val)).toBe(0);
    });

    expect(screen.getByText(/Zero Alpha\s+\(Robotics\)/)).toBeInTheDocument();
    expect(screen.getByText(/Zero Beta\s+\(AI\/ML\)/)).toBeInTheDocument();
  });

  test("3. Votes of 50, 25, and 10 produce progress values of 100, 50, and 20", () => {
    mockSwrState = {
      data: [
        {
          data: [
            { _id: "p1", name: "First Place", department: "CSE", votes: 50, image: "gold.jpg" },
            { _id: "p2", name: "Second Place", department: "IT", votes: 25, image: "silver.jpg" },
            { _id: "p3", name: "Third Place", department: "ECE", votes: 10, image: "bronze.jpg" },
          ],
        },
      ],
      error: null,
      size: 1,
      setSize: jest.fn(),
      isLoading: false,
    };

    render(<WinnersPage />);

    const progressBars = screen.getAllByRole("progressbar");
    expect(progressBars).toHaveLength(3);

    expect(progressBars[0]).toHaveAttribute("aria-valuenow", "100");
    expect(progressBars[1]).toHaveAttribute("aria-valuenow", "50");
    expect(progressBars[2]).toHaveAttribute("aria-valuenow", "20");
  });

  test("4. API errors are handled gracefully with an error alert", () => {
    mockSwrState = {
      data: null,
      error: new Error("Failed to fetch winner data"),
      size: 1,
      setSize: jest.fn(),
      isLoading: false,
    };

    render(<WinnersPage />);

    expect(
      screen.getByText("Failed to load winners. Please try again later.")
    ).toBeInTheDocument();
    expect(screen.queryByText("No winners or votes recorded yet.")).not.toBeInTheDocument();
  });

  test("5. Existing winner display and medal podium styling remain functional", () => {
    mockSwrState = {
      data: [
        {
          data: [
            { _id: "w1", name: "Solar Car", department: "Mechanical", votes: 120, image: "car.png" },
            { _id: "w2", name: "Bio Filter", department: "Civil", votes: 80, image: "filter.png" },
          ],
        },
      ],
      error: null,
      size: 1,
      setSize: jest.fn(),
      isLoading: false,
    };

    render(<WinnersPage />);

    expect(screen.getByText(/1\.\s+Solar Car\s+\(Mechanical\)/)).toBeInTheDocument();
    expect(screen.getByText(/2\.\s+Bio Filter\s+\(Civil\)/)).toBeInTheDocument();
    expect(screen.getByText("120 votes")).toBeInTheDocument();
    expect(screen.getByText("80 votes")).toBeInTheDocument();
  });
});
