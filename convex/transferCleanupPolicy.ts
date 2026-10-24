// Every retry is scheduled by the terminal transfer mutation itself. These
// are absolute offsets from that transaction, not delays chained from a prior
// scheduled action, so one at-most-once action failure cannot strand cleanup.
export const TRANSFER_CLEANUP_RETRY_OFFSETS_MS = [
  2_000,
  30_000,
  ...Array.from({ length: 15 }, (_, index) => (index + 1) * 60_000),
] as const;

export const TRANSFER_JOIN_TOKEN_TTL = "1m";
export const TRANSFER_JOIN_TOKEN_TTL_MS = 60_000;
