import React, { useCallback, useMemo } from "react";
import axios from "axios";
import useSWRInfinite from "swr/infinite";
import {
  Container,
  Typography,
  Grid,
  Avatar,
  Box,
  Button,
  LinearProgress,
  Tooltip,
  CircularProgress,
  Alert,
} from "@mui/material";
import API_URL from "../api";

// Stable fetcher defined outside component scope to prevent reference churn
const fetcher = (url) => axios.get(url).then((res) => res.data);

const WinnersPage = () => {
  const getKey = useCallback((pageIndex, previousPageData) => {
    if (previousPageData) {
      if (previousPageData.meta && previousPageData.meta.hasMore === false) return null;
      if (Array.isArray(previousPageData.data) && previousPageData.data.length === 0) return null;
      if (Array.isArray(previousPageData) && previousPageData.length === 0) return null;
    }
    return `${API_URL}/allParticipantsByVotes?page=${pageIndex + 1}&limit=6`;
  }, []);

  const { data, error, size, setSize, isLoading } = useSWRInfinite(getKey, fetcher, {
    revalidateFirstPage: false,
    revalidateOnFocus: false,
    dedupingInterval: 4000,
  });

  const winnersData = useMemo(() => {
    if (!data) return [];
    return data.flatMap((page) => {
      if (Array.isArray(page)) return page;
      return page.data || [];
    });
  }, [data]);

  const maxVotes = winnersData[0]?.votes || 0;

  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === "undefined");
  const isEmpty = data?.[0]?.data?.length === 0;
  const isReachingEnd = isEmpty || (data && data[data.length - 1]?.data?.length < 6);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography
          variant="h4"
          align="center"
          fontWeight="bold"
          gutterBottom
          sx={{ color: "primary.main", mb: 4 }}
        >
          🏆 Event Winners
        </Typography>

        {isLoading && winnersData.length === 0 ? (
          <Box textAlign="center" mt={6}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Box textAlign="center" mt={4} mb={4}>
            <Alert severity="error" sx={{ maxWidth: 500, mx: "auto" }}>
              Failed to load winners. Please try again later.
            </Alert>
          </Box>
        ) : winnersData.length === 0 ? (
          <Box textAlign="center" mt={6} p={4} bgcolor="rgba(0,0,0,0.02)" borderRadius={3}>
            <Typography variant="h6" color="text.secondary">
              No winners or votes recorded yet.
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={2} direction="column" alignItems="center">
            {winnersData.map((winner, index) => {
              const rawProgress = maxVotes > 0 ? (winner.votes / maxVotes) * 100 : 0;
              const progressValue = Math.min(100, Math.max(0, Number.isFinite(rawProgress) ? rawProgress : 0));

              return (
                <Tooltip key={winner._id} title={`${winner.name} - ${winner.votes} votes`} arrow>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      maxWidth: 600,
                      bgcolor:
                        index === 0
                          ? "#FFD700"
                          : index === 1
                          ? "#C0C0C0"
                          : index === 2
                          ? "#CD7F32"
                          : "#f5f5f5",
                      borderRadius: 2,
                      p: 2,
                      mb: 1,
                      boxShadow: 1,
                      transition: "transform 0.2s",
                      "&:hover": { transform: "scale(1.02)" },
                    }}
                  >
                    <Avatar
                      alt={winner.name}
                      src={winner.image}
                      sx={{ width: 50, height: 50, mr: 2 }}
                    />
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="subtitle1" fontWeight="bold">
                        {index + 1}. {winner.name} ({winner.department})
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={progressValue}
                        sx={{ height: 10, borderRadius: 5, mt: 1 }}
                        color={index === 0 ? "warning" : index === 1 ? "info" : "primary"}
                      />
                    </Box>
                    <Typography sx={{ ml: 2, fontWeight: "bold" }}>{winner.votes} votes</Typography>
                  </Box>
                </Tooltip>
              );
            })}
          </Grid>
        )}

        {/* Load More Button */}
        {winnersData.length > 0 && !isReachingEnd && (
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
      </Container>
  );
};

export default WinnersPage;
