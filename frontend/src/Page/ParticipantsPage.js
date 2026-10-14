import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import axios from "axios";
import useSWRInfinite from "swr/infinite";
import { useInView } from "react-intersection-observer";
import {
  Container,
  Typography,
  Grid,
  Button,
  Box,
  Paper,
  Menu,
  MenuItem,
  Snackbar,
  Alert,
  Skeleton,
  TextField,
  InputAdornment,
} from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import SearchIcon from "@mui/icons-material/Search";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import FacebookIcon from "@mui/icons-material/Facebook";
import TwitterIcon from "@mui/icons-material/Twitter";
import LinkIcon from "@mui/icons-material/Link";
import API_URL from "../api";

const fetcher = (url) => axios.get(url).then((res) => res.data);

const VOTE_STORAGE_KEY = "guestVotes";
const VOTE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const getGuestVotes = () => {
  try {
    return JSON.parse(localStorage.getItem(VOTE_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
};

// ---- Optimized Lazy Image ----
const LazyImage = ({ src, alt }) => {
  const { ref, inView } = useInView({
    triggerOnce: true,
    rootMargin: "300px",
  });

  return (
    <Box
      ref={ref}
      component="img"
      src={inView ? src : ""}
      alt={alt}
      loading="lazy"
      onError={(e) => {
        e.target.onerror = null;
        e.target.src = "https://via.placeholder.com/300?text=No+Preview";
      }}
      sx={{
        width: "100%",
        height: 150,
        objectFit: "cover",
        borderRadius: 2,
        mb: 2,
        background: "#e0e0e0",
        filter: inView ? "blur(0px)" : "blur(10px)",
        transition: "filter 0.4s ease-out",
      }}
    />
  );
};

// ---- Memoized Card ----
const ParticipantCard = memo(({ participant, voted, onVote }) => (
  <Grid size={{ xs: 12, sm: 6, md: 4 }}>
    <Paper
      elevation={10}
      sx={{
        width: 300,
        height: 500,
        p: 2,
        borderRadius: 4,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        transition: "0.25s",
        "&:hover": { transform: "translateY(-8px)", boxShadow: 8 },
      }}
    >
      <Box
        sx={{
          py: 1,
          mb: 1,
          textAlign: "center",
          fontWeight: "bold",
          fontSize: 18,
          color: "#fff",
          background: "linear-gradient(90deg, #4b6cb7, #182848)",
          borderRadius: 2,
        }}
      >
        {participant.name}
      </Box>

      {(participant.projectName || participant.department) && (
        <Box
          sx={{
            py: 0.5,
            fontWeight: "bold",
            textAlign: "center",
            background: "#c3cfe2",
            borderRadius: 2,
            mb: 1,
          }}
        >
          {participant.projectName || participant.department}
        </Box>
      )}

      {participant.email && (
        <Typography align="center" sx={{ fontWeight: "bold", mb: 1 }}>
          {participant.email}
        </Typography>
      )}

      <LazyImage src={participant.image} alt={participant.name} />

      <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: "bold" }}>
          Team: {participant.teamNo || "-"}
        </Typography>

        <Typography
          variant="body2"
          sx={{
            border: "1px dashed #4b6cb7",
            p: 1,
            borderRadius: 2,
            background: "#fff",
            mt: 1,
          }}
        >
          {participant.description}
        </Typography>
      </Box>

      {!voted ? (
        <Button
          variant="contained"
          fullWidth
          sx={{ mt: 2, fontWeight: "bold" }}
          onClick={() => onVote(participant._id)}
        >
          Vote
        </Button>
      ) : (
        <Typography align="center" color="green" mt={2}>
          ✅ You have voted
        </Typography>
      )}
    </Paper>
  </Grid>
));

const ParticipantsPage = () => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [guestVotes, setGuestVotes] = useState(getGuestVotes);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "success",
  });

  // Sync server-recorded votes for authenticated voter across sessions and devices
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    axios
      .get(`${API_URL}/myVotes`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        if (res.data?.votedParticipantIds && Array.isArray(res.data.votedParticipantIds)) {
          setGuestVotes((prev) => {
            const nextVotes = { ...prev };
            res.data.votedParticipantIds.forEach((id) => {
              nextVotes[id] = nextVotes[id] || Date.now();
            });
            try {
              localStorage.setItem(VOTE_STORAGE_KEY, JSON.stringify(nextVotes));
            } catch {}
            return nextVotes;
          });
        }
      })
      .catch(() => {});
  }, []);

  // ---- Stable SWR Infinite key generator ----
  const getKey = useCallback((pageIndex, previousPageData) => {
    if (previousPageData) {
      if (previousPageData.meta && previousPageData.meta.hasMore === false) return null;
      if (Array.isArray(previousPageData.data) && previousPageData.data.length === 0) return null;
      if (Array.isArray(previousPageData) && previousPageData.length === 0) return null;
    }
    return `${API_URL}/allParticipants?page=${pageIndex + 1}&limit=12`;
  }, []);

  const { data, mutate, size, setSize, isLoading } = useSWRInfinite(
    getKey,
    fetcher,
    {
      revalidateFirstPage: false,
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 4000,
    }
  );

  const allParticipants = useMemo(() => {
    if (!data) return [];
    return data.flatMap((page) => {
      // Handle both new pagination format { data: [...] } and old array format [...]
      if (Array.isArray(page)) return page;
      return page.data || [];
    });
  }, [data]);

  // Debounced search filtering to prevent re-render thrashing
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const filteredParticipants = useMemo(() => {
    if (!debouncedSearch.trim()) return allParticipants;
    const query = debouncedSearch.trim().toLowerCase();
    return allParticipants.filter((p) => {
      const name = (p.name || "").toLowerCase();
      const proj = (p.projectName || "").toLowerCase();
      const dept = (p.department || "").toLowerCase();
      const team = p.teamNo ? String(p.teamNo).toLowerCase() : "";
      return name.includes(query) || proj.includes(query) || dept.includes(query) || team.includes(query);
    });
  }, [allParticipants, debouncedSearch]);

  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === "undefined");
  const isEmpty = data?.[0]?.data?.length === 0;
  const isReachingEnd = isEmpty || (data && data[data.length - 1]?.data?.length < 12);

  const loading = isLoading && !data;

  // ---- Voting Logic ----
  const handleVote = useCallback(
    async (id) => {
      const token = localStorage.getItem("token");
      if (!token) {
        setSnackbar({
          open: true,
          message: "Please login to cast your vote!",
          severity: "warning",
        });
        return;
      }

      // Optimistic UI update
      mutate(
        (currentData) => {
          if (!currentData) return currentData;
          return currentData.map((page) => ({
            ...page,
            data: page.data.map((p) =>
              p._id === id ? { ...p, votes: (p.votes || 0) + 1 } : p
            ),
          }));
        },
        { revalidate: false }
      );

      try {
        const res = await axios.post(
          `${API_URL}/voteParticipant/${id}`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );

        // Update cache with confirmed server tally without triggering refetch cascade
        if (res.data && typeof res.data.votes === "number") {
          mutate(
            (currentData) => {
              if (!currentData) return currentData;
              return currentData.map((page) => ({
                ...page,
                data: page.data.map((p) =>
                  p._id === id ? { ...p, votes: res.data.votes } : p
                ),
              }));
            },
            { revalidate: false }
          );
        }
        if (res.data?.alreadyVoted) {
          setGuestVotes((prev) => {
            const updated = { ...prev, [id]: Date.now() };
            try {
              localStorage.setItem(VOTE_STORAGE_KEY, JSON.stringify(updated));
            } catch {}
            return updated;
          });
          setSnackbar({
            open: true,
            message: "Vote already recorded for this participant.",
            severity: "info",
          });
        } else {
          setGuestVotes((prev) => {
            const updated = { ...prev, [id]: Date.now() };
            try {
              localStorage.setItem(VOTE_STORAGE_KEY, JSON.stringify(updated));
            } catch {}
            return updated;
          });
          setSnackbar({
            open: true,
            message: "Vote Successful!",
            severity: "success",
          });
        }
      } catch (err) {
        mutate();
        if (err.response?.status === 409) {
          setGuestVotes((prev) => {
            const updated = { ...prev, [id]: Date.now() };
            try {
              localStorage.setItem(VOTE_STORAGE_KEY, JSON.stringify(updated));
            } catch {}
            return updated;
          });
        }
        const errorMsg =
          err.response?.data?.error ||
          (err.response?.status === 401
            ? "Session expired. Please login again to vote."
            : "Vote Failed!");
        setSnackbar({ open: true, message: errorMsg, severity: "error" });
      }
    },
    [mutate]
  );

  // ---- Share ----
  const handleShareClick = (e) => setAnchorEl(e.currentTarget);
  const handleShareClose = (platform) => {
    setAnchorEl(null);
    if (!platform) return;

    const url = window.location.href;

    const links = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(url)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`,
    };

    if (platform === "link") {
      navigator.clipboard.writeText(url);
      setSnackbar({ open: true, message: "Link Copied!", severity: "success" });
      return;
    }

    window.open(links[platform], "_blank");
  };

  return (
    <Container sx={{ py: 6 }}>
      <Typography variant="h4" align="center" fontWeight="bold" sx={{ mb: 4 }}>
        🏅 Participants of the Event
      </Typography>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: 2,
          justifyContent: "space-between",
          alignItems: "center",
          maxWidth: 950,
          mx: "auto",
          mb: 4,
        }}
      >
        <TextField
          size="small"
          placeholder="Search by project, department, team..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: "100%", sm: 350 }, bgcolor: "white", borderRadius: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
          }}
        />

        <Button variant="outlined" startIcon={<ShareIcon />} onClick={handleShareClick}>
          Share Participants
        </Button>

        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => handleShareClose(null)}>
          <MenuItem onClick={() => handleShareClose("whatsapp")}>
            <WhatsAppIcon sx={{ mr: 1 }} /> WhatsApp
          </MenuItem>
          <MenuItem onClick={() => handleShareClose("facebook")}>
            <FacebookIcon sx={{ mr: 1 }} /> Facebook
          </MenuItem>
          <MenuItem onClick={() => handleShareClose("twitter")}>
            <TwitterIcon sx={{ mr: 1 }} /> Twitter
          </MenuItem>
          <MenuItem onClick={() => handleShareClose("link")}>
            <LinkIcon sx={{ mr: 1 }} /> Copy Link
          </MenuItem>
        </Menu>
      </Box>

      {/* PARTICIPANT GRID */}
      <Grid container spacing={4} justifyContent="center">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
                <Skeleton variant="rectangular" height={500} sx={{ borderRadius: 3 }} />
              </Grid>
            ))
          : filteredParticipants.length > 0
          ? filteredParticipants.map((p) => {
              const voted =
                guestVotes[p._id] &&
                Date.now() - guestVotes[p._id] < VOTE_COOLDOWN_MS;

              return (
                <ParticipantCard
                  key={p._id}
                  participant={p}
                  voted={voted}
                  onVote={handleVote}
                />
              );
            })
          : debouncedSearch.trim() && (
              <Box textAlign="center" py={6} width="100%">
                <Typography variant="h6" color="text.secondary">
                  🔍 No projects match "{debouncedSearch}"
                </Typography>
              </Box>
            )}
      </Grid>

      {/* Load More Button (only when not actively filtering) */}
      {!debouncedSearch.trim() && !isReachingEnd && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <Button
            variant="contained"
            onClick={() => setSize(size + 1)}
            disabled={isLoadingMore}
            sx={{ fontWeight: "bold", px: 4, py: 1.5 }}
          >
            {isLoadingMore ? "Loading..." : "Load More"}
          </Button>
        </Box>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={2500}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
      >
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </Container>
  );
};

export default ParticipantsPage;
