const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.use(express.json());

// ── CORS — allow Netlify frontend ─────────────────────────────────────
app.use((req, res, next) => {
  const allowed = [
    'https://gimnode.netlify.app',
    'http://localhost:3000'
  ];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Serve all dashboard pages from public/ ────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Role → email mapping (edit here to add/remove users) ─────────────
const ROLE_EMAILS = {
  owner:  ['owner1@gmail.com'],
  member: ['member1@gmail.com'],
  zumba:  ['zumba1@gmail.com']
};

function getRole(email) {
  const lower = email.toLowerCase();
  for (const [role, emails] of Object.entries(ROLE_EMAILS)) {
    if (emails.includes(lower)) return role;
  }
  return null;
}

// ── POST /api/login ───────────────────────────────────────────────────
// Called by Netlify index.js with { email, password, role }
// Uses Firebase Auth REST API — no Firebase SDK needed on server
app.post('/api/login', async (req, res) => {
  const { email, password, role: selectedRole } = req.body;

  if (!email || !password || !selectedRole) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

  if (!FIREBASE_API_KEY) {
    return res.status(500).json({ error: 'Server not configured. Contact admin.' });
  }

  try {
    // Verify credentials via Firebase Auth REST API
    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password, returnSecureToken: true })
      }
    );

    const firebaseData = await firebaseRes.json();

    // Wrong email or password
    if (firebaseData.error) {
      const code = firebaseData.error.message;
      let msg = 'Invalid email or password.';
      if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
        msg = 'Too many failed attempts. Try again later.';
      }
      return res.status(401).json({ error: msg });
    }

    // Check role matches email
    const emailRole = getRole(email);
    if (emailRole !== null && emailRole !== selectedRole) {
      return res.status(403).json({
        error: `Invalid login for ${selectedRole} section.`
      });
    }

    // Success — return redirect URL
    const redirects = {
      owner:  '/gym_owner_panel.html',
      member: '/Members_Section.html',
      zumba:  '/Zumba_Members_Section.html'
    };

    res.json({
      success:     true,
      role:        selectedRole,
      redirectUrl: redirects[selectedRole] || '/'
    });

  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Ping — keeps Render warm ──────────────────────────────────────────
app.get('/ping', (req, res) => res.json({ status: 'ok' }));

// ── Root ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => {
  console.log(`✅ GYM Portal running at http://localhost:${PORT}`);
});
