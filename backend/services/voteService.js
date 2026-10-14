const mongoose = require("mongoose");
const { ParticipantsModel } = require("../models/participantsModels");
const VoteModel = require("../models/voteModel");

/**
 * Reconciles participant vote counts with the canonical Vote ledger.
 * Handles crashes that may occur between Vote insertion and counter increment.
 * Respects legacyVotes if set.
 *
 * @param {string} contestId - The contest identifier (default: "default")
 * @returns {Promise<{ reconciledParticipants: number, totalLedgerVotes: number }>}
 */
async function reconcileVotes(contestId = "default") {
  // 1. Aggregate total confirmed votes per participant in this contest
  const tallies = await VoteModel.aggregate([
    { $match: { contestId } },
    { $group: { _id: "$participantId", count: { $sum: 1 } } },
  ]);

  const tallyMap = new Map();
  let totalLedgerVotes = 0;
  for (const item of tallies) {
    tallyMap.set(item._id.toString(), item.count);
    totalLedgerVotes += item.count;
  }

  // 2. Update participants to reflect exact ledger counts
  const allParticipants = await ParticipantsModel.find({});
  let reconciledParticipants = 0;

  for (const participant of allParticipants) {
    const ledgerCount = tallyMap.get(participant._id.toString()) || 0;
    const baseLegacy = participant.legacyVotes || 0;
    const correctTotal = baseLegacy + ledgerCount;

    if (participant.votes !== correctTotal) {
      participant.votes = correctTotal;
      await participant.save();
      reconciledParticipants++;
    }
  }

  return {
    reconciledParticipants,
    totalLedgerVotes,
  };
}

module.exports = {
  reconcileVotes,
};
