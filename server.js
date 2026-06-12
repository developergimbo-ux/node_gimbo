const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use((req, res, next) => {
  const allowed = ['https://gimnode.netlify.app', 'http://localhost:3000'];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const ROLE_EMAILS = {
  owner: ['owner1@gmail.com'],
  member: ['member1@gmail.com'],
  zumba: ['zumba1@gmail.com']
};

function getRole(email) {
  for (const [role, emails] of Object.entries(ROLE_EMAILS)) {
    if (emails.includes(email.toLowerCase())) return role;
  }
  return null;
}

app.post('/api/login', async (req, res) => {
  const { email, password, role: selectedRole } = req.body;
  if (!email || !password || !selectedRole) return res.status(400).json({ error: 'Missing fields' });
  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
  if (!FIREBASE_API_KEY) return res.status(500).json({ error: 'Server not configured.' });
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }) }
    );
    const d = await r.json();
    if (d.error) return res.status(401).json({ error: 'Invalid email or password.' });
    const emailRole = getRole(email);
    if (emailRole && emailRole !== selectedRole) return res.status(403).json({ error: 'Wrong section.' });
    const redirects = { owner: '/gym_owner_panel.html', member: '/Members_Section.html', zumba: '/Zumba_Members_Section.html' };
    res.json({ success: true, redirectUrl: redirects[selectedRole] || '/' });
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

app.get('/ping', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('OK'));
app.listen(PORT, () => console.log(`Running on ${PORT}`));
