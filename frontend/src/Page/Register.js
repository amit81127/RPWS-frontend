import React, { useState } from "react";
import axios from "axios";
import { mutate } from "swr";
import {
  Container,
  Typography,
  TextField,
  Button,
  Grid,
  Paper,
  Box,
  Avatar,
  CircularProgress,
  Alert,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import API_URL from "../api";
const Register = () => {
  const [formData, setFormData] = useState({
    teamNo: "",
    name: "",
    projectName: "",
    department: "",
    email: "",
    description: "",
    image: null,
  });
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (files) {
      const file = files[0];
      if (file && file.size > 5 * 1024 * 1024) {
        setStatusMessage({ type: "error", text: "Image is too large. Maximum size is 5MB." });
        return;
      }
      setStatusMessage(null);
      setFormData((prev) => ({ ...prev, [name]: file }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatusMessage(null);

    setLoading(true);
    try {
      const data = new FormData();
      data.append("teamNo", formData.teamNo);
      data.append("name", formData.name);
      data.append("projectName", formData.projectName);
      data.append("department", formData.department);
      data.append("email", formData.email);
      data.append("description", formData.description);

      // Append image file for Cloudinary upload if selected
      if (formData.image) {
        data.append("image", formData.image);
      }

      const token = localStorage.getItem("token");
      const headers = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      await axios.post(`${API_URL}/addParticipants`, data, { headers });

      // Invalidate SWR cache for participants feed so the new entry appears immediately
      mutate((key) => typeof key === "string" && key.includes("/allParticipants"));

      setStatusMessage({
        type: "success",
        text: "🎉 Registration Successful! Project photo uploaded to Cloudinary CDN.",
      });
      setFormData({
        teamNo: "",
        name: "",
        projectName: "",
        department: "",
        email: "",
        description: "",
        image: null,
      });
    } catch (error) {
      console.error("❌ Error registering participant:", error);
      setStatusMessage({
        type: "error",
        text: error.response?.data?.error || "Registration failed. Please verify all details.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
        <Typography
          variant="h4"
          align="center"
          fontWeight="bold"
          gutterBottom
          sx={{ mb: 4 }}
        >
          📝 Register for the Event
        </Typography>

        <Paper elevation={4} sx={{ p: 4, maxWidth: 600, mx: "auto", borderRadius: 3 }}>
          {statusMessage && (
            <Alert severity={statusMessage.type} sx={{ mb: 3 }} onClose={() => setStatusMessage(null)}>
              {statusMessage.text}
            </Alert>
          )}

          <form onSubmit={handleSubmit} encType="multipart/form-data">
            <Grid container spacing={3}>
              {/* Team Number */}
              <Grid size={12}>
                <TextField
                  name="teamNo"
                  label="Team Number"
                  variant="outlined"
                  fullWidth
                  required
                  value={formData.teamNo}
                  onChange={handleChange}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  name="name"
                  label="Team Name"
                  variant="outlined"
                  fullWidth
                  required
                  value={formData.name}
                  onChange={handleChange}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  name="projectName"
                  label="Project Name"
                  variant="outlined"
                  fullWidth
                  required
                  value={formData.projectName}
                  onChange={handleChange}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  name="department"
                  label="Department"
                  variant="outlined"
                  fullWidth
                  required
                  value={formData.department}
                  onChange={handleChange}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  name="email"
                  label="College Email Address"
                  type="email"
                  variant="outlined"
                  fullWidth
                  required
                  placeholder="e.g. 2023bcs108@axiscolleges.in"
                  helperText="College email format: 2023bcs108@axiscolleges.in"
                  value={formData.email}
                  onChange={handleChange}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  name="description"
                  label="Project Description / Participation Details"
                  variant="outlined"
                  fullWidth
                  multiline
                  rows={4}
                  required
                  value={formData.description}
                  onChange={handleChange}
                />
              </Grid>

              <Grid size={12}>
                <Button
                  variant="outlined"
                  component="label"
                  startIcon={<UploadFileIcon />}
                  fullWidth
                  disabled={loading}
                >
                  {formData.image
                    ? `Change Image (${(formData.image.size / (1024 * 1024)).toFixed(2)} MB)`
                    : "Upload Project Image to Cloudinary"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    hidden
                    name="image"
                    onChange={handleChange}
                  />
                </Button>
                <Typography variant="caption" color="text.secondary" display="block" textAlign="center" mt={0.5}>
                  Images are hosted on Cloudinary CDN (Max size: 5MB • Formats: JPEG, PNG, WEBP, GIF)
                </Typography>
                {formData.image && (
                  <Box mt={2} display="flex" flexDirection="column" alignItems="center">
                    <Avatar
                      src={URL.createObjectURL(formData.image)}
                      alt="preview"
                      sx={{ width: 100, height: 100, borderRadius: 2, boxShadow: 2 }}
                    />
                    <Typography variant="caption" color="text.secondary" mt={0.5}>
                      Selected: {formData.image.name}
                    </Typography>
                  </Box>
                )}
              </Grid>

              <Grid size={12}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  fullWidth
                  disabled={loading}
                  sx={{ py: 1.5, borderRadius: 2, fontWeight: "bold" }}
                >
                  {loading ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <CircularProgress size={20} color="inherit" />
                      <span>Uploading to Cloudinary & Registering...</span>
                    </Box>
                  ) : (
                    "Register Project"
                  )}
                </Button>
              </Grid>
            </Grid>
          </form>
        </Paper>
      </Container>
  );
};

export default Register;
