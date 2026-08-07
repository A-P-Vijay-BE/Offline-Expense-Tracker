# My Offline Expense Tracker

A beginner-friendly, personal, offline-first expense tracker.

## What this project does

- Saves every expense to IndexedDB on the device before attempting any network call.
- Works as an installable Progressive Web App (PWA).
- Synchronizes data to Cloud Firestore when the internet is available.
- Restores cloud history after signing in on a new phone.
- Supports expense and income messages such as:
  - `Lunch 150`
  - `Petrol 1200 UPI`
  - `Groceries 850 cash`
  - `Salary 50000`
  - `Dinner 450 card yesterday`
- Shows today, current-month, category and history summaries.
- Supports edit, soft delete, search, CSV export and JSON backup/restore.

## Important offline behavior

The app saves in this order:

1. Save the record to the device's IndexedDB database.
2. Immediately show it in the history and dashboard.
3. Attempt to upload it to Firestore.
4. If offline, keep it as `Pending`.
5. When internet returns or the app is opened again, retry synchronization.

This means internet is not needed to record an expense.

However, an expense entered while offline exists only on that device until it
successfully syncs. Do not clear browser data or uninstall the app before the
pending count becomes zero. Use **Backup JSON** for an additional manual backup.

## Prerequisites

Install these on your computer:

- Node.js LTS
- Visual Studio Code
- A free Google account
- Chrome or another modern browser

Check Node.js:

```bash
node -v
npm -v
```

## Part 1 — Create the Firebase project

1. Open Firebase Console.
2. Click **Create a project**.
3. Enter a name such as `my-personal-expenses`.
4. Google Analytics is optional; you can turn it off.
5. Create the project.
6. Keep the project on the **Spark** no-cost plan. Do not attach a billing account.

## Part 2 — Register the web application

1. Open the project overview.
2. Click the **Web** icon (`</>`).
3. App nickname: `My Expenses Web`.
4. You may select Firebase Hosting.
5. Click **Register app**.
6. Firebase displays a `firebaseConfig` object.
7. Open `src/firebase-config.js`.
8. Replace every `PASTE_...` value with the values shown by Firebase.

Example shape:

```js
export const firebaseConfig = {
  apiKey: "actual-value",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "actual-value",
  appId: "actual-value"
};
```

Do not add quotes around the entire object and do not remove commas.

## Part 3 — Enable email/password login

1. Firebase Console -> **Build** -> **Authentication**.
2. Click **Get started**.
3. Open **Sign-in method**.
4. Select **Email/Password**.
5. Enable Email/Password.
6. Save.

The app stores data below the signed-in user's unique Firebase UID, so one user
cannot read another user's data.

## Part 4 — Create Cloud Firestore

1. Firebase Console -> **Build** -> **Firestore Database**.
2. Click **Create database**.
3. Select the no-cost/default database.
4. Choose a region close to you.
5. Choose **Production mode**.
6. Complete database creation.
7. Open the **Rules** tab in Firestore.
8. Open the local `firestore.rules` file, copy all of its contents, paste them into the Firebase Rules editor, and click **Publish**.

Do not manually create a collection. The application creates it after the first
successful expense sync. The included rules allow each signed-in user to access
only the documents under that user's own UID.

## Part 5 — Install project dependencies

Open the project folder in VS Code.

Open **Terminal -> New Terminal** and run:

```bash
npm install
```

## Part 6 — Run locally

```bash
npm run dev
```

Vite displays a local address, usually:

```text
http://localhost:5173
```

Open it in Chrome.

The first local visit requires internet because Firebase authentication and the
initial application files need to load. After the PWA has cached its application
shell, it can reopen offline.

## Part 7 — Create your account and test

1. Enter your personal email.
2. Enter a password of at least six characters.
3. Click **Create account**.
4. Enter `Lunch 150`.
5. Click **Save**.
6. Confirm that the item appears immediately.
7. Firebase Console -> Firestore Database -> Data.
8. Confirm this structure appears:

```text
users
  <your-firebase-uid>
    expenses
      <expense-id>
```

## Part 8 — Test offline mode before deployment

1. Keep the app open in Chrome.
2. Open Chrome Developer Tools with `F12`.
3. Open the **Network** tab.
4. Change throttling from `No throttling` to `Offline`.
5. Enter `Tea 30 cash`.
6. The record should appear immediately with `Pending`.
7. Change Network back to `No throttling`.
8. Click **Sync now**.
9. Pending should become zero and the record should appear in Firestore.

Also test a full offline reload:

1. Open DevTools -> Application -> Service Workers.
2. Confirm the service worker is active.
3. Set Network to Offline.
4. Reload the page.
5. The application should still open.

## Part 9 — Install Firebase CLI

```bash
npm install -g firebase-tools
```

Check installation:

```bash
firebase --version
```

Sign in:

```bash
firebase login
```

## Part 10 — Connect the local project to Firebase

From the project root:

```bash
firebase init
```

Select:

- Firestore
- Hosting: Configure files for Firebase Hosting

Then answer:

- Use an existing project: select your Firebase project
- Firestore rules file: `firestore.rules`
- Firestore indexes file: accept the default
- Public directory: `dist`
- Configure as a single-page app: `Yes`
- Set up automatic GitHub deploys: `No`
- Overwrite `index.html`: `No`

If `firebase init` modifies `firebase.json`, confirm that the public directory
remains `dist`.

## Part 11 — Build and deploy

Build:

```bash
npm run build
```

Deploy Hosting and Firestore rules:

```bash
firebase deploy --only hosting,firestore:rules
```

At the end, Firebase prints a URL similar to:

```text
https://your-project-id.web.app
```

Open that URL on your phone while online.

## Part 12 — Install on Android

1. Open the Firebase URL in Chrome.
2. Open Chrome's three-dot menu.
3. Tap **Install app** or **Add to Home screen**.
4. Open it from the new home-screen icon.
5. Sign in.
6. Add one test expense.
7. Turn on airplane mode.
8. Reopen the installed app and add another expense.
9. Turn internet back on and check that pending becomes zero.

## Part 13 — Install on iPhone

1. Open the Firebase URL in Safari.
2. Tap the **Share** icon.
3. Tap **Add to Home Screen**.
4. Tap **Add**.
5. Open the installed icon.
6. Sign in once while online.
7. Test airplane mode.

Background synchronization is not equally supported by every browser. This
project does not depend only on the Background Sync API. It retries when:

- The app detects the browser's `online` event.
- The app starts.
- The user clicks **Sync now**.

## Part 14 — Daily usage

Use messages such as:

```text
Lunch 150
Petrol 1200 UPI
Groceries 850 cash
Electricity bill 2400
Salary 50000
Dinner 450 yesterday
Medicine 320 card
```

The first positive number is treated as the amount.

## Part 15 — Backup routine

Cloud Firestore is the cross-device copy. For additional safety:

1. Wait until **Pending sync** shows `0`.
2. Tap **Backup JSON** once a week or once a month.
3. Save the JSON file to Google Drive.
4. CSV is for viewing/reporting.
5. JSON is for restoring the application data.

## How the data safety works

### Layer 1: IndexedDB

Every new entry is written to IndexedDB before cloud sync. The screen reads from
this local database, so recording remains available without internet.

### Layer 2: Firestore offline cache

Firestore is configured with persistent multi-tab local caching. It can retain
cached cloud data and queue changes.

### Layer 3: Firestore cloud database

After sync, the same account can restore history on another device.

### Layer 4: JSON backup

A downloadable backup protects against accidental browser-storage clearing or
project mistakes.

## Free-tier expectation

For one personal user, typical usage is far below Firestore's free daily read and
write limits and Hosting's free allowance. Keep the Firebase project on Spark and
do not enable paid Cloud Functions, phone authentication, or billing.

## Updating the app later

After changing code:

```bash
npm run build
firebase deploy --only hosting
```

The service worker checks for an updated version. Reopen the app if it reports
that a new version is available.

## Common problems

### Firebase is not configured

Open `src/firebase-config.js` and replace all placeholder values.

### `auth/operation-not-allowed`

Enable Email/Password in Firebase Authentication.

### Permission denied in Firestore

Deploy the rules:

```bash
firebase deploy --only firestore:rules
```

### The app opens online but not offline

Open it online once after deployment and wait a few seconds so the service worker
can finish installing. Then test offline.

### A pending item does not sync

1. Confirm internet access.
2. Tap **Sync now**.
3. Sign out and sign in again if authentication expired.
4. Check Firebase Console -> Firestore.
5. Check the browser Console for errors.

### New phone does not show old data

Use exactly the same email/password account. Wait while online for Firestore to
download the history.

## Recommended next phase

After the core application is stable, add:

- Monthly budgets and alerts
- Recurring expenses
- WhatsApp chat text import
- Receipt image scanning
- Better natural-language date recognition
- PIN/biometric lock through a native wrapper
