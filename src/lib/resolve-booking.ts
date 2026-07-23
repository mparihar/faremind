// FILE: src/lib/resolve-booking.ts
// Resolve a MasterBooking from ANY identifier a staff member might paste into a
// servicing console: the MasterBooking id, the FareMind reference (FM…), the
// airline PNR, or the Mystifly UniqueID / provider order id (MF…). Post-booking
// tools accept "MFRef or Booking ID", so all of these must resolve.
import { prisma } from '@/lib/db';

export interface ResolvedBooking {
  id: string;
  masterBookingReference: string;
  bookingStatus: string;
}

export async function resolveBookingByAnyRef(ref: string): Promise<ResolvedBooking | null> {
  const value = (ref || '').trim();
  if (!value) return null;

  const booking = await prisma.masterBooking.findFirst({
    where: {
      OR: [
        { id: value },
        { masterBookingReference: value },
        { masterPnr: value },
        { mystiflyMfRef: value },
        { providerOrderId: value },
        { pnrs: { some: { providerOrderId: value } } },
      ],
    },
    select: { id: true, masterBookingReference: true, bookingStatus: true },
  });

  return booking as ResolvedBooking | null;
}
