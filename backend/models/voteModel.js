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

// Enforce at most one vote per voter per participant per contest
voteSchema.index({ contestId: 1, voterId: 1, participantId: 1 }, { unique: true });

// Query optimization for participant vote deletion
voteSchema.index({ participantId: 1 });

// Covered aggregation index for reconcileVotes ({ $match: { contestId } }, { $group: { _id: "$participantId" } })
voteSchema.index({ contestId: 1, participantId: 1 });

// Query optimization for voter history (/myVotes)
voteSchema.index({ contestId: 1, voterId: 1 });

const VoteModel = mongoose.model("Vote", voteSchema);

module.exports = VoteModel;
