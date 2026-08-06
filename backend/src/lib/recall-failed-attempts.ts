/**
 * Recall passenger details from a booking attempt that failed.
 *
 * Passenger recall reads `booking_passengers`, which only exist once a booking
 * completes. A failed attempt writes none — and that is exactly the moment
 * someone is about to re-enter the same three travellers, because the fare died
 * under them and they are starting again.
 *
 * `booking_failure_audits` kept what they typed. Less of it than a real booking
 * row: name, date of birth, nationality, phone and email, with no passport and
 * no gender, and the name stored as one combined string. Partial is still worth
 * having — whatever is known gets filled and the rest is left for the traveller,
 * which beats a blank form.
 *
 * A completed booking always wins over an audit; this is the fallback.
 */
import { prisma } from './db';

export interface RecalledPassenger {
  firstName: string;
  lastName: string;
  middleName: string;
  email: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  nationality: string;
  passportCountry: string;
  passportNumber: string;
  passportExpiry: string;
}

interface AuditPassenger {
  name?: string;
  type?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  nationality?: string;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

/**
 * Split the audit's single `name` field.
 *
 * The first token is the given name and the remainder the family name, so
 * "Avinish Kumar" splits cleanly and "Mary Anne Van Der Berg" keeps the whole
 * surname together rather than losing everything after the second word.
 */
export function splitAuditName(full: string | undefined | null): { firstName: string; lastName: string } {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** ISO-ish date for a date input; the audit already stores YYYY-MM-DD. */
function isoDate(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : '';
}

/**
 * Find a traveller in this caller's failed attempts.
 *
 * Scoped the same way completed-booking recall is: the caller must own the
 * attempt, either as the customer or as the agent who made it. The contact email
 * is the family key, matched against the attempt's customer email so a child
 * with no address of their own is still reachable.
 */
export async function recallFromFailedAttempts(params: {
  callerId: string;
  firstName: string;
  lastName: string;
  contactEmail: string;
}): Promise<RecalledPassenger | null> {
  const { callerId, firstName, lastName, contactEmail } = params;
  if (!callerId || !firstName || !contactEmail) return null;

  const audits = await prisma.bookingFailureAudit.findMany({
    where: {
      userId: callerId,
      customerEmail: { equals: contactEmail, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { passengersJson: true, customerPhone: true, customerEmail: true },
  }).catch(() => []);

  for (const audit of audits) {
    let list: AuditPassenger[] = [];
    try {
      const parsed = JSON.parse(audit.passengersJson);
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      continue; // a malformed audit is not worth failing recall over
    }

    for (const p of list) {
      const { firstName: pf, lastName: pl } = splitAuditName(p?.name);
      const nameMatches =
        norm(pf) === norm(firstName) &&
        (norm(pl) === norm(lastName) || !lastName || !pl);
      if (!nameMatches) continue;

      return {
        firstName: pf,
        lastName: pl,
        middleName: '',
        email: String(p?.email ?? '').trim(),
        // Only the booker's phone is collected, so a child inherits the
        // attempt's contact number rather than nothing.
        phone: String(p?.phone ?? '').trim() || String(audit.customerPhone ?? '').trim(),
        gender: '',            // not captured on a failed attempt
        dateOfBirth: isoDate(p?.dateOfBirth),
        nationality: String(p?.nationality ?? '').trim(),
        passportCountry: '',   // not captured
        passportNumber: '',    // not captured
        passportExpiry: '',    // not captured
      };
    }
  }

  return null;
}
