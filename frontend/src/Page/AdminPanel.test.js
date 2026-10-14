import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockAxiosGet = jest.fn();
const mockAxiosDelete = jest.fn();

jest.mock(
  "axios",
  () => ({
    __esModule: true,
    default: {
      get: (...args) => mockAxiosGet(...args),
      delete: (...args) => mockAxiosDelete(...args),
      isCancel: () => false,
    },
    get: (...args) => mockAxiosGet(...args),
    delete: (...args) => mockAxiosDelete(...args),
    isCancel: () => false,
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

jest.mock(
  "framer-motion",
  () => ({
    motion: {
      div: ({ children, whileHover, animate, initial, transition, ...props }) => (
        <div {...props}>{children}</div>
      ),
    },
  }),
  { virtual: true }
);

import AdminPanel from "./AdminPanel";

describe("AdminPanel Component - Pagination for Gandhigiri Expo (Max 80 Projects)", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockAxiosDelete.mockReset();
    window.alert = jest.fn();
  });

  const createMockParticipants = (start, count) =>
    Array.from({ length: count }, (_, idx) => {
      const id = start + idx;
      return {
        _id: `participant-${id}`,
        name: `Project ${id}`,
        email: `project${id}@aitm.edu.in`,
        department: "Computer Science",
        projectName: `System ${id}`,
        teamNo: id,
        image: "https://via.placeholder.com/300",
      };
    });

  test("1. Loads the first page with limit=50 and renders projects 1 through 50", async () => {
    const page1Data = createMockParticipants(1, 50);
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        data: page1Data,
        meta: {
          total: 80,
          page: 1,
          limit: 50,
          hasMore: true,
        },
      },
    });

    render(<AdminPanel />);

    // Shows loading spinner initially
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    // Resolves and displays page 1 items
    await waitFor(() => {
      expect(screen.getByText("Project 1")).toBeInTheDocument();
      expect(screen.getByText("Project 50")).toBeInTheDocument();
    });

    // Verifies requested URL contract (page=1, limit=50)
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining("/allParticipants?page=1&limit=50"),
      expect.any(Object)
    );

    // Verifies pagination info banner
    expect(screen.getByLabelText("pagination-info")).toHaveTextContent(
      "Showing 1 - 50 of 80 projects (Page 1 of 2)"
    );

    // Page 2 button exists
    expect(screen.getByRole("button", { name: /page 2/i })).toBeInTheDocument();
  });

  test("2. Navigates to the next page and displays participants beyond the first 50 (51 through 80)", async () => {
    const page1Data = createMockParticipants(1, 50);
    const page2Data = createMockParticipants(51, 30);

    mockAxiosGet
      .mockResolvedValueOnce({
        data: {
          data: page1Data,
          meta: { total: 80, page: 1, limit: 50, hasMore: true },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: page2Data,
          meta: { total: 80, page: 2, limit: 50, hasMore: false },
        },
      });

    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByText("Project 1")).toBeInTheDocument();
    });

    // Click Go to page 2 / Next button
    const page2Button = screen.getByRole("button", { name: /page 2/i });
    fireEvent.click(page2Button);

    // Wait for page 2 participants to display
    await waitFor(() => {
      expect(screen.getByText("Project 51")).toBeInTheDocument();
      expect(screen.getByText("Project 80")).toBeInTheDocument();
    });

    // Verify Project 1 is no longer rendered on page 2
    expect(screen.queryByText("Project 1")).not.toBeInTheDocument();

    // Verify page 2 URL was requested
    expect(mockAxiosGet).toHaveBeenLastCalledWith(
      expect.stringContaining("/allParticipants?page=2&limit=50"),
      expect.any(Object)
    );

    // Verify pagination summary for page 2
    expect(screen.getByLabelText("pagination-info")).toHaveTextContent(
      "Showing 51 - 80 of 80 projects (Page 2 of 2)"
    );
  });

  test("3. Handles empty results when no projects are registered", async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        data: [],
        meta: { total: 0, page: 1, limit: 50, hasMore: false },
      },
    });

    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByText("No participants found.")).toBeInTheDocument();
    });

    // Pagination controls should not be displayed when total is 0
    expect(screen.queryByLabelText("admin-pagination")).not.toBeInTheDocument();
  });

  test("4. Handles API failures with error alert and allows retrying", async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error("Network Error"));

    render(<AdminPanel />);

    // Error alert is displayed
    await waitFor(() => {
      expect(
        screen.getByText("Failed to load participants. Please try again.")
      ).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    // Second attempt succeeds
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        data: createMockParticipants(1, 5),
        meta: { total: 5, page: 1, limit: 50, hasMore: false },
      },
    });

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText("Project 1")).toBeInTheDocument();
    });
    expect(screen.queryByText("Failed to load participants. Please try again.")).not.toBeInTheDocument();
  });

  test("5. Preserves participant deletion and updates pagination count", async () => {
    const page1Data = createMockParticipants(1, 2);
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        data: page1Data,
        meta: { total: 2, page: 1, limit: 50, hasMore: false },
      },
    });
    mockAxiosDelete.mockResolvedValueOnce({ data: { message: "Participant deleted" } });

    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByText("Project 1")).toBeInTheDocument();
      expect(screen.getByText("Project 2")).toBeInTheDocument();
    });

    // Click delete icon for Project 1
    const deleteBtn = screen.getByLabelText("delete-participant-1");
    fireEvent.click(deleteBtn);

    // Confirm dialog opens
    expect(
      screen.getByText("Are you sure you want to delete this participant?")
    ).toBeInTheDocument();

    // Click confirm Delete
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(confirmBtn);

    // Project 1 should be removed from view
    await waitFor(() => {
      expect(screen.queryByText("Project 1")).not.toBeInTheDocument();
      expect(screen.getByText("Project 2")).toBeInTheDocument();
    });

    expect(mockAxiosDelete).toHaveBeenCalledWith(
      expect.stringContaining("/deleteParticipant/participant-1"),
      expect.any(Object)
    );
  });
});
