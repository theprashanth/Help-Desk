/**
 * Ticket numbers look like "#41130": a hash and a number that counts up.
 * The old "TICKET-1130" style maps to "#41130" (old number + 40000), so nothing collides and order is kept.
 */

export const LEGACY_OFFSET = 40000;

/** The running number inside a ticket number ("#41130" → 41130, legacy "TICKET-1130" → 41130). */
export function ticketSeq(ticketNumber: string | undefined | null): number {
  const s = String(ticketNumber || '');
  const legacy = s.match(/^TICKET-(\d+)$/);
  if (legacy) return LEGACY_OFFSET + Number(legacy[1]);
  const n = parseInt(s.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/** The next free number after every existing one (never reuses a number, even after deletes). */
export function nextTicketNumber(existing: Iterable<string | undefined | null>): string {
  let max = LEGACY_OFFSET + 1000;
  for (const t of existing) max = Math.max(max, ticketSeq(t));
  return `#${max + 1}`;
}

const LEGACY_RE = /#?TICKET-(\d+)/g;

/** Rewrite every legacy "TICKET-1130" / "#TICKET-1130" inside a string to "#41130". */
export const migrateLegacyText = (s: string) => s.replace(LEGACY_RE, (_m, n) => `#${LEGACY_OFFSET + Number(n)}`);

export const hasLegacyTicketText = (s: string) => /TICKET-\d+/.test(s);
