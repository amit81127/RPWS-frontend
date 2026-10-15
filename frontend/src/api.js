const rawApiUrl = process.env.REACT_APP_API_URL || "http://localhost:5000";
const API_URL = rawApiUrl.replace(/\/+$/, "");

export default API_URL;