# GYM Portal — Node.js Setup

## Project Structure

```
gym-portal/
├── server.js          ← Express backend (serves static files)
├── package.json       ← Node dependencies
├── README.md
└── public/
    ├── index.html              ← Login portal (HTML + CSS)
    ├── index.js                ← Firebase initialisation (ES module)
    ├── index_main.js           ← Login app logic (role selection, login, redirects)
    │
    ├── gym_owner_panel.html    ← Owner dashboard (sidebar + stats)
    ├── gym_owner_panel.js      ← Owner dashboard logic (Firebase live data)
    │
    │   ── Add your remaining pages here ──
    ├── Members_Section.html
    ├── Zumba_Members_Section.html
    ├── members.html
    ├── attendance.html
    ├── fees.html
    ├── supplement.html
    ├── equipment.html
    ├── suppliment_sales.html
    ├── staff.html
    ├── settings.html
    ├── reports.html
    ├── excel.html
    ├── diet_chart.html
    ├── exercise_chart.html
    ├── zumba_members.html
    ├── zumba_attendance.html
    ├── zumba_fees.html
    └── zumba_diet_chart.html
```

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Run the server
```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

### 3. Open in browser
```
http://localhost:3000
```

## Adding Your Other Pages

Copy `gym_owner_panel.html`, `Members_Section.html`, and `Zumba_Members_Section.html`
into the `public/` folder. The login portal will redirect to them automatically after login.

## Firebase Configuration

The Firebase project config is already embedded in `public/index.js`.
To change Firebase projects, update the `firebaseConfig` object in that file.

## Role → Email Mapping

Edit the `ROLE_EMAILS` object in `public/index_main.js` to add or remove
authorised emails for each role:

```js
const ROLE_EMAILS = {
    owner:  ['owner1@gmail.com'],
    member: ['member1@gmail.com'],
    zumba:  ['zumba1@gmail.com']
};
```

## Deployment

This app can be deployed to any Node.js host (Render, Railway, Vercel, etc.).
Set the `PORT` environment variable if needed — it defaults to `3000`.
