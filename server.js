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
  setDbHelpers
} = require("./auth");

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "public", "uploads");

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const uniqueSuffix =
      Date.now() + "-" + Math.round(Math.random() * 1e9);

    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    }

    cb(new Error("Only image files are allowed!"));
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

app.post("/api/auth/session", async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        error: "idToken required."
      });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const role = decoded.role || null;

    const dashboardUrl =
      role === "Admin"
        ? "/admin-dashboard.html"
        : role === "Leader"
        ? "/leader-dashboard.html"
        : role === "Supervisor"
        ? "/supervisor-dashboard.html"
        : "/student-dashboard.html";

    res.cookie("token", idToken, {
      maxAge: 60 * 60 * 1000,
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/"
    });

    res.json({
      message: "Session started",
      user: {
        uid: decoded.uid,
        email: decoded.email,
        role,
        teamId: decoded.teamId || null
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

app.post("/api/achievements/:id/comments", (req, res) => {
  try {
    const { content, authorName } = req.body;

    if (!content || !authorName) {
      return res.status(400).json({
        error: "Content and author name required"
      });
    }

    dbHelpers.addComment(content, req.params.id, null, authorName);

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
  upload.array("images", 5),
  (req, res) => {
    try {
      const { title, description } = req.body;

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
        "pending"
      );

      if (req.files) {
        req.files.forEach((file) => {
          dbHelpers.addImage(
            "/uploads/" + file.filename,
            result.lastInsertRowid
          );
        });
      }

      res.json({
        message: "Achievement submitted for review",
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

      if (achievement.Status === "published") {
        return res.status(400).json({
          error: "Cannot delete a published achievement"
        });
      }

      dbHelpers.deleteAchievement(req.params.id);

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

// ==================== LEADER ROUTES ====================

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

      res.json({
        own,
        pendingFromStudents
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
  upload.array("images", 5),
  (req, res) => {
    try {
      const { title, description, status } = req.body;

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
        status || "published"
      );

      if (req.files) {
        req.files.forEach((file) => {
          dbHelpers.addImage(
            "/uploads/" + file.filename,
            result.lastInsertRowid
          );
        });
      }

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

      if (!achievement || achievement.CreatedBy !== req.user.userId) {
        return res.status(403).json({
          error: "Not allowed"
        });
      }

      dbHelpers.deleteAchievement(req.params.id);

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

app.get(
  "/api/admin/users",
  authenticateToken,
  authorizeRole("Admin"),
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
      const { name, email, password, role, teamId } = req.body;

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

      const fbUser = await admin.auth().createUser({
        email,
        password,
        displayName: name
      });

      await setUserClaims(fbUser.uid, role, teamId || null);

      dbHelpers.createUser(
        name,
        email,
        null,
        role,
        teamId || null
      );

      res.json({
        message: "User created",
        uid: fbUser.uid
      });
    } catch (error) {
      console.error("Create user error:", error);

      res.status(500).json({
        error: error.message || "Failed to create user"
      });
    }
  }
);

app.put(
  "/api/admin/users/:id",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      const { name, email, teamId } = req.body;

      dbHelpers.updateUser(
        req.params.id,
        name,
        email,
        teamId
      );

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

app.delete(
  "/api/admin/users/:id",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    try {
      dbHelpers.deleteUser(req.params.id);

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
          dbUser.TeamID || null
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

    const uploadDir = path.join(__dirname, "public", "uploads");

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
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