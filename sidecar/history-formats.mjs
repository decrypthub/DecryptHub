// Released host formats. Storage generations and event schemas evolve separately.
export const CURRENT_EVENT_VERSION = 3;
export const CURRENT_STORAGE_VERSION = 5;
export const HISTORY_EVENT_FORMATS = Object.freeze([
  Object.freeze({ version: 1, representation: 'legacy-message-array', migration: 'migrateV1' }),
  Object.freeze({ version: 2, representation: 'event-timeline', migration: 'preserve-events' }),
  Object.freeze({ version: 3, representation: 'event-timeline-with-interval-summaries', migration: 'current' }),
]);
export const HISTORY_STORAGE_FORMATS = Object.freeze([
  Object.freeze({ version: 4, encoding: 'jsonl', writable: false }),
  Object.freeze({ version: 5, encoding: 'checksummed-zstd-jsonl', writable: true }),
]);
