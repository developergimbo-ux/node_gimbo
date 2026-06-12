import { initializeApp }
  from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBawDWPi-NvWl3bKyGVIFi-v9FX7yHraEI",
  authDomain: "gimbo-dc910.firebaseapp.com",
  projectId: "gimbo-dc910",
  storageBucket: "gimbo-dc910.firebasestorage.app",
  messagingSenderId: "294864961933",
  appId: "1:294864961933:web:61d6c4086c09a506bf3dc4",
  measurementId: "G-XSBFDNVXKD"
};
const API_BASE = "https://backend02-4.onrender.com";

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ─── STATE ─────────────────────────────────────────────────────────────────────
let planData         = null;
let currentGymName   = 'Gym';
let memberDocId      = '';
let memberPhone      = '';
let parentPhone      = '';
let currentPowerId   = '';
let memberFitnessAim = ''; // raw fitness_aim from Firestore

// ─── LOAD GYM NAME ─────────────────────────────────────────────────────────────
async function loadGymName() {
  try {
    const snap = await getDoc(doc(db, 'gym_settings', 'config'));
    if (snap.exists()) {
      currentGymName = snap.data().gymName || 'Gym';
      document.getElementById('pageTitle').textContent = currentGymName + ' — Exercise Plan Generator';
      document.title = currentGymName + ' — Exercise Plan Generator';
    }
  } catch (e) { console.error('Gym name load error:', e); }
}
loadGymName();

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

// ─── GOAL BADGE ────────────────────────────────────────────────────────────────
const goalLabels = {
  muscle_gain: 'Muscle Gain',
  fat_loss:    'Fat Loss',
  maintenance: 'Maintenance',
  strength:    'Strength',
  endurance:   'Endurance'
};
document.getElementById('goal').addEventListener('change', function () {
  const val = this.value;
  const el  = document.getElementById('goalBadgeEl');
  if (val && goalLabels[val]) {
    el.innerHTML = `<span class="goal-badge ${val}">${goalLabels[val]}</span>`;
  } else {
    el.innerHTML = '';
  }
});

// ─── PARENT PHONE HELPERS ──────────────────────────────────────────────────────
function useParentPhone() {
  if (parentPhone) document.getElementById('phone').value = parentPhone;
}
function useMemberPhone() {
  document.getElementById('phone').value = memberPhone;
}
window.useParentPhone = useParentPhone;
window.useMemberPhone = useMemberPhone;

// ─── FIELD SYNC TO FIRESTORE ───────────────────────────────────────────────────
function attachFieldSyncListeners() {
  const syncMap = {
    age:        'personalData.age',
    gender:     'gender',
    height:     'personalData.height',
    weight:     'personalData.weight',
    goal:       'personalData.fitness_aim',
    experience: 'personalData.experienceLevel',
    injuries:   'personalData.injuries',
    split:      'personalData.preferredSplit',
    gymHours:   'personalData.sessionDurationHrs',
    gymDays:    'personalData.gymFrequencyDays',
  };
  Object.entries(syncMap).forEach(([fieldId, dbPath]) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.removeEventListener('change', el._syncHandler);
    el._syncHandler = async () => {
      if (!memberDocId) return;
      const val = el.value.trim();
      if (val === '' && !['injuries','split','gymHours','gymDays'].includes(fieldId)) return;
      try {
        const ref    = doc(db, 'members', memberDocId);
        const update = {};
        if (['age','height','weight'].includes(fieldId)) {
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

// ─── FETCH MEMBER ──────────────────────────────────────────────────────────────
async function fetchMemberById() {
  const powerId = document.getElementById('powerId').value.trim();
  if (!powerId) { showError('Please enter a Power ID.'); return; }

  const btn = document.getElementById('fetchBtn');
  btn.classList.add('loading');
  btn.disabled = true;
  hideMemberBadge();

  try {
    const q    = query(collection(db, 'members'), where('powerId', '==', powerId));
    const snap = await getDocs(q);

    if (snap.empty) {
      showError('No member found with Power ID: "' + powerId + '"');
    } else {
      const docSnap = snap.docs[0];
      const data    = docSnap.data();
      memberDocId    = docSnap.id;
      currentPowerId = powerId;

      // Name (readonly)
      const nameEl   = document.getElementById('name');
      nameEl.value   = data.name || '';
      nameEl.readOnly = true;

      // Phone
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

      // Age
      const age = pd.age ?? data.age;
      if (age !== undefined && age !== '') document.getElementById('age').value = age;

      // Gender (root level)
      const gender = data.gender || pd.gender;
      if (gender) document.getElementById('gender').value = gender;

      // Height
      const height = pd.height || pd.heightCm || data.height || data.heightCm;
      if (height) document.getElementById('height').value = height;

      // Weight
      const weight = pd.weight || pd.weightKg || data.weight || data.weightKg;
      if (weight) document.getElementById('weight').value = weight;

      // Fitness Goal — members → personalData → fitness_aim (primary), then fallbacks
      const rawAim = pd.fitness_aim || pd.fitnessGoal || pd.goal || data.fitness_aim || data.fitnessGoal || data.goal || '';
      memberFitnessAim = rawAim.toLowerCase().trim();

      const mappedGoal = mapGoal(memberFitnessAim);
      if (mappedGoal) {
        document.getElementById('goal').value = mappedGoal;
        document.getElementById('goal').dispatchEvent(new Event('change'));
      }

      // Experience — default: beginner
      const exp = pd.experienceLevel || pd.experience || data.experienceLevel || data.experience || 'beginner';
      document.getElementById('experience').value = exp;

      // Injuries — read from personalData.injuries in DB
      const injuries = pd.injuries ?? data.injuries ?? '';
      document.getElementById('injuries').value = injuries;

      // Preferred Split — default: full_body
      const splitVal = pd.preferredSplit || data.preferredSplit || 'full_body';
      document.getElementById('split').value = splitVal;

      // Session Duration — default: 1.5 hrs
      const hoursVal = pd.sessionDurationHrs || data.sessionDurationHrs || '1.5';
      document.getElementById('gymHours').value = String(hoursVal);

      // Gym Frequency — default: 6 days
      const daysVal = pd.gymFrequencyDays || data.gymFrequencyDays || '6';
      document.getElementById('gymDays').value = String(daysVal);

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

// ─── GOAL MAPPING HELPERS ─────────────────────────────────────────────────────
// All three functions are aligned: cardio→endurance+cardio, strength→strength+strength,
// cardio+strength→maintenance+null, everything else→goal+null

function mapGoal(rawAim) {
  const a = (rawAim || '').toLowerCase().trim();
  if (!a) return null;
  if (a === 'cardio' || a === 'endurance')                 return 'endurance';
  if (a === 'strength' || a === 'strength training')       return 'strength';
  if (a === 'cardio+strength' || a === 'strength+cardio' ||
      a === 'cardio + strength' || a === 'strength + cardio') return 'maintenance';
  if (a === 'muscle_gain' || a === 'muscle gain' || a === 'bulking') return 'muscle_gain';
  if (a === 'fat_loss'    || a === 'fat loss'    || a === 'cutting') return 'fat_loss';
  if (a === 'maintenance' || a === 'tone')                 return 'maintenance';
  return null;
}

function getExerciseType(rawAim) {
  const a = (rawAim || '').toLowerCase().trim();
  if (a === 'cardio' || a === 'endurance')                 return 'cardio';
  if (a === 'strength' || a === 'strength training')       return 'strength';
  return null;
}

function getExerciseTypeFromGoal(goal) {
  if (goal === 'endurance') return 'cardio';
  if (goal === 'strength')  return 'strength';
  return null;
}

// ─── GENERATE PLAN ─────────────────────────────────────────────────────────────
async function generatePlan() {
  const name       = document.getElementById('name').value.trim();
  const phone      = document.getElementById('phone').value.trim();
  const age        = parseInt(document.getElementById('age').value);
  const gender     = document.getElementById('gender').value;
  const weight     = parseFloat(document.getElementById('weight').value);
  const height     = parseFloat(document.getElementById('height').value);
  const goal       = document.getElementById('goal').value;
  const experience = document.getElementById('experience').value;
  const split      = document.getElementById('split').value;
  const gymHours   = document.getElementById('gymHours').value;
  const gymDays    = document.getElementById('gymDays').value;
  const injuries   = document.getElementById('injuries').value.trim();

  if (!name)       return showError('Member name is missing. Please fetch a member first.');
  if (!age || age < 10 || age > 80) return showError('Enter a valid age (10–80).');
  if (!gender)     return showError('Please select gender.');
  if (!goal)       return showError('Please select a fitness goal.');
  if (!experience) return showError('Please select experience level.');
  if (!gymHours)   return showError('Please select daily gym hours.');
  if (!gymDays)    return showError('Please select days per week.');

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="ai-spinner" style="border-top-color:white;width:14px;height:14px;display:inline-block;"></div> Generating…';

  try {
    const apiGoal      = goal;
    const exerciseType = getExerciseTypeFromGoal(goal);

    // Fetch equipment and call API in parallel to eliminate sequential delay
    const equipPromise = exerciseType !== 'cardio'
      ? getDocs(collection(db, 'equipment')).catch(eqErr => {
          showError('Could not load equipment list — plan will use bodyweight exercises only.');
          console.error('Equipment fetch error:', eqErr);
          return null;
        })
      : Promise.resolve(null);

    const body = {
      name,
      age:                 parseInt(age),
      gender,
      weight_kg:           (weight && !isNaN(weight)) ? weight : null,
      height_cm:           (height && !isNaN(height)) ? height : null,
      goal:                apiGoal,
      experience:          experience || 'beginner',
      split:               split || 'auto',
      gym_hours:           parseFloat(gymHours),
      gym_days:            parseInt(gymDays),
      injuries:            injuries || '',
      available_equipment: [],   // filled after equipment resolves
      power_id:            currentPowerId || '',
      phone:               phone || '',
    };
    if (exerciseType) body.exercise_type = exerciseType;

    // Resolve equipment while API request is being prepared — then fire both
    const equipSnap = await equipPromise;
    if (equipSnap) {
      const seen = new Set();
      equipSnap.forEach(d => {
        const key = (d.data().equipment_db_key || '').toLowerCase().trim();
        if (key && !seen.has(key)) { seen.add(key); body.available_equipment.push(key); }
      });
    }

    const response = await fetch(`${API_BASE}/exercise-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      throw new Error(e.detail || `API error ${response.status}`);
    }

    const apiData = await response.json();
    const plan    = apiData.plan;

    renderPlan(plan, { name, phone, goal: apiGoal, experience, gymHours: parseFloat(gymHours), gymDays: parseInt(gymDays), split, injuries });

    planData = { memberName: name, phone, powerId: currentPowerId, goal: apiGoal, experience, gymHours: parseFloat(gymHours), gymDays: parseInt(gymDays), split, injuries, plan };

    const output = document.getElementById('output');
    output.classList.add('visible');
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    showError('AI error: ' + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Generate Exercise Plan`;
  }
}


// ─── RENDER PLAN ──────────────────────────────────────────────────────────────
function renderPlan(plan, meta) {
  const { gymHours, gymDays, goal, experience, name } = meta;

  // Stats
  document.getElementById('statVolume').textContent   = plan.weekly_volume_sets || '—';
  document.getElementById('statDays').textContent     = gymDays;
  document.getElementById('statDaysSub').textContent  = `${gymDays} active + ${7 - gymDays} rest`;
  document.getElementById('statDuration').textContent = plan.session_duration_mins || Math.round(gymHours * 60);
  document.getElementById('statSplit').textContent    = plan.split_type || '—';
  document.getElementById('statSplitSub').textContent = goalLabels[goal] || goal;

  // Total hours
  const totalHrs = ((plan.session_duration_mins || gymHours * 60) * gymDays / 60).toFixed(1);
  document.getElementById('totalHours').innerHTML = `${totalHrs} <span>hrs/week</span>`;
  document.getElementById('totalNote').textContent = `${gymDays} sessions × ~${plan.session_duration_mins || Math.round(gymHours * 60)} mins | ${name}, ${experience}`;

  // Weekly grid
  const grid = document.getElementById('weekGrid');
  grid.innerHTML = '';
  (plan.schedule || []).forEach(day => {
    const isRest = day.is_rest;
    const card   = document.createElement('div');
    card.className = `day-card ${isRest ? 'rest-day' : 'active-day'}`;
    let exercisesHTML = isRest
      ? `<div class="rest-label">😴 Rest Day</div>`
      : (day.exercises || []).slice(0, 5).map(ex => `
          <div class="exercise-item">
            <div class="ex-dot"></div>
            <div>
              <div class="ex-name">${ex.name}</div>
              <div class="ex-detail">${ex.sets} × ${ex.reps}</div>
            </div>
          </div>`).join('') + (day.exercises.length > 5 ? `<div class="ex-detail" style="padding:5px 0;color:#6b7280;">+${day.exercises.length - 5} more…</div>` : '');

    card.innerHTML = `
      <div class="day-header">
        <div class="day-name">${day.day_short || day.day.slice(0,3)}</div>
        <div class="day-focus">${isRest ? 'Recovery' : (day.focus || '')}</div>
      </div>
      <div class="day-body">${exercisesHTML}</div>`;
    grid.appendChild(card);
  });

  // Detailed exercise table grouped by day
  const tableEl = document.getElementById('exerciseTable');
  tableEl.innerHTML = '';
  const hdr = document.createElement('div');
  hdr.className   = 'card-header';
  hdr.innerHTML   = '<div class="card-title">💪 Full Exercise Details</div>';
  tableEl.appendChild(hdr);

  (plan.schedule || []).filter(d => !d.is_rest).forEach(day => {
    const grpTitle = document.createElement('div');
    grpTitle.className = 'ex-group-title';
    grpTitle.textContent = `${day.day} — ${day.focus || ''}`;
    tableEl.appendChild(grpTitle);

    const rowHdr = document.createElement('div');
    rowHdr.className = 'ex-row-header';
    rowHdr.innerHTML = '<span>Exercise</span><span style="text-align:center;">Sets</span><span style="text-align:center;">Reps</span><span style="text-align:center;">Rest</span>';
    tableEl.appendChild(rowHdr);

    (day.exercises || []).forEach(ex => {
      const row = document.createElement('div');
      row.className = 'ex-row';
      row.innerHTML = `
        <div>
          <div class="ex-row-name">${ex.name}</div>
          ${ex.tip ? `<div class="ex-tip">💡 ${ex.tip}</div>` : ''}
        </div>
        <div class="ex-row-sets">${ex.sets}</div>
        <div class="ex-row-reps">${ex.reps}</div>
        <div class="ex-row-rest">${ex.rest}</div>`;
      tableEl.appendChild(row);
    });
  });

  // Warm-up
  const warmupEl = document.getElementById('warmupList');
  warmupEl.innerHTML = (plan.warmup || []).map(item =>
    `<div class="protocol-item">🔸 <span>${item}</span></div>`
  ).join('');

  // Cool-down
  const cooldownEl = document.getElementById('cooldownList');
  cooldownEl.innerHTML = (plan.cooldown || []).map(item =>
    `<div class="protocol-item">❄️ <span>${item}</span></div>`
  ).join('');
}

// ─── WHATSAPP SHARE ───────────────────────────────────────────────────────────
function sendWhatsApp() {
  if (!planData) return;
  const p    = planData;
  const plan = p.plan;

  // Also download PDF
  const doc = generateExercisePDF();
  if (doc) doc.save(`Exercise_Plan_${p.memberName.replace(/\s+/g,'_')}.pdf`);

  let msg = `🏋️ *${currentGymName}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (p.powerId)   msg += `🪪 *Power ID:* ${p.powerId}\n`;
  msg += `👤 *Name:* ${p.memberName}\n`;
  msg += `🎯 *Goal:* ${goalLabels[p.goal] || p.goal}\n`;
  msg += `🏅 *Level:* ${p.experience}\n`;
  msg += `⏱️ *Session:* ~${plan.session_duration_mins} mins | *${p.gymDays} days/week*\n`;
  msg += `📊 *Split:* ${plan.split_type}\n`;
  if (p.injuries) msg += `🚫 *Avoid:* ${p.injuries}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*📅 WEEKLY SCHEDULE:*\n\n`;

  (plan.schedule || []).forEach(day => {
    if (day.is_rest) {
      msg += `*${day.day}* — 😴 Rest Day\n\n`;
    } else {
      msg += `*${day.day}* — ${day.focus || ''}\n`;
      (day.exercises || []).forEach(ex => {
        msg += `  • ${ex.name} — ${ex.sets} sets × ${ex.reps} (rest: ${ex.rest})\n`;
      });
      msg += `\n`;
    }
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🔥 *Warm-Up:* ${(plan.warmup || []).join(' | ')}\n`;
  msg += `❄️ *Cool-Down:* ${(plan.cooldown || []).join(' | ')}\n`;
  msg += `\n📎 _Exercise Plan PDF has been downloaded — please attach it to this chat._\n`;
  msg += `_Follow this plan consistently for best results. Consult your trainer if needed._`;

  const phone   = p.phone ? p.phone.replace(/\D/g, '') : '';
  const encoded = encodeURIComponent(msg);
  const url     = phone ? `https://wa.me/91${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
  window.open(url, '_blank');
}

// ─── PDF GENERATOR ────────────────────────────────────────────────────────────
function generateExercisePDF() {
  if (!planData) return null;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const p    = planData;
  const plan = p.plan;
  const W    = 210, margin = 14;
  let y = 0;

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 38, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text(currentGymName, margin, 15);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('PERSONALISED EXERCISE PLAN', margin, 22);
  const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(`Date: ${today}`, W - margin, 15, { align: 'right' });
  if (p.powerId) doc.text(`Power ID: ${p.powerId}`, W - margin, 21, { align: 'right' });
  doc.setDrawColor(249, 115, 22);
  doc.setLineWidth(1);
  doc.line(0, 38, W, 38);
  y = 48;

  // Member info row
  doc.setFillColor(23, 23, 27);
  doc.roundedRect(margin, y, W - margin * 2, 22, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(p.memberName, margin + 5, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(156, 163, 175);
  doc.text(`Goal: ${goalLabels[p.goal] || p.goal}   |   Level: ${p.experience}   |   Split: ${plan.split_type}   |   ${p.gymDays} days/week`, margin + 5, y + 15);
  y += 30;

  // Stats row
  const stats = [
    { label: 'Weekly Volume', value: String(plan.weekly_volume_sets), sub: 'total sets/week', color: [249, 115, 22] },
    { label: 'Session Length', value: String(plan.session_duration_mins) + ' min', sub: 'per workout', color: [96, 165, 250] },
    { label: 'Split Type',    value: plan.split_type,                  sub: 'training style', color: [192, 132, 252] },
    { label: 'Active Days',   value: String(p.gymDays) + '/week',      sub: 'gym sessions', color: [74, 222, 128] },
  ];
  const sW = (W - margin * 2 - 9) / 4;
  stats.forEach((s, i) => {
    const sx = margin + i * (sW + 3);
    doc.setFillColor(23, 23, 27);
    doc.roundedRect(sx, y, sW, 22, 3, 3, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text(s.label.toUpperCase(), sx + 4, y + 6);
    doc.setFontSize(s.value.length > 10 ? 8 : 11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...s.color);
    doc.text(s.value, sx + 4, y + 14);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text(s.sub, sx + 4, y + 19);
  });
  y += 30;

  // Warm-up
  if (plan.warmup && plan.warmup.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(249, 115, 22);
    doc.text('WARM-UP PROTOCOL', margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text(plan.warmup.join('   •   '), margin, y);
    y += 10;
  }

  // Schedule
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(229, 231, 235);
  doc.text('WEEKLY EXERCISE SCHEDULE', margin, y);
  y += 6;

  for (const day of (plan.schedule || [])) {
    if (day.is_rest) {
      if (y + 12 > 272) { doc.addPage(); y = 14; }
      doc.setFillColor(20, 20, 20);
      doc.roundedRect(margin, y, W - margin * 2, 10, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.text(`${day.day.toUpperCase()} — REST DAY`, margin + 4, y + 7);
      y += 14;
      continue;
    }

    const rowsH = 14 + (day.exercises || []).length * 10 + 4;
    if (y + rowsH > 272) { doc.addPage(); y = 14; }

    // Day header
    doc.setFillColor(30, 41, 59);
    doc.roundedRect(margin, y, W - margin * 2, 12, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(day.day.toUpperCase(), margin + 4, y + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(249, 115, 22);
    doc.text(day.focus || '', margin + 4 + doc.getTextWidth(day.day.toUpperCase()) + 8, y + 8);
    y += 14;

    // Table header
    doc.setFillColor(18, 18, 18);
    doc.rect(margin, y, W - margin * 2, 7, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(75, 85, 99);
    doc.text('EXERCISE', margin + 3, y + 5);
    doc.text('SETS', margin + 100, y + 5, { align: 'center' });
    doc.text('REPS', margin + 125, y + 5, { align: 'center' });
    doc.text('REST', W - margin - 10, y + 5, { align: 'center' });
    y += 9;

    (day.exercises || []).forEach((ex, idx) => {
      if (y > 272) { doc.addPage(); y = 14; }
      if (idx % 2 === 0) {
        doc.setFillColor(21, 21, 21);
        doc.rect(margin, y, W - margin * 2, 9, 'F');
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(229, 231, 235);
      const nm = ex.name.length > 38 ? ex.name.substring(0, 37) + '…' : ex.name;
      doc.text(nm, margin + 3, y + 6);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(96, 165, 250);
      doc.text(String(ex.sets), margin + 100, y + 6, { align: 'center' });
      doc.setTextColor(74, 222, 128);
      doc.text(ex.reps, margin + 125, y + 6, { align: 'center' });
      doc.setTextColor(107, 114, 128);
      doc.text(ex.rest, W - margin - 10, y + 6, { align: 'center' });
      y += 9;
    });
    y += 6;
  }

  // Cool-down
  if (plan.cooldown && plan.cooldown.length > 0) {
    if (y + 14 > 272) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(96, 165, 250);
    doc.text('COOL-DOWN PROTOCOL', margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text(plan.cooldown.join('   •   '), margin, y);
    y += 12;
  }

  // Footer
  if (y + 10 > 272) { doc.addPage(); y = 14; }
  doc.setDrawColor(42, 42, 42);
  doc.setLineWidth(0.3);
  doc.line(margin, y, W - margin, y);
  y += 5;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(107, 114, 128);
  doc.text('Follow this plan with consistency and proper form. Consult your trainer if you experience pain.', margin, y);
  doc.text(`Generated by ${currentGymName}`, W - margin, y, { align: 'right' });

  return doc;
}

function downloadPDF() {
  if (!planData) return;
  const doc = generateExercisePDF();
  if (doc) doc.save(`Exercise_Plan_${planData.memberName.replace(/\s+/g,'_')}.pdf`);
}

function resetForm() {
  ['powerId','age','gender','height','weight','goal','experience','split','gymHours','gymDays','injuries','phone','name']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  document.getElementById('parentPhoneRow').style.display = 'none';
  document.getElementById('phoneLabelHint').textContent = '';
  document.getElementById('goalBadgeEl').innerHTML = '';
  document.getElementById('output').classList.remove('visible');
  document.getElementById('errorBox').classList.remove('visible');
  hideMemberBadge();
  planData         = null;
  memberDocId      = '';
  currentPowerId   = '';
  memberPhone      = '';
  parentPhone      = '';
  memberFitnessAim = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── EXPOSE ────────────────────────────────────────────────────────────────────
window.fetchMemberById = fetchMemberById;
window.generatePlan    = generatePlan;
window.sendWhatsApp    = sendWhatsApp;
window.downloadPDF     = downloadPDF;
window.resetForm       = resetForm;