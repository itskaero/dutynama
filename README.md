# DutyNama

> Duty roster management for hospital PGR teams — built so the person who always ends up making the Excel sheet doesn't have to anymore.

DutyNama is a lightweight, single-page web app that handles monthly duty scheduling for Postgraduate Residents (PGRs). It runs entirely in the browser, uses Firebase for real-time data sync, and keeps things simple enough that non-technical staff can actually use it.

---

## What it does

- A **Senior PGR** sets up the account, adds team members by email, and builds the monthly roster
- **PGRs** log in, mark their preferred off-days, and apply for leaves
- A **Senior Resident** can approve/reject leaves and record duty replacements
- Everyone sees the same live data — no more "which Excel is the latest one?" chaos

---

## Getting started

### 1. Firebase setup (one-time, ~5 minutes)

This app needs a Firebase project. The free Spark plan is more than enough.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project
2. Add a **Web App** (the `</>` icon on the project overview page)
3. Enable **Email/Password** authentication:
   `Authentication → Sign-in method → Email/Password → Enable`
4. Create a **Firestore database**:
   `Firestore Database → Create database → Start in test mode`
5. Paste these security rules under `Firestore → Rules`:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
6. Copy your project's config values from `Project Settings → Your Apps`

### 2. Add your Firebase config

Open `firebase-config.js` and fill in your values:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123",
};
```

> **Don't commit real credentials.** The file in the repo uses `YOUR_API_KEY` placeholders on purpose. Use the GitHub Actions workflow (below) to inject real values at deploy time.

### 3. Serve the app

The app can't run directly from `file://` (Firebase Auth blocks it). Use any local server:

```bash
# Python
python -m http.server 8080

# Node
npx serve .

# VS Code: install the "Live Server" extension and click "Go Live"
```

Then open `http://localhost:8080` in your browser.

### 4. First login

On first load, you'll see a "Create Admin Account" screen. This is the **Senior PGR** account — fill in your name, email, and choose a PIN. That's your only account for now; from there you can invite the rest of the team.

---

## Deploying to the web

The included GitHub Actions workflow handles deployment automatically when you push to `main`. It injects your Firebase credentials from GitHub Secrets so the real values are never stored in the repo.

### Add secrets to GitHub

`Settings → Secrets and variables → Actions → New repository secret`

| Secret | Where to find it |
|---|---|
| `FIREBASE_API_KEY` | Firebase project settings |
| `FIREBASE_AUTH_DOMAIN` | Firebase project settings |
| `FIREBASE_PROJECT_ID` | Firebase project settings |
| `FIREBASE_STORAGE_BUCKET` | Firebase project settings |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase project settings |
| `FIREBASE_APP_ID` | Firebase project settings |

### Choose a host

In `.github/workflows/deploy.yml`, uncomment one of the two deploy steps at the bottom:

- **Firebase Hosting** — tightest integration, free custom domain, global CDN
- **GitHub Pages** — zero config if your repo is already on GitHub

---

## Roles

| Role | What they can do |
|---|---|
| **Senior PGR** | Everything — build roster, manage team, configure units/shifts, invite/remove PGRs |
| **Senior Resident** | Approve/reject leaves, record duty replacements |
| **PGR** | Mark preferred off-days, apply for leaves |
| **Viewer** | Read-only dashboard |

---

## How the invite flow works

Regular PGRs can't just sign up — they have to be invited first. Here's the flow:

1. Senior PGR goes to **Admin → Invite PGR**, enters name + email + role
2. An invite is created in Firestore (no Firebase Auth account yet)
3. The PGR opens the app, clicks **"Setup Account"**, enters their email + a new PIN
4. Their Firebase Auth account is created and linked to the invite — done

This way nobody can create an account unless the Senior PGR has explicitly added them.

---

## File structure

```
dutynama/
├── index.html              # Single-page shell, all views live here
├── style.css               # GitHub-dark glassmorphism theme
├── firebase-config.js      # Firebase init (placeholders — safe to commit)
├── .github/
│   └── workflows/
│       └── deploy.yml      # CI: inject secrets → verify → deploy
└── js/
    ├── app.js              # Bootstrap: Firebase auth state → load app
    ├── auth.js             # Auth modes: login / setup account / initial setup
    ├── db.js               # Firestore data layer with in-memory cache
    ├── admin.js            # Team management, unit config, SR panel
    ├── rosterEngine.js     # Calendar render, shift assignment, auto-generate
    ├── leaveManager.js     # Leave apply / approve / reject
    ├── validationEngine.js # Constraint checking, alert generation
    ├── dashboard.js        # Today's duties, stats, overwork indicators
    ├── preferences.js      # Preferred off-day picker
    └── ui.js               # Navigation, modals, alert panel
```

---

## Features at a glance

- Monthly roster calendar with clickable dates, shift pills, and leave indicators
- Auto-roster generator — round-robin, duty-balanced, respects leaves and preferences
- Leave management — apply, approve/reject, conflict detection
- Preferred off-days — soft constraints; violations raise warnings, not hard blocks
- Replacement tracking — log who covered for whom, visible to Senior Resident
- Duty balancing — tracks actual vs minimum duties, supports carry-forward
- Overwork alerts — flags anyone with ≥4 duties in any 7-day window
- Real-time sync — everyone sees live data via Firestore listeners
- PIN-based auth — users only ever see and enter a short PIN; Firebase handles the rest
- CSV export — download any month's roster as a spreadsheet

---

## Tech

Pure HTML, CSS, and vanilla JavaScript — no build step, no framework, no bundler. Firebase v10 (compat SDK) for auth and database. Deployable anywhere that can serve static files.
