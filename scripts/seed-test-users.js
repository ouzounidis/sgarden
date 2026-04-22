/**
 * seed-test-users.js
 * Creates (or ensures) the two test accounts required by the smoke tests:
 *   admin / admin123  (role: admin)
 *   user  / user1234  (role: user)
 *
 * Usage:  node seed-test-users.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { User } from '../backend/src/models/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load backend .env
// ---------------------------------------------------------------------------
const envPath = path.join(__dirname, '..', 'backend', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const DATABASE_URL =
  process.env.DATABASE_URL || 'mongodb://localhost:27017/testDB';

async function upsertUser({ username, email, password, role }) {
  const existing = await User.findOne({ username }).select('+password');
  if (existing) {
    // Backend User model pre-save hook hashes passwords.
    existing.password = password;
    existing.role = role;
    await existing.save();
    console.log(`  [updated] ${username} (role: ${role})`);
  } else {
    const user = new User({
      username,
      email,
      // Backend User model pre-save hook hashes passwords.
      password,
      role,
    });
    await user.save();
    console.log(`  [created] ${username} (role: ${role})`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  process.stdout.write('Seeding test users… ');

  try {
    await mongoose.connect(DATABASE_URL);

    await upsertUser({ username: 'admin', email: 'admin@sgarden.test', password: 'admin123', role: 'admin' });
    await upsertUser({ username: 'user',  email: 'user@sgarden.test',  password: 'user1234',  role: 'user'  });

    await mongoose.disconnect();
    console.log('Done.');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }

}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
