# 🏆 Rating Website

A full-stack web application for managing event participants, allowing users to view profiles, vote for their favorites, and see real-time winners.

## 🚀 Features

-   **Participant Gallery**: Browse all participants with infinite scroll pagination.
-   **Voting System**: Secure voting with cooldown periods to prevent spam.
-   **Live Leaderboard**: View top-rated participants in the Winners section.
-   **Admin Panel**: Manage participants (Add, Edit, Delete) with a secure dashboard.
-   **Authentication**: User Signup and Login functionality.
-   **Responsive Design**: Built with Material UI for a seamless experience on all devices.

## 🛠️ Tech Stack

-   **Frontend**: React.js, Material UI, Framer Motion, SWR (for data fetching).
-   **Backend**: Node.js, Express.js.
-   **Database**: MongoDB (Mongoose).
-   **Authentication**: JWT (JSON Web Tokens).

## ⚙️ Setup Instructions

### Prerequisites
-   Node.js installed.
-   MongoDB installed and running (or a MongoDB Atlas URI).

### 1. Backend Setup

Navigate to the backend directory:
```bash
cd backend
```

Install dependencies:
```bash
npm install
```

Create a `.env` file in the `backend` directory:
```env
PORT=5000
MONGO_URL=mongodb://127.0.0.1:27017/ratingdb
JWT_SECRET=your_secret_key
```

Start the server:
```bash
npm start
```
The server will run on `http://localhost:5000`.

### 2. Frontend Setup

Navigate to the frontend directory:
```bash
cd frontend
```

Install dependencies:
```bash
npm install
```

Create a `.env` file in the `frontend` directory (optional if using defaults):
```env
REACT_APP_API_URL=http://localhost:5000
```

Start the application:
```bash
npm start
```
The application will open at `http://localhost:3000`.

## 📂 Project Structure

```
rating/
├── backend/            # Node.js/Express API
│   ├── models/         # Mongoose Models
│   ├── schemas/        # Validation Schemas
│   ├── index.js        # Server Entry Point
│   └── ...
├── frontend/           # React Application
│   ├── src/
│   │   ├── Page/       # Page Components (Participants, Winners, Admin)
│   │   ├── components/ # Reusable Components
│   │   └── ...
│   └── ...
└── README.md           # Project Documentation
```

## ⚡ Recent Optimizations

-   **Pagination**: Implemented infinite scrolling for Participants and Winners pages to handle large datasets efficiently.
-   **Performance**: Optimized image loading and API response sizes.

## 🏛️ System Architecture

For a comprehensive breakdown of the system design, data flow diagrams, transactional voting engine, and security policies, see the [Architecture Documentation](file:///e:/expovote/ARCHITECTURE.md).

