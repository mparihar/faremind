import { prisma } from './src/lib/db';
prisma.masterBooking.findMany({ select: { id: true, bookingStatus: true, createdAt: true, updatedAt: true } }).then(b => { console.log(JSON.stringify(b, null, 2)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
