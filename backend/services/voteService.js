const mongoose = require("mongoose");
const { ParticipantsModel } = require("../models/participantsModels");
const VoteModel = require("../models/voteModel");
const SettingModel = require("../models/settingModel");

// Process-level status synchronization for immediate in-flight cutoff
let inMemoryVotingEnabled = false;

/**
 * Retrieves the current global voting status.
 * Safe default: voting is disabled (false) until explicitly enabled by an administrator.
 * Fail closed: any database read errors safely return false.
 *
 * @param {import("mongoose").ClientSession} [session] - Optional Mongoose session for transactional reads
 * @returns {Promise<boolean>}
 */
async function isVotingEnabled(session = null) {
  try {
    const query = SettingModel.findOne({ key: "votingEnabled" });
    if (session) {
      query.session(session);
    }
    const setting = await query;
    const enabled = setting ? Boolean(setting.value) : false;
    inMemoryVotingEnabled = enabled;
    return enabled;
  } catch (err) {
    console.error("Error reading votingEnabled status (failing closed):", err);
    inMemoryVotingEnabled = false;
    return false;
  }
}

/**
 * Immediate synchronous check to detect in-process stop cutoff.
 * @returns {boolean}
 */
function isVotingEnabledSync() {
  return inMemoryVotingEnabled;
}

/**
 * Sets the global voting status persistently in MongoDB.
 *
 * @param {boolean} enabled - Whether voting should be enabled
 * @returns {Promise<boolean>}
 */
async function setVotingEnabled(enabled) {
  inMemoryVotingEnabled = Boolean(enabled);
  const setting = await SettingModel.findOneAndUpdate(
    { key: "votingEnabled" },
    { value: Boolean(enabled), updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  inMemoryVotingEnabled = Boolean(setting.value);
  return inMemoryVotingEnabled;
}

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
  isVotingEnabled,
  isVotingEnabledSync,
  setVotingEnabled,
};
