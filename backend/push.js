const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const { execSync } = require('child_process');

try {
  execSync('npx prisma db push --schema ../prisma/schema.prisma', { stdio: 'inherit' });
} catch (e) {
  console.error(e);
  process.exit(1);
}
