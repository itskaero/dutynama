/**
 * firebase-config.js
 *
 * HOW TO SET UP:
 * 1. Go to https://console.firebase.google.com
 * 2. Create a new project (free Spark plan)
 * 3. Add a Web App (</> icon)
 * 4. Copy the firebaseConfig object values below
 * 5. In Firebase Console → Build → Firestore Database → Create database
 *    Choose "Start in test mode" (allows all reads/writes while authenticated)
 * 6. In Firebase Console → Build → Authentication → Sign-in method
 *    Enable "Email/Password" provider
 *
 * FIRESTORE SECURITY RULES (paste in Firestore → Rules tab):
 *
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *
 *       // Public read of config/main so the app can detect first-run
 *       // (document missing = show setup) vs configured (document exists = show login).
 *       // config/main contains no sensitive data (only shift/unit settings).
 *       match /config/main {
 *         allow read: if true;
 *         allow write: if request.auth != null
 *                      && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'senior_pgr';
 *       }
 *
 *       // Pending invites — anyone can read (new users check their invite before creating
 *       // a Firebase Auth account); only authenticated users can create/revoke.
 *       match /pendingUsers/{docId} {
 *         allow read: if true;
 *         allow write: if request.auth != null;
 *       }
 *
 *       match /{document=**} {
 *         allow read, write: if request.auth != null;
 *       }
 *     }
 *   }
 */

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_AUTH_DOMAIN",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
