/**
 * InternTrack — Firebase Role Setup Script
 * =========================================
 * Run this ONCE to assign Firebase custom claims (role + teamId)
 * to all users in your database so login routing works correctly.
 *
 * Usage:
 *   node setup-roles.js
 */

require('dotenv').config();
const admin = require('firebase-admin');
const { initializeDatabase, dbHelpers } = require('./database');

// ── Init Firebase Admin ───────────────────────────────────────
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

async function main() {
  console.log('\n🚀 InternTrack — Firebase Role Setup\n');

  // MUST await — database uses sql.js which initialises asynchronously
  await initializeDatabase();
  console.log('✅  Database loaded\n');

  const roles = ['Admin', 'Leader', 'Student', 'Supervisor'];
  let totalUpdated = 0;
  let totalMissing = 0;
  let totalErrors  = 0;

  for (const role of roles) {
    const users = dbHelpers.getUsersByRole(role);
    if (!users.length) {
      console.log(`   ${role}: none in database`);
      continue;
    }

    console.log(`── ${role}s (${users.length}) ──────────────────────`);

    for (const user of users) {
      try {
        const fbUser = await admin.auth().getUserByEmail(user.Email);
        await admin.auth().setCustomUserClaims(fbUser.uid, {
          role:   user.Role,
          teamId: user.TeamID || null,
        });
        console.log(`  ✅  ${user.Name} <${user.Email}>  →  role="${user.Role}"  teamId=${user.TeamID ?? 'null'}`);
        totalUpdated++;
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          console.log(`  ⚠️   ${user.Name} <${user.Email}>  →  NOT IN Firebase Auth`);
          console.log(`        → Create this user in Firebase Console then run this script again`);
          totalMissing++;
        } else {
          console.log(`  ❌  ${user.Name} <${user.Email}>  →  ${err.message}`);
          totalErrors++;
        }
      }
    }
    console.log('');
  }

  console.log('────────────────────────────────────────');
  console.log(`✅  Updated : ${totalUpdated}`);
  if (totalMissing) console.log(`⚠️   Missing : ${totalMissing}  (not yet in Firebase Auth)`);
  if (totalErrors)  console.log(`❌  Errors  : ${totalErrors}`);
  console.log('');

  if (totalMissing) {
    console.log('To fix missing users:');
    console.log('  1. Firebase Console → Authentication → Users → Add user');
    console.log('  2. Use the same email & password as in your database');
    console.log('  3. Run  node setup-roles.js  again\n');
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
