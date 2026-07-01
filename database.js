const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

let db;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'internship_tracker.db');

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

  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

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

  // Add CoverImage column if not exists (migration-safe)
  try { db.run('ALTER TABLE Teams ADD COLUMN CoverImage TEXT DEFAULT NULL'); } catch(e) {}

db.run(`
  CREATE TABLE IF NOT EXISTS TeamTasks (
    TaskID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamID INTEGER NOT NULL,
    Title TEXT NOT NULL,
    Description TEXT,
    AssignedTo INTEGER,
    CreatedBy INTEGER,
    Status TEXT DEFAULT 'todo',
    DueDate TEXT,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS TeamChat (
    ChatID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamID INTEGER NOT NULL,
    SenderID INTEGER,
    SenderName TEXT NOT NULL,
    Message TEXT NOT NULL,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Shared team notes — any team member (student or leader) can add/check/delete
db.run(`
  CREATE TABLE IF NOT EXISTS TeamNotes (
    NoteID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamID INTEGER NOT NULL,
    Title TEXT NOT NULL,
    Completed INTEGER DEFAULT 0,
    CreatedBy INTEGER,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
db.run('CREATE INDEX IF NOT EXISTS idx_team_notes_team ON TeamNotes(TeamID)');

// Shared team links — any team member (student or leader) can add/delete any link
db.run(`
  CREATE TABLE IF NOT EXISTS TeamLinks (
    LinkID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamID INTEGER NOT NULL,
    Title TEXT,
    URL TEXT NOT NULL,
    AddedBy INTEGER,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
db.run('CREATE INDEX IF NOT EXISTS idx_team_links_team ON TeamLinks(TeamID)');
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

  // Add Phone column if not exists (migration-safe)
  try { db.run('ALTER TABLE Users ADD COLUMN Phone TEXT DEFAULT NULL'); } catch(e) {}

  // Add ProfilePicture column if not exists (migration-safe)
  try { db.run('ALTER TABLE Users ADD COLUMN ProfilePicture TEXT DEFAULT NULL'); } catch(e) {}

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

  // Add WeekLabel column if not exists (migration-safe)
  try { db.run('ALTER TABLE Achievements ADD COLUMN WeekLabel TEXT DEFAULT NULL'); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS Documents (
      DocumentID   INTEGER PRIMARY KEY AUTOINCREMENT,
      FilePath     TEXT NOT NULL,
      FileName     TEXT NOT NULL,
      FileType     TEXT NOT NULL,
      AchievementID INTEGER NOT NULL,
      UploadedAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (AchievementID) REFERENCES Achievements(AchievementID) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_achievements_team ON Achievements(TeamID)');
  db.run('CREATE INDEX IF NOT EXISTS idx_achievements_date ON Achievements(DatePosted)');
  db.run('CREATE INDEX IF NOT EXISTS idx_images_achievement ON Images(AchievementID)');
  db.run('CREATE INDEX IF NOT EXISTS idx_comments_achievement ON Comments(AchievementID)');
  db.run('CREATE INDEX IF NOT EXISTS idx_documents_achievement ON Documents(AchievementID)');

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

// Help Messages
db.run(`
  CREATE TABLE IF NOT EXISTS HelpMessages (
    MessageID INTEGER PRIMARY KEY AUTOINCREMENT,
    SenderID INTEGER,
    SenderName TEXT NOT NULL,
    SenderRole TEXT NOT NULL,
    Message TEXT NOT NULL,
    Status TEXT DEFAULT 'pending',
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration: normalize old unread/read statuses to the pending/done/rejected model
try { db.run("UPDATE HelpMessages SET Status = 'pending' WHERE Status = 'unread'"); } catch(e) {}
try { db.run("UPDATE HelpMessages SET Status = 'done' WHERE Status = 'read'"); } catch(e) {}

// Shared calendar events (created by Admin, visible to everyone)
db.run(`
  CREATE TABLE IF NOT EXISTS CalendarEvents (
    EventID INTEGER PRIMARY KEY AUTOINCREMENT,
    Title TEXT NOT NULL,
    Description TEXT,
    EventDate TEXT NOT NULL,
    EventTime TEXT,
    CreatedBy INTEGER,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (CreatedBy) REFERENCES Users(UserID) ON DELETE SET NULL
  )
`);
db.run('CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON CalendarEvents(EventDate)');
try { db.run('ALTER TABLE CalendarEvents ADD COLUMN EventPoster TEXT DEFAULT NULL'); } catch(e) {}
try { db.run('ALTER TABLE CalendarEvents ADD COLUMN EventSpeakers TEXT DEFAULT NULL'); } catch(e) {}
try { db.run('ALTER TABLE CalendarEvents ADD COLUMN EventLocation TEXT DEFAULT NULL'); } catch(e) {}

// Personal reminders and to-do items (private per-user, every role can manage their own)
db.run(`
  CREATE TABLE IF NOT EXISTS Reminders (
    ReminderID INTEGER PRIMARY KEY AUTOINCREMENT,
    UserID INTEGER NOT NULL,
    Title TEXT NOT NULL,
    Description TEXT,
    ReminderDate TEXT,
    StartTime TEXT,
    EndTime TEXT,
    Completed INTEGER DEFAULT 0,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
  )
`);
db.run('CREATE INDEX IF NOT EXISTS idx_reminders_user ON Reminders(UserID)');

db.run(`
  CREATE TABLE IF NOT EXISTS TodoItems (
    TodoID INTEGER PRIMARY KEY AUTOINCREMENT,
    UserID INTEGER NOT NULL,
    Title TEXT NOT NULL,
    Completed INTEGER DEFAULT 0,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
  )
`);
db.run('CREATE INDEX IF NOT EXISTS idx_todos_user ON TodoItems(UserID)');

// News Feed — Twitter-like posts visible to all logged-in users
db.run(`
  CREATE TABLE IF NOT EXISTS NewsFeed (
    PostID INTEGER PRIMARY KEY AUTOINCREMENT,
    Content TEXT NOT NULL,
    AuthorID INTEGER NOT NULL,
    AuthorName TEXT NOT NULL,
    AuthorRole TEXT NOT NULL,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (AuthorID) REFERENCES Users(UserID) ON DELETE CASCADE
  )
`);
db.run('CREATE INDEX IF NOT EXISTS idx_newsfeed_author ON NewsFeed(AuthorID)');

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
  createUser: (name, email, password, role, teamId = null, phone = null) => {
    let hashedPassword = "firebase-auth-user";

    if (password && password.trim() !== "") {
      hashedPassword = bcrypt.hashSync(password, 10);
    }

    const result = runQuery(
      "INSERT INTO Users (Name, Email, Password, Role, TeamID, Phone) VALUES (?, ?, ?, ?, ?, ?)",
      [name, email, hashedPassword, role, teamId || null, phone || null]
    );

    saveDatabase();
    return result;
  },
getTeamMembers: (teamId) => {
  return queryAll(
    "SELECT UserID, Name, Email, Role, ProfilePicture FROM Users WHERE TeamID = ? ORDER BY Role, Name",
    [teamId]
  );
},

getTeamTasks: (teamId) => {
  return queryAll(
    `SELECT tt.*, u.Name as AssignedName
     FROM TeamTasks tt
     LEFT JOIN Users u ON tt.AssignedTo = u.UserID
     WHERE tt.TeamID = ?
     ORDER BY tt.CreatedAt DESC`,
    [teamId]
  );
},

createTeamTask: (teamId, title, description, assignedTo, createdBy, dueDate) => {
  const result = runQuery(
    `INSERT INTO TeamTasks (TeamID, Title, Description, AssignedTo, CreatedBy, DueDate)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [teamId, title, description || "", assignedTo || null, createdBy || null, dueDate || null]
  );
  saveDatabase();
  return result;
},

updateTeamTaskStatus: (taskId, status) => {
  const result = runQuery(
    "UPDATE TeamTasks SET Status = ? WHERE TaskID = ?",
    [status, taskId]
  );
  saveDatabase();
  return result;
},

getTeamTaskById: (taskId) => {
  return queryOne("SELECT * FROM TeamTasks WHERE TaskID = ?", [taskId]);
},

deleteTeamTask: (taskId) => {
  const result = runQuery("DELETE FROM TeamTasks WHERE TaskID = ?", [taskId]);
  saveDatabase();
  return result;
},

getTeamNotes: (teamId) => {
  return queryAll("SELECT * FROM TeamNotes WHERE TeamID = ? ORDER BY Completed, CreatedAt DESC", [teamId]);
},

getTeamNoteById: (noteId) => {
  return queryOne("SELECT * FROM TeamNotes WHERE NoteID = ?", [noteId]);
},

createTeamNote: (teamId, title, createdBy) => {
  const result = runQuery(
    "INSERT INTO TeamNotes (TeamID, Title, CreatedBy) VALUES (?, ?, ?)",
    [teamId, title, createdBy || null]
  );
  saveDatabase();
  return result;
},

toggleTeamNote: (noteId, completed) => {
  const result = runQuery("UPDATE TeamNotes SET Completed = ? WHERE NoteID = ?", [completed ? 1 : 0, noteId]);
  saveDatabase();
  return result;
},

deleteTeamNote: (noteId) => {
  const result = runQuery("DELETE FROM TeamNotes WHERE NoteID = ?", [noteId]);
  saveDatabase();
  return result;
},

getTeamLinks: (teamId) => {
  return queryAll(
    `SELECT tl.*, u.Name as AdderName
     FROM TeamLinks tl
     LEFT JOIN Users u ON tl.AddedBy = u.UserID
     WHERE tl.TeamID = ?
     ORDER BY tl.CreatedAt DESC`,
    [teamId]
  );
},

getTeamLinkById: (linkId) => {
  return queryOne("SELECT * FROM TeamLinks WHERE LinkID = ?", [linkId]);
},

addTeamLink: (teamId, title, url, addedBy) => {
  const result = runQuery(
    "INSERT INTO TeamLinks (TeamID, Title, URL, AddedBy) VALUES (?, ?, ?, ?)",
    [teamId, title || null, url, addedBy || null]
  );
  saveDatabase();
  return result;
},

deleteTeamLink: (linkId) => {
  const result = runQuery("DELETE FROM TeamLinks WHERE LinkID = ?", [linkId]);
  saveDatabase();
  return result;
},

getTeamChat: (teamId) => {
  return queryAll(
    "SELECT * FROM TeamChat WHERE TeamID = ? ORDER BY CreatedAt DESC LIMIT 20",
    [teamId]
  );
},

addTeamChat: (teamId, senderId, senderName, message) => {
  const result = runQuery(
    "INSERT INTO TeamChat (TeamID, SenderID, SenderName, Message) VALUES (?, ?, ?, ?)",
    [teamId, senderId, senderName, message]
  );
  saveDatabase();
  return result;
},

getAllCalendarEvents: () => {
  return queryAll(
    `SELECT ce.*, u.Name as CreatedByName
     FROM CalendarEvents ce
     LEFT JOIN Users u ON ce.CreatedBy = u.UserID
     ORDER BY ce.EventDate, ce.EventTime`
  );
},

createCalendarEvent: (title, description, eventDate, eventTime, createdBy, eventPoster, eventSpeakers, eventLocation) => {
  const result = runQuery(
    "INSERT INTO CalendarEvents (Title, Description, EventDate, EventTime, CreatedBy, EventPoster, EventSpeakers, EventLocation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [title, description || '', eventDate, eventTime || null, createdBy || null, eventPoster || null, eventSpeakers || null, eventLocation || null]
  );
  saveDatabase();
  return result;
},

updateCalendarEvent: (id, title, description, eventDate, eventTime, eventPoster, eventSpeakers, eventLocation) => {
  const result = runQuery(
    "UPDATE CalendarEvents SET Title = ?, Description = ?, EventDate = ?, EventTime = ?, EventPoster = ?, EventSpeakers = ?, EventLocation = ? WHERE EventID = ?",
    [title, description || '', eventDate, eventTime || null, eventPoster || null, eventSpeakers || null, eventLocation || null, id]
  );
  saveDatabase();
  return result;
},

deleteCalendarEvent: (id) => {
  const result = runQuery("DELETE FROM CalendarEvents WHERE EventID = ?", [id]);
  saveDatabase();
  return result;
},

getCalendarEventById: (id) => {
  return queryOne("SELECT * FROM CalendarEvents WHERE EventID = ?", [id]);
},

getAllNewsFeedPosts: () => {
  return queryAll(`
    SELECT nf.*, u.ProfilePicture as AuthorPic
    FROM NewsFeed nf
    LEFT JOIN Users u ON nf.AuthorID = u.UserID
    ORDER BY nf.CreatedAt DESC
  `);
},

createNewsFeedPost: (content, authorId, authorName, authorRole) => {
  const result = runQuery(
    "INSERT INTO NewsFeed (Content, AuthorID, AuthorName, AuthorRole) VALUES (?, ?, ?, ?)",
    [content, authorId, authorName, authorRole]
  );
  saveDatabase();
  return result;
},

updateNewsFeedPost: (postId, content, authorId) => {
  const result = runQuery(
    "UPDATE NewsFeed SET Content = ?, UpdatedAt = CURRENT_TIMESTAMP WHERE PostID = ? AND AuthorID = ?",
    [content, postId, authorId]
  );
  saveDatabase();
  return result;
},

deleteNewsFeedPost: (postId) => {
  const result = runQuery("DELETE FROM NewsFeed WHERE PostID = ?", [postId]);
  saveDatabase();
  return result;
},

getNewsFeedPostById: (postId) => {
  return queryOne("SELECT * FROM NewsFeed WHERE PostID = ?", [postId]);
},

createHelpMessage: (senderId, senderName, senderRole, message) => {
  const result = runQuery(
    "INSERT INTO HelpMessages (SenderID, SenderName, SenderRole, Message, Status) VALUES (?, ?, ?, ?, 'pending')",
    [senderId, senderName, senderRole, message]
  );
  saveDatabase();
  return result;
},

getAllHelpMessages: () => {
  return queryAll("SELECT * FROM HelpMessages ORDER BY CreatedAt DESC");
},

getHelpMessagesBySender: (senderId) => {
  return queryAll("SELECT * FROM HelpMessages WHERE SenderID = ? ORDER BY CreatedAt DESC", [senderId]);
},

updateHelpMessageStatus: (id, status) => {
  const result = runQuery("UPDATE HelpMessages SET Status = ? WHERE MessageID = ?", [status, id]);
  saveDatabase();
  return result;
},

deleteHelpMessage: (id) => {
  const result = runQuery("DELETE FROM HelpMessages WHERE MessageID = ?", [id]);
  saveDatabase();
  return result;
},

getRemindersByUser: (userId) => {
  return queryAll("SELECT * FROM Reminders WHERE UserID = ? ORDER BY ReminderDate, StartTime", [userId]);
},

createReminder: (userId, title, description, reminderDate, startTime, endTime) => {
  const result = runQuery(
    "INSERT INTO Reminders (UserID, Title, Description, ReminderDate, StartTime, EndTime) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, title, description || '', reminderDate || null, startTime || null, endTime || null]
  );
  saveDatabase();
  return result;
},

updateReminder: (id, userId, title, description, reminderDate, startTime, endTime) => {
  const result = runQuery(
    "UPDATE Reminders SET Title = ?, Description = ?, ReminderDate = ?, StartTime = ?, EndTime = ? WHERE ReminderID = ? AND UserID = ?",
    [title, description || '', reminderDate || null, startTime || null, endTime || null, id, userId]
  );
  saveDatabase();
  return result;
},

toggleReminder: (id, userId, completed) => {
  const result = runQuery(
    "UPDATE Reminders SET Completed = ? WHERE ReminderID = ? AND UserID = ?",
    [completed ? 1 : 0, id, userId]
  );
  saveDatabase();
  return result;
},

deleteReminder: (id, userId) => {
  const result = runQuery("DELETE FROM Reminders WHERE ReminderID = ? AND UserID = ?", [id, userId]);
  saveDatabase();
  return result;
},

getTodosByUser: (userId) => {
  return queryAll("SELECT * FROM TodoItems WHERE UserID = ? ORDER BY Completed, CreatedAt DESC", [userId]);
},

createTodo: (userId, title) => {
  const result = runQuery(
    "INSERT INTO TodoItems (UserID, Title) VALUES (?, ?)",
    [userId, title]
  );
  saveDatabase();
  return result;
},

toggleTodo: (id, userId, completed) => {
  const result = runQuery(
    "UPDATE TodoItems SET Completed = ? WHERE TodoID = ? AND UserID = ?",
    [completed ? 1 : 0, id, userId]
  );
  saveDatabase();
  return result;
},

deleteTodo: (id, userId) => {
  const result = runQuery("DELETE FROM TodoItems WHERE TodoID = ? AND UserID = ?", [id, userId]);
  saveDatabase();
  return result;
},

getTeamTodos: (teamId) => {
  return queryAll(
    `SELECT t.*, u.Name as OwnerName
     FROM TodoItems t
     JOIN Users u ON t.UserID = u.UserID
     WHERE u.TeamID = ?
     ORDER BY u.Name, t.Completed, t.CreatedAt DESC`,
    [teamId]
  );
},

  getUserByEmail: (email) => {
    return queryOne("SELECT * FROM Users WHERE LOWER(Email) = LOWER(?)", [email]);
  },

  getUserById: (id) => {
    return queryOne(
      `SELECT u.UserID, u.Name, u.Email, u.Role, u.TeamID, u.Phone, u.ProfilePicture, t.TeamName
       FROM Users u
       LEFT JOIN Teams t ON u.TeamID = t.TeamID
       WHERE u.UserID = ?`,
      [id]
    );
  },

  getUsersByRole: (role) => {
    return queryAll(
      `SELECT u.UserID, u.Name, u.Email, u.Role, u.TeamID, u.Phone, u.ProfilePicture, t.TeamName
       FROM Users u
       LEFT JOIN Teams t ON u.TeamID = t.TeamID
       WHERE LOWER(u.Role) = LOWER(?)
       ORDER BY u.Name`,
      [role]
    );
  },

  updateUser: (id, name, email, teamId, phone = null, profilePicture = null) => {
    const result = runQuery(
      "UPDATE Users SET Name = ?, Email = ?, TeamID = ?, Phone = ?, ProfilePicture = ? WHERE UserID = ?",
      [name, email, teamId || null, phone || null, profilePicture || null, id]
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

  updateTeamCoverImage: (id, coverImage) => {
    const result = runQuery("UPDATE Teams SET CoverImage = ? WHERE TeamID = ?", [coverImage, id]);
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

  createAchievement: (title, description, teamId, createdBy, status = 'published', weekLabel = null) => {
    const result = runQuery(
      "INSERT INTO Achievements (Title, Description, TeamID, CreatedBy, Status, WeekLabel) VALUES (?, ?, ?, ?, ?, ?)",
      [title, description, teamId, createdBy, status, weekLabel]
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

  addDocument: (filePath, fileName, fileType, achievementId) => {
    const result = runQuery(
      "INSERT INTO Documents (FilePath, FileName, FileType, AchievementID) VALUES (?, ?, ?, ?)",
      [filePath, fileName, fileType, achievementId]
    );
    saveDatabase();
    return result;
  },

  getAchievementDocuments: (achievementId) => {
    return queryAll(
      "SELECT DocumentID, FilePath, FileName, FileType, UploadedAt FROM Documents WHERE AchievementID = ?",
      [achievementId]
    );
  },

  getStatistics: () => {
    const totalTeams = queryOne("SELECT COUNT(*) as count FROM Teams").count;
    const totalLeaders = queryOne("SELECT COUNT(*) as count FROM Users WHERE Role = 'Leader'").count;
    const totalStudents = queryOne("SELECT COUNT(*) as count FROM Users WHERE Role = 'Student'").count;
    const totalAchievements = queryOne("SELECT COUNT(*) as count FROM Achievements WHERE Status = 'published'").count;
    const totalDrafts   = queryOne("SELECT COUNT(*) as count FROM Achievements WHERE Status = 'draft'").count;
    const totalPending  = queryOne("SELECT COUNT(*) as count FROM Achievements WHERE Status = 'pending'").count;
    const totalRejected = queryOne("SELECT COUNT(*) as count FROM Achievements WHERE Status = 'rejected'").count;
    const totalAll      = queryOne("SELECT COUNT(*) as count FROM Achievements").count;

    const teamActivity = queryAll(
      `SELECT t.TeamName,
              COUNT(CASE WHEN a.Status = 'published' THEN 1 END) as published,
              COUNT(CASE WHEN a.Status = 'pending'   THEN 1 END) as pending,
              COUNT(a.AchievementID) as total
       FROM Teams t
       LEFT JOIN Achievements a ON t.TeamID = a.TeamID
       GROUP BY t.TeamID
       ORDER BY published DESC`
    );

    const recentAchievements = queryAll(
      `SELECT a.Title, a.Status, a.DatePosted, t.TeamName, u.Name as AuthorName
       FROM Achievements a
       JOIN Teams t ON a.TeamID = t.TeamID
       LEFT JOIN Users u ON a.CreatedBy = u.UserID
       ORDER BY a.DatePosted DESC
       LIMIT 8`
    );

    const topStudents = queryAll(
      `SELECT u.Name, t.TeamName,
              COUNT(a.AchievementID) as total,
              COUNT(CASE WHEN a.Status = 'published' THEN 1 END) as published
       FROM Users u
       LEFT JOIN Achievements a ON a.CreatedBy = u.UserID
       LEFT JOIN Teams t ON u.TeamID = t.TeamID
       WHERE u.Role = 'Student'
       GROUP BY u.UserID
       ORDER BY total DESC
       LIMIT 6`
    );

    return {
      totalTeams,
      totalLeaders,
      totalStudents,
      totalAchievements,
      totalDrafts,
      totalPending,
      totalRejected,
      totalAll,
      publishedAchievements: totalAchievements,
      teamActivity,
      recentAchievements,
      topStudents
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