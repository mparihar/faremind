/**
 * The passenger title, derived in one place.
 *
 *   Adult   Mr   (male)    Ms   (female)
 *   Child   Mstr (male)    Miss (female)
 *   Infant  Mstr (male)    Miss (female)
 *
 * An infant takes the same title as a child. The booking path used to send the
 * literal `INF`, which Mystifly accepts and then stores as a gender title of its
 * own choosing — FM83B9T2's female infant came back `MS` instead of `Miss`.
 * The [TITLE-DIAG] log has since proved we now send `Miss` and Mystifly stores
 * `MS` regardless — that part is the provider's, and is with their support.
 *
 * Four call sites derived this independently (book, PTR, reissue, Duffel) and
 * disagreed with each other, which is how a wrong value survived. They all read
 * from here now.
 *
 * Adults are MR/MS rather than MRS/MISS deliberately: marital status is never
 * collected, and MS is the correct neutral form for a female adult.
 */

/**
 * Title case, matching Mystifly's PassengerTitle enum
 * ('Mr' | 'Mrs' | 'Ms' | 'Miss' | 'Mstr'). Upper case is NOT interchangeable —
 * the contract is cased.
 */
export type PassengerTitle = 'Mr' | 'Ms' | 'Mstr' | 'Miss';
export type PassengerTitleCased = PassengerTitle;

export type NormalizedPaxType = 'ADT' | 'CHD' | 'INF';

/** Accepts adult/child/infant, ADT/CHD/INF, and the single-letter forms. */
export function normalizePaxType(raw?: string | null): NormalizedPaxType {
  const t = String(raw ?? 'adult').trim().toLowerCase();
  if (t.startsWith('inf') || t === 'i') return 'INF';
  if (t.startsWith('child') || t.startsWith('chd') || t === 'c') return 'CHD';
  return 'ADT';
}

function isFemale(gender?: string | null): boolean {
  const g = String(gender ?? '').trim().toLowerCase();
  return g === 'female' || g === 'f';
}

/** The title, as both the booking and PTR contracts expect it. */
export function passengerTitle(gender?: string | null, type?: string | null): PassengerTitle {
  const t = normalizePaxType(type);
  const female = isFemale(gender);
  // A child and an infant carry the same title; only an adult differs.
  if (t === 'CHD' || t === 'INF') return female ? 'Miss' : 'Mstr';
  return female ? 'Ms' : 'Mr';
}

/** Alias kept so the PTR builder reads clearly at its call site. */
export const passengerTitleCased = passengerTitle;
