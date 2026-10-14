const mongoose = require("mongoose");
const { ParticipantsModel } = require("../models/participantsModels");
const VoteModel = require("../models/voteModel");
const SettingModel = require("../models/settingModel");

// Process-level status synchronization and short TTL cache for eliminating redundant DB reads
let inMemoryVotingEnabled = false;
let lastSettingFetchTime = 0;
const SETTING_CACHE_TTL_MS = 3000;

/**
 * Retrieves the current global voting status.
 * Safe default: voting is disabled (false) until explicitly enabled by an administrator.
 * Fail closed: any database read errors safely return false.
 * Uses a 3-second memory cache for non-transactional reads to eliminate repeated DB round trips.
 *
 * @param {import("mongoose").ClientSession} [session] - Optional Mongoose session for transactional reads
 * @param {boolean} [forceFresh] - Force fresh read from database bypassing cache
 * @returns {Promise<boolean>}
 */
async function isVotingEnabled(session = null, forceFresh = false) {
  // If inside an explicit transactional session, we must read within that session for ACID consistency
  if (session) {
    try {
      const setting = await SettingModel.findOne({ key: "votingEnabled" }, { value: 1 }).session(session).lean();
      const enabled = setting ? Boolean(setting.value) : false;
      inMemoryVotingEnabled = enabled;
      lastSettingFetchTime = Date.now();
      return enabled;
    } catch (err) {
      console.error("Error reading votingEnabled in session:", err);
      return false;
    }
  }

  // Fast path: cached in-memory read if within TTL and not forcing fresh
  const now = Date.now();
  if (!forceFresh && now - lastSettingFetchTime < SETTING_CACHE_TTL_MS) {
    return inMemoryVotingEnabled;
  }

  try {
    const setting = await SettingModel.findOne({ key: "votingEnabled" }, { value: 1 }).lean();
    const enabled = setting ? Boolean(setting.value) : false;
    inMemoryVotingEnabled = enabled;
    lastSettingFetchTime = now;
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
 * Sets the global voting status persistently in MongoDB and invalidates local cache immediately.
 *
 * @param {boolean} enabled - Whether voting should be enabled
 * @returns {Promise<boolean>}
 */
async function setVotingEnabled(enabled) {
  inMemoryVotingEnabled = Boolean(enabled);
  lastSettingFetchTime = Date.now();

  const setting = await SettingModel.findOneAndUpdate(
    { key: "votingEnabled" },
    { value: Boolean(enabled), updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  inMemoryVotingEnabled = Boolean(setting.value);
  lastSettingFetchTime = Date.now();
  return inMemoryVotingEnabled;
}

/**
 * Reconciles participant vote counts with the canonical Vote ledger.
 * Handles crashes that may occur between Vote insertion and counter increment.
 * Respects legacyVotes if set.
 * Parallelizes tallies aggregation and participant fetching for maximum throughput.
 *
 * @param {string} contestId - The contest identifier (default: "default")
 * @returns {Promise<{ reconciledParticipants: number, totalLedgerVotes: number }>}
 */
async function reconcileVotes(contestId = "default") {
  // Parallelize independent queries: Vote ledger aggregation + Participant list fetch
  const [tallies, allParticipants] = await Promise.all([
    VoteModel.aggregate([
      { $match: { contestId } },
      { $group: { _id: "$participantId", count: { $sum: 1 } } },
    ]),
    ParticipantsModel.find(
      {},
      { _id: 1, votes: 1, legacyVotes: 1 }
    ).lean(),
  ]);

  const tallyMap = new Map();
  let totalLedgerVotes = 0;
  for (const item of tallies) {
    tallyMap.set(item._id.toString(), item.count);
    totalLedgerVotes += item.count;
  }

  let reconciledParticipants = 0;
  const bulkOps = [];

  for (const p of allParticipants) {
    const ledgerCount = tallyMap.get(p._id.toString()) || 0;
    const baseLegacy = p.legacyVotes || 0;
    const correctTotal = baseLegacy + ledgerCount;

    if (p.votes !== correctTotal) {
      reconciledParticipants++;
      bulkOps.push({
        updateOne: {
          filter: { _id: p._id },
          update: { $set: { votes: correctTotal } },
        },
      });
    }
  }

  if (bulkOps.length > 0) {
    await ParticipantsModel.bulkWrite(bulkOps, { ordered: false });
  }

  return {
    reconciledParticipants,
    totalLedgerVotes,
  };
}

let lastVoteActivityAt = null;

function recordVoteActivity() {
  lastVoteActivityAt = new Date();
}

function getLastVoteActivity() {
  return lastVoteActivityAt;
}

module.exports = {
  reconcileVotes,
  isVotingEnabled,
  isVotingEnabledSync,
  setVotingEnabled,
  recordVoteActivity,
  getLastVoteActivity,
};
