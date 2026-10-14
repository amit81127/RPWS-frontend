const rawApiUrl = process.env.REACT_APP_API_URL || "https://aitm-vote.onrender.com";
const API_URL = rawApiUrl.replace(/\/+$/, "");

export default API_URL;