import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { prisma } from './src/lib/db';

async function main() {
  await prisma.changeRequest.deleteMany({});
  await prisma.cancellationRecord.deleteMany({});
  await prisma.bookingPassengerUpdate.deleteMany({});
  await prisma.bookingRefund.deleteMany({});
  console.log("Deleted all pending work from database.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
