const admin = require('firebase-admin');

// Initialize Firebase Admin SDK (called once from server.js)
function initFirebase() {
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
}

// dbHelpers reference — set once from server.js via setDbHelpers()
let _db = null;
function setDbHelpers(dbHelpers) { _db = dbHelpers; }

// Middleware: verify Firebase ID token from Authorization header or cookie
// Also looks up the SQLite user record to get the real UserID and TeamID.
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const tokenFromCookie = req.cookies?.token;
  const idToken = tokenFromHeader || tokenFromCookie;

  if (!idToken) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);

    // Start with token claims
    req.user = {
      uid:    decoded.uid,
      email:  decoded.email,
      role:   decoded.role   || null,
      teamId: decoded.teamId || null,
      userId: null,  // will be filled from DB below
    };

    // Look up the real DB record so userId and teamId are always correct
    if (_db) {
      try {
        const dbUser = _db.getUserByEmail(decoded.email);
        if (dbUser) {
          req.user.userId = dbUser.UserID;
          req.user.teamId = dbUser.TeamID || decoded.teamId || null;
          // Also use DB role as ground truth if token claim is missing
          if (!req.user.role && dbUser.Role) req.user.role = dbUser.Role;
        }
      } catch (e) {
        // DB lookup failure is non-fatal — token claims still work for auth
        console.error('DB lookup in authenticateToken failed:', e.message);
      }
    }

    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

// Role-based authorization middleware
function authorizeRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    next();
  };
}

// Check team ownership
function checkTeamOwnership(req, res, next) {
  const teamId = parseInt(req.params.teamId || req.body.teamId);
  if (req.user.role === 'Admin') return next();
  if (req.user.role === 'Leader' && req.user.teamId === teamId) return next();
  return res.status(403).json({ error: "You can only manage your own team's achievements." });
}

// Set custom claims on a user
async function setUserClaims(uid, role, teamId = null) {
  await admin.auth().setCustomUserClaims(uid, { role, teamId });
}

module.exports = { initFirebase, authenticateToken, authorizeRole, checkTeamOwnership, setUserClaims, setDbHelpers };
