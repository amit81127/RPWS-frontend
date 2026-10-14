const { Schema } = require("mongoose");

const participantsSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    department: { type: String, default: "", trim: true },
    projectName: { type: String, default: "", trim: true },
    email: { type: String, trim: true },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    teamNo: { type: Number },
    votes: { type: Number, default: 0 },
    legacyVotes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Indexes based on actual query patterns
// 1. Leaderboard query sorting by votes descending
participantsSchema.index({ votes: -1, _id: 1 });

// 2. Participant list feed sorting by createdAt descending
participantsSchema.index({ createdAt: -1, _id: 1 });

// 3. Team number search lookup (sparse to allow null values without collision)
participantsSchema.index({ teamNo: 1 }, { sparse: true });

module.exports = { participantsSchema };
