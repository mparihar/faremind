/**
 * Build the `passengers` array required by every Mystifly Post-Ticketing Request
 * (VoidQuote / Void / RefundQuote / Refund / ReIssueQuote). Per Mystifly's PTR
 * contract each passenger needs: firstName, lastName, title, eTicket, passengerType.
 * Omitting this array is rejected by Mystifly as "Please verify the request."
 *
 * Source is the persisted MasterBooking (passengers + tickets from
 * getMasterBookingFull). eTicket is matched per passenger via BookingTicket.
 */

export interface PtrPassenger {
  firstName: string;
  lastName: string;
  title: string;
  eTicket: string;
  passengerType: 'ADT' | 'CHD' | 'INF';
}

function paxType(raw?: string): 'ADT' | 'CHD' | 'INF' {
  const t = (raw || 'adult').toLowerCase();
  if (t.startsWith('child') || t === 'chd' || t === 'c') return 'CHD';
  if (t.startsWith('inf') || t === 'inf' || t === 'i') return 'INF';
  return 'ADT';
}

function titleFor(p: any, type: 'ADT' | 'CHD' | 'INF'): string {
  // BookingPassenger has no title; derive from gender (child/infant → Mstr/Miss).
  const g = (p.gender || '').toLowerCase();
  if (type !== 'ADT') return g === 'female' || g === 'f' ? 'Miss' : 'Mstr';
  return g === 'female' || g === 'f' ? 'Ms' : 'Mr';
}

export function buildPtrPassengers(booking: any): PtrPassenger[] {
  const passengers = booking?.passengers || [];
  const tickets = booking?.tickets || [];
  return passengers.map((p: any) => {
    const type = paxType(p.passengerType);
    const ticket = tickets.find((t: any) => t.passengerId === p.id);
    const eTicket = ticket?.eTicketNumber || ticket?.ticketNumber || '';
    return {
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      title: titleFor(p, type),
      eTicket,
      passengerType: type,
    };
  });
}
