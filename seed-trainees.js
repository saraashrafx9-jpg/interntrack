/**
 * InternTrack — Trainee Seed Script
 * Run once to populate teams and all trainee accounts.
 * Usage: node seed-trainees.js
 */

require('dotenv').config();
const { initializeDatabase, dbHelpers } = require('./database');

const teams = [
  {
    name: 'Software Team',
    leader: { name: 'Hadi Taha',     email: 'hadi.taha.psp2.2026@gmail.com',     password: 'H.Taha@sgmb2026!' },
    members: [
      { name: 'Mohammad Sami',    email: 'mohammad.sami.psp2.2026@gmail.com',    password: 'M.Sami@sgmb2026!' },
      { name: 'Mohamed Rihawi',   email: 'mohamed.rihawi.psp2.2026@gmail.com',   password: 'M.Rihawi@sgmb2026!' },
      { name: 'Omair Masood',     email: 'omair.masood.psp2.2026@gmail.com',     password: 'O.Masood@sgmb2026!' },
      { name: 'Ahmed Alminhali',  email: 'ahmed.alminhali.psp2.2026@gmail.com',  password: 'A.Alminhali@sgmb2026!' },
      { name: 'Aladdin Abu Jaish',email: 'aladdin.abujaish.psp2.2026@gmail.com', password: 'A.Abujaish@sgmb2026!' },
      { name: 'Hussein Hussein',  email: 'hussein.hussein.psp2.2026@gmail.com',  password: 'H.Hussein@sgmb2026!' },
    ],
  },
  {
    name: 'Website Team',
    leader: { name: 'Juwana Abdalla', email: 'juwana.abdalla.psp2.2026@gmail.com', password: 'J.Abdalla@sgmb2026!' },
    members: [
      { name: 'Maryam Jumaah',   email: 'maryam.jumaah.psp2.2026@gmail.com',   password: 'M.Jumaah@sgmb2026!' },
      { name: 'Sara Ashraf',     email: 'sara.ashraf.psp2.2026@gmail.com',     password: 'S.Ashraf@sgmb2026!' },
      { name: 'Roba Rajab',      email: 'roba.rajab.psp2.2026@gmail.com',      password: 'R.Rajab@sgmb2026!' },
      { name: 'Imaan Idrees',    email: 'imaan.idrees.psp2.2026@gmail.com',    password: 'I.Idrees@sgmb2026!' },
      { name: 'Haneen Theibeche',email: 'haneen.theibeche.psp2.2026@gmail.com',password: 'H.Theibeche@sgmb2026!' },
      { name: 'Rana Naim',       email: 'rana.naim.psp2.2026@gmail.com',       password: 'R.Naim@sgmb2026!' },
    ],
  },
  {
    name: 'Media Team',
    leader: { name: 'Saud Aldarmaki', email: 'saud.aldarmaki.psp2.2026@gmail.com', password: 'S.Aldarmaki@sgmb2026!' },
    members: [
      { name: 'Hessa Alshamsi',   email: 'hessa.alshamsi.psp2.2026@gmail.com',   password: 'H.Alshamsi@sgmb2026!' },
      { name: 'Shahad Alzahmi',   email: 'shahad.alzahmi.psp2.2026@gmail.com',   password: 'S.Alzahmi@sgmb2026!' },
      { name: 'Nour Ashraf',      email: 'nour.ashraf.psp2.2026@gmail.com',      password: 'N.Ashraf@sgmb2026!' },
      { name: 'Fatima Alshamsi',  email: 'fatima.alshamsi.psp2.2026@gmail.com',  password: 'F.Alshamsi@sgmb2026!' },
      { name: 'Raghad Alnaqbi',   email: 'raghad.alnaqbi.psp2.2026@gmail.com',   password: 'R.Alnaqbi@sgmb2026!' },
      { name: 'Fatima Alketbi',   email: 'fatima.alketbi.psp2.2026@gmail.com',   password: 'F.Alketbi@sgmb2026!' },
      { name: 'Hamda Almaazmi',   email: 'hamda.almaazmi2.psp2.2026@gmail.com',  password: 'H.Almaazmi@sgmb2026!' },
      { name: 'Hassan Alblooshi', email: 'hassan.alblooshi.psp2.2026@gmail.com', password: 'H.Alblooshi@sgmb2026!' },
      { name: 'Yousif Al Ali',    email: 'yousif.alali.psp2.2026@gmail.com',     password: 'Y.Alali@sgmb2026!' },
    ],
  },
  {
    name: 'Cloud Team',
    leader: { name: 'Basel Tarify', email: 'basel.tarify.psp2.2026@gmail.com', password: 'B.Tarify@sgmb2026!' },
    members: [
      { name: 'Yahya AbdAlhakin',   email: 'yahya.abdalhakin.psp2.2026@gmail.com',  password: 'Y.Abdalhakin@sgmb2026!' },
      { name: 'Mina Maged',         email: 'mina.maged.psp2.2026@gmail.com',         password: 'M.Maged@sgmb2026!' },
      { name: 'Malek Ramadan',      email: 'malek.ramadan.psp2.2026@gmail.com',      password: 'M.Ramadan@sgmb2026!' },
      { name: 'Basim Belal',        email: 'basim.belal.psp2.2026@gmail.com',        password: 'B.Belal@sgmb2026!' },
      { name: 'Ahmad Albloshi',     email: 'ahmad.albloshi.psp2.2026@gmail.com',     password: 'A.Albloshi@sgmb2026!' },
      { name: 'Mohamad Alhomsi',    email: 'mohamad.alhomsi.psp2.2026@gmail.com',    password: 'M.Alhomsi@sgmb2026!' },
      { name: 'Moatassim Arbaoui',  email: 'moatassim.arbaoui.psp2.2026@gmail.com',  password: 'M.Arbaoui@sgmb2026!' },
    ],
  },
  {
    name: 'IT Group',
    leader: { name: 'Samira Al Saqqa', email: 'samira.alsaqqa.psp2.2026@gmail.com', password: 'S.Al Saqqa@sgmb2026!' },
    members: [
      { name: 'Lana Alimam',     email: 'lana.alimam.psp2.2026@gmail.com',     password: 'L.Alimam@sgmb2026!' },
      { name: 'Sama Altabbakha', email: 'sama.altabbakha.psp2.2026@gmail.com', password: 'S.Altabbakha@sgmb2026!' },
      { name: 'Faris Dahabreh',  email: 'faris.dahabreh.psp2.2026@gmail.com',  password: 'F.Dahabreh@sgmb2026!' },
    ],
  },
  {
    name: 'Management Group',
    leader: { name: 'Maria Almulla', email: 'maria.almulla.psp2.2026@gmail.com', password: 'M.Almulla@sgmb2026!' },
    members: [
      { name: 'Maitha Alkaabi',    email: 'maitha.alkaabi.psp2.2026@gmail.com',    password: 'M.Alkaabi@sgmb2026!' },
      { name: 'Hamda Almaazmi',    email: 'hamda.almaazmi.psp2.2026@gmail.com',    password: 'Almaazmi.H@sgmb2026!' },
      { name: 'Lujin Tamer',       email: 'lujin.tamer.psp2.2026@gmail.com',       password: 'L.Tamer@sgmb2026!' },
      { name: 'Fatima Ahmed',      email: 'fatima.ahmed.psp2.2026@gmail.com',      password: 'F.Ahmed@sgmb2026!' },
      { name: 'Zakaria Yahia',     email: 'zakaria.yahia.psp2.2026@gmail.com',     password: 'Z.Yahia@sgmb2026!' },
      { name: 'Samah Hamad',       email: 'samah.hamad.psp2.2026@gmail.com',       password: 'S.Hamad@sgmb2026!' },
      { name: 'Suliman Mohammed',  email: 'suliman.mohammed.psp2.2026@gmail.com',  password: 'S.Mohammed@sgmb2026!' },
      { name: 'Abdullah Alsalus',  email: 'abdullah.alsalus.psp2.2026@gmail.com',  password: 'A.Alsalus@sgmb2026!' },
      { name: 'Saman Nadeem',      email: 'saman.nadeem.psp2.2026@gmail.com',      password: 'S.Nadeem@sgmb2026!' },
    ],
  },
];

async function main() {
  await initializeDatabase();
  console.log('Database ready.\n');

  let teamsCreated = 0, leadersCreated = 0, membersCreated = 0, skipped = 0;

  for (const team of teams) {
    // Create or find team
    let teamRow = dbHelpers.getAllTeams().find(t => t.TeamName === team.name);
    if (!teamRow) {
      const res = dbHelpers.createTeam(team.name, '');
      teamRow = { TeamID: res.lastInsertRowid, TeamName: team.name };
      teamsCreated++;
      console.log(`  Team created: ${team.name}`);
    } else {
      console.log(`  Team exists:  ${team.name}`);
    }

    const teamId = teamRow.TeamID;

    // Create leader
    const existingLeader = dbHelpers.getUserByEmail(team.leader.email);
    if (!existingLeader) {
      const res = dbHelpers.createUser(team.leader.name, team.leader.email, team.leader.password, 'Leader', teamId);
      // Set as team leader
      dbHelpers.updateTeam(teamId, team.name, '', res.lastInsertRowid);
      leadersCreated++;
      console.log(`    + Leader: ${team.leader.name}`);
    } else {
      skipped++;
      console.log(`    ~ Leader exists: ${team.leader.name}`);
    }

    // Create members
    for (const member of team.members) {
      const existing = dbHelpers.getUserByEmail(member.email);
      if (!existing) {
        dbHelpers.createUser(member.name, member.email, member.password, 'Student', teamId);
        membersCreated++;
        console.log(`    + Member: ${member.name}`);
      } else {
        skipped++;
        console.log(`    ~ Exists:  ${member.name}`);
      }
    }

    console.log('');
  }

  console.log('─────────────────────────────────────');
  console.log(`Teams created  : ${teamsCreated}`);
  console.log(`Leaders added  : ${leadersCreated}`);
  console.log(`Members added  : ${membersCreated}`);
  console.log(`Skipped (exist): ${skipped}`);
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
