console.log("HELLO FROM SERVER");

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const multer = require("multer");
const admin = require("firebase-admin");

const { initializeDatabase, dbHelpers } = require("./database");
const {
  initFirebase,
  authenticateToken,
  authorizeRole,
  setUserClaims,
  setDbHelpers,
  signLocalToken
} = require("./auth");

const bcrypt = require("bcryptjs");

// Initialize Firebase Admin SDK
initFirebase();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ==================== MULTER UPLOAD ====================

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "public", "uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    cb(null, UPLOAD_DIR);
  },

  filename: (req, file, cb) => {
    const uniqueSuffix =
      Date.now() + "-" + Math.round(Math.random() * 1e9);

    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const ALLOWED_IMAGE_TYPES = /jpeg|jpg|png|gif|webp/;
const ALLOWED_DOC_TYPES   = /pdf|doc|docx|ppt|pptx/;
const ALLOWED_DOC_MIMES   = /pdf|msword|officedocument|presentation|wordprocessingml|powerpoint/;

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB for documents
  fileFilter: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype;
    if (ALLOWED_IMAGE_TYPES.test(ext) || ALLOWED_DOC_TYPES.test(ext) || ALLOWED_DOC_MIMES.test(mime)) {
      return cb(null, true);
    }
    cb(new Error("Only images, PDF, Word, and PowerPoint files are allowed."));
  }
});

// ==================== AUTH ROUTES ====================

app.get("/api/test", (req, res) => {
  res.json({ message: "API is working!" });
});

app.get("/api/firebase-config", (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
  });
});

// ==================== SERVER-SENT EVENTS ====================

const sseClients = new Set();

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  sseClients.add(res);
  const heartbeat = setInterval(() => res.write(":ping\n\n"), 25000);
  req.on("close", () => { clearInterval(heartbeat); sseClients.delete(res); });
});

function broadcast(resource) {
  const payload = `data: ${JSON.stringify({ resource })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

// ==================== AUTH ROUTES ====================

app.post("/api/auth/session", async (req, res) => {
  try {
    const { idToken, remember } = req.body;

    if (!idToken) {
      return res.status(400).json({
        error: "idToken required."
      });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    let role = decoded.role || null;
    let teamId = decoded.teamId || null;

    // Firebase ID tokens are always short-lived (~1h) and this app never
    // refreshes them, so "remember me" would silently stop working after an
    // hour. Mint our own longer-lived local token for the ongoing session
    // instead of reusing the raw Firebase idToken.
    try {
      const dbUser = dbHelpers.getUserByEmail(decoded.email);
      if (dbUser) {
        role = role || dbUser.Role;
        teamId = dbUser.TeamID || teamId;
      }
    } catch (e) {}

    const dashboardUrl =
      role === "Admin"
        ? "/admin-dashboard.html"
        : role === "Leader"
        ? "/leader-dashboard.html"
        : role === "Supervisor"
        ? "/supervisor-dashboard.html"
        : "/student-dashboard.html";

    const maxAgeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000;

    const sessionToken = signLocalToken({
      uid: decoded.uid,
      email: decoded.email,
      role,
      teamId,
      exp: Math.floor(Date.now() / 1000) + maxAgeMs / 1000
    });

    res.cookie("token", sessionToken, {
      maxAge: maxAgeMs,
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/"
    });

    res.json({
      message: "Session started",
      token: sessionToken,
      user: {
        uid: decoded.uid,
        email: decoded.email,
        role,
        teamId
      },
      redirectUrl: dashboardUrl
    });
  } catch (error) {
    console.error("Session error code:", error.code);
    console.error("Session error message:", error.message);
    console.error("Full session error:", error);

    res.status(403).json({
      error: "Invalid Firebase token.",
      code: error.code,
      message: error.message
    });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out successfully" });
});

app.post("/api/auth/local-login", (req, res) => {
  try {
    const { email, password, remember } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = dbHelpers.getUserByEmail(email);
    if (!user || !user.Password || user.Password === "firebase-auth-user") {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = bcrypt.compareSync(password, user.Password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const maxAgeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000;

    const token = signLocalToken({
      uid:    `local_${user.UserID}`,
      email:  user.Email,
      role:   user.Role,
      teamId: user.TeamID || null,
      exp:    Math.floor(Date.now() / 1000) + maxAgeMs / 1000
    });

    const redirectUrl = user.Role === "Admin"      ? "/admin-dashboard.html"
                      : user.Role === "Leader"     ? "/leader-dashboard.html"
                      : user.Role === "Supervisor" ? "/supervisor-dashboard.html"
                      :                              "/student-dashboard.html";

    res.cookie("token", token, { maxAge: maxAgeMs, httpOnly: false, sameSite: "lax", path: "/" });
    res.json({ token, redirectUrl, user: { email: user.Email, role: user.Role } });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/auth/supervisor-session", async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        error: "idToken required."
      });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);

    if (decoded.role !== "Supervisor") {
      return res.status(403).json({
        error: "This account does not have supervisor access."
      });
    }

    res.cookie("token", idToken, {
      maxAge: 60 * 60 * 1000,
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/"
    });

    res.json({
      message: "Supervisor session started",
      role: "Supervisor"
    });
  } catch (error) {
    res.status(403).json({
      error: "Invalid Firebase token."
    });
  }
});

app.get("/api/auth/me", authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);

    if (!user) {
      return res.json({
        UserID: null,
        Name: req.user.email,
        Email: req.user.email,
        Role: req.user.role,
        TeamID: req.user.teamId || null,
        TeamName: null
      });
    }

    if (!user.Role) {
      user.Role = req.user.role;
    }

    if (user.TeamID && !user.TeamName) {
      const team = dbHelpers.getTeamById(user.TeamID);
      if (team) user.TeamName = team.TeamName;
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({
      error: "Failed to get user"
    });
  }
});

// ==================== PUBLIC ROUTES ====================

app.get("/api/achievements", (req, res) => {
  try {
    const { teamId, search, limit } = req.query;

    const filters = {};

    if (teamId) filters.teamId = parseInt(teamId);
    if (search) filters.search = search;
    if (limit) filters.limit = parseInt(limit);

    res.json(dbHelpers.getAllAchievements(filters));
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch achievements"
    });
  }
});

app.get("/api/achievements/:id", (req, res) => {
  try {
    const achievement = dbHelpers.getAchievementById(req.params.id);

    if (!achievement) {
      return res.status(404).json({
        error: "Not found"
      });
    }

    const images = dbHelpers.getAchievementImages(req.params.id);
    const comments = dbHelpers.getAchievementComments(req.params.id);
    const likeCount = dbHelpers.getLikeCount(req.params.id);

    res.json({
      ...achievement,
      images,
      comments,
      likeCount
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch achievement"
    });
  }
});

app.get("/api/teams", (req, res) => {
  try {
    res.json(dbHelpers.getAllTeams());
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch teams"
    });
  }
});

app.get("/api/statistics", (req, res) => {
  try {
    res.json(dbHelpers.getStatistics());
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch statistics"
    });
  }
});

// ==================== CALENDAR EVENTS ====================
// Admin: full access. Media Team members/leader: can create; leader can edit/delete any
// team event; members can only edit/delete their own.

function isMediaTeamUser(req) {
  if (!req.user.teamId) return false;
  const team = dbHelpers.getTeamById(req.user.teamId);
  return team && team.TeamName && team.TeamName.toLowerCase().includes("media");
}

function authorizeCalendarWrite(req, res, next) {
  if (req.user.role === "Admin") return next();
  if (req.user.role === "Supervisor") return next();
  if (isMediaTeamUser(req)) return next();
  return res.status(403).json({ error: "Only administrators, supervisors, and Media Team members can manage calendar events." });
}

app.get("/api/calendar-events", authenticateToken, (req, res) => {
  try {
    res.json(dbHelpers.getAllCalendarEvents());
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch calendar events"
    });
  }
});

app.post(
  "/api/admin/calendar-events",
  authenticateToken,
  authorizeCalendarWrite,
  (req, res) => {
    try {
      const { title, description, eventDate, eventTime, eventPoster, eventSpeakers, eventLocation } = req.body;

      if (!title || !eventDate) {
        return res.status(400).json({
          error: "Title and date are required"
        });
      }

      dbHelpers.createCalendarEvent(title, description, eventDate, eventTime, req.user.userId, eventPoster, eventSpeakers, eventLocation);

      broadcast("calendar");
      res.json({ message: "Event created" });
    } catch (error) {
      res.status(500).json({
        error: "Failed to create event"
      });
    }
  }
);

app.put(
  "/api/admin/calendar-events/:id",
  authenticateToken,
  authorizeCalendarWrite,
  (req, res) => {
    try {
      const { title, description, eventDate, eventTime, eventPoster, eventSpeakers, eventLocation } = req.body;

      if (!title || !eventDate) {
        return res.status(400).json({
          error: "Title and date are required"
        });
      }

      // Media Team leaders can edit any event; all others can only edit their own
      if (req.user.role !== "Admin") {
        const canEditAll = isMediaTeamUser(req) && req.user.role === "Leader";
        if (!canEditAll) {
          const ev = dbHelpers.getCalendarEventById(req.params.id);
          if (!ev) return res.status(404).json({ error: "Event not found" });
          if (ev.CreatedBy !== req.user.userId) {
            return res.status(403).json({ error: "You can only edit your own events." });
          }
        }
      }

      dbHelpers.updateCalendarEvent(req.params.id, title, description, eventDate, eventTime, eventPoster, eventSpeakers, eventLocation);

      broadcast("calendar");
      res.json({ message: "Event updated" });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update event"
      });
    }
  }
);

app.delete(
  "/api/admin/calendar-events/:id",
  authenticateToken,
  authorizeCalendarWrite,
  (req, res) => {
    try {
      // Media Team leaders can delete any event; all others can only delete their own
      if (req.user.role !== "Admin") {
        const canDeleteAll = isMediaTeamUser(req) && req.user.role === "Leader";
        if (!canDeleteAll) {
          const ev = dbHelpers.getCalendarEventById(req.params.id);
          if (!ev) return res.status(404).json({ error: "Event not found" });
          if (ev.CreatedBy !== req.user.userId) {
            return res.status(403).json({ error: "You can only delete your own events." });
          }
        }
      }
      dbHelpers.deleteCalendarEvent(req.params.id);

      broadcast("calendar");
      res.json({ message: "Event deleted" });
    } catch (error) {
      res.status(500).json({
        error: "Failed to delete event"
      });
    }
  }
);

app.post("/api/upload-event-poster", authenticateToken, authorizeCalendarWrite, upload.single("posterImage"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ url: "/uploads/" + req.file.filename });
});

app.get("/api/achievements/:id/documents", (req, res) => {
  try {
    res.json(dbHelpers.getAchievementDocuments(req.params.id));
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

app.post("/api/achievements/:id/comments", (req, res) => {
  try {
    const { content, authorName } = req.body;

    if (!content || !authorName) {
      return res.status(400).json({
        error: "Content and author name required"
      });
    }

    dbHelpers.addComment(content, req.params.id, null, authorName);

    broadcast("comment");
    res.json({
      message: "Comment added"
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to add comment"
    });
  }
});

app.post("/api/achievements/:id/like", (req, res) => {
  try {
    const liked = dbHelpers.toggleLike(
      req.params.id,
      null,
      req.ip
    );

    const likeCount = dbHelpers.getLikeCount(req.params.id);

    broadcast("like");
    res.json({
      liked,
      likeCount
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to toggle like"
    });
  }
});

// ==================== STUDENT ROUTES ====================

app.get(
  "/api/student/achievements",
  authenticateToken,
  authorizeRole("Student"),
  (req, res) => {
    try {
      res.json(
        dbHelpers.getAllAchievements({
          userId: req.user.userId,
          statusFilter: ["published", "pending", "draft", "rejected"]
        })
      );
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch achievements"
      });
    }
  }
);

app.post(
  "/api/student/achievements",
  authenticateToken,
  authorizeRole("Student"),
  upload.fields([{ name: 'images', maxCount: 5 }, { name: 'documents', maxCount: 10 }]),
  (req, res) => {
    try {
      const { title, description, weekLabel } = req.body;

      if (!title || !description) {
        return res.status(400).json({
          error: "Title and description required"
        });
      }

      const user = dbHelpers.getUserById(req.user.userId);

      if (!user || !user.TeamID) {
        return res.status(400).json({
          error: "You must be assigned to a team before posting achievements."
        });
      }

      const result = dbHelpers.createAchievement(
        title,
        description,
        user.TeamID,
        req.user.userId,
        "pending",
        weekLabel || null
      );

      const allFiles = [...(req.files?.images || []), ...(req.files?.documents || [])];
      allFiles.forEach((file) => {
        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        const isDoc = ALLOWED_DOC_TYPES.test(ext);
        if (isDoc) {
          dbHelpers.addDocument(
            "/uploads/" + file.filename,
            file.originalname,
            ext.toUpperCase(),
            result.lastInsertRowid
          );
        } else {
          dbHelpers.addImage("/uploads/" + file.filename, result.lastInsertRowid);
        }
      });

      broadcast("achievement");
      res.json({
        message: "Weekly summary submitted for review",
        achievementId: result.lastInsertRowid
      });
    } catch (error) {
      console.error("Error creating student achievement:", error);

      res.status(500).json({
        error: "Failed to submit achievement"
      });
    }
  }
);

app.put(
  "/api/student/achievements/:id",
  authenticateToken,
  authorizeRole("Student"),
  upload.fields([{ name: 'images', maxCount: 5 }, { name: 'documents', maxCount: 10 }]),
  (req, res) => {
    try {
      const achievement = dbHelpers.getAchievementById(req.params.id);

      if (!achievement) {
        return res.status(404).json({
          error: "Not found"
        });
      }

      if (achievement.CreatedBy !== req.user.userId) {
        return res.status(403).json({
          error: "Not allowed"
        });
      }

      if (achievement.Status === "published") {
        return res.status(400).json({
          error: "Cannot edit a published achievement"
        });
      }

      const { title, description } = req.body;

      dbHelpers.updateAchievement(
        req.params.id,
        title || achievement.Title,
        description || achievement.Description,
        "pending"
      );

      const allFiles = [...(req.files?.images || []), ...(req.files?.documents || [])];
      allFiles.forEach((file) => {
        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        const isDoc = ALLOWED_DOC_TYPES.test(ext);
        if (isDoc) {
          dbHelpers.addDocument(
            "/uploads/" + file.filename,
            file.originalname,
            ext.toUpperCase(),
            req.params.id
          );
        } else {
          dbHelpers.addImage("/uploads/" + file.filename, req.params.id);
        }
      });

      broadcast("achievement");
      res.json({
        message: "Updated and resubmitted for review"
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update achievement"
      });
    }
  }
);

app.delete(
  "/api/student/achievements/:id",
  authenticateToken,
  authorizeRole("Student"),
  (req, res) => {
    try {
      const achievement = dbHelpers.getAchievementById(req.params.id);

      if (!achievement || achievement.CreatedBy !== req.user.userId) {
        return res.status(403).json({
          error: "Not allowed"
        });
      }

      dbHelpers.deleteAchievement(req.params.id);

      broadcast("achievement");
      res.json({
        message: "Deleted"
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to delete"
      });
    }
  }
);
// ==================== TEAM WORKSPACE ROUTES ====================

app.get('/api/team-workspace', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);

    if (!user || !user.TeamID) {
      return res.status(400).json({
        error: 'User is not assigned to a team'
      });
    }

    res.json({
      team: dbHelpers.getTeamById(user.TeamID),
      members: dbHelpers.getTeamMembers(user.TeamID),
      tasks: dbHelpers.getTeamTasks(user.TeamID),
      chat: dbHelpers.getTeamChat(user.TeamID)
    });

  } catch (err) {
    console.error('Team Workspace Error:', err);
    res.status(500).json({
      error: 'Failed to load team workspace'
    });
  }
});

app.post('/api/team-workspace/tasks', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    if (user.Role !== 'Leader') {
      return res.status(403).json({ error: 'Only the team leader can assign tasks' });
    }
    const { title, description, assignedTo, dueDate } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    dbHelpers.createTeamTask(user.TeamID, title.trim(), description, assignedTo || null, user.UserID, dueDate || null);
    broadcast('team-workspace');
    res.json({ message: 'Task created' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.put('/api/team-workspace/tasks/:id/status', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    const task = dbHelpers.getTeamTaskById(req.params.id);
    if (!task || Number(task.TeamID) !== Number(user.TeamID)) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (user.Role !== 'Leader' && Number(task.AssignedTo) !== Number(user.UserID)) {
      return res.status(403).json({ error: 'You can only update tasks assigned to you' });
    }
    const { status } = req.body;
    if (!['todo', 'progress', 'done'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    dbHelpers.updateTeamTaskStatus(req.params.id, status);
    broadcast('team-workspace');
    res.json({ message: 'Task updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/team-workspace/tasks/:id', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    if (user.Role !== 'Leader') {
      return res.status(403).json({ error: 'Only the team leader can delete tasks' });
    }
    const task = dbHelpers.getTeamTaskById(req.params.id);
    if (!task || Number(task.TeamID) !== Number(user.TeamID)) {
      return res.status(404).json({ error: 'Task not found' });
    }
    dbHelpers.deleteTeamTask(req.params.id);
    broadcast('team-workspace');
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

app.get('/api/team-workspace/notes', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    res.json(dbHelpers.getTeamNotes(user.TeamID));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

app.post('/api/team-workspace/notes', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    dbHelpers.createTeamNote(user.TeamID, title.trim(), user.UserID);
    broadcast('team-workspace');
    res.json({ message: 'Note created' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create note' });
  }
});

app.put('/api/team-workspace/notes/:id/toggle', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    const note = dbHelpers.getTeamNoteById(req.params.id);
    if (!note || Number(note.TeamID) !== Number(user.TeamID)) {
      return res.status(404).json({ error: 'Note not found' });
    }
    dbHelpers.toggleTeamNote(req.params.id, req.body.completed);
    broadcast('team-workspace');
    res.json({ message: 'Note updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

app.delete('/api/team-workspace/notes/:id', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    const note = dbHelpers.getTeamNoteById(req.params.id);
    if (!note || Number(note.TeamID) !== Number(user.TeamID)) {
      return res.status(404).json({ error: 'Note not found' });
    }
    dbHelpers.deleteTeamNote(req.params.id);
    broadcast('team-workspace');
    res.json({ message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

app.get('/api/team-workspace/todos', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    res.json(dbHelpers.getTeamTodos(user.TeamID));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load team todos' });
  }
});

app.get('/api/team-workspace/links', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    res.json(dbHelpers.getTeamLinks(user.TeamID));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load team links' });
  }
});

app.post('/api/team-workspace/links', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    const { title, url } = req.body;
    if (!url || !url.trim()) {
      return res.status(400).json({ error: 'URL is required' });
    }
    dbHelpers.addTeamLink(user.TeamID, title?.trim() || null, url.trim(), user.UserID);
    broadcast('team-workspace');
    res.json({ message: 'Link added' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add link' });
  }
});

app.delete('/api/team-workspace/links/:id', authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    if (!user || !user.TeamID) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    const link = dbHelpers.getTeamLinkById(req.params.id);
    if (!link || Number(link.TeamID) !== Number(user.TeamID)) {
      return res.status(404).json({ error: 'Link not found' });
    }
    dbHelpers.deleteTeamLink(req.params.id);
    broadcast('team-workspace');
    res.json({ message: 'Link deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete link' });
  }
});
// ==================== LEADER ROUTES ====================
app.post("/api/help-messages", authenticateToken, (req, res) => {
  try {
    const { message } = req.body;

    const user = dbHelpers.getUserByEmail(req.user.email);

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    dbHelpers.createHelpMessage(
      user.UserID,
      user.Name,
      user.Role,
      message.trim()
    );

    broadcast("help-messages");
    res.json({
      success: true
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to send message"
    });
  }
});

app.get("/api/help-messages/mine", authenticateToken, (req, res) => {
  try {
    res.json(dbHelpers.getHelpMessagesBySender(req.user.userId));
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch your messages"
    });
  }
});

app.get(
  "/api/admin/help-messages",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      res.json(dbHelpers.getAllHelpMessages());
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch help messages"
      });
    }
  }
);

app.put(
  "/api/admin/help-messages/:id/status",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      const { status } = req.body;
      if (!["pending", "done", "rejected"].includes(status)) {
        return res.status(400).json({
          error: "Invalid status"
        });
      }
      dbHelpers.updateHelpMessageStatus(req.params.id, status);
      // Notify the sender
      const hm = dbHelpers.getHelpMessageById(req.params.id);
      if (hm && hm.SenderID) {
        const label = status === 'done' ? 'resolved' : status === 'rejected' ? 'rejected' : 'updated';
        dbHelpers.createNotification(hm.SenderID, 'help_reply', 'Admin replied to your request', `Your help request has been ${label}.`, hm.MessageID);
        broadcast("notifications");
      }
      broadcast("help-messages");
      res.json({ message: "Status updated" });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update message"
      });
    }
  }
);

app.put(
  "/api/admin/help-messages/:id/reply",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      const { reply } = req.body;
      if (!reply || !reply.trim()) return res.status(400).json({ error: "Reply cannot be empty" });
      dbHelpers.replyHelpMessage(req.params.id, reply.trim());
      const hm = dbHelpers.getHelpMessageById(req.params.id);
      if (hm && hm.SenderID) {
        dbHelpers.createNotification(hm.SenderID, 'help_reply', 'Admin replied to your request', reply.trim(), hm.MessageID);
        broadcast("notifications");
      }
      broadcast("help-messages");
      res.json({ message: "Reply sent" });
    } catch (error) {
      res.status(500).json({ error: "Failed to send reply" });
    }
  }
);

app.delete(
  "/api/admin/help-messages/:id",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      dbHelpers.deleteHelpMessage(req.params.id);
      broadcast("help-messages");
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({
        error: "Failed to delete message"
      });
    }
  }
);

// ==================== NOTIFICATIONS ====================

app.get("/api/notifications", authenticateToken, (req, res) => {
  try {
    const stored = dbHelpers.getNotificationsByUser(req.user.userId);

    // Dynamic: personal reminders due today
    const today = new Date().toISOString().slice(0, 10);
    const reminders = dbHelpers.getRemindersByUser(req.user.userId)
      .filter(r => r.ReminderDate === today && !r.Completed)
      .map(r => ({ NotificationID: `r_${r.ReminderID}`, Type: 'reminder', Title: '⏰ Reminder', Message: r.Title, IsRead: 0, CreatedAt: r.CreatedAt, dynamic: true }));

    // Dynamic: events happening tomorrow (all users see these)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const events = dbHelpers.getAllCalendarEvents()
      .filter(e => e.EventDate === tomorrowStr)
      .map(e => ({ NotificationID: `e_${e.EventID}`, Type: 'event_tomorrow', Title: '📅 Event Tomorrow', Message: `"${e.Title}" is tomorrow${e.EventTime ? ' at ' + e.EventTime : ''}`, IsRead: 0, CreatedAt: e.CreatedAt, dynamic: true }));

    const all = [...stored, ...reminders, ...events]
      .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

app.get("/api/notifications/count", authenticateToken, (req, res) => {
  try {
    const stored = dbHelpers.getUnreadNotificationCount(req.user.userId);

    const today = new Date().toISOString().slice(0, 10);
    const reminderCount = dbHelpers.getRemindersByUser(req.user.userId)
      .filter(r => r.ReminderDate === today && !r.Completed).length;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const eventCount = dbHelpers.getAllCalendarEvents().filter(e => e.EventDate === tomorrowStr).length;

    res.json({ count: stored + reminderCount + eventCount });
  } catch (err) {
    res.json({ count: 0 });
  }
});

app.put("/api/notifications/mark-all-read", authenticateToken, (req, res) => {
  try {
    dbHelpers.markAllNotificationsRead(req.user.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

app.put("/api/notifications/:id/read", authenticateToken, (req, res) => {
  try {
    dbHelpers.markNotificationRead(req.params.id, req.user.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// ==================== EVENT REQUESTS ====================

app.post("/api/event-requests", authenticateToken, (req, res) => {
  try {
    const { eventName, eventSpeaker, eventDate, eventTime, description } = req.body;
    if (!eventName || !eventDate) return res.status(400).json({ error: "Event name and date are required" });
    const user = dbHelpers.getUserById(req.user.userId);
    dbHelpers.createEventRequest(
      req.user.userId, user.Name, user.TeamID, user.TeamName,
      eventName, eventSpeaker, eventDate, eventTime, description
    );
    broadcast("event-requests");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to submit request" });
  }
});

app.get("/api/event-requests", authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserById(req.user.userId);
    const isMedia = user.TeamName && user.TeamName.toLowerCase().includes('media');
    if (req.user.role !== 'Admin' && req.user.role !== 'Supervisor' && !isMedia) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.json(dbHelpers.getAllEventRequests());
  } catch (err) {
    res.status(500).json({ error: "Failed to load requests" });
  }
});

app.get("/api/event-requests/my", authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(dbHelpers.getMyEventRequests(user.UserID));
  } catch (err) {
    res.status(500).json({ error: "Failed to load requests" });
  }
});

app.put("/api/event-requests/:id", authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserById(req.user.userId);
    const isMedia = user.TeamName && user.TeamName.toLowerCase().includes('media');
    if (req.user.role !== 'Admin' && req.user.role !== 'Supervisor' && !isMedia) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { status, reviewNote } = req.body;
    if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: "Invalid status" });

    const request = dbHelpers.getEventRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found" });

    dbHelpers.updateEventRequestStatus(req.params.id, status, req.user.userId, reviewNote);

    const title = status === 'accepted' ? '✅ Event Request Accepted' : '❌ Event Request Declined';
    const msg = status === 'accepted'
      ? `Your event request "${request.EventName}" has been accepted by the Media Team!`
      : `Your event request "${request.EventName}" was declined.${reviewNote ? ' Note: ' + reviewNote : ''}`;
    dbHelpers.createNotification(request.RequesterID, 'event_request', title, msg, request.RequestID);

    broadcast("event-requests");
    broadcast("notifications");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update request" });
  }
});

app.delete("/api/event-requests/:id", authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserById(req.user.userId);
    const isMedia = user.TeamName && user.TeamName.toLowerCase().includes('media');
    if (req.user.role !== 'Admin' && req.user.role !== 'Supervisor' && !isMedia) {
      return res.status(403).json({ error: "Access denied" });
    }
    const request = dbHelpers.getEventRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.Status === 'pending') return res.status(400).json({ error: "Cannot delete a pending request" });
    dbHelpers.deleteEventRequest(req.params.id);
    broadcast("event-requests");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete request" });
  }
});

// Requester edits their own pending request
app.patch("/api/event-requests/:id/my", authenticateToken, (req, res) => {
  try {
    const request = dbHelpers.getEventRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (String(request.RequesterID) !== String(req.user.userId)) return res.status(403).json({ error: "Not authorized" });
    if (request.Status !== 'pending') return res.status(400).json({ error: "Only pending requests can be edited" });
    const { eventName, eventSpeaker, eventDate, eventTime, description } = req.body;
    if (!eventName || !eventDate) return res.status(400).json({ error: "Event name and date are required" });
    dbHelpers.updateEventRequest(req.params.id, eventName, eventSpeaker, eventDate, eventTime, description);
    broadcast("event-requests");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update request" });
  }
});

// Requester deletes their own request (any status)
app.delete("/api/event-requests/:id/my", authenticateToken, (req, res) => {
  try {
    const request = dbHelpers.getEventRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (String(request.RequesterID) !== String(req.user.userId)) return res.status(403).json({ error: "Not authorized" });
    dbHelpers.deleteEventRequest(req.params.id);
    broadcast("event-requests");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete request" });
  }
});

app.put("/api/news-feed/comments/:commentId", authenticateToken, (req, res) => {
  try {
    const comment = dbHelpers.getNewsFeedCommentById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    const user = dbHelpers.getUserByEmail(req.user.email);
    const userId = user?.UserID || req.user.userId;
    if (comment.AuthorID !== userId) return res.status(403).json({ error: "Not authorized" });
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: "Content required" });
    dbHelpers.updateNewsFeedComment(req.params.commentId, content.trim(), userId);
    broadcast("newsfeed");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update comment" });
  }
});

// ==================== PERSONAL REMINDERS & TO-DO (private per user) ====================

app.get("/api/reminders", authenticateToken, (req, res) => {
  try {
    res.json(dbHelpers.getRemindersByUser(req.user.userId));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch reminders" });
  }
});

app.post("/api/reminders", authenticateToken, (req, res) => {
  try {
    const { title, description, reminderDate, startTime, endTime } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    dbHelpers.createReminder(req.user.userId, title, description, reminderDate, startTime, endTime);
    res.json({ message: "Reminder created" });
  } catch (error) {
    res.status(500).json({ error: "Failed to create reminder" });
  }
});

app.put("/api/reminders/:id", authenticateToken, (req, res) => {
  try {
    const { title, description, reminderDate, startTime, endTime } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    dbHelpers.updateReminder(req.params.id, req.user.userId, title, description, reminderDate, startTime, endTime);
    res.json({ message: "Reminder updated" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update reminder" });
  }
});

app.put("/api/reminders/:id/toggle", authenticateToken, (req, res) => {
  try {
    dbHelpers.toggleReminder(req.params.id, req.user.userId, req.body.completed);
    res.json({ message: "Reminder updated" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update reminder" });
  }
});

app.delete("/api/reminders/:id", authenticateToken, (req, res) => {
  try {
    dbHelpers.deleteReminder(req.params.id, req.user.userId);
    res.json({ message: "Reminder deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete reminder" });
  }
});

app.get("/api/todos", authenticateToken, (req, res) => {
  try {
    res.json(dbHelpers.getTodosByUser(req.user.userId));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch to-do items" });
  }
});

app.post("/api/todos", authenticateToken, (req, res) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    const result = dbHelpers.createTodo(req.user.userId, title);
    broadcast('team-workspace');
    res.json({ message: "To-do created", todoId: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ error: "Failed to create to-do item" });
  }
});

app.put("/api/todos/:id/toggle", authenticateToken, (req, res) => {
  try {
    dbHelpers.toggleTodo(req.params.id, req.user.userId, req.body.completed);
    broadcast('team-workspace');
    res.json({ message: "To-do updated" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update to-do item" });
  }
});

app.delete("/api/todos/:id", authenticateToken, (req, res) => {
  try {
    dbHelpers.deleteTodo(req.params.id, req.user.userId);
    broadcast('team-workspace');
    res.json({ message: "To-do deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete to-do item" });
  }
});

app.get(
  "/api/leader/achievements",
  authenticateToken,
  authorizeRole("Leader"),
  (req, res) => {
    try {
      const own = dbHelpers.getAllAchievements({
        userId: req.user.userId,
        statusFilter: ["published", "draft", "pending", "rejected"]
      });

      const pendingFromStudents = dbHelpers
        .getAllAchievements({
          teamId: req.user.teamId,
          statusFilter: ["pending"]
        })
        .filter((a) => a.CreatedBy !== req.user.userId);

      const publishedFromStudents = dbHelpers
        .getAllAchievements({
          teamId: req.user.teamId,
          statusFilter: ["published"]
        })
        .filter((a) => a.CreatedBy !== req.user.userId);

      res.json({
        own,
        pendingFromStudents,
        publishedFromStudents
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch achievements"
      });
    }
  }
);

app.post(
  "/api/leader/achievements",
  authenticateToken,
  authorizeRole("Leader"),
  upload.fields([{ name: 'images', maxCount: 5 }, { name: 'documents', maxCount: 10 }]),
  (req, res) => {
    try {
      const { title, description, status, weekLabel } = req.body;

      if (!title || !description) {
        return res.status(400).json({
          error: "Title and description required"
        });
      }

      if (!req.user.teamId) {
        return res.status(400).json({
          error: "You must be assigned to a team before posting achievements."
        });
      }

      if (!req.user.userId) {
        return res.status(400).json({
          error: "User record not found. Please log out and log back in."
        });
      }

      const result = dbHelpers.createAchievement(
        title,
        description,
        req.user.teamId,
        req.user.userId,
        status || "published",
        weekLabel || null
      );

      const allFiles = [...(req.files?.images || []), ...(req.files?.documents || [])];
      allFiles.forEach((file) => {
        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        const isDoc = ALLOWED_DOC_TYPES.test(ext);
        if (isDoc) {
          dbHelpers.addDocument(
            "/uploads/" + file.filename,
            file.originalname,
            ext.toUpperCase(),
            result.lastInsertRowid
          );
        } else {
          dbHelpers.addImage("/uploads/" + file.filename, result.lastInsertRowid);
        }
      });

      broadcast("achievement");
      res.json({
        message: "Created",
        achievementId: result.lastInsertRowid
      });
    } catch (error) {
      console.error("Error creating achievement:", error);

      res.status(500).json({
        error: "Failed to create achievement"
      });
    }
  }
);

app.put(
  "/api/leader/achievements/:id",
  authenticateToken,
  authorizeRole("Leader"),
  upload.fields([{ name: 'images', maxCount: 5 }, { name: 'documents', maxCount: 10 }]),
  (req, res) => {
    try {
      const achievement = dbHelpers.getAchievementById(req.params.id);

      if (!achievement) {
        return res.status(404).json({
          error: "Not found"
        });
      }

      if (achievement.CreatedBy !== req.user.userId) {
        return res.status(403).json({
          error: "Not allowed"
        });
      }

      const { title, description, status } = req.body;

      dbHelpers.updateAchievement(
        req.params.id,
        title || achievement.Title,
        description || achievement.Description,
        status || achievement.Status
      );

      const allFiles = [...(req.files?.images || []), ...(req.files?.documents || [])];
      allFiles.forEach((file) => {
        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        const isDoc = ALLOWED_DOC_TYPES.test(ext);
        if (isDoc) {
          dbHelpers.addDocument(
            "/uploads/" + file.filename,
            file.originalname,
            ext.toUpperCase(),
            req.params.id
          );
        } else {
          dbHelpers.addImage("/uploads/" + file.filename, req.params.id);
        }
      });

      broadcast("achievement");
      res.json({
        message: "Updated"
      });
    } catch (error) {
      console.error("Error updating achievement:", error);

      res.status(500).json({
        error: "Failed to update achievement"
      });
    }
  }
);

app.post(
  "/api/leader/achievements/:id/review",
  authenticateToken,
  authorizeRole("Leader"),
  (req, res) => {
    try {
      const achievement = dbHelpers.getAchievementById(req.params.id);

      if (!achievement) {
        return res.status(404).json({
          error: "Not found"
        });
      }

      if (achievement.TeamID !== req.user.teamId) {
        return res.status(403).json({
          error: "Not your team"
        });
      }

      const { action, feedback } = req.body;

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({
          error: "Action must be approve or reject"
        });
      }

      const newStatus =
        action === "approve" ? "published" : "rejected";

      dbHelpers.updateAchievement(
        req.params.id,
        achievement.Title,
        achievement.Description,
        newStatus
      );

      if (action === "reject" && feedback) {
        dbHelpers.addComment(
          `[Leader Feedback] ${feedback}`,
          req.params.id,
          req.user.userId,
          "Team Leader"
        );
      }

      broadcast("achievement");
      res.json({
        message:
          action === "approve"
            ? "Achievement published!"
            : "Achievement rejected"
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to review achievement"
      });
    }
  }
);

app.delete(
  "/api/leader/achievements/:id",
  authenticateToken,
  authorizeRole("Leader"),
  (req, res) => {
    try {
      const achievement = dbHelpers.getAchievementById(req.params.id);

      if (!achievement) {
        return res.status(404).json({ error: "Not found" });
      }

      if (achievement.TeamID !== req.user.teamId) {
        return res.status(403).json({
          error: "Not your team's achievement"
        });
      }

      dbHelpers.deleteAchievement(req.params.id);

      broadcast("achievement");
      res.json({
        message: "Deleted"
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to delete"
      });
    }
  }
);

// ==================== ADMIN ROUTES ====================

app.get(
  "/api/admin/statistics",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      res.json(dbHelpers.getStatistics());
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch statistics"
      });
    }
  }
);

app.post(
  "/api/admin/teams",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      const { teamName, description, leaderId } = req.body;

      if (!teamName) {
        return res.status(400).json({
          error: "Team name required"
        });
      }

      dbHelpers.createTeam(
        teamName,
        description,
        leaderId || null
      );

      broadcast("teams");
      res.json({
        message: "Team created"
      });
    } catch (error) {
      console.error("Error creating team:", error);

      res.status(500).json({
        error: "Failed to create team"
      });
    }
  }
);

app.put(
  "/api/admin/teams/:id",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      const { teamName, description, leaderId } = req.body;

      const teams = dbHelpers.getAllTeams();

      const existingTeam = teams.find(
        (t) => t.TeamID === parseInt(req.params.id)
      );

      if (!existingTeam) {
        return res.status(404).json({
          error: "Team not found"
        });
      }

      dbHelpers.updateTeam(
        req.params.id,
        teamName || existingTeam.TeamName,
        description !== undefined
          ? description
          : existingTeam.Description,
        leaderId !== undefined
          ? leaderId
          : existingTeam.LeaderUserID
      );

      broadcast("teams");
      res.json({
        message: "Team updated"
      });
    } catch (error) {
      console.error("Error updating team:", error);

      res.status(500).json({
        error: "Failed to update team"
      });
    }
  }
);

app.delete(
  "/api/admin/teams/:id",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      dbHelpers.deleteTeam(req.params.id);

      broadcast("teams");
      res.json({
        message: "Team deleted"
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to delete team"
      });
    }
  }
);

app.put(
  "/api/admin/teams/:id/cover",
  authenticateToken,
  authorizeRole("Admin"),
  upload.single("coverImage"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No image uploaded"
        });
      }

      const coverImage = "/uploads/" + req.file.filename;
      dbHelpers.updateTeamCoverImage(req.params.id, coverImage);

      broadcast("teams");
      res.json({
        message: "Cover image updated",
        coverImage
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update cover image"
      });
    }
  }
);

app.get(
  "/api/admin/users",
  authenticateToken,
  authorizeRole("Admin", "Supervisor"),
  (req, res) => {
    try {
      const leaders = dbHelpers.getUsersByRole("Leader");
      const admins = dbHelpers.getUsersByRole("Admin");
      const students = dbHelpers.getUsersByRole("Student");
      const supervisors = dbHelpers.getUsersByRole("Supervisor");

      res.json({
        leaders,
        admins,
        students,
        supervisors
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch users"
      });
    }
  }
);

app.post(
  "/api/admin/users",
  authenticateToken,
  authorizeRole("Admin"),
  async (req, res) => {
    try {
      const { name, email, password, role, teamId, phone } = req.body;

      if (!name || !email || !password || !role) {
        return res.status(400).json({
          error: "All fields required"
        });
      }

      if (
        !["Admin", "Leader", "Student", "Supervisor"].includes(role)
      ) {
        return res.status(400).json({
          error: "Invalid role"
        });
      }

      let uid = null;
      try {
        const fbUser = await admin.auth().createUser({ email, password, displayName: name });
        await setUserClaims(fbUser.uid, role, teamId || null);
        uid = fbUser.uid;
        dbHelpers.createUser(name, email, null, role, teamId || null, phone || null);
      } catch (fbErr) {
        if (fbErr.code && fbErr.code.startsWith("auth/")) {
          // Firebase rejected it (e.g. email already exists) — surface the error
          return res.status(400).json({ error: fbErr.message || "Firebase error" });
        }
        // Network unreachable — create locally with hashed password so user can still log in
        console.warn("[user creation] Firebase unreachable, creating locally:", fbErr.message);
        dbHelpers.createUser(name, email, password, role, teamId || null, phone || null);
      }

      broadcast("users");
      res.json({ message: "User created", uid });
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: error.message || "Failed to create user" });
    }
  }
);

app.put(
  "/api/admin/users/:id",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      const { name, email, teamId, phone } = req.body;
      const existing = dbHelpers.getUserById(req.params.id);

      dbHelpers.updateUser(
        req.params.id,
        name,
        email,
        teamId,
        phone,
        existing?.ProfilePicture
      );

      broadcast("users");
      res.json({
        message: "User updated"
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update user"
      });
    }
  }
);

app.post(
  "/api/admin/users/:id/photo",
  authenticateToken,
  authorizeRole("Admin"),
  upload.single("profileImage"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image uploaded" });
      }
      const existing = dbHelpers.getUserById(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "User not found" });
      }
      const profilePicture = "/uploads/" + req.file.filename;
      dbHelpers.updateUser(
        req.params.id,
        existing.Name,
        existing.Email,
        existing.TeamID,
        existing.Phone,
        profilePicture
      );
      broadcast("users");
      res.json({ message: "Profile picture updated", profilePicture });
    } catch (error) {
      res.status(500).json({ error: "Failed to update profile picture" });
    }
  }
);

app.delete(
  "/api/admin/users/:id/photo",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      const existing = dbHelpers.getUserById(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "User not found" });
      }
      dbHelpers.updateUser(
        req.params.id,
        existing.Name,
        existing.Email,
        existing.TeamID,
        existing.Phone,
        null
      );
      broadcast("users");
      res.json({ message: "Profile picture removed" });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove profile picture" });
    }
  }
);

app.delete(
  "/api/admin/users/:id",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      dbHelpers.deleteUser(req.params.id);

      broadcast("users");
      res.json({
        message: "User deleted"
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to delete user"
      });
    }
  }
);

// ==================== ADMIN PROFILE UPDATE ====================
// This route updates Admin name, email, password, and profile image.
// It updates Firebase Auth + local database.

app.put(
  "/api/admin/profile",
  authenticateToken,
  authorizeRole("Admin"),
  upload.single("profileImage"),
  async (req, res) => {
    try {
      const { name, email, password } = req.body;

      const currentEmail = req.user.email;

      if (!currentEmail) {
        return res.status(400).json({
          error: "Current admin email not found."
        });
      }

      const firebaseUser = await admin
        .auth()
        .getUserByEmail(currentEmail);

      const updateData = {};

      if (name && name.trim() !== "") {
        updateData.displayName = name.trim();
      }

      if (email && email.trim() !== "") {
        updateData.email = email.trim();
      }

      if (password && password.trim() !== "") {
        if (password.length < 6) {
          return res.status(400).json({
            error: "Password must be at least 6 characters."
          });
        }

        updateData.password = password;
      }

      if (req.file) {
        updateData.photoURL = "/uploads/" + req.file.filename;
      }

      await admin.auth().updateUser(firebaseUser.uid, updateData);

      const dbUser = dbHelpers.getUserByEmail(currentEmail);

      if (dbUser) {
        dbHelpers.updateUser(
          dbUser.UserID,
          name || dbUser.Name,
          email || dbUser.Email,
          dbUser.TeamID || null,
          dbUser.Phone || null,
          req.file ? "/uploads/" + req.file.filename : dbUser.ProfilePicture
        );
      }

      res.json({
        message: "Admin profile updated successfully",
        photoURL: updateData.photoURL || null,
        updatedEmail: email || currentEmail,
        updatedName: name || dbUser?.Name || "Admin"
      });
    } catch (error) {
      console.error("Admin profile update error:", error);

      res.status(500).json({
        error: error.message || "Failed to update admin profile"
      });
    }
  }
);

// ==================== SELF-SERVICE PROFILE UPDATE (any role) ====================
// Updates the caller's own name/email/password/phone. Tries Firebase first;
// if the account isn't Firebase-backed (or Firebase is unreachable), falls
// back to updating the local record only so the request still succeeds.

app.put("/api/profile", authenticateToken, async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const currentEmail = req.user.email;

    const dbUser = dbHelpers.getUserByEmail(currentEmail);
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (password && password.trim() !== "" && password.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters."
      });
    }

    let updatedEmail = dbUser.Email;

    try {
      const firebaseUser = await admin.auth().getUserByEmail(currentEmail);
      const updateData = {};

      if (name && name.trim() !== "") updateData.displayName = name.trim();
      if (email && email.trim() !== "" && email.trim() !== currentEmail) updateData.email = email.trim();
      if (password && password.trim() !== "") updateData.password = password;

      if (Object.keys(updateData).length > 0) {
        await admin.auth().updateUser(firebaseUser.uid, updateData);
      }
      if (updateData.email) updatedEmail = updateData.email;
    } catch (fbErr) {
      console.warn("[profile update] Firebase update skipped:", fbErr.message);
    }

    dbHelpers.updateUser(
      dbUser.UserID,
      name && name.trim() !== "" ? name.trim() : dbUser.Name,
      updatedEmail,
      dbUser.TeamID || null,
      phone !== undefined ? phone : dbUser.Phone,
      dbUser.ProfilePicture
    );

    res.json({
      message: "Profile updated",
      name: name && name.trim() !== "" ? name.trim() : dbUser.Name,
      email: updatedEmail,
      phone: phone !== undefined ? phone : dbUser.Phone
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({
      error: error.message || "Failed to update profile"
    });
  }
});

app.post("/api/profile/photo", authenticateToken, upload.single("profileImage"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }
    const dbUser = dbHelpers.getUserByEmail(req.user.email);
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }
    if (dbUser.Role === "Student") {
      return res.status(403).json({ error: "Only an admin can change your profile picture." });
    }
    const profilePicture = "/uploads/" + req.file.filename;
    dbHelpers.updateUser(
      dbUser.UserID,
      dbUser.Name,
      dbUser.Email,
      dbUser.TeamID || null,
      dbUser.Phone,
      profilePicture
    );
    res.json({ message: "Profile picture updated", profilePicture });
  } catch (error) {
    console.error("Profile photo update error:", error);
    res.status(500).json({ error: "Failed to update profile picture" });
  }
});

app.get(
  "/api/admin/achievements",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      res.json(
        dbHelpers.getAllAchievements({
          statusFilter: ["published", "pending", "draft", "rejected"]
        })
      );
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch achievements"
      });
    }
  }
);

app.delete(
  "/api/admin/achievements/:id",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      dbHelpers.deleteAchievement(req.params.id);

      broadcast("achievement");
      res.json({
        message: "Deleted"
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to delete"
      });
    }
  }
);

// ==================== SUPERVISOR ROUTES ====================

app.get(
  "/api/supervisor/achievements",
  authenticateToken,
  authorizeRole("Supervisor"),
  (req, res) => {
    try {
      const achievements = dbHelpers.getAllAchievements({
        statusFilter: ["published", "pending", "draft", "rejected"]
      });

      const result = achievements.map((a) => ({
        ...a,
        supervisorFeedbackCount:
          dbHelpers.getSupervisorFeedbackCount(a.AchievementID)
      }));

      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch achievements"
      });
    }
  }
);

app.get(
  "/api/supervisor/achievements/:id/feedback",
  authenticateToken,
  authorizeRole("Supervisor"),
  (req, res) => {
    try {
      res.json(
        dbHelpers.getSupervisorFeedback(req.params.id)
      );
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch feedback"
      });
    }
  }
);

app.post(
  "/api/supervisor/achievements/:id/feedback",
  authenticateToken,
  authorizeRole("Supervisor"),
  (req, res) => {
    try {
      const { content } = req.body;

      if (!content) {
        return res.status(400).json({
          error: "Content required"
        });
      }

      const user = dbHelpers.getUserByEmail(req.user.email);
      const authorName = user?.Name || "Supervisor";

      dbHelpers.addSupervisorFeedback(
        content,
        req.params.id,
        user?.UserID || null,
        authorName
      );

      broadcast("feedback");
      res.json({
        message: "Feedback posted"
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to post feedback"
      });
    }
  }
);

app.put(
  "/api/supervisor/feedback/:id",
  authenticateToken,
  authorizeRole("Supervisor"),
  (req, res) => {
    try {
      const fb = dbHelpers.getSupervisorFeedbackById(req.params.id);
      if (!fb) return res.status(404).json({ error: "Feedback not found" });
      const user = dbHelpers.getUserByEmail(req.user.email);
      if (fb.SupervisorUserID !== (user?.UserID || null)) return res.status(403).json({ error: "Not authorized" });
      const { content } = req.body;
      if (!content || !content.trim()) return res.status(400).json({ error: "Content required" });
      dbHelpers.updateSupervisorFeedback(req.params.id, content.trim());
      broadcast("feedback");
      res.json({ message: "Feedback updated" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update feedback" });
    }
  }
);

app.delete(
  "/api/supervisor/feedback/:id",
  authenticateToken,
  authorizeRole("Supervisor"),
  (req, res) => {
    try {
      const fb = dbHelpers.getSupervisorFeedbackById(req.params.id);
      if (!fb) return res.status(404).json({ error: "Feedback not found" });
      const user = dbHelpers.getUserByEmail(req.user.email);
      if (fb.SupervisorUserID !== (user?.UserID || null)) return res.status(403).json({ error: "Not authorized" });
      dbHelpers.deleteSupervisorFeedback(req.params.id);
      broadcast("feedback");
      res.json({ message: "Feedback deleted" });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete feedback" });
    }
  }
);

app.get(
  "/api/supervisor/my-feedback",
  authenticateToken,
  authorizeRole("Supervisor"),
  (req, res) => {
    try {
      const user = dbHelpers.getUserByEmail(req.user.email);

      if (!user) {
        return res.status(404).json({
          error: "User not found"
        });
      }

      res.json(
        dbHelpers.getSupervisorFeedbackBySupervisor(user.UserID)
      );
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch feedback"
      });
    }
  }
);

app.get(
  "/api/team/achievements/:id/supervisor-feedback",
  authenticateToken,
  (req, res) => {
    try {
      const role = req.user.role;

      if (
        !["Leader", "Student", "Admin", "Supervisor"].includes(role)
      ) {
        return res.status(403).json({
          error: "Not authorized"
        });
      }

      if (role === "Leader" || role === "Student") {
        const achievement = dbHelpers.getAchievementById(req.params.id);

        if (!achievement) {
          return res.status(404).json({
            error: "Not found"
          });
        }

        if (String(achievement.TeamID) !== String(req.user.teamId)) {
          return res.status(403).json({
            error: "Not your team"
          });
        }
      }

      res.json(
        dbHelpers.getSupervisorFeedbackForTeamAchievement(req.params.id)
      );
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch supervisor feedback"
      });
    }
  }
);

// ==================== NEWS FEED ROUTES ====================

app.get("/api/news-feed", authenticateToken, (req, res) => {
  try {
    res.json(dbHelpers.getAllNewsFeedPosts());
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch news feed" });
  }
});

app.post("/api/news-feed", authenticateToken, (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: "Content required" });
    const user = dbHelpers.getUserByEmail(req.user.email);
    const authorId = user?.UserID || req.user.userId;
    const authorName = user?.Name || req.user.email;
    const authorRole = user?.Role || req.user.role;
    if (!authorId) return res.status(400).json({ error: "User not found" });
    dbHelpers.createNewsFeedPost(content.trim(), authorId, authorName, authorRole);
    broadcast("newsfeed");
    res.json({ message: "Post created" });
  } catch (error) {
    res.status(500).json({ error: "Failed to create post" });
  }
});

app.put("/api/news-feed/:id", authenticateToken, (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: "Content required" });
    const post = dbHelpers.getNewsFeedPostById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    const user = dbHelpers.getUserByEmail(req.user.email);
    const userId = user?.UserID || req.user.userId;
    if (post.AuthorID !== userId) return res.status(403).json({ error: "Not your post" });
    dbHelpers.updateNewsFeedPost(req.params.id, content.trim(), userId);
    broadcast("newsfeed");
    res.json({ message: "Post updated" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update post" });
  }
});

app.delete("/api/news-feed/:id", authenticateToken, (req, res) => {
  try {
    const post = dbHelpers.getNewsFeedPostById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    const user = dbHelpers.getUserByEmail(req.user.email);
    const userId = user?.UserID || req.user.userId;
    if (post.AuthorID !== userId && req.user.role !== "Admin") {
      return res.status(403).json({ error: "Not authorized" });
    }
    dbHelpers.deleteNewsFeedPost(req.params.id);
    broadcast("newsfeed");
    res.json({ message: "Post deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete post" });
  }
});

// ==================== NEWS FEED LIKES & COMMENTS ====================

app.post("/api/news-feed/:id/like", authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    const userId = user?.UserID || req.user.userId;
    const result = dbHelpers.toggleNewsFeedLike(req.params.id, userId);
    broadcast("newsfeed");
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to toggle like" });
  }
});

app.get("/api/news-feed/:id/comments", authenticateToken, (req, res) => {
  try {
    res.json(dbHelpers.getNewsFeedComments(req.params.id));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

app.post("/api/news-feed/:id/comments", authenticateToken, (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: "Content required" });
    const user = dbHelpers.getUserByEmail(req.user.email);
    const userId = user?.UserID || req.user.userId;
    const authorName = user?.Name || req.user.email;
    dbHelpers.addNewsFeedComment(req.params.id, userId, authorName, content.trim());
    broadcast("newsfeed");
    res.json({ message: "Comment added" });
  } catch (error) {
    res.status(500).json({ error: "Failed to add comment" });
  }
});

app.delete("/api/news-feed/comments/:commentId", authenticateToken, (req, res) => {
  try {
    const comment = dbHelpers.getNewsFeedCommentById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    const user = dbHelpers.getUserByEmail(req.user.email);
    const userId = user?.UserID || req.user.userId;
    if (comment.AuthorID !== userId && req.user.role !== "Admin") {
      return res.status(403).json({ error: "Not authorized" });
    }
    dbHelpers.deleteNewsFeedComment(req.params.commentId);
    broadcast("newsfeed");
    res.json({ message: "Comment deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

app.get("/api/news-feed/my-likes", authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserByEmail(req.user.email);
    const userId = user?.UserID || req.user.userId;
    const likes = dbHelpers.getNewsFeedLikesByUser(userId);
    res.json(likes.map(l => l.PostID));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch likes" });
  }
});

// ==================== STATIC FILES / PAGE ROUTES ====================

function requirePageAuth(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.redirect("/login.html");
  }

  next();
}

app.get("/", (req, res) => {
  const p = path.join(__dirname, "public", "login.html");

  res.sendFile(
    fs.existsSync(p)
      ? p
      : path.join(__dirname, "login.html")
  );
});

app.get("/login.html", (req, res) => {
  const p = path.join(__dirname, "public", "login.html");

  res.sendFile(
    fs.existsSync(p)
      ? p
      : path.join(__dirname, "login.html")
  );
});

app.get("/student-dashboard.html", requirePageAuth, (req, res) => {
  const p = path.join(
    __dirname,
    "public",
    "student-dashboard.html"
  );

  res.sendFile(
    fs.existsSync(p)
      ? p
      : path.join(__dirname, "student-dashboard.html")
  );
});

app.get("/admin-dashboard.html", requirePageAuth, (req, res) => {
  const p = path.join(
    __dirname,
    "public",
    "admin-dashboard.html"
  );

  res.sendFile(
    fs.existsSync(p)
      ? p
      : path.join(__dirname, "admin-dashboard.html")
  );
});

app.get("/leader-dashboard.html", requirePageAuth, (req, res) => {
  const p = path.join(
    __dirname,
    "public",
    "leader-dashboard.html"
  );

  res.sendFile(
    fs.existsSync(p)
      ? p
      : path.join(__dirname, "leader-dashboard.html")
  );
});

app.get("/supervisor-dashboard.html", requirePageAuth, (req, res) => {
  const p = path.join(
    __dirname,
    "public",
    "supervisor-dashboard.html"
  );

  res.sendFile(
    fs.existsSync(p)
      ? p
      : path.join(__dirname, "supervisor-dashboard.html")
  );
});

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

// ==================== SEED DEFAULT ADMIN ====================

async function seedDefaultAdmin() {
  const email = process.env.ADMIN_EMAIL || "admin@company.com";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const name = "Admin";

  try {
    let fbUser;

    try {
      fbUser = await admin.auth().getUserByEmail(email);
      console.log(`[seed] Admin user already exists: ${email}`);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        fbUser = await admin.auth().createUser({
          email,
          password,
          displayName: name
        });

        console.log(`[seed] Default admin created: ${email}`);
      } else {
        throw err;
      }
    }

    await setUserClaims(fbUser.uid, "Admin", null);

    console.log("[seed] Admin claims set");

    try {
      dbHelpers.createUser(name, email, null, "Admin", null);
    } catch (dbErr) {
      if (!dbErr.message || !dbErr.message.includes("UNIQUE")) {
        console.log("[seed] DB user already exists or skipped");
      }
    }
  } catch (err) {
    console.error("[seed] Admin setup failed:", err.message);
  }
}

// ==================== START SERVER ====================

async function startServer() {
  try {
    console.log("1 - Start server");

    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    console.log("2 - Before database");

    const dbInit = initializeDatabase();

    if (dbInit && typeof dbInit.then === "function") {
      await dbInit;
    }

    setDbHelpers(dbHelpers);

    console.log("3 - After database");

    await seedDefaultAdmin();

    console.log("4 - After seed");

    app.listen(PORT, () => {
      console.log("Server running on http://localhost:" + PORT);
    });
  } catch (error) {
    console.error("Failed to start:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  if (dbHelpers && dbHelpers.close) {
    dbHelpers.close();
  }

  process.exit(0);
});

startServer();