const mongoose = require("mongoose");
const { Schema } = mongoose;

const voteSchema = new Schema(
  {
    voterId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: "participants",
      required: true,
    },
    contestId: {
      type: String,
      required: true,
      default: "default",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Enforce one vote per voter per contest
voteSchema.index({ contestId: 1, voterId: 1 }, { unique: true });

// Query optimization for participant vote aggregation
voteSchema.index({ participantId: 1 });

const VoteModel = mongoose.model("Vote", voteSchema);

module.exports = VoteModel;
