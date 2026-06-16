const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

let db;
const DB_PATH = path.join(__dirname, 'internship_tracker.db');

function queryAll(sql, params = []) {
  const safeParams = params.map(p => p === undefined ? null : p);
  const stmt = db.prepare(sql);
  if (safeParams.length > 0) stmt.bind(safeParams);

  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const safeParams = params.map(p => p === undefined ? null : p);
  const stmt = db.prepare(sql);
  if (safeParams.length > 0) stmt.bind(safeParams);

  let result = null;
  if (stmt.step()) result = stmt.getAsObject();
  stmt.free();
  return result;
}

function runQuery(sql, params = []) {
  const safeParams = params.map(p => p === undefined ? null : p);
  const stmt = db.prepare(sql);
  if (safeParams.length > 0) stmt.bind(safeParams);

  stmt.step();
  const lastId = db.exec("SELECT last_insert_rowid()");
  stmt.free();

  return {
    changes: db.getRowsModified(),
    lastInsertRowid: lastId && lastId[0] ? lastId[0].values[0][0] : 0
  };
}

async function initializeDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS Teams (
      TeamID INTEGER PRIMARY KEY AUTOINCREMENT,
      TeamName TEXT NOT NULL UNIQUE,
      Description TEXT,
      LeaderUserID INTEGER,
      CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS Users (
      UserID INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Email TEXT UNIQUE NOT NULL,
      Password TEXT NOT NULL,
      Role TEXT CHECK(Role IN ('Admin', 'Leader', 'Student', 'Supervisor')) NOT NULL,
      TeamID INTEGER,
      CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (TeamID) REFERENCES Teams(TeamID) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS Achievements (
      AchievementID INTEGER PRIMARY KEY AUTOINCREMENT,
      Title TEXT NOT NULL,
      Description TEXT NOT NULL,
      DatePosted DATETIME DEFAULT CURRENT_TIMESTAMP,
      TeamID INTEGER NOT NULL,
      CreatedBy INTEGER NOT NULL,
      Status TEXT DEFAULT 'published' CHECK(Status IN ('draft', 'published', 'pending', 'rejected', 'archived')),
      FOREIGN KEY (TeamID) REFERENCES Teams(TeamID) ON DELETE CASCADE,
      FOREIGN KEY (CreatedBy) REFERENCES Users(UserID) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS Images (
      ImageID INTEGER PRIMARY KEY AUTOINCREMENT,
      FilePath TEXT NOT NULL,
      AchievementID INTEGER NOT NULL,
      UploadedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (AchievementID) REFERENCES Achievements(AchievementID) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS Comments (
      CommentID INTEGER PRIMARY KEY AUTOINCREMENT,
      Content TEXT NOT NULL,
      AchievementID INTEGER NOT NULL,
      UserID INTEGER,
      AuthorName TEXT NOT NULL,
      CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (AchievementID) REFERENCES Achievements(AchievementID) ON DELETE CASCADE,
      FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS Likes (
      LikeID INTEGER PRIMARY KEY AUTOINCREMENT,
      AchievementID INTEGER NOT NULL,
      UserID INTEGER,
      VisitorIP TEXT,
      CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (AchievementID) REFERENCES Achievements(AchievementID) ON DELETE CASCADE,
      FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_achievements_team ON Achievements(TeamID)');
  db.run('CREATE INDEX IF NOT EXISTS idx_achievements_date ON Achievements(DatePosted)');
  db.run('CREATE INDEX IF NOT EXISTS idx_images_achievement ON Images(AchievementID)');
  db.run('CREATE INDEX IF NOT EXISTS idx_comments_achievement ON Comments(AchievementID)');

  // Supervisor private feedback table
  db.run(`
    CREATE TABLE IF NOT EXISTS SupervisorFeedback (
      FeedbackID INTEGER PRIMARY KEY AUTOINCREMENT,
      Content TEXT NOT NULL,
      AchievementID INTEGER NOT NULL,
      SupervisorUserID INTEGER,
      AuthorName TEXT NOT NULL DEFAULT 'Supervisor',
      CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (AchievementID) REFERENCES Achievements(AchievementID) ON DELETE CASCADE,
      FOREIGN KEY (SupervisorUserID) REFERENCES Users(UserID) ON DELETE SET NULL
    )
  `);

  // Migration: allow Supervisor role if DB already exists with old constraint
  try {
    db.run("UPDATE sqlite_master SET sql = REPLACE(sql, \"'Admin', 'Leader', 'Student'\", \"'Admin', 'Leader', 'Student', 'Supervisor'\") WHERE type='table' AND name='Users'");
  } catch(e) { /* ignore */ }

  saveDatabase();
  console.log('Database initialized successfully');
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function seedDefaultAdmin() {
  const adminExists = queryOne("SELECT * FROM Users WHERE Role = 'Admin'");

  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);

    runQuery(
      "INSERT INTO Users (Name, Email, Password, Role) VALUES (?, ?, ?, ?)",
      ['IT Admin', 'admin@company.com', hashedPassword, 'Admin']
    );

    saveDatabase();
    console.log('Default admin account created');
    console.log('Email: admin@company.com');
    console.log('Password: admin123');
  }
}

const dbHelpers = {
  createUser: (name, email, password, role, teamId = null) => {
    let hashedPassword = "firebase-auth-user";

    if (password && password.trim() !== "") {
      hashedPassword = bcrypt.hashSync(password, 10);
    }

    const result = runQuery(
      "INSERT INTO Users (Name, Email, Password, Role, TeamID) VALUES (?, ?, ?, ?, ?)",
      [name, email, hashedPassword, role, teamId || null]
    );

    saveDatabase();
    return result;
  },

  getUserByEmail: (email) => {
    return queryOne("SELECT * FROM Users WHERE LOWER(Email) = LOWER(?)", [email]);
  },

  getUserById: (id) => {
    return queryOne(
      `SELECT u.UserID, u.Name, u.Email, u.Role, u.TeamID, t.TeamName
       FROM Users u
       LEFT JOIN Teams t ON u.TeamID = t.TeamID
       WHERE u.UserID = ?`,
      [id]
    );
  },

  getUsersByRole: (role) => {
    return queryAll(
      `SELECT u.UserID, u.Name, u.Email, u.Role, u.TeamID, t.TeamName
       FROM Users u
       LEFT JOIN Teams t ON u.TeamID = t.TeamID
       WHERE LOWER(u.Role) = LOWER(?)
       ORDER BY u.Name`,
      [role]
    );
  },

  updateUser: (id, name, email, teamId) => {
    const result = runQuery(
      "UPDATE Users SET Name = ?, Email = ?, TeamID = ? WHERE UserID = ?",
      [name, email, teamId || null, id]
    );

    saveDatabase();
    return result;
  },

  deleteUser: (id) => {
    const result = runQuery("DELETE FROM Users WHERE UserID = ?", [id]);
    saveDatabase();
    return result;
  },

  createTeam: (teamName, description, leaderId = null) => {
    const result = runQuery(
      "INSERT INTO Teams (TeamName, Description, LeaderUserID) VALUES (?, ?, ?)",
      [teamName, description || '', leaderId || null]
    );

    saveDatabase();
    return result;
  },

  getAllTeams: () => {
    return queryAll(
      `SELECT t.*, u.Name as LeaderName,
       (SELECT COUNT(*) FROM Users WHERE TeamID = t.TeamID AND Role = 'Student') as StudentCount,
       (SELECT COUNT(*) FROM Achievements WHERE TeamID = t.TeamID) as AchievementCount
       FROM Teams t
       LEFT JOIN Users u ON t.LeaderUserID = u.UserID
       ORDER BY t.TeamName`
    );
  },

  getTeamById: (id) => {
    return queryOne(
      `SELECT t.*, u.Name as LeaderName
       FROM Teams t
       LEFT JOIN Users u ON t.LeaderUserID = u.UserID
       WHERE t.TeamID = ?`,
      [id]
    );
  },

  updateTeam: (id, teamName, description, leaderId) => {
    const result = runQuery(
      "UPDATE Teams SET TeamName = ?, Description = ?, LeaderUserID = ? WHERE TeamID = ?",
      [teamName, description || '', leaderId || null, id]
    );

    saveDatabase();
    return result;
  },

  deleteTeam: (id) => {
    const result = runQuery("DELETE FROM Teams WHERE TeamID = ?", [id]);
    saveDatabase();
    return result;
  },

  getAllAchievements: (filters = {}) => {
    let query = `
      SELECT a.*, a.DatePosted as CreatedAt, t.TeamName, u.Name as CreatorName,
      (SELECT COUNT(*) FROM Images WHERE AchievementID = a.AchievementID) as ImageCount,
      (SELECT FilePath FROM Images WHERE AchievementID = a.AchievementID LIMIT 1) as FirstImage,
      (SELECT COUNT(*) FROM Likes WHERE AchievementID = a.AchievementID) as LikeCount,
      (SELECT COUNT(*) FROM Comments WHERE AchievementID = a.AchievementID) as CommentCount
      FROM Achievements a
      JOIN Teams t ON a.TeamID = t.TeamID
      JOIN Users u ON a.CreatedBy = u.UserID
      WHERE 1=1
    `;

    const params = [];

    if (filters.statusFilter) {
      if (Array.isArray(filters.statusFilter)) {
        query += ` AND a.Status IN (${filters.statusFilter.map(() => '?').join(',')})`;
        params.push(...filters.statusFilter);
      } else {
        query += ' AND a.Status = ?';
        params.push(filters.statusFilter);
      }
    } else {
      query += " AND a.Status = 'published'";
    }

    if (filters.teamId) {
      query += ' AND a.TeamID = ?';
      params.push(filters.teamId);
    }

    if (filters.search) {
      query += ' AND (a.Title LIKE ? OR a.Description LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    if (filters.userId) {
      query += ' AND a.CreatedBy = ?';
      params.push(filters.userId);
    }

    query += ' ORDER BY a.DatePosted DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return queryAll(query, params);
  },

  getAchievementById: (id) => {
    return queryOne(
      `SELECT a.*, a.DatePosted as CreatedAt, t.TeamName, u.Name as CreatorName
       FROM Achievements a
       JOIN Teams t ON a.TeamID = t.TeamID
       JOIN Users u ON a.CreatedBy = u.UserID
       WHERE a.AchievementID = ?`,
      [id]
    );
  },

  createAchievement: (title, description, teamId, createdBy, status = 'published') => {
    const result = runQuery(
      "INSERT INTO Achievements (Title, Description, TeamID, CreatedBy, Status) VALUES (?, ?, ?, ?, ?)",
      [title, description, teamId, createdBy, status]
    );

    saveDatabase();
    return result;
  },

  updateAchievement: (id, title, description, status) => {
    const result = runQuery(
      "UPDATE Achievements SET Title = ?, Description = ?, Status = ? WHERE AchievementID = ?",
      [title, description, status, id]
    );

    saveDatabase();
    return result;
  },

  deleteAchievement: (id) => {
    const result = runQuery("DELETE FROM Achievements WHERE AchievementID = ?", [id]);
    saveDatabase();
    return result;
  },

  addImage: (filePath, achievementId) => {
    const result = runQuery(
      "INSERT INTO Images (FilePath, AchievementID) VALUES (?, ?)",
      [filePath, achievementId]
    );

    saveDatabase();
    return result;
  },

  getAchievementImages: (achievementId) => {
    return queryAll(
      "SELECT ImageID, AchievementID, FilePath as ImageURL, UploadedAt FROM Images WHERE AchievementID = ?",
      [achievementId]
    );
  },

  deleteImage: (imageId) => {
    const result = runQuery("DELETE FROM Images WHERE ImageID = ?", [imageId]);
    saveDatabase();
    return result;
  },

  getStatistics: () => {
    const totalTeams = queryOne("SELECT COUNT(*) as count FROM Teams").count;
    const totalLeaders = queryOne("SELECT COUNT(*) as count FROM Users WHERE Role = 'Leader'").count;
    const totalStudents = queryOne("SELECT COUNT(*) as count FROM Users WHERE Role = 'Student'").count;
    const totalAchievements = queryOne("SELECT COUNT(*) as count FROM Achievements WHERE Status = 'published'").count;
    const totalDrafts = queryOne("SELECT COUNT(*) as count FROM Achievements WHERE Status = 'draft'").count;
    const totalPending = queryOne("SELECT COUNT(*) as count FROM Achievements WHERE Status = 'pending'").count;

    const teamActivity = queryAll(
      `SELECT t.TeamName, COUNT(a.AchievementID) as achievement_count
       FROM Teams t
       LEFT JOIN Achievements a ON t.TeamID = a.TeamID AND a.Status = 'published'
       GROUP BY t.TeamID
       ORDER BY achievement_count DESC`
    );

    const recentAchievements = queryAll(
      `SELECT a.Title, a.DatePosted, t.TeamName
       FROM Achievements a
       JOIN Teams t ON a.TeamID = t.TeamID
       WHERE a.Status = 'published'
       ORDER BY a.DatePosted DESC
       LIMIT 10`
    );

    return {
      totalTeams,
      totalLeaders,
      totalStudents,
      totalAchievements,
      totalDrafts,
      totalPending,
      publishedAchievements: totalAchievements,
      teamActivity,
      recentAchievements
    };
  },

  addComment: (content, achievementId, userId, authorName) => {
    const result = runQuery(
      "INSERT INTO Comments (Content, AchievementID, UserID, AuthorName) VALUES (?, ?, ?, ?)",
      [content, achievementId, userId, authorName]
    );

    saveDatabase();
    return result;
  },

  getAchievementComments: (achievementId) => {
    return queryAll(
      "SELECT * FROM Comments WHERE AchievementID = ? ORDER BY CreatedAt DESC",
      [achievementId]
    );
  },

  toggleLike: (achievementId, userId, visitorIP) => {
    const existing = queryOne(
      "SELECT * FROM Likes WHERE AchievementID = ? AND (UserID = ? OR VisitorIP = ?)",
      [achievementId, userId, visitorIP]
    );

    if (existing) {
      runQuery("DELETE FROM Likes WHERE LikeID = ?", [existing.LikeID]);
      saveDatabase();
      return false;
    } else {
      runQuery(
        "INSERT INTO Likes (AchievementID, UserID, VisitorIP) VALUES (?, ?, ?)",
        [achievementId, userId, visitorIP]
      );
      saveDatabase();
      return true;
    }
  },

  getLikeCount: (achievementId) => {
    const result = queryOne(
      "SELECT COUNT(*) as count FROM Likes WHERE AchievementID = ?",
      [achievementId]
    );

    return result ? result.count : 0;
  },

  close: () => {
    if (db) {
      saveDatabase();
      db.close();
    }
  },

  // ── SUPERVISOR FEEDBACK ──────────────────────────────────────────────────
  addSupervisorFeedback: (content, achievementId, supervisorUserId, authorName) => {
    const result = runQuery(
      "INSERT INTO SupervisorFeedback (Content, AchievementID, SupervisorUserID, AuthorName) VALUES (?, ?, ?, ?)",
      [content, achievementId, supervisorUserId, authorName]
    );
    saveDatabase();
    return result;
  },

  getSupervisorFeedback: (achievementId) => {
    return queryAll(
      "SELECT * FROM SupervisorFeedback WHERE AchievementID = ? ORDER BY CreatedAt ASC",
      [achievementId]
    );
  },

  getSupervisorFeedbackCount: (achievementId) => {
    const r = queryOne(
      "SELECT COUNT(*) as count FROM SupervisorFeedback WHERE AchievementID = ?",
      [achievementId]
    );
    return r ? r.count : 0;
  },

  getSupervisorFeedbackBySupervisor: (supervisorUserId) => {
    return queryAll(
      `SELECT sf.*, a.Title as AchievementTitle, t.TeamName
       FROM SupervisorFeedback sf
       JOIN Achievements a ON sf.AchievementID = a.AchievementID
       LEFT JOIN Teams t ON a.TeamID = t.TeamID
       WHERE sf.SupervisorUserID = ?
       ORDER BY sf.CreatedAt DESC`,
      [supervisorUserId]
    );
  },

  // All supervisor feedback for a team (for leaders/students)
  getSupervisorFeedbackForTeamAchievement: (achievementId) => {
    return queryAll(
      "SELECT * FROM SupervisorFeedback WHERE AchievementID = ? ORDER BY CreatedAt ASC",
      [achievementId]
    );
  }
};

module.exports = { initializeDatabase, seedDefaultAdmin, dbHelpers };