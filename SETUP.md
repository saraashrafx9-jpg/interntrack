# InternTrack — Setup Guide

The server needs a **Firebase service account** to verify login tokens.
Follow these steps exactly and it will work.

---

## Step 1 — Get your Firebase Service Account key

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: **interntrack-d**
3. Click the ⚙️ gear icon → **Project Settings**
4. Click the **Service accounts** tab
5. Click **"Generate new private key"** → confirm → a JSON file downloads
6. Open that JSON file — it looks like this:

```json
{
  "type": "service_account",
  "project_id": "interntrack-d",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@interntrack-d.iam.gserviceaccount.com",
  ...
}
```

---

## Step 2 — Create your .env file

Create a file named exactly **`.env`** in your project root folder
(`C:\Users\Marya\OneDrive\Desktop\InternTrack\.env`)

Paste this content and fill in the values from your JSON file:

```
PORT=3000
NODE_ENV=development

FIREBASE_PROJECT_ID=interntrack-d
FIREBASE_CLIENT_EMAIL=paste_client_email_here
FIREBASE_PRIVATE_KEY="paste_private_key_here_keep_the_quotes"
```

### ⚠️ Important — Private Key formatting:
The private key in the JSON has literal `\n` characters. Paste it exactly as-is,
wrapped in **double quotes**. Example:

```
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvg...(long key)...==\n-----END PRIVATE KEY-----\n"
```

---

## Step 3 — Start the server

```bash
npm run dev
```

You should see:
```
HELLO FROM SERVER
Server running on http://localhost:3000
```

If you still get an error, double-check that:
- The `.env` file is in the project root (same folder as `server.js`)
- The `FIREBASE_PRIVATE_KEY` value is wrapped in double quotes
- You copied from the right JSON file (for project `interntrack-d`)

---

## Step 4 — Set up user roles (IMPORTANT)

Firebase needs to know each user's role. Run this **once** after starting the server:

```bash
node setup-roles.js
```

This reads your database and sets the `role` and `teamId` claims on each Firebase user.

**If a user shows "NOT FOUND in Firebase Auth"**, you need to create them in Firebase:
1. Go to Firebase Console → **Authentication** → **Users** tab
2. Click **"Add user"**
3. Enter the same email and password that's in your database
4. Run `node setup-roles.js` again

---

## Step 5 — Creating a Supervisor account

Supervisors are not created through the normal signup flow. An Admin must:

1. Log in as Admin → go to **Admin Dashboard**
2. Click the **Supervisors** tab in the sidebar
3. Click **"Add Supervisor"** → fill in name, email, password → Save
4. Go to **Firebase Console → Authentication → Add user** with the same email/password
5. Run `node setup-roles.js` again to sync the role

Then the supervisor can log in at:
- The main login page (select "Supervisor" tile) — **or**
- `/supervisor-login.html` (dedicated supervisor login)

---

## How login works (summary)

```
User opens site → clicks Login → picks role tile
  → enters email + password
  → Firebase Auth verifies credentials
  → server checks Firebase custom claim matches selected role
  → redirects to correct dashboard:
      Admin      → /admin-dashboard.html
      Leader     → /leader-dashboard.html
      Student    → /student-dashboard.html
      Supervisor → /supervisor-dashboard.html
```

The `role` lives as a **Firebase custom claim** (set by `setup-roles.js`).
The `teamId` claim is also set so leaders/students are scoped to their team.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Service account object must contain a string "project_id"` | `.env` file missing or `FIREBASE_PROJECT_ID` not set |
| `Invalid credential` | Wrong `FIREBASE_CLIENT_EMAIL` or `FIREBASE_PRIVATE_KEY` |
| Login works but goes to wrong dashboard | Run `node setup-roles.js` to sync roles |
| "This account is registered as Student, not Leader" | Role mismatch — run `setup-roles.js` again |
| Supervisor can't see feedback | Make sure their Firebase custom claim is `role: "Supervisor"` |
