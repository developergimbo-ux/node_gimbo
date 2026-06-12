import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    query,
    where,
    updateDoc,
    doc,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBawDWPi-NvWl3bKyGVIFi-v9FX7yHraEI",
    authDomain: "gimbo-dc910.firebaseapp.com",
    projectId: "gimbo-dc910",
    storageBucket: "gimbo-dc910.firebasestorage.app",
    messagingSenderId: "294864961933",
    appId: "1:294864961933:web:61d6c4086c09a506bf3dc4"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── Helpers ───────────────────────────────────────────────────

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDisplayDate(s) {
    const [y, m, d] = s.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

function currentTime() {
    const n = new Date();
    return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

function padId(id) {
    return String(id).trim().padStart(3, '0');
}

// ── Parse any Firestore date value → JS Date ──────────────────
function parseDate(val) {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate();   // Firestore Timestamp
    if (val instanceof Date)              return val;
    if (typeof val === 'number')          return new Date(val);
    if (typeof val === 'string') {
        const s = val.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
        const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (dmy) return new Date(`${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`);
        return new Date(s);
    }
    return null;
}

// ── Parse package string → duration in months ─────────────────
function packageToMonths(pkg) {
    if (!pkg) return 1;
    const s = pkg.toLowerCase().trim();
    if (s.includes('year'))    { const n = parseFloat(s) || 1; return Math.round(n * 12); }
    if (s.includes('half'))    return 6;
    if (s.includes('quarter')) return 3;
    if (s.includes('annual'))  return 12;
    const monthMatch = s.match(/(\d+\.?\d*)\s*month/);
    if (monthMatch) return parseFloat(monthMatch[1]);
    const num = parseFloat(s);
    if (!isNaN(num) && num > 0) return num;
    return 1;
}

// ── Add N months to a Date ────────────────────────────────────
function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + Math.floor(months));
    const extra = Math.round((months - Math.floor(months)) * 30);
    if (extra > 0) d.setDate(d.getDate() + extra);
    return d;
}

function resolveTime(data) {
    // Support both 'time' and 'checkIn' field names (Firebase uses checkIn)
    const t = data.time || data.checkIn || null;
    if (t && typeof t === 'string' && t !== '-' && t.trim() !== '') {
        return t.trim().substring(0, 5); // ensure HH:MM format
    }
    if (data.timestamp) {
        let date = null;
        if (typeof data.timestamp.toDate === 'function') date = data.timestamp.toDate();
        else if (data.timestamp instanceof Date)         date = data.timestamp;
        else if (typeof data.timestamp === 'number')     date = new Date(data.timestamp);
        if (date) return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
    }
    return '-';
}

// ── State ─────────────────────────────────────────────────────
let allMembers      = [];  // { docId, powerId, name, package, lastPayment, fee }
let attendanceMap   = {};  // padded powerId → { docId, status, time }
let feesMap         = {};  // padded powerId → 'paid' | 'overdue' | 'pending'
let selectedDate    = todayStr();
let unsubAttendance = null;
let unsubMembers    = null;
let unsubFees       = null;

const tableBody    = document.getElementById('tableBody');
const cardHeader   = document.getElementById('cardHeader');
const dateInput    = document.getElementById('dateInput');
const statusFilter = document.getElementById('statusFilter');
const searchInput  = document.getElementById('searchInput');

// Set date input to today
dateInput.value = selectedDate;
cardHeader.textContent = `Attendance - ${formatDisplayDate(selectedDate)}`;

// ── Render ────────────────────────────────────────────────────
function renderTable() {
    const search = searchInput.value.trim().toLowerCase();
    const filter = statusFilter.value;

    const filtered = allMembers.filter(m => {
        const key     = padId(m.powerId);
        const att     = attendanceMap[key];
        const attStat = att ? att.status : 'absent';
        if (filter === 'Present' && attStat !== 'present') return false;
        if (filter === 'Absent'  && attStat !== 'absent')  return false;
        if (search && !m.name.toLowerCase().includes(search) && !key.includes(search)) return false;
        return true;
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="loading">No records found.</td></tr>`;
        return;
    }

    tableBody.innerHTML = filtered.map(m => {
        const key    = padId(m.powerId);
        const att    = attendanceMap[key];
        const status = att ? att.status : 'absent';
        const time   = att ? att.time   : '-';

        const attBadge = status === 'present'
            ? `<span class="badge badge-present">Present</span>`
            : `<span class="badge badge-absent">Absent</span>`;

        const feeState = feesMap[key] || 'pending';
        const feeBadge = feeState === 'paid'
            ? `<span class="badge badge-paid">Paid</span>`
            : feeState === 'overdue'
            ? `<span class="badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;">Overdue</span>`
            : `<span class="badge badge-unpaid">Unpaid</span>`;

        return `
        <tr data-powerid="${key}">
            <td>${key}</td>
            <td style="text-align:left">${m.name}</td>
            <td>${m.package}</td>
            <td>${feeBadge}</td>
            <td>${attBadge}</td>
            <td>${time}</td>
            <td>
                <button class="action-btn present" onclick="window._markOne('${key}','present')">✓ Present</button>
                <button class="action-btn absent"  onclick="window._markOne('${key}','absent')">✗ Absent</button>
            </td>
        </tr>`;
    }).join('');
}

// ── Rebuild feesMap from members + fees data ──────────────────
let _membersRaw = {};  // powerId → member doc data
let _feesRaw    = {};  // powerId → most recent fees doc data

function rebuildFeesMap() {
    feesMap = {};
    const now = new Date();

    for (const [pid, m] of Object.entries(_membersRaw)) {
        const key = padId(pid);
        const f   = _feesRaw[pid] || null;

        let lastPaymentDate = null;
        if (f && f.paymentDate)  lastPaymentDate = parseDate(f.paymentDate);
        if (!lastPaymentDate && m.lastPayment)  lastPaymentDate = parseDate(m.lastPayment);
        if (!lastPaymentDate && m.joinDate)     lastPaymentDate = parseDate(m.joinDate);
        if (!lastPaymentDate && m.joinedDate)   lastPaymentDate = parseDate(m.joinedDate);

        if (!lastPaymentDate) {
            feesMap[key] = 'pending';
            continue;
        }

        const pkg          = m.package || (f && f.package) || '1 Month';
        const durationMos  = packageToMonths(pkg);
        const nextPayment  = addMonths(lastPaymentDate, durationMos);

        if (f && (f.status || '').toLowerCase() === 'paid') {
            feesMap[key] = nextPayment < now ? 'overdue' : 'paid';
        } else if (!f) {
            feesMap[key] = nextPayment < now ? 'overdue' : 'paid';
        } else {
            feesMap[key] = 'pending';
        }
    }

    renderTable();
}

// ── Listeners ─────────────────────────────────────────────────

function startAttendanceListener(date) {
    if (unsubAttendance) { unsubAttendance(); unsubAttendance = null; }
    attendanceMap = {};

    const q = query(collection(db, 'zumba_attendance'), where('date', '==', date));

    unsubAttendance = onSnapshot(q, snapshot => {
        attendanceMap = {};
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const key  = padId(data.powerId);
            const resolvedTime = resolveTime(data);
            const existing = attendanceMap[key];
            if (!existing ||
                (data.status === 'present' && existing.status !== 'present') ||
                (resolvedTime !== '-' && existing.time === '-')) {
                attendanceMap[key] = {
                    docId  : docSnap.id,
                    status : data.status || 'absent',
                    time   : resolvedTime
                };
            }
        });
        renderTable();
    }, err => console.error('Attendance error:', err));
}

function startMembersListener() {
    if (unsubMembers) { unsubMembers(); unsubMembers = null; }

    unsubMembers = onSnapshot(collection(db, 'zumba_members'), snapshot => {
        allMembers  = [];
        _membersRaw = {};

        snapshot.forEach(docSnap => {
            const m = docSnap.data();
            if ((m.status || '').toLowerCase() === 'left') return;
            const pid = String(m.powerId || '');
            allMembers.push({
                docId   : docSnap.id,
                powerId : pid,
                name    : m.name    || '—',
                package : m.package || '-'
            });
            _membersRaw[pid] = m;
        });

        allMembers.sort((a, b) => parseInt(a.powerId) - parseInt(b.powerId));
        rebuildFeesMap();
    }, err => console.error('Members error:', err));
}

function startFeesListener() {
    if (unsubFees) { unsubFees(); unsubFees = null; }

    unsubFees = onSnapshot(collection(db, 'zumba_fees'), snapshot => {
        _feesRaw = {};

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const pid  = String(data.powerId || '').trim();
            if (!pid) return;

            const existing     = _feesRaw[pid];
            const existingDate = existing ? parseDate(existing.paymentDate) : null;
            const thisDate     = parseDate(data.paymentDate);

            if (!existing || (thisDate && existingDate && thisDate > existingDate)) {
                _feesRaw[pid] = data;
            }
        });

        rebuildFeesMap();
    }, err => console.error('Fees error:', err));
}

// ── Save / Update attendance in Firebase ─────────────────────
async function saveAttendance(member, status) {
    const key      = padId(member.powerId);
    const time     = status === 'present' ? currentTime() : '-';
    const existing = attendanceMap[key];

    if (existing && existing.docId) {
        await updateDoc(doc(db, 'zumba_attendance', existing.docId), {
            powerId   : key,
            status,
            time,
            timestamp : new Date()
        });
    } else {
        await addDoc(collection(db, 'zumba_attendance'), {
            memberId  : member.docId,
            powerId   : key,
            name      : member.name,
            date      : selectedDate,
            status,
            time,
            timestamp : new Date()
        });
    }
}

window._markOne = async (powerId, status) => {
    const key    = padId(powerId);
    const member = allMembers.find(m => padId(m.powerId) === key);
    if (!member) return;

    const row  = tableBody.querySelector(`tr[data-powerid="${key}"]`);
    const btns = row ? row.querySelectorAll('.action-btn') : [];
    btns.forEach(b => b.disabled = true);

    try {
        await saveAttendance(member, status);
    } catch(e) {
        console.error('Mark attendance error:', e);
        btns.forEach(b => b.disabled = false);
    }
};

// ── Date input change ─────────────────────────────────────────
dateInput.addEventListener('change', () => {
    const val = dateInput.value;
    if (!val) return;
    selectedDate = val;
    cardHeader.textContent = `Attendance - ${formatDisplayDate(selectedDate)}`;
    tableBody.innerHTML = `<tr><td colspan="7" class="loading"><span class="loader"></span> Loading…</td></tr>`;
    startAttendanceListener(selectedDate);
});

searchInput.addEventListener('input',   renderTable);
statusFilter.addEventListener('change', renderTable);

// ── Boot ──────────────────────────────────────────────────────
startMembersListener();
startAttendanceListener(selectedDate);
startFeesListener();
