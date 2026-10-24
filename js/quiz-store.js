// quiz-store.js - saves quiz attempts in the browser's localStorage.
//
// Everything here is wrapped so that a missing, blocked, full or damaged
// localStorage can never crash the site. Quizzes still work; they just
// cannot be saved.
//
// What is stored (one key):
//   { "schemaVersion": 1, "attempts": [ attempt, attempt, ... ] }
// Each attempt is added as a NEW entry; earlier attempts are never overwritten.
//
// LIMIT: localStorage belongs to one browser profile on one device. History
// does not sync to other browsers or devices, and clearing the browser's site
// data removes it.

import { validateAttempt } from "./quiz-core.js";

export const STORAGE_KEY = "sanskritMitram.quizHistory";
const BACKUP_KEY = STORAGE_KEY + ".unreadable-backup";
const FORMAT_VERSION = 1;

let provider = () => window.localStorage;

// Only for tests: lets a test supply a fake storage.
export function _setStorageProvider(fn) {
  provider = fn;
}

function getStorage() {
  try {
    return provider() || null; // reading window.localStorage can itself throw
  } catch {
    return null;
  }
}

// Returns { storage, entries, rootProblem }.
// entries is the raw list of saved attempts (unchecked).
function readRoot() {
  const storage = getStorage();
  if (!storage) return { storage: null, entries: [], rootProblem: false };

  let text;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { storage: null, entries: [], rootProblem: false };
  }
  if (text === null) return { storage, entries: [], rootProblem: false };

  try {
    const root = JSON.parse(text);
    if (root && root.schemaVersion === FORMAT_VERSION && Array.isArray(root.attempts)) {
      return { storage, entries: root.attempts, rootProblem: false, text };
    }
  } catch {
    // fall through: unreadable
  }
  return { storage, entries: [], rootProblem: true, text };
}

function writeRoot(storage, entries) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: FORMAT_VERSION, attempts: entries }));
}

// Returns { available, attempts, skipped }.
//   available: false when localStorage cannot be used at all
//   attempts:  valid attempts, newest first
//   skipped:   how many saved entries were damaged and ignored
export function loadAttempts() {
  const { storage, entries, rootProblem } = readRoot();
  if (!storage) return { available: false, attempts: [], skipped: 0 };

  const attempts = [];
  let skipped = rootProblem ? 1 : 0;
  entries.forEach((entry, position) => {
    const attempt = validateAttempt(entry);
    if (attempt) attempts.push({ attempt, position });
    else skipped++;
  });

  // Newest first. Equal or unreadable times fall back to the saving order.
  const time = (a) => {
    const t = Date.parse(a.submittedAt);
    return Number.isNaN(t) ? 0 : t;
  };
  attempts.sort((a, b) => time(b.attempt) - time(a.attempt) || b.position - a.position);
  return { available: true, attempts: attempts.map((x) => x.attempt), skipped };
}

// Returns { ok: true } or { ok: false, reason }.
export function saveAttempt(attempt) {
  const { storage, entries, rootProblem, text } = readRoot();
  if (!storage) return { ok: false, reason: "unavailable" };

  try {
    if (rootProblem && text) {
      // Keep a copy of what we could not read before starting a fresh list.
      try {
        storage.setItem(BACKUP_KEY, text);
      } catch {
        // If even the backup does not fit, carry on.
      }
    }
    writeRoot(storage, [...entries, attempt]); // existing entries are kept untouched
    return { ok: true };
  } catch {
    return { ok: false, reason: "write-failed" }; // storage full or blocked
  }
}

export function getAttempt(attemptId) {
  return loadAttempts().attempts.find((a) => a.attemptId === attemptId) || null;
}

export function latestAttemptFor(quizId) {
  return loadAttempts().attempts.find((a) => a.quizId === quizId) || null;
}

// Removes ALL saved attempts (and the unreadable-data backup).
export function clearHistory() {
  const storage = getStorage();
  if (!storage) return { ok: false };
  try {
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(BACKUP_KEY);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
