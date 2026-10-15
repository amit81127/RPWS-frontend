# Rating Website - Backend API

🚀 **Backend API for Rating Website** - A Node.js/Express server with MongoDB for managing participants and voting.

## 🌟 Live Demo

**API Endpoint**: Coming soon after Render deployment

## 📋 Features

- ✅ JWT-based authentication
- ✅ User signup/login with brute-force defense
- ✅ Participant management (CRUD)
- ✅ Voting system with ACID transactions & ledger
- ✅ Traffic spike & overload hardening (NAT-aware rate limiting, multi-instance Mongo store)
- ✅ Bounded concurrency semaphores for heavy operations
- ✅ Strict request body limits (16KB auth/vote, 5MB image uploads)
- ✅ MongoDB Atlas integration with connection pooling
- ✅ CORS enabled with preflight caching
- ✅ Lightweight health check & sanitized telemetry endpoint
- ✅ Production-ready configuration

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js 5
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (jsonwebtoken) + bcryptjs
- **File Upload**: Multer
- **Environment**: dotenv

## 📦 Installation

### Prerequisites
- Node.js v16+
- MongoDB Atlas account
- Git

### Local Setup

```bash
# Clone repository
git clone https://github.com/justfsl50/rating.git
cd rating

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env with your credentials
# MONGO_URL=your_mongodb_connection_string
# JWT_SECRET=your_jwt_secret
# PORT=3000

# Start development server
npm run dev

# Or start production server
npm start
```

## 🔧 Environment Variables

Create a `.env` file in the root directory:

```env
MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/database
JWT_SECRET=your_super_secret_jwt_key_min_32_characters
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://your-frontend-url.com
```

## 📡 API Endpoints

### Health & Info
- `GET /` - API information
- `GET /health` - Health check endpoint

### Authentication
- `POST /signup` - Create new user account
- `POST /login` - Login user

### Participants
- `GET /allParticipants` - Get all participants (paginated)
- `GET /allParticipantsByVotes` - Get participants sorted by votes (leaderboard)
- `POST /addParticipants` - Add new participant (authenticated students/admins)
- `DELETE /deleteParticipant/:id` - Delete participant by ID (admin only)
- `POST /voteParticipant/:id` - Vote for a participant (authenticated, during open voting window)

### Admin Controls (Admin JWT Required)
- `GET /admin/votingStatus` - Retrieve current voting window status (`votingEnabled`)
- `POST /admin/startVoting` - Open the voting window for students
- `POST /admin/stopVoting` - Close the voting window (preserves all recorded votes)
- `POST /admin/reconcileVotes` - Reconcile participant counters against canonical ledger

## 🚀 Deploy to Render

### Quick Deploy Steps:

1. **Push to GitHub** (Already done! ✅)

2. **Go to Render Dashboard**: https://dashboard.render.com

3. **Create Web Service**:
   - Click "New +" → "Web Service"
   - Connect this GitHub repository
   - Configure:
     - **Name**: `rating-website-backend`
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`

4. **Add Environment Variables**:
   ```
   MONGO_URL=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret
   PORT=3000
   NODE_ENV=production
   FRONTEND_URL=your_frontend_url
   ```

5. **Deploy** and copy your backend URL!

### Render Configuration

This project includes `render.yaml` with deployment hints.

**Free Tier**: Render offers 750 hours/month free hosting!

## 🛡️ Traffic Hardening & Rate Limiting (Campus Scale)
 
To protect against sudden traffic surges during college project exhibitions while safeguarding legitimate students sharing one public IP:
 
| Rate Limiter | Scope / Route | Window | Default Limit | NAT / Key Strategy |
|---|---|---|---|---|
| **`loginLimiter`** | `POST /login` | 15 min | 30 / account | Keyed by `login_email_<normalized>` (NAT safe). Account brute-force defense without locking out campus peers. |
| **`signupLimiter`** | `POST /signup` | 15 min | 60 / IP | Keyed by `signup_ip_<ip>`. Accommodates campus computer lab batches while blocking bot floods. |
| **`voteLimiter`** | `POST /voteParticipant/:id` | 1 min | 240 / voter | Keyed by cryptographically verified JWT `voter_<userId>`. Students on college Wi-Fi never throttle each other. |
| **`readLimiter`** | `GET /allParticipants*`, `GET /participant/:id`, `GET /myVotes` | 1 min | 10,000 / IP pool | Authenticated students receive separate `reader_<userId>` quota; public shared NAT IP pool gets 10,000 req/min. |
| **`uploadLimiter`** | `POST /addParticipants` | 15 min | 100 / user | Evaluated BEFORE Multer file disk staging and Cloudinary network uploads. |
| **`adminLimiter`** | `/admin/*` operations | 15 min | 120 / admin | Keyed by `admin_<userId>` after `authMiddleware` and `adminOnly` verification. |
| **`imageStreamLimiter`** | `GET /participantImage/:id` | 1 min | 1,200 / IP | Rate limits image proxy and base64 streaming. |
 
### Multi-Instance Distributed Synchronization
- **`RATE_LIMIT_STORE=mongo`**: Uses a MongoDB Atlas `rate_limits` collection with atomic pipeline updates and automated TTL index cleanup (`expiresAt: 0`). When scaled across multiple Render instances, hit counters remain globally synchronized without Redis.
- **Resilient Fallback**: Automatically falls back to an internal MemoryStore if the database is temporarily unreachable or running in offline tests.
 
### Bounded Concurrency Semaphores
- Heavy administrative vote reconciliation (`POST /admin/reconcileVotes`) is bounded to **2 concurrent executions** with a bounded FIFO queue of 5 requests and a 5-second queue timeout.
- Image base64 streaming (`GET /participantImage/:id`) is bounded to **25 concurrent decodings** with a bounded queue of 50 requests.
- When queues reach capacity, requests fail fast with `HTTP 429 Too Many Requests` and a `Retry-After: 5` header, insulating memory and database sockets from overload.
- Critical endpoints (`/health`, `/login`, `/voteParticipant/:id`) are strictly isolated and never gated by heavy operation semaphores.
 
### Request Body & Payload Limits
- Strict 16KB body parser on `/login`, `/signup`, `/voteParticipant/:id`, and `/admin/*`. Oversized JSON payloads trigger fast HTTP 413 rejection before route execution.
- General JSON default body parser bounded to 64KB across the application.
- Multipart form uploads bounded to 5MB file size, 100-character field names, and 1MB max text fields.
 
### Standard HTTP 429 Response Format
All limiters emit uniform RFC 6585 compliant responses with standard draft-7 headers and `Retry-After`:
```json
{
  "error": "Too many requests. Please slow down and try again.",
  "retryAfterSeconds": 45,
  "limit": 100,
  "remaining": 0,
  "resetTime": "2026-10-15T03:30:00.000Z"
}
```

## 📊 Database Schema

### Users Collection
```javascript
{
  name: String (required),
  email: String (required, unique),
  password: String (required, hashed)
}
```

### Participants Collection
```javascript
{
  name: String,
  department: String,
  email: String,
  description: String,
  image: String (base64),
  teamNo: Number,
  votes: Number (default: 0)
}
```

## 🧪 Testing

Test the deployed API:

```bash
# Health check
curl https://your-app.onrender.com/health

# Get all participants
curl https://your-app.onrender.com/allParticipants

# Get leaderboard
curl https://your-app.onrender.com/allParticipantsByVotes
```

## 📝 Scripts

```json
{
  "start": "node index.js",                // Production server
  "dev": "nodemon index.js",               // Development with auto-reload
  "create-admin": "node scripts/createAdmin.js" // Provision administrator account
}
```

## 🏛️ Architecture Documentation

For complete technical specifications, sequence diagrams, and schema details, refer to the root [ARCHITECTURE.md](file:///e:/expovote/ARCHITECTURE.md).


## 🐛 Troubleshooting

### Database Connection Issues
- Verify MongoDB Atlas IP whitelist includes `0.0.0.0/0`
- Check connection string format
- Ensure database user has read/write permissions

### CORS Errors
- Add frontend URL to `FRONTEND_URL` environment variable
- Redeploy after updating environment variables

### Render Deployment Issues
- Check build logs in Render dashboard
- Verify all environment variables are set
- Ensure MongoDB Atlas is accessible

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -m "Add feature"`
4. Push to branch: `git push origin feature-name`
5. Open a Pull Request

## 📄 License

MIT License

## 👤 Author

**justfsl50**
- GitHub: [@justfsl50](https://github.com/justfsl50)

## 🔗 Related

- **Frontend Repository**: Coming soon
- **Full Project Documentation**: See deployment guides

## 📞 Support

For deployment help or issues:
- Open an issue on GitHub
- Check Render documentation: https://render.com/docs
- MongoDB Atlas docs: https://docs.atlas.mongodb.com

---

**⭐ Star this repo if you find it helpful!**

**🚀 Ready to deploy!** Follow the steps above to get your API live on Render.
