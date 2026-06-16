// ─── Firebase Client-Side Auth ───────────────────────────────────────────────
// Replace the three config values below after you create your Firebase project.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "REPLACE_WITH_YOUR_API_KEY",
  authDomain:        "REPLACE_WITH_YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket:     "REPLACE_WITH_YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_MESSAGING_SENDER_ID",
  appId:             "REPLACE_WITH_YOUR_APP_ID"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ─── Login ────────────────────────────────────────────────────────────────────
async function handleLogin(event) {
  event.preventDefault();
  const email    = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const idToken    = await credential.user.getIdToken();

    // Send token to server — server verifies it, sets cookie, returns role + redirect
    const res  = await fetch('/api/auth/session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ idToken })
    });
    const data = await res.json();

    if (res.ok) {
      showToast('Login successful!', 'success');
      currentUser = data.user;
      updateUIForAuth();
      window.location.href = data.redirectUrl;
    } else {
      showToast(data.error || 'Login failed', 'error');
    }
  } catch (error) {
    console.error('Login error:', error);
    showToast(firebaseErrorMessage(error.code), 'error');
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function logout() {
  try {
    await signOut(auth);
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    updateUIForUnauth();
    showToast('Logged out successfully', 'success');
    showPage('home');
  } catch (error) {
    showToast('Logout failed', 'error');
  }
}

// ─── Auth state listener (keeps token fresh) ─────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // Firebase tokens expire every 1h — refresh cookie automatically
    const freshToken = await user.getIdToken(/* forceRefresh */ true);
    document.cookie = `token=${freshToken}; path=/; max-age=3600`;
  }
});

// ─── Authenticated fetch helper ───────────────────────────────────────────────
async function authenticatedFetch(url, options = {}) {
  const user = auth.currentUser;
  if (!user) { logout(); throw new Error('Not logged in'); }

  const idToken = await user.getIdToken();
  const headers = { ...options.headers, 'Authorization': `Bearer ${idToken}` };
  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 || response.status === 403) {
    logout();
    throw new Error('Authentication failed');
  }
  return response;
}

// ─── Friendly Firebase error messages ────────────────────────────────────────
function firebaseErrorMessage(code) {
  const map = {
    'auth/invalid-email':         'Invalid email address.',
    'auth/user-not-found':        'No account found with this email.',
    'auth/wrong-password':        'Incorrect password.',
    'auth/too-many-requests':     'Too many attempts. Try again later.',
    'auth/invalid-credential':    'Invalid email or password.',
  };
  return map[code] || 'Login failed. Please try again.';
}
