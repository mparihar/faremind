import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { Pool } from 'pg';
// @ts-ignore
import { PrismaClient } from '../src/generated/prisma/client.js';
// @ts-ignore
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = 'mparihar@gmail.com';
  const password = '778899';

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.adminUser.findUnique({ where: { email } });

  if (existing) {
    await prisma.adminUser.update({
      where: { email },
      data: { passwordHash, role: 'SUPER_ADMIN', isActive: true },
    });
    console.log(`✅ Updated super admin: ${email}`);
  } else {
    await prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        fullName: 'Maulik Parihar',
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });
    console.log(`✅ Created super admin: ${email}`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
