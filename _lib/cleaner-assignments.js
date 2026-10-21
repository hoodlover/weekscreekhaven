import { LEGACY_CLEANER_ID } from './cleaner-profiles.js';

export function cleaningCleanerId(state, bookingId) {
  const assignment = state.assignments.find(item => item.bookingId === bookingId);
  return assignment ? assignment.cleanerId || LEGACY_CLEANER_ID : state.settings.primaryCleanerId || LEGACY_CLEANER_ID;
}

export function cleanerOwnsCleaning(state, bookingId, cleanerId) {
  return cleaningCleanerId(state, bookingId) === cleanerId;
}
