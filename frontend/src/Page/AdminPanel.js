import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import axios from "axios";
import { mutate } from "swr";
import {
  Container,
  Typography,
  Grid,
  Avatar,
  Box,
  IconButton,
  TextField,
  CircularProgress,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Pagination,
  Alert,
  Paper,
  Stack,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import GroupsIcon from "@mui/icons-material/Groups";
import { jwtDecode } from "jwt-decode";

import { motion } from "framer-motion";
import API_URL from "../api";

const AdminPanel = () => {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: null });

  // Debounce search input to avoid recalculating on every single keystroke
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => clearTimeout(handler);
  }, [search]);

  // Determine administrator role from current token
  const token = localStorage.getItem("token");
  let isAdmin = false;
  if (token) {
    try {
      const decoded = jwtDecode(token);
      isAdmin = decoded.role === "admin";
    } catch (_) {
      isAdmin = false;
    }
  }

  // Voting control window state
  const [votingStatus, setVotingStatus] = useState(null); // boolean | null
  const [votingLoading, setVotingLoading] = useState(false);
  const [votingActionInProgress, setVotingActionInProgress] = useState(false);
  const [votingMessage, setVotingMessage] = useState(null); // { type: 'success' | 'error', text: string } | null
  const [votingConfirmDialog, setVotingConfirmDialog] = useState({ open: false, action: null });

  // Pagination state (default limit 50 aligned with backend max limit)
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 50;

  const activeRequestRef = useRef(null);

  // Fetch voting status from backend (Admin only)
  const fetchVotingStatus = useCallback(async () => {
    if (!isAdmin) return;
    setVotingLoading(true);
    try {
      const currentToken = localStorage.getItem("token");
      const { data } = await axios.get(`${API_URL}/admin/votingStatus`, {
        headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
      });
      setVotingStatus(Boolean(data.votingEnabled));
    } catch (err) {
      console.error("Error fetching voting status:", err);
      setVotingStatus(false);
      setVotingMessage({
        type: "error",
        text: err.response?.data?.error || "Failed to load voting status from server.",
      });
    } finally {
      setVotingLoading(false);
    }
  }, [isAdmin]);

  // Administrator management state
  const [admins, setAdmins] = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [newAdmin, setNewAdmin] = useState({ name: "", email: "", password: "" });
  const [newAdminLoading, setNewAdminLoading] = useState(false);
  const [adminActionMessage, setAdminActionMessage] = useState(null);

  // Fetch administrator list (Admin only)
  const fetchAdmins = useCallback(async () => {
    if (!isAdmin) return;
    setAdminsLoading(true);
    try {
      const currentToken = localStorage.getItem("token");
      const { data } = await axios.get(`${API_URL}/admin/listAdmins`, {
        headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
      });
      setAdmins(data.data || []);
    } catch (err) {
      console.error("Error fetching administrators:", err);
    } finally {
      setAdminsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      fetchVotingStatus();
      fetchAdmins();
    }
  }, [isAdmin, fetchVotingStatus, fetchAdmins]);

  // Handle registering a new administrator
  const handleRegisterAdmin = async (e) => {
    e.preventDefault();
    setAdminActionMessage(null);

    if (!newAdmin.name.trim() || !newAdmin.email.trim() || !newAdmin.password) {
      setAdminActionMessage({ type: "error", text: "All fields are required." });
      return;
    }

    if (newAdmin.password.length < 6) {
      setAdminActionMessage({ type: "error", text: "Password must be at least 6 characters." });
      return;
    }

    setNewAdminLoading(true);
    try {
      const currentToken = localStorage.getItem("token");
      const { data } = await axios.post(
        `${API_URL}/admin/registerAdmin`,
        {
          name: newAdmin.name.trim(),
          email: newAdmin.email.trim().toLowerCase(),
          password: newAdmin.password,
        },
        {
          headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
        }
      );

      setAdminActionMessage({ type: "success", text: data.message || "Administrator registered successfully!" });
      setNewAdmin({ name: "", email: "", password: "" });
      await fetchAdmins();

      setTimeout(() => {
        setAdminDialogOpen(false);
        setAdminActionMessage(null);
      }, 1500);
    } catch (err) {
      setAdminActionMessage({
        type: "error",
        text: err.response?.data?.error || "Failed to register administrator.",
      });
    } finally {
      setNewAdminLoading(false);
    }
  };

  // Execute start or stop voting action after confirmation
  const handleVotingAction = async (action) => {
    setVotingConfirmDialog({ open: false, action: null });
    setVotingActionInProgress(true);
    setVotingMessage(null);
    try {
      const currentToken = localStorage.getItem("token");
      const endpoint = action === "start" ? "/admin/startVoting" : "/admin/stopVoting";
      const { data } = await axios.post(
        `${API_URL}${endpoint}`,
        {},
        {
          headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
        }
      );
      setVotingMessage({
        type: "success",
        text: data.message || `Voting ${action === "start" ? "started" : "stopped"} successfully!`,
      });
      // Refresh status from backend rather than trusting only local state
      await fetchVotingStatus();
    } catch (err) {
      console.error(`Error during ${action} voting:`, err);
      setVotingMessage({
        type: "error",
        text: err.response?.data?.error || `Failed to ${action} voting. Please try again.`,
      });
    } finally {
      setVotingActionInProgress(false);
    }
  };

  // Fetch participants with abort controller to prevent duplicate/stale requests
  const fetchParticipants = useCallback(
    async (targetPage = 1, signal) => {
      if (activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
      const controller = new AbortController();
      activeRequestRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const { data } = await axios.get(
          `${API_URL}/allParticipants?page=${targetPage}&limit=${limit}`,
          { signal: signal || controller.signal }
        );

        let items = [];
        if (data && Array.isArray(data.data)) {
          items = data.data;
        } else if (Array.isArray(data)) {
          items = data;
        }

        setParticipants(items);

        if (data && data.meta) {
          const metaTotal =
            typeof data.meta.total === "number" ? data.meta.total : items.length;
          setTotal(metaTotal);
          setTotalPages(Math.max(1, Math.ceil(metaTotal / limit)));
        } else {
          setTotal(items.length);
          setTotalPages(1);
        }
      } catch (err) {
        if (
          axios.isCancel?.(err) ||
          err.name === "CanceledError" ||
          err.code === "ERR_CANCELED"
        ) {
          return;
        }
        console.error("Error fetching participants:", err);
        setError("Failed to load participants. Please try again.");
        setParticipants([]);
      } finally {
        if (activeRequestRef.current === controller) {
          activeRequestRef.current = null;
          setLoading(false);
        }
      }
    },
    [limit]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchParticipants(page, controller.signal);
    return () => {
      controller.abort();
    };
  }, [page, fetchParticipants]);

  const handlePageChange = (event, value) => {
    if (value !== page && !loading) {
      setPage(value);
    }
  };

  // Delete participant
  const handleDelete = async (participantId) => {
    try {
      const token = localStorage.getItem("token");
      await axios.delete(`${API_URL}/deleteParticipant/${participantId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const remaining = participants.filter((p) => p._id !== participantId);
      setParticipants(remaining);
      setTotal((prev) => {
        const nextTotal = Math.max(0, prev - 1);
        setTotalPages(Math.max(1, Math.ceil(nextTotal / limit)));
        return nextTotal;
      });
        setDeleteDialog({ open: false, id: null });

        // Invalidate global SWR caches so participant list and winners update immediately
        mutate((key) => typeof key === "string" && (key.includes("/allParticipants") || key.includes("/allParticipantsByVotes")));

        if (remaining.length === 0 && page > 1) {
          setPage((prevPage) => prevPage - 1);
        }
      } catch (err) {
        console.error("Error deleting participant:", err);
        alert(err.response?.data?.error || "Failed to delete participant.");
      }
    };

    // Memoized filter calculation using debounced search
    const filteredParticipants = useMemo(() => {
      if (!debouncedSearch.trim()) return participants;
      const s = debouncedSearch.trim().toLowerCase();
      return participants.filter((p) => {
        const nameMatch = p.name ? p.name.toLowerCase().includes(s) : false;
        const deptMatch = p.department ? p.department.toLowerCase().includes(s) : false;
        const projectMatch = p.projectName ? p.projectName.toLowerCase().includes(s) : false;
        const teamMatch = p.teamNo ? p.teamNo.toString().includes(s) : false;
        return nameMatch || deptMatch || projectMatch || teamMatch;
      });
    }, [participants, debouncedSearch]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
        {/* Admin Voting Window Controls (Only visible to authenticated administrators) */}
        {isAdmin && (
          <Paper
            elevation={3}
            sx={{
              p: 3,
              mb: 4,
              borderRadius: 3,
              bgcolor: "#ffffffdd",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
            aria-label="voting-control-panel"
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "flex-start", sm: "center" },
                justifyContent: "space-between",
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="h6" fontWeight="bold">
                  Voting Window Controls
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Current Status:
                  </Typography>
                  {votingLoading && votingStatus === null ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" color="text.secondary">
                        Checking status...
                      </Typography>
                    </Box>
                  ) : votingStatus === true ? (
                    <Chip
                      label="VOTING OPEN"
                      color="success"
                      size="small"
                      sx={{ fontWeight: "bold", px: 1 }}
                      aria-label="voting-status-open"
                    />
                  ) : (
                    <Chip
                      label="VOTING CLOSED"
                      color="error"
                      size="small"
                      sx={{ fontWeight: "bold", px: 1 }}
                      aria-label="voting-status-closed"
                    />
                  )}
                </Box>
              </Box>

              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="contained"
                  color="success"
                  disabled={votingLoading || votingActionInProgress || votingStatus === true}
                  onClick={() => setVotingConfirmDialog({ open: true, action: "start" })}
                  aria-label="start-voting-button"
                  sx={{ textTransform: "none", fontWeight: "bold" }}
                >
                  Start Voting
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  disabled={votingLoading || votingActionInProgress || votingStatus === false}
                  onClick={() => setVotingConfirmDialog({ open: true, action: "stop" })}
                  aria-label="stop-voting-button"
                  sx={{ textTransform: "none", fontWeight: "bold" }}
                >
                  Stop Voting
                </Button>
                {votingActionInProgress && (
                  <CircularProgress size={24} aria-label="voting-action-spinner" />
                )}
              </Stack>
            </Box>

            {votingMessage && (
              <Alert
                severity={votingMessage.type}
                sx={{ mt: 2 }}
                onClose={() => setVotingMessage(null)}
                aria-label="voting-message-alert"
              >
                {votingMessage.text}
              </Alert>
            )}
          </Paper>
        )}

        {/* Administrator Management Panel (Admin only can sign up other admins) */}
        {isAdmin && (
          <Paper
            elevation={3}
            sx={{
              p: 3,
              mb: 4,
              borderRadius: 3,
              bgcolor: "#ffffffdd",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
            aria-label="admin-management-panel"
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "flex-start", sm: "center" },
                justifyContent: "space-between",
                gap: 2,
                mb: 2,
              }}
            >
              <Box>
                <Typography variant="h6" fontWeight="bold">
                  Administrator Management
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Public admin registration is restricted. Only authorized administrators can register additional admin accounts.
                </Typography>
              </Box>

              <Button
                variant="contained"
                startIcon={<GroupAddIcon />}
                onClick={() => {
                  setAdminActionMessage(null);
                  setAdminDialogOpen(true);
                }}
                sx={{
                  bgcolor: "#003366",
                  color: "#FFD700",
                  textTransform: "none",
                  fontWeight: "bold",
                  borderRadius: 2,
                  px: 2.5,
                  "&:hover": { bgcolor: "#002244" },
                }}
              >
                + Register New Admin
              </Button>
            </Box>

            {adminsLoading ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Loading authorized administrators...
                </Typography>
              </Box>
            ) : (
              <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mt: 1 }}>
                {admins.map((adm) => (
                  <Chip
                    key={adm._id}
                    avatar={
                      <Avatar sx={{ bgcolor: "#003366", color: "#FFD700" }}>
                        {adm.name ? adm.name[0].toUpperCase() : "A"}
                      </Avatar>
                    }
                    label={`${adm.name} (${adm.email})`}
                    variant="outlined"
                    sx={{
                      fontWeight: 500,
                      py: 2.2,
                      px: 1,
                      borderRadius: 2,
                      borderColor: "rgba(0, 51, 102, 0.2)",
                    }}
                  />
                ))}
              </Box>
            )}
          </Paper>
        )}

        {/* Team Statistics & Search Overview */}
        <Paper
          elevation={2}
          sx={{
            p: 3,
            mb: 4,
            borderRadius: 3,
            bgcolor: "#ffffffdd",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(0, 51, 102, 0.12)",
          }}
          aria-label="teams-overview-panel"
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              alignItems: { xs: "flex-start", md: "center" },
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            {/* Total Teams Metric Card */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: 2.5,
                  bgcolor: "var(--primary-blue, #003366)",
                  color: "#FFD700",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 12px rgba(0, 51, 102, 0.25)",
                }}
              >
                <GroupsIcon sx={{ fontSize: 32 }} />
              </Box>
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={700}
                  letterSpacing={0.8}
                  textTransform="uppercase"
                >
                  Total Participating Teams
                </Typography>
                <Typography
                  variant="h4"
                  fontWeight={800}
                  sx={{ color: "var(--primary-blue, #003366)", lineHeight: 1.1 }}
                >
                  {total}
                  <Typography
                    component="span"
                    variant="subtitle1"
                    color="text.secondary"
                    sx={{ ml: 1, fontWeight: 500 }}
                  >
                    {total === 1 ? "team registered" : "teams registered"}
                  </Typography>
                </Typography>
              </Box>
            </Box>

            {/* Search Box */}
            <TextField
              variant="outlined"
              size="small"
              placeholder="Search by team, project, or department..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{
                width: { xs: "100%", md: 360 },
                "& .MuiOutlinedInput-root": {
                  borderRadius: 2.5,
                  bgcolor: "rgba(0,0,0,0.03)",
                  "&:hover": { bgcolor: "rgba(0,0,0,0.06)" },
                },
              }}
            />
          </Box>
        </Paper>

        {/* Participants */}
        {loading ? (
          <Box textAlign="center" mt={10}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Box textAlign="center" mt={4} mb={4}>
            <Alert severity="error" sx={{ maxWidth: 500, mx: "auto", mb: 2 }}>
              {error}
            </Alert>
            <Button variant="contained" onClick={() => fetchParticipants(page)}>
              Retry
            </Button>
          </Box>
        ) : (
          <>
            {filteredParticipants.length === 0 ? (
              <Box textAlign="center" mt={6} p={4} bgcolor="rgba(0,0,0,0.02)" borderRadius={3}>
                <Typography variant="h6" color="text.secondary">
                  {search ? "No participants match your search criteria." : "No participants found."}
                </Typography>
              </Box>
            ) : (
              <Grid container spacing={2}>
                {filteredParticipants.map((participant, index) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={participant._id}>
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          p: 3,
                          borderRadius: 3,
                          boxShadow: 4,
                          bgcolor: "#ffffffdd",
                          backdropFilter: "blur(8px)",
                          border: "1px solid rgba(0,0,0,0.1)",
                          transition: "0.3s",
                          "&:hover": {
                            transform: "translateY(-5px)",
                            boxShadow: 10,
                            borderColor: "rgba(0,0,0,0.2)",
                          },
                        }}
                      >
                        <Avatar
                          alt={participant.name}
                          src={participant.image}
                          sx={{ width: 70, height: 70, mb: 2 }}
                        />
                        <Typography variant="h6" fontWeight="bold" align="center">
                          {participant.name}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          align="center"
                          mb={1}
                        >
                          {participant.email}
                        </Typography>
                        <Chip
                          label={participant.department || participant.projectName || "General"}
                          color="primary"
                          size="small"
                          sx={{
                            mb: 1,
                            "&:hover": { transform: "scale(1.1)", transition: "0.3s" },
                          }}
                        />
                        {/* Team Number */}
                        {participant.teamNo && (
                          <Typography
                            variant="body2"
                            color="secondary.main"
                            align="center"
                            mb={2}
                          >
                            Team No: {participant.teamNo}
                          </Typography>
                        )}
                        <IconButton
                          color="error"
                          aria-label={`delete-${participant._id}`}
                          onClick={() =>
                            setDeleteDialog({ open: true, id: participant._id })
                          }
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </motion.div>
                  </Grid>
                ))}
              </Grid>
            )}

            {/* Pagination Controls */}
            {total > 0 && (
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mt: 4, mb: 2 }}>
                <Typography variant="body2" color="text.secondary" mb={1} aria-label="pagination-info">
                  Showing {participants.length ? (page - 1) * limit + 1 : 0} -{" "}
                  {Math.min(page * limit, total)} of {total} teams (Page {page} of {totalPages})
                </Typography>
                <Pagination
                  count={totalPages}
                  page={page}
                  onChange={handlePageChange}
                  color="primary"
                  showFirstButton
                  showLastButton
                  disabled={loading}
                  aria-label="admin-pagination"
                />
              </Box>
            )}
          </>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={deleteDialog.open}
          onClose={() => setDeleteDialog({ open: false, id: null })}
        >
          <DialogTitle>
            Are you sure you want to delete this participant?
          </DialogTitle>
          <DialogActions>
            <Button onClick={() => setDeleteDialog({ open: false, id: null })}>
              Cancel
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => handleDelete(deleteDialog.id)}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>

        {/* Voting Window Action Confirmation Dialog */}
        <Dialog
          open={votingConfirmDialog.open}
          onClose={() =>
            !votingActionInProgress && setVotingConfirmDialog({ open: false, action: null })
          }
        >
          <DialogTitle>
            {votingConfirmDialog.action === "start" ? "Confirm Start Voting" : "Confirm Stop Voting"}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {votingConfirmDialog.action === "start"
                ? "Are you sure you want to OPEN voting? Authenticated students will immediately be able to cast votes for participants."
                : "Are you sure you want to CLOSE voting? Students will no longer be able to submit new votes. All existing votes and ledger records will be preserved safely."}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setVotingConfirmDialog({ open: false, action: null })}
              disabled={votingActionInProgress}
            >
              Cancel
            </Button>
            <Button
              color={votingConfirmDialog.action === "start" ? "success" : "error"}
              variant="contained"
              onClick={() => handleVotingAction(votingConfirmDialog.action)}
              disabled={votingActionInProgress}
              autoFocus
            >
              {votingConfirmDialog.action === "start" ? "Open Voting" : "Close Voting"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Register New Administrator Dialog */}
        <Dialog
          open={adminDialogOpen}
          onClose={() => !newAdminLoading && setAdminDialogOpen(false)}
          maxWidth="sm"
          fullWidth
          aria-labelledby="register-admin-dialog-title"
        >
          <form onSubmit={handleRegisterAdmin}>
            <DialogTitle id="register-admin-dialog-title" sx={{ fontWeight: "bold", color: "#003366" }}>
              Register New Administrator
            </DialogTitle>
            <DialogContent>
              <DialogContentText sx={{ mb: 3 }}>
                Provide the credentials for the new administrator. They will be granted full administrative rights to manage participants, voting windows, and platform settings.
              </DialogContentText>

              {adminActionMessage && (
                <Alert severity={adminActionMessage.type} sx={{ mb: 2 }}>
                  {adminActionMessage.text}
                </Alert>
              )}

              <TextField
                autoFocus
                margin="dense"
                label="Full Name"
                type="text"
                fullWidth
                variant="outlined"
                value={newAdmin.name}
                onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })}
                required
                disabled={newAdminLoading}
                sx={{ mb: 2 }}
              />

              <TextField
                margin="dense"
                label="Administrator Email"
                type="email"
                fullWidth
                variant="outlined"
                value={newAdmin.email}
                onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })}
                required
                disabled={newAdminLoading}
                sx={{ mb: 2 }}
              />

              <TextField
                margin="dense"
                label="Initial Password"
                type="password"
                fullWidth
                variant="outlined"
                value={newAdmin.password}
                onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                helperText="Must be at least 6 characters long"
                required
                disabled={newAdminLoading}
              />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button
                onClick={() => setAdminDialogOpen(false)}
                disabled={newAdminLoading}
                sx={{ textTransform: "none" }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={newAdminLoading}
                sx={{
                  bgcolor: "#003366",
                  color: "#FFD700",
                  textTransform: "none",
                  fontWeight: "bold",
                  "&:hover": { bgcolor: "#002244" },
                }}
              >
                {newAdminLoading ? (
                  <span className="d-flex align-items-center gap-2">
                    <CircularProgress size={16} color="inherit" />
                    Registering...
                  </span>
                ) : (
                  "Create Admin Account"
                )}
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      </Container>
  );
};

export default AdminPanel;
