const admin = require('firebase-admin');
const crypto = require('crypto');

const LOCAL_SECRET = process.env.LOCAL_JWT_SECRET || 'interntrack-local-fallback-secret-2026';

function signLocalToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'LOCAL' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig    = crypto.createHmac('sha256', LOCAL_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyLocalToken(token) {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) throw new Error('Bad token');
  const headerData = JSON.parse(Buffer.from(header, 'base64url').toString());
  if (headerData.typ !== 'LOCAL') throw new Error('Not a local token');
  const expected = crypto.createHmac('sha256', LOCAL_SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig !== expected) throw new Error('Invalid signature');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// Initialize Firebase Admin SDK (called once from server.js)
// Non-fatal if credentials are missing/invalid — local-auth login still works without Firebase.
function initFirebase() {
  if (admin.apps.length > 0) return;
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    console.warn('[auth] Firebase env vars missing — skipping Firebase Admin init (local-auth login will still work).');
    return;
  }
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  } catch (err) {
    console.warn('[auth] Firebase Admin init failed — continuing without it:', err.message);
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

  // Try local token first (fast, offline-capable)
  try {
    const decoded = verifyLocalToken(idToken);
    req.user = {
      uid:    decoded.uid || decoded.email,
      email:  decoded.email,
      role:   decoded.role   || null,
      teamId: decoded.teamId || null,
      userId: null,
    };
    if (_db) {
      try {
        const dbUser = _db.getUserByEmail(decoded.email);
        if (dbUser) {
          req.user.userId = dbUser.UserID;
          req.user.teamId = dbUser.TeamID || decoded.teamId || null;
          if (!req.user.role && dbUser.Role) req.user.role = dbUser.Role;
        }
      } catch (e) {}
    }
    return next();
  } catch (_) {
    // Not a local token — fall through to Firebase
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.user = {
      uid:    decoded.uid,
      email:  decoded.email,
      role:   decoded.role   || null,
      teamId: decoded.teamId || null,
      userId: null,
    };

    if (_db) {
      try {
        const dbUser = _db.getUserByEmail(decoded.email);
        if (dbUser) {
          req.user.userId = dbUser.UserID;
          req.user.teamId = dbUser.TeamID || decoded.teamId || null;
          if (!req.user.role && dbUser.Role) req.user.role = dbUser.Role;
        }
      } catch (e) {
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

module.exports = { initFirebase, authenticateToken, authorizeRole, checkTeamOwnership, setUserClaims, setDbHelpers, signLocalToken };
