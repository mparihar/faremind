import { passengerTitleCased } from './passenger-title';

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
  // BookingPassenger has no title; derive it. Shared with the booking path so a
  // PTR cannot address a passenger differently from how they were ticketed.
  return passengerTitleCased(p.gender, type);
}

export function buildPtrPassengers(booking: any): PtrPassenger[] {
  const passengers = booking?.passengers || [];
  const tickets = booking?.tickets || [];
  return passengers.map((p: any) => {
    const type = paxType(p.passengerType);
    // A passenger can carry more than one BookingTicket row and only some of them hold
    // a number, so pick the first row that actually has one rather than the first row
    // outright — otherwise the e-ticket comes back empty and Mystifly rejects the PTR
    // with "Please Specify ETicket Number for Passenger".
    const mine = tickets.filter((t: any) => t.passengerId === p.id);
    const ticket = mine.find((t: any) => t.eTicketNumber || t.ticketNumber) || mine[0];
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
