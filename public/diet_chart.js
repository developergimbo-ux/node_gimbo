import { initializeApp }
  from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, collection, serverTimestamp, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const BASE = "https://backend-2gex.onrender.com";

const firebaseConfig = {
  apiKey: "AIzaSyBawDWPi-NvWl3bKyGVIFi-v9FX7yHraEI",
  authDomain: "gimbo-dc910.firebaseapp.com",
  projectId: "gimbo-dc910",
  storageBucket: "gimbo-dc910.firebasestorage.app",
  messagingSenderId: "294864961933",
  appId: "1:294864961933:web:61d6c4086c09a506bf3dc4",
  measurementId: "G-XSBFDNVXKD"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ─── STATE ─────────────────────────────────────────────────────────────────────
let planData       = null;
let currentPowerId = '';
let currentGymName = 'Gym';
let memberDocId    = '';
let memberPhone    = '';
let parentPhone    = '';

const mealIcons = {
  'Breakfast':           '☀️',
  'Lunch':               '🍛',
  'Dinner':              '🌙',
  'Mid Morning Snack':   '🥗',
  'Afternoon Snack':     '🥗',
};
const mealTimes = {
  'Breakfast':           '7:00 – 8:30 AM',
  'Lunch':               '12:30 – 1:30 PM',
  'Dinner':              '7:30 – 8:30 PM',
  'Mid Morning Snack':   '10:30 – 11:00 AM',
  'Afternoon Snack':     '4:00 – 5:00 PM',
};

// ─── LOAD GYM NAME ─────────────────────────────────────────────────────────────
async function loadGymName() {
  try {
    const snap = await getDoc(doc(db, 'gym_settings', 'config'));
    if (snap.exists()) {
      currentGymName = snap.data().gymName || 'Gym';
      document.getElementById('pageTitle').textContent = currentGymName + ' — Diet Plan Generator';
      document.title = currentGymName + ' — Diet Plan Generator';
    }
  } catch (e) { console.error('Could not load gym name:', e); }
}
loadGymName();

// ─── WARM UP BACKEND ──────────────────────────────────────────────────────────
let backendWarmedUp = false;
function warmUpBackend() {
  if (backendWarmedUp) return;
  backendWarmedUp = true;
fetch(`${BASE}/ping`, { method: 'GET', signal: AbortSignal.timeout(30000) }).catch(() => {});
}
warmUpBackend();
['age','gender','height','weight','goal','diet','activity','allergies','supplements'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('focus', warmUpBackend, { once: true });
});

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = '⚠ ' + msg;
  box.classList.add('visible');
  setTimeout(() => box.classList.remove('visible'), 5000);
}
function showMemberBadge(text) {
  document.getElementById('memberBadgeText').textContent = text;
  document.getElementById('memberBadge').classList.add('visible');
}
function hideMemberBadge() {
  document.getElementById('memberBadge').classList.remove('visible');
}
function getSupplementTiming(supp) {
  const s = supp.toLowerCase();
  if (s.includes('whey') || s.includes('protein'))           return "Post-workout or with breakfast (1 scoop ≈ 25–30g)";
  if (s.includes('creatine'))                                return "Post-workout with water (5g daily)";
  if (s.includes('bcaa'))                                    return "During or after workout (5–10g)";
  if (s.includes('multivitamin') || s.includes('vitamin'))   return "With breakfast (as per dosage)";
  if (s.includes('omega') || s.includes('fish oil'))         return "With meals (1–2 capsules)";
  if (s.includes('glutamine'))                               return "Post-workout or before bed (5g)";
  if (s.includes('pre-workout') || s.includes('preworkout')) return "30 mins before workout";
  if (s.includes('casein'))                                  return "Before bed (1 scoop ≈ 30g)";
  return "As directed — consult trainer/physician";
}

function showSyncToast(msg) {
  let toast = document.getElementById('syncToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'syncToast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e3a5f;border:1px solid #2563eb;color:#60a5fa;font-size:13px;padding:9px 16px;border-radius:10px;z-index:9999;transition:opacity 0.3s;font-family:Inter,sans-serif;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}

// ─── INJECT POPUP STYLES ──────────────────────────────────────────────────────
function injectPopupStyles() {
  if (document.getElementById('wa-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'wa-popup-styles';
  style.textContent = `
    #waPdfOverlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.82);
      backdrop-filter: blur(8px);
      z-index: 99999;
      align-items: center;
      justify-content: center;
    }
    #waPdfOverlay.show { display: flex; }

    #waPdfModal {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 0;
      max-width: 420px;
      width: 94%;
      box-shadow: 0 40px 80px rgba(0,0,0,0.8);
      animation: waPop 0.25s cubic-bezier(.34,1.56,.64,1);
      overflow: hidden;
    }
    @keyframes waPop {
      from { transform: scale(0.85) translateY(20px); opacity: 0; }
      to   { transform: scale(1)    translateY(0);    opacity: 1; }
    }

    /* ── Header ── */
    #waPdfModal .wa-header {
      background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
      padding: 22px 22px 18px;
      display: flex;
      align-items: center;
      gap: 14px;
      border-bottom: 1px solid #134e4a;
    }
    #waPdfModal .wa-header-icon {
      width: 48px; height: 48px; min-width: 48px;
      background: rgba(255,255,255,0.12);
      border-radius: 14px;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px;
    }
    #waPdfModal .wa-header-text h3 {
      color: #fff; font-size: 15px; font-weight: 700; margin: 0 0 3px;
      font-family: Inter, sans-serif;
    }
    #waPdfModal .wa-header-text p {
      color: #6ee7b7; font-size: 12px; margin: 0;
      font-family: Inter, sans-serif;
    }

    /* ── Download badge ── */
    #waPdfModal .wa-download-badge {
      margin: 16px 20px 0;
      background: #1e293b;
      border: 1px solid #134e4a;
      border-radius: 10px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #waPdfModal .wa-download-badge .badge-icon {
      font-size: 20px;
    }
    #waPdfModal .wa-download-badge .badge-text {
      flex: 1;
    }
    #waPdfModal .wa-download-badge .badge-text strong {
      display: block;
      color: #f1f5f9;
      font-size: 12.5px;
      font-family: Inter, sans-serif;
    }
    #waPdfModal .wa-download-badge .badge-text span {
      color: #64748b;
      font-size: 11px;
      font-family: monospace;
    }
    #waPdfModal .wa-download-badge .badge-status {
      background: #14532d;
      color: #4ade80;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 20px;
      font-family: Inter, sans-serif;
    }

    /* ── Steps ── */
    #waPdfModal .wa-steps-label {
      color: #475569;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-family: Inter, sans-serif;
      padding: 16px 20px 8px;
    }
    #waPdfModal .wa-steps {
      padding: 0 20px 4px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #waPdfModal .wa-step {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 10px 12px;
    }
    #waPdfModal .wa-step-num {
      min-width: 22px; height: 22px;
      background: #25d366;
      color: #000;
      border-radius: 50%;
      font-size: 10px;
      font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
      font-family: Inter, sans-serif;
    }
    #waPdfModal .wa-step-content {
      flex: 1;
    }
    #waPdfModal .wa-step-content strong {
      display: block;
      color: #e2e8f0;
      font-size: 12.5px;
      font-weight: 600;
      margin-bottom: 2px;
      font-family: Inter, sans-serif;
    }
    #waPdfModal .wa-step-content span {
      color: #64748b;
      font-size: 11.5px;
      line-height: 1.4;
      font-family: Inter, sans-serif;
    }
    #waPdfModal .wa-step-content .wa-chip {
      display: inline-block;
      background: #1e293b;
      color: #93c5fd;
      font-size: 10.5px;
      padding: 1px 7px;
      border-radius: 4px;
      font-family: monospace;
      margin-top: 3px;
    }

    /* ── Platform note ── */
    #waPdfModal .wa-platform-note {
      margin: 12px 20px 0;
      background: #1e1a2e;
      border: 1px solid #312e81;
      border-radius: 8px;
      padding: 8px 12px;
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    #waPdfModal .wa-platform-note span {
      font-size: 12px; color: #a5b4fc;
      font-family: Inter, sans-serif;
      line-height: 1.5;
    }

    /* ── Buttons ── */
    #waPdfModal .wa-btn-row {
      display: flex;
      gap: 10px;
      padding: 16px 20px 20px;
    }
    #waPdfModal .wa-btn-open {
      flex: 1;
      background: #25d366;
      color: #000;
      border: none;
      border-radius: 12px;
      padding: 13px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.18s, transform 0.1s;
      font-family: Inter, sans-serif;
    }
    #waPdfModal .wa-btn-open:hover  { background: #1db954; }
    #waPdfModal .wa-btn-open:active { transform: scale(0.97); }
    #waPdfModal .wa-btn-cancel {
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 13px 18px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.18s;
      font-family: Inter, sans-serif;
    }
    #waPdfModal .wa-btn-cancel:hover { background: #334155; color: #e2e8f0; }

    /* ── Mobile share success ── */
    #waPdfModal.mobile-shared .wa-steps,
    #waPdfModal.mobile-shared .wa-steps-label,
    #waPdfModal.mobile-shared .wa-platform-note { display: none; }
  `;
  document.head.appendChild(style);
}

// ─── BEAUTIFUL WHATSAPP POPUP ──────────────────────────────────────────────────
function showWaPdfPopup(waUrl, memberName, fileName, isMobileShare) {
  injectPopupStyles();
  const old = document.getElementById('waPdfOverlay');
  if (old) old.remove();

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const platformNote = isMobile
    ? '💡 On mobile: tap the attachment icon → <strong>Document</strong> → select the downloaded PDF from your Downloads folder.'
    : '💡 On desktop: click the 📎 clip icon in WhatsApp Web → <strong>Document</strong> → select the downloaded PDF from your Downloads folder.';

  const overlay = document.createElement('div');
  overlay.id = 'waPdfOverlay';
  overlay.className = 'show';
  overlay.innerHTML = `
    <div id="waPdfModal">
      <div class="wa-header">
        <div class="wa-header-icon">📤</div>
        <div class="wa-header-text">
          <h3>Send Diet Plan via WhatsApp</h3>
          <p>PDF saved • Follow 3 quick steps below</p>
        </div>
      </div>

      <div class="wa-download-badge">
        <div class="badge-icon">📄</div>
        <div class="badge-text">
          <strong>Diet Plan PDF</strong>
          <span>${fileName}</span>
        </div>
        <div class="badge-status">✓ SAVED</div>
      </div>

      <div class="wa-steps-label">How to send</div>
      <div class="wa-steps">
        <div class="wa-step">
          <div class="wa-step-num">1</div>
          <div class="wa-step-content">
            <strong>Open WhatsApp</strong>
            <span>Click the button below — member's chat opens automatically${waUrl.includes('wa.me/') ? '' : ' (or paste the number manually)'}.</span>
          </div>
        </div>
        <div class="wa-step">
          <div class="wa-step-num">2</div>
          <div class="wa-step-content">
            <strong>Tap the 📎 attachment icon</strong>
            <span>Found in the chat input bar, bottom of screen.</span>
          </div>
        </div>
        <div class="wa-step">
          <div class="wa-step-num">3</div>
          <div class="wa-step-content">
            <strong>Choose Document → Select the PDF</strong>
            <span>Find it in your Downloads folder:</span>
            <div class="wa-chip">${fileName}</div>
          </div>
        </div>
      </div>

      <div class="wa-platform-note">
        <span>ℹ️ &nbsp;</span>
        <span>${platformNote}</span>
      </div>

      <div class="wa-btn-row">
        <button class="wa-btn-open" id="waOpenBtn">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.532 5.862L.057 23.737a.75.75 0 00.914.914l5.875-1.475A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.896 0-3.67-.523-5.188-1.43l-.372-.22-3.854.968.987-3.608-.242-.374A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
          </svg>
          Open WhatsApp
        </button>
        <button class="wa-btn-cancel" id="waCancelBtn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('waOpenBtn').onclick = () => {
    window.open(waUrl, '_blank');
    overlay.remove();
  };
  document.getElementById('waCancelBtn').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ─── FIELD → DB SYNC ──────────────────────────────────────────────────────────
function attachFieldSyncListeners() {
  const syncMap = {
    age:       'personalData.age',
    gender:    'gender',
    height:    'personalData.height',
    weight:    'personalData.weight',
    goal:      'personalData.fitnessGoal',
    diet:      'personalData.dietPreference',
    allergies: 'personalData.allergies',
    activity:  'personalData.activityLevel',
  };
  Object.entries(syncMap).forEach(([fieldId, dbPath]) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.removeEventListener('change', el._syncHandler);
    el._syncHandler = async () => {
      if (!memberDocId) return;
      const val = el.value.trim();
      if (val === '' && fieldId !== 'allergies') return;
      try {
        const ref = doc(db, 'members', memberDocId);
        const update = {};
        if (fieldId === 'age' || fieldId === 'height' || fieldId === 'weight') {
          update[dbPath] = parseFloat(val);
        } else {
          update[dbPath] = val;
        }
        await updateDoc(ref, update);
        showSyncToast(`${fieldId.charAt(0).toUpperCase() + fieldId.slice(1)} updated ✓`);
      } catch (e) { console.error('DB sync error:', e); }
    };
    el.addEventListener('change', el._syncHandler);
  });
}

function useParentPhone() {
  if (parentPhone) document.getElementById('phone').value = parentPhone;
}
function useMemberPhone() {
  document.getElementById('phone').value = memberPhone;
}
window.useParentPhone = useParentPhone;
window.useMemberPhone = useMemberPhone;

// ─── FETCH MEMBER ─────────────────────────────────────────────────────────────
async function fetchMemberById() {
  const powerId = document.getElementById('powerId').value.trim();
  if (!powerId) { showError('Please enter a Power ID.'); return; }

  const btn = document.getElementById('fetchBtn');
  btn.classList.add('loading');
  btn.disabled = true;
  hideMemberBadge();

  try {
    const membersRef = collection(db, 'members');
    const q          = query(membersRef, where('powerId', '==', powerId));
    const snap       = await getDocs(q);

    if (snap.empty) {
      showError('No member found with Power ID: "' + powerId + '"');
    } else {
      const docSnap = snap.docs[0];
      const data    = docSnap.data();
      currentPowerId = powerId;
      memberDocId    = docSnap.id;

      const nameEl = document.getElementById('name');
      nameEl.value    = data.name || '';
      nameEl.readOnly = true;

      memberPhone = data.phone || data.phoneNumber || '';
      parentPhone = data.parentPhone || data.guardianPhone || data.emergencyPhone || '';
      document.getElementById('phone').value = memberPhone;
      document.getElementById('phoneLabelHint').textContent = '(editable for WhatsApp only — DB not affected)';

      const parentRow = document.getElementById('parentPhoneRow');
      if (parentPhone) {
        document.getElementById('parentPhoneDisplay').textContent = parentPhone;
        parentRow.style.display = 'block';
      } else {
        parentRow.style.display = 'none';
      }

      const pd = data.personalData || {};
      const age = pd.age ?? data.age;
      if (age !== undefined && age !== '') document.getElementById('age').value = age;

      const gender = data.gender || pd.gender;
      if (gender) document.getElementById('gender').value = gender;

      const height = pd.height || pd.heightCm || data.height || data.heightCm;
      if (height) document.getElementById('height').value = height;

      const weight = pd.weight || pd.weightKg || data.weight || data.weightKg;
      if (weight) document.getElementById('weight').value = weight;

      const goal = pd.fitness_aim || pd.fitnessGoal || pd.goal || data.fitness_aim || data.fitnessGoal || data.goal;
      if (goal) document.getElementById('goal').value = goal;

      const diet = pd.dietPreference || pd.diet || data.dietPreference || data.diet;
      if (diet) document.getElementById('diet').value = diet;

      const activity = pd.activityLevel || pd.activity || data.activityLevel || data.activity || 'very_active';
      document.getElementById('activity').value = activity;

      const allergies = pd.allergies ?? data.allergies;
      if (allergies !== undefined) document.getElementById('allergies').value = allergies;

      const supplements = pd.supplements || data.supplements;
      if (supplements) document.getElementById('supplements').value = supplements;

      attachFieldSyncListeners();
      showMemberBadge('✓ Member loaded — ' + (data.name || powerId) + ' (ID: ' + powerId + ')');
    }
  } catch (err) {
    showError('Firebase error: ' + err.message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ─── GENERATE PLAN ────────────────────────────────────────────────────────────
async function generatePlan() {
  const name       = document.getElementById('name').value.trim();
  const age        = parseInt(document.getElementById('age').value);
  const gender     = document.getElementById('gender').value;
  const height     = parseFloat(document.getElementById('height').value);
  const weight     = parseFloat(document.getElementById('weight').value);
  const goal       = document.getElementById('goal').value;
  const diet       = document.getElementById('diet').value;
  const activity   = document.getElementById('activity').value;
  const allergyRaw = document.getElementById('allergies').value.trim();
  const supps      = document.getElementById('supplements').value.trim();
  const phone      = document.getElementById('phone').value.trim();

  if (!name)                                   return showError('Member name is missing. Please fetch a member first.');
  if (!age || age < 10 || age > 100)           return showError('Enter a valid age (10–100).');
  if (!gender)                                 return showError('Please select gender.');
  if (!height || height < 100 || height > 250) return showError('Enter a valid height (100–250 cm).');
  if (!weight || weight < 30  || weight > 300) return showError('Enter a valid weight (30–300 kg).');
  if (!goal)                                   return showError('Please select a fitness goal.');
  if (!diet)                                   return showError('Please select diet preference.');
  if (!activity)                               return showError('Please select activity level.');

  const allergies = allergyRaw ? allergyRaw.split(',').map(a => a.trim().toLowerCase()).filter(Boolean) : [];

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="ai-spinner" style="border-top-color:white;width:14px;height:14px;"></div> Generating…';

  const slowTimer     = setTimeout(() => { if (btn.disabled) btn.innerHTML = '<div class="ai-spinner" style="border-top-color:white;width:14px;height:14px;"></div> Waking up server…'; }, 4000);
  const verySlowTimer = setTimeout(() => { if (btn.disabled) btn.innerHTML = '<div class="ai-spinner" style="border-top-color:white;width:14px;height:14px;"></div> Almost ready…'; }, 15000);

  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 90000);

    const res = await fetch(`${BASE}/meal-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ age, height_cm: height, weight_kg: weight, gender: gender === 'other' ? 'male' : gender, goal, activity, diet_type: diet, meals_per_day: 4, allergies })
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.detail || `Server error ${res.status}`);
    }

    const data = await res.json();
    const s    = data.stats;

    const bmiColors = { Underweight: '#2dd4bf', Normal: '#4ade80', Overweight: '#facc15', Obese: '#fb923c' };
    document.getElementById('bmiVal').textContent = s.bmi;
    document.getElementById('catVal').textContent = s.bmi_category;
    document.getElementById('catVal').style.color = bmiColors[s.bmi_category] || '#facc15';
    document.getElementById('catSub').textContent = `BMI: ${s.bmi}`;
    document.getElementById('calVal').textContent = s.target_calories;
    const goalLabels = { fat_loss: 'Fat Loss', muscle_gain: 'Muscle Gain', maintenance: 'Maintenance' };
    const goalSubs   = { fat_loss: 'Caloric deficit', muscle_gain: 'Caloric surplus', maintenance: 'Balanced intake' };
    document.getElementById('goalVal').textContent = goalLabels[goal] || goal;
    document.getElementById('goalSub').textContent = goalSubs[goal]   || '';

    const grid = document.getElementById('mealsGrid');
    grid.innerHTML = '';
    let totalActual = 0;

    for (const meal of data.meals) {
      totalActual += meal.actual_calories;
      const icon = mealIcons[meal.meal_name] || '🍽️';
      const time = mealTimes[meal.meal_name] || '';
      const card = document.createElement('div');
      card.className = 'meal-card';
      card.innerHTML = `
        <div class="meal-header">
          <div class="meal-title">${icon} ${meal.meal_name}</div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            <span class="meal-kcal">~${meal.actual_calories} kcal</span>
            <span class="meal-time">${time}</span>
          </div>
        </div>
        <div class="meal-body">
          ${meal.foods.map(f => `
            <div class="food-item">
              <div class="food-dot"></div>
              <div>
                <div class="food-name">${f.name}</div>
                <div class="food-measure">${f.quantity}</div>
              </div>
              <div class="food-kcal">~${f.calories} kcal</div>
            </div>`).join('')}
        </div>`;
      grid.appendChild(card);
    }

    document.getElementById('totalKcal').innerHTML   = `${totalActual} <span>kcal</span>`;
    document.getElementById('totalNote').textContent = `Target: ${s.target_calories} kcal | ${name}, ${age}yr, ${weight}kg`;

    const suppList   = supps ? supps.split(',').map(s => s.trim()).filter(Boolean) : [];
    const suppSec    = document.getElementById('suppSection');
    const suppListEl = document.getElementById('suppList');
    if (suppList.length > 0) {
      suppListEl.innerHTML = suppList.map(s => `<div class="supp-item">→ <span>${s}</span> — ${getSupplementTiming(s)}</div>`).join('');
      suppSec.style.display = 'block';
    } else {
      suppSec.style.display = 'none';
    }

    planData = { memberName: name, phone, goal, diet, activity, allergies: allergyRaw, supplements: supps, powerId: currentPowerId, stats: s, meals: data.meals, daily_totals: data.daily_totals, suppList };

    const output = document.getElementById('output');
    output.classList.add('visible');
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    if (err.name === 'AbortError') {
      showError('Request timed out. The server may be sleeping — please try again in a moment.');
    } else {
      showError(err.message);
    }
  } finally {
    clearTimeout(slowTimer);
    clearTimeout(verySlowTimer);
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Generate Diet Plan`;
  }
}

// ─── PDF GENERATOR ─────────────────────────────────────────────────────────────
function generateDietPDF() {
  if (!planData) return null;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const p = planData;
  const dietLabel = { veg: 'Vegetarian', nonveg: 'Non-Vegetarian', eggetarian: 'Eggetarian' }[p.diet] || p.diet;
  const goalLabel = { fat_loss: 'Fat Loss', muscle_gain: 'Muscle Gain', maintenance: 'Maintenance' }[p.goal] || p.goal;
  const actLabel  = { sedentary: 'Low (Sedentary)', moderate: 'Moderate', very_active: 'High (6-7 days/wk)' }[p.activity] || p.activity;
  const W = 210, margin = 14;
  let y = 0;

  doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, 38, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(255,255,255);
  doc.text(currentGymName, margin, 15);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(148,163,184);
  doc.text('PERSONALISED DIET PLAN REPORT', margin, 22);
  const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  doc.setFontSize(8); doc.setTextColor(203,213,225);
  doc.text(`Date: ${today}`, W - margin, 15, { align: 'right' });
  if (p.powerId) doc.text(`Power ID: ${p.powerId}`, W - margin, 21, { align: 'right' });
  doc.setDrawColor(59,130,246); doc.setLineWidth(1); doc.line(0, 38, W, 38);
  y = 48;

  doc.setFillColor(23,23,27); doc.roundedRect(margin, y, W - margin*2, 22, 3, 3, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  doc.text(p.memberName, margin+5, y+8);
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(156,163,175);
  doc.text(`Goal: ${goalLabel}   |   Diet: ${dietLabel}   |   Activity: ${actLabel}${p.allergies ? '   |   Avoid: '+p.allergies : ''}`, margin+5, y+15);
  y += 30;

  const stats = [
    { label:'BMI Score',      value:String(p.stats.bmi),             sub:p.stats.bmi_category, color:[45,212,191] },
    { label:'Daily Calories', value:String(p.stats.target_calories),  sub:'kcal / day target',  color:[251,146,60] },
    { label:'Goal Plan',      value:goalLabel,                        sub:'Fitness objective',   color:[167,139,250] },
    { label:'Diet Type',      value:dietLabel,                        sub:'Food preference',     color:[74,222,128] },
  ];
  const sW = (W - margin*2 - 9) / 4;
  stats.forEach((s, i) => {
    const sx = margin + i*(sW+3);
    doc.setFillColor(23,23,27); doc.roundedRect(sx, y, sW, 22, 3, 3, 'F');
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(107,114,128);
    doc.text(s.label.toUpperCase(), sx+4, y+6);
    doc.setFontSize(s.value.length > 10 ? 8 : 11); doc.setFont('helvetica','bold'); doc.setTextColor(...s.color);
    doc.text(s.value, sx+4, y+14);
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(107,114,128);
    doc.text(s.sub, sx+4, y+19);
  });
  y += 30;

  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(229,231,235);
  doc.text('MEAL PLAN', margin, y); y += 5;
  const colW = (W - margin*2 - 4) / 2;

  for (let i = 0; i < p.meals.length; i += 2) {
    const rowMeals = p.meals.slice(i, i+2);
    let maxH = 0;
    rowMeals.forEach(meal => { const h = 14 + meal.foods.length*8 + 4; if (h > maxH) maxH = h; });
    if (y + maxH > 272) { doc.addPage(); y = 14; }
    rowMeals.forEach((meal, j) => {
      const mx = margin + j*(colW+4);
      const time = mealTimes[meal.meal_name] || '';
      doc.setFillColor(21,21,21); doc.setDrawColor(42,42,42); doc.setLineWidth(0.3);
      doc.roundedRect(mx, y, colW, maxH, 3, 3, 'FD');
      doc.setFillColor(30,41,59); doc.roundedRect(mx, y, colW, 12, 3, 3, 'F');
      doc.rect(mx, y+6, colW, 6, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(255,255,255);
      doc.text(meal.meal_name, mx+4, y+8);
      doc.setFontSize(7.5); doc.setTextColor(74,222,128);
      doc.text(`~${meal.actual_calories} kcal`, mx+colW-4, y+8, { align:'right' });
      if (time) { doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(107,114,128); doc.text(time, mx+colW-4, y+14, { align:'right' }); }
      let fy = y + 18;
      meal.foods.forEach(f => {
        doc.setFillColor(59,130,246); doc.circle(mx+5, fy-1, 1, 'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(229,231,235);
        const fname = f.name.length > 28 ? f.name.substring(0,27)+'…' : f.name;
        doc.text(fname, mx+8, fy);
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(107,114,128);
        doc.text(`~${f.calories} kcal`, mx+colW-4, fy, { align:'right' });
        fy += 4; doc.setFontSize(6.5); doc.text(f.quantity, mx+8, fy); fy += 5;
      });
    });
    y += maxH + 4;
  }

  if (p.suppList && p.suppList.length > 0) {
    if (y + 10 + p.suppList.length*8 > 272) { doc.addPage(); y = 14; }
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(251,146,60);
    doc.text('SUPPLEMENT PROTOCOL', margin, y); y += 5;
    p.suppList.forEach(s => {
      if (y > 272) { doc.addPage(); y = 14; }
      doc.setFillColor(23,23,27); doc.roundedRect(margin, y, W-margin*2, 9, 2, 2, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(255,255,255);
      doc.text(s, margin+4, y+6);
      doc.setFont('helvetica','normal'); doc.setTextColor(156,163,175);
      doc.text(getSupplementTiming(s), W-margin-4, y+6, { align:'right' });
      y += 12;
    });
  }

  if (y + 18 > 272) { doc.addPage(); y = 14; }
  y += 4;
  doc.setFillColor(15,30,60); doc.setDrawColor(59,130,246); doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, W-margin*2, 18, 3, 3, 'FD');
  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(255,255,255);
  doc.text('TOTAL DAILY INTAKE', margin+5, y+7);
  doc.setFontSize(11); doc.setTextColor(59,130,246);
  doc.text(`${p.daily_totals.calories} kcal`, margin+5, y+14);
  doc.setFontSize(8.5); doc.setTextColor(156,163,175);
  doc.text(`Protein: ${p.daily_totals.protein_g}g   |   Carbs: ${p.daily_totals.carbs_g}g   |   Fat: ${p.daily_totals.fat_g}g`, W-margin-5, y+10, { align:'right' });
  y += 26;

  doc.setDrawColor(42,42,42); doc.setLineWidth(0.3); doc.line(margin, y, W-margin, y); y += 5;
  doc.setFont('helvetica','italic'); doc.setFontSize(7.5); doc.setTextColor(107,114,128);
  doc.text('Consult your trainer or physician before making any dietary changes.', margin, y);
  doc.text(`Generated by ${currentGymName}`, W-margin, y, { align:'right' });

  return doc;
}

function downloadPDF() {
  if (!planData) return;
  const doc = generateDietPDF();
  if (doc) doc.save(`Diet_Plan_${planData.memberName.replace(/\s+/g,'_')}.pdf`);
}

// ─── WHATSAPP SEND (SMART — ALL PLATFORMS) ────────────────────────────────────
//
//  TECHNICAL REALITY:
//  WhatsApp does NOT allow any website/app to programmatically attach files.
//  The wa.me and web.whatsapp.com APIs only support pre-filled text.
//  The Web Share API on mobile lets the OS share-sheet handle the file —
//  the user picks WhatsApp from the sheet and WhatsApp receives the PDF.
//  On desktop there is NO automatic attachment — the best UX is:
//    1. Auto-download the PDF
//    2. Auto-open the member's WhatsApp chat with a pre-filled message
//    3. Show a clear guide overlay to attach the downloaded file
//
// ─────────────────────────────────────────────────────────────────────────────

async function sendWhatsApp() {
  if (!planData) return;
  const p = planData;

  const fileName  = `Diet_Plan_${p.memberName.replace(/\s+/g,'_')}.pdf`;
  const goalLabel = { fat_loss: 'Fat Loss', muscle_gain: 'Muscle Gain', maintenance: 'Maintenance' }[p.goal] || p.goal;
  const dietLabel = { veg: 'Vegetarian', nonveg: 'Non-Vegetarian', eggetarian: 'Eggetarian' }[p.diet] || p.diet;

  const waText =
    `🏋️ *${currentGymName}*\n` +
    (p.powerId ? `🪪 *Power ID:* ${p.powerId}\n` : '') +
    `👤 *Name:* ${p.memberName}\n` +
    `🎯 *Goal:* ${goalLabel}   |   🥗 *Diet:* ${dietLabel}\n` +
    `🔥 *Daily Target:* ~${p.stats.target_calories} kcal\n` +
    `📊 *BMI:* ${p.stats.bmi} (${p.stats.bmi_category})\n\n` +
    `📎 _Diet Plan PDF is attached below. Follow your trainer's guidance._\n` +
    `_— ${currentGymName}_`;

  const phone   = p.phone ? p.phone.replace(/\D/g, '') : '';
  const encoded = encodeURIComponent(waText);
  const waUrl   = phone
    ? `https://wa.me/91${phone}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // ── MOBILE PATH: try Web Share API first ──────────────────────────────────
  if (isMobile && navigator.share) {
    // Quick capability probe with a dummy file
    const probe = new File([new Blob([''])], fileName, { type: 'application/pdf' });
    const canShareFiles = navigator.canShare && navigator.canShare({ files: [probe] });

    if (canShareFiles) {
      try {
        // Generate PDF
        const pdfDoc  = generateDietPDF();
        const pdfBlob = pdfDoc.output('blob');
        const file    = new File([pdfBlob], fileName, { type: 'application/pdf' });

        await navigator.share({
          title: `${p.memberName} — Diet Plan`,
          text:  waText,
          files: [file],
        });
        // User completed (or dismissed) share sheet — nothing more to do
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user cancelled intentionally
        // fall through to manual flow below
      }
    }

    // Mobile but Web Share file-share not supported
    // → open WhatsApp app directly via deep link (works on Android/iOS)
    generateDietPDF().save(fileName);
    // Small delay so download starts before the app switch
    setTimeout(() => {
      window.location.href = waUrl;   // deep-links to WhatsApp app on mobile
    }, 600);
    showSyncToast('📲 Opening WhatsApp app…');
    return;
  }

  // ── DESKTOP PATH ─────────────────────────────────────────────────────────
  // Step 1: open WhatsApp Web tab SYNCHRONOUSLY (before any async/await)
  //         so the browser popup blocker does not kill it
  const waWindow = window.open(waUrl, '_blank');

  // Step 2: generate & download PDF
  generateDietPDF().save(fileName);

  // Step 3: show the beautiful guide overlay
  showWaPdfPopup(waUrl, p.memberName, fileName, false);

  // If popup was blocked, the overlay still shows so user can click "Open WhatsApp" manually
  if (!waWindow || waWindow.closed || typeof waWindow.closed === 'undefined') {
    showSyncToast('⚠️ Popup blocked — click "Open WhatsApp" in the guide below');
  } else {
    showSyncToast('📥 PDF downloaded — attach it in WhatsApp Web');
  }
}

// ─── RESET ─────────────────────────────────────────────────────────────────────
function resetForm() {
  ['powerId','age','gender','height','weight','goal','diet','activity','allergies','supplements']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('name').value  = '';
  document.getElementById('phone').value = '';
  document.getElementById('parentPhoneRow').style.display = 'none';
  document.getElementById('phoneLabelHint').textContent = '';
  document.getElementById('output').classList.remove('visible');
  document.getElementById('errorBox').classList.remove('visible');
  hideMemberBadge();
  planData = null; currentPowerId = ''; memberDocId = ''; memberPhone = ''; parentPhone = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── EXPOSE ────────────────────────────────────────────────────────────────────
window.fetchMemberById = fetchMemberById;
window.generatePlan    = generatePlan;
window.sendWhatsApp    = sendWhatsApp;
window.resetForm       = resetForm;
window.downloadPDF     = downloadPDF;