import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
    getFirestore, collection, getDocs, onSnapshot, query, where,
    addDoc, doc
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";


const app = initializeApp({
    apiKey: "AIzaSyBawDWPi-NvWl3bKyGVIFi-v9FX7yHraEI",
    authDomain: "gimbo-dc910.firebaseapp.com",
    projectId: "gimbo-dc910",
    storageBucket: "gimbo-dc910.firebasestorage.app",
    messagingSenderId: "294864961933",
    appId: "1:294864961933:web:61d6c4086c09a506bf3dc4"
});
const db = getFirestore(app);

// ── Canonical collection names ────────────────────────────────
const COL = {
    members:     'members',
    attendance:  'attendance',
    fees:        'fees',
    sales:       'supplement_sales',
    supplements: 'supplements',
    equipment:   'equipment',
    staff:       'staff'
};

// ── Pure helpers ──────────────────────────────────────────────

const _dateFmtCache = new Map();
function getLocalDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function normalizeDate(v) {
    if (!v) return '';
    if (typeof v === 'number') {
        const d = new Date(Math.round((v - 25569) * 86400000));
        return d.toISOString().slice(0, 10);
    }
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (!s) return '';
    if (_dateFmtCache.has(s)) return _dateFmtCache.get(s);
    let result = s;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        result = s.slice(0, 10);
    } else {
        const d = new Date(s);
        result = isNaN(d) ? s : d.toISOString().slice(0, 10);
    }
    if (_dateFmtCache.size < 2000) _dateFmtCache.set(s, result);
    return result;
}

function normalizeKeys(obj) {
    const out = {};
    for (const k of Object.keys(obj)) {
        out[k.trim().toLowerCase()] = typeof obj[k] === 'string' ? obj[k].trim() : obj[k];
    }
    return out;
}

function pick(obj, ...keys) {
    for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return '';
}

function safeNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function safeLocalDate(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') return new Date(v);
    const s = String(v).trim();
    if (!s) return null;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2])-1, Number(iso[3]));
    const d = new Date(s);
    return isNaN(d) ? null : d;
}

function extractTime(r) {
    if (r.time) return r.time;
    if (r.timestamp && typeof r.timestamp.toDate === 'function')
        return r.timestamp.toDate().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:false });
    if (r.checkintime) return r.checkintime;
    return '—';
}

function pidOf(r) {
    return String(r.powerId || r.memberid || r['power id'] || '').trim();
}

function feeDate(f) {
    return f.paymentDate || f.lastpayment || f.date || f.month || '';
}

// ── Debounce ──────────────────────────────────────────────────
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Settings — Firebase primary, localStorage cache ───────────
let _settings = {};

function getSetting(key, fallback = '') {
    return _settings[key] !== undefined ? String(_settings[key]) : (localStorage.getItem('gym_setting_' + key) ?? fallback);
}

function _applySettingsToUI() {
    const gymName = getSetting('gymName', 'GYM Admin Panel') || 'GYM Admin Panel';
    document.getElementById('gymNameFooter').textContent = gymName;
    document.title = gymName + ' — Owner Panel';
}

function loadSettings() { _applySettingsToUI(); }

let _settingsLoaded = false;

function _applySettingsSnap(snap) {
    if (snap.exists()) {
        const data   = snap.data();
        const timing = (data.gymTiming && typeof data.gymTiming === 'object') ? data.gymTiming : {};
        const sunday = (timing.sunday  && typeof timing.sunday  === 'object') ? timing.sunday  : {};
        _settings = {
            ...data,
            morningOpen:   timing.morningOpen  || data.morningOpen  || '',
            morningClose:  timing.morningClose || data.morningClose || '',
            eveningOpen:   timing.eveningOpen  || data.eveningOpen  || '',
            eveningClose:  timing.eveningClose || data.eveningClose || '',
            sundayOpen:    sunday.open   || data.sundayOpen   || '',
            sundayClose:   sunday.close  || data.sundayClose  || '',
            sundayStatus:  sunday.status || data.sundayStatus || 'closed',
        };

        // ── Avg session: try multiple field name variants ──
        const avgRaw = data.avg_time_spent_on_gym_by_member
                    || data.avgTimeSpentOnGymByMember
                    || data.avgSessionHours
                    || data.sessionDuration
                    || null;
        const _avgH = parseFloat(avgRaw);
        if (!isNaN(_avgH) && _avgH > 0) {
            MAX_SESSION_MIN = Math.round(_avgH * 60);
            console.log('[Settings] MAX_SESSION_MIN =', MAX_SESSION_MIN, 'mins (', _avgH, 'hrs)');
        }

        console.log('[Settings] gymTiming read:', {
            morningOpen:  _settings.morningOpen,
            morningClose: _settings.morningClose,
            eveningOpen:  _settings.eveningOpen,
            eveningClose: _settings.eveningClose,
            sundayStatus: _settings.sundayStatus,
            MAX_SESSION_MIN
        });

        Object.entries(_settings).forEach(([k, v]) => {
            if (v !== undefined && v !== null && typeof v !== 'object')
                localStorage.setItem('gym_setting_' + k, String(v));
        });
    }
    _applySettingsToUI();
}

function _subscribeSettings(onFirstLoad) {
    let firstFired = false;
    onSnapshot(doc(db, 'gym_settings', 'config'), snap => {
        _applySettingsSnap(snap);
        if (!firstFired) {
            firstFired = true;
            _settingsLoaded = true;
            if (typeof onFirstLoad === 'function') onFirstLoad();
        } else {
            _updateInsideGymCard();
        }
    }, err => {
        console.warn('settings onSnapshot error:', err);
        if (!firstFired) {
            firstFired = true;
            _settingsLoaded = true;
            if (typeof onFirstLoad === 'function') onFirstLoad();
        }
    });
}


// ── Live Firebase state ───────────────────────────────────────
let _fbMembers     = [];
let _fbFees        = [];
let _fbSales       = [];
let _fbAttendance  = [];
let _fbSupplements = [];
let _fbEquipment   = [];
let _fbStaff       = [];

let _cache = {
    memberMap:    null,
    activeMembers: null,
    paidSetThisMonth: null,
};

function _invalidateCache() {
    _cache.memberMap     = null;
    _cache.activeMembers = null;
    _cache.paidSetThisMonth = null;
}

function _getMemberMap() {
    if (!_cache.memberMap) {
        _cache.memberMap = new Map();
        _fbMembers.forEach(m => {
            const pid = pidOf(m);
            if (pid) _cache.memberMap.set(pid, m);
        });
    }
    return _cache.memberMap;
}

function _getActiveMembers() {
    if (!_cache.activeMembers) {
        _cache.activeMembers = _fbMembers.filter(m => (m.status||'').toLowerCase() === 'active');
    }
    return _cache.activeMembers;
}

function _getPaidSetThisMonth() {
    if (!_cache.paidSetThisMonth) {
        const now = new Date();
        const thisMonth = now.getMonth(), thisYear = now.getFullYear();
        _cache.paidSetThisMonth = new Set();
        for (const f of _fbFees) {
            if ((f.status||'').toLowerCase() !== 'paid') continue;
            const ds = feeDate(f);
            if (!ds) continue;
            const fd = safeLocalDate(ds);
            if (!fd) continue;
            _cache.paidSetThisMonth.add(pidOf(f));
        }
    }
    return _cache.paidSetThisMonth;
}

// ── Dashboard ─────────────────────────────────────────────────
const _debouncedDashboard = debounce(_recomputeDashboard, 80);

function _recomputeDashboard() {
    const today     = new Date();
    const thisMonth = today.getMonth();
    const thisYear  = today.getFullYear();
    const todayStr  = getLocalDateString();

    document.getElementById('dashboardDate').textContent =
        today.toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

    let totalNonLeft = 0, activeCount = 0, pausedCount = 0, leftCount = 0;
    for (const m of _fbMembers) {
        const s = (m.status || '').toLowerCase();
        if (s === 'left') { leftCount++; }
        else { totalNonLeft++; if (s === 'active') activeCount++; else if (s === 'paused') pausedCount++; }
    }
    document.getElementById('statTotalMembers').textContent   = totalNonLeft;
    document.getElementById('statActiveMembers').textContent  = activeCount;
    document.getElementById('statPausedMembers').textContent  = pausedCount;
    document.getElementById('statLeftMembers').textContent    = leftCount;
    document.getElementById('statEquipmentCount').textContent = _fbEquipment.length;

    const todayPids = new Set();
    for (const a of _fbAttendance) {
        if (normalizeDate(a.date) !== todayStr) continue;
        const s = (a.status||'').toLowerCase();
        if (!['present','inside','checkin','check-in','entry'].includes(s)) continue;
        const pid = pidOf(a);
        if (pid) todayPids.add(pid);
    }
    document.getElementById('statTodayPresent').textContent = todayPids.size;

    let feeRevenue = 0;
    const paidSet  = _getPaidSetThisMonth();
    for (const f of _fbFees) {
        if ((f.status||'').toLowerCase() !== 'paid') continue;
        const ds = feeDate(f);
        if (!ds) continue;
        const fd = safeLocalDate(ds);
        if (!fd) continue;
        if (fd.getMonth() === thisMonth && fd.getFullYear() === thisYear) feeRevenue += safeNum(f.amount);
    }

    let salesRevenue = 0;
    for (const s of _fbSales) {
        const ds = s.date || '';
        if (!ds) continue;
        const sd = safeLocalDate(ds);
        if (!sd) continue;
        if (sd.getMonth() === thisMonth && sd.getFullYear() === thisYear)
            salesRevenue += safeNum(s.totalAmount || s.amount || 0);
    }

    const totalRevenue = feeRevenue + salesRevenue;
    document.getElementById('statMonthlyRevenue').textContent = '₹' + totalRevenue.toLocaleString('en-IN');
    document.getElementById('statRevenueFees').textContent    = '₹' + feeRevenue.toLocaleString('en-IN');
    document.getElementById('statRevenueSales').textContent   = '₹' + salesRevenue.toLocaleString('en-IN');

    // ── Unpaid Fees ──
    function _feePkgMonths(pkg) {
        if (!pkg) return 1;
        const s = pkg.toLowerCase().trim();
        if (s.includes('year'))    { const n = parseFloat(s)||1; return Math.round(n*12); }
        if (s.includes('half'))    return 6;
        if (s.includes('quarter')) return 3;
        if (s.includes('annual'))  return 12;
        if (s.includes('weekly'))  return 0.25;
        const mm = s.match(/(\d+\.?\d*)\s*month/); if (mm) return parseFloat(mm[1]);
        const num = parseFloat(s); return (!isNaN(num)&&num>0) ? num : 1;
    }
    function _feeAddMonths(date, months) {
        const whole = Math.floor(months), extra = Math.round((months-whole)*30);
        const d = new Date(date); d.setMonth(d.getMonth()+whole);
        if (extra>0) d.setDate(d.getDate()+extra); return d;
    }
    function _feeParseDate(v) {
        if (!v) return null;
        if (typeof v.toDate === 'function') return v.toDate();
        if (v instanceof Date) return v;
        if (typeof v === 'number') return new Date(v);
        const s = String(v).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
        const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (dmy) return new Date(`${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`);
        return new Date(s);
    }
    const _feesMap = {};
    _fbFees.forEach(f => {
        const pid = String(f.powerId||'').trim(); if (!pid) return;
        if (!_feesMap[pid]) _feesMap[pid] = [];
        _feesMap[pid].push(f);
    });
    const _feeRows = _fbMembers
        .filter(m => (m.status||'').toLowerCase() !== 'left')
        .map(m => {
            const pid = String(m.powerId||'').trim();
            const pkg = m.package || '—';
            const dur = _feePkgMonths(pkg);
            const allFees  = _feesMap[pid] || [];
            const paidFees = allFees.filter(f=>(f.status||'').toLowerCase()==='paid');
            paidFees.sort((a,b)=>{ const da=_feeParseDate(a.paymentDate), db=_feeParseDate(b.paymentDate); return (db&&da)?db-da:0; });
            const latestPaid = paidFees[0] || null;
            let lastPayment = null;
            if (latestPaid)                 lastPayment = _feeParseDate(latestPaid.paymentDate);
            if (!lastPayment && m.lastPayment)  lastPayment = _feeParseDate(m.lastPayment);
            if (!lastPayment && m.joinDate)     lastPayment = _feeParseDate(m.joinDate);
            if (!lastPayment && m.joinedDate)   lastPayment = _feeParseDate(m.joinedDate);
            const nextDue = lastPayment ? _feeAddMonths(lastPayment, dur) : null;
            const now2    = new Date();
            let status;
            if (latestPaid) { status = (nextDue && nextDue <= now2) ? 'Overdue' : 'Paid'; }
            else            { status = 'Pending'; }
            const amount = (latestPaid && latestPaid.amount != null) ? latestPaid.amount
                         : (m.fee != null) ? m.fee : 0;
            return { status, amount };
        });
    let unpaidCount = 0, unpaidTotal = 0;
    _feeRows.forEach(d => {
        if (d.status === 'Pending' || d.status === 'Overdue') {
            unpaidCount++;
            unpaidTotal += Number(d.amount || 0);
        }
    });

    document.getElementById('statUnpaidFees').textContent  = '₹' + unpaidTotal.toLocaleString('en-IN');
    document.getElementById('statUnpaidCount').textContent = unpaidCount;
    _updateInsideGymCard();
}

// ── Today Present table ───────────────────────────────────────
let _unsubTodayPresent = null;

function loadTodayPresentFromFirebase() {
    const tbody    = document.getElementById('todayPresentBody');
    const badge    = document.getElementById('todayPresentBadge');
    const todayStr = getLocalDateString();

    if (_unsubTodayPresent) { _unsubTodayPresent(); _unsubTodayPresent = null; }
    tbody.innerHTML = '<tr><td colspan="6" class="loading-row"><span class="loading-spinner"></span> Loading from Firebase...</td></tr>';

    _unsubTodayPresent = onSnapshot(
        query(collection(db, COL.attendance), where('date', '==', todayStr)),
        snap => {
            const memberMap = _getMemberMap();
            const latestByPid = new Map();
            snap.forEach(d => {
                const data   = d.data();
                const status = (data.status || '').toLowerCase();
                if (!['present','inside','checkin','check-in','entry'].includes(status)) return;
                const pid  = pidOf(data);
                if (!pid) return;
                const tMin = _timeStrToMinutes(extractTime(data)) ?? -1;
                const prev = latestByPid.get(pid);
                if (!prev || tMin > prev.tMin) latestByPid.set(pid, { tMin, data });
            });

            const rows = [];
            for (const [pid, { data }] of latestByPid) {
                const member = memberMap.get(pid) || memberMap.get(String(Number(pid))) || {};
                rows.push({
                    powerId: pid,
                    name:    data.name || member.name || 'Unknown',
                    time:    extractTime(data),
                    package: data.package || member.package || '—',
                    status:  data.status || 'present'
                });
            }

            rows.sort((a, b) => {
                const an = parseFloat(a.powerId), bn = parseFloat(b.powerId);
                return (!isNaN(an) && !isNaN(bn)) ? an - bn : String(a.powerId).localeCompare(String(b.powerId));
            });

            badge.textContent = rows.length + ' present today (' + todayStr + ')';
            document.getElementById('statTodayPresent').textContent = rows.length;

            if (rows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">No members present today (${todayStr})</td></tr>`;
                return;
            }
            tbody.innerHTML = rows.map((r, i) => {
                const bc = (r.status||'').toLowerCase() === 'present' ? 'badge-present' : 'badge-inside';
                return `<tr>
                    <td style="color:var(--text-muted);">${i+1}</td>
                    <td style="font-family:monospace;font-size:0.85rem;color:var(--accent);">${r.powerId}</td>
                    <td style="font-weight:600;">${r.name}</td>
                    <td style="color:var(--text-secondary);font-weight:500;">${r.time}</td>
                    <td><span style="background:rgba(59,130,246,0.1);color:var(--accent);padding:3px 8px;border-radius:6px;font-size:0.78rem;">${r.package}</span></td>
                    <td><span class="badge ${bc}">${r.status}</span></td>
                </tr>`;
            }).join('');
        },
        err => {
            console.error('todayPresent onSnapshot error:', err);
            badge.textContent = 'Firebase error';
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">Error loading attendance.</td></tr>`;
        }
    );
}
window.loadTodayPresent = loadTodayPresentFromFirebase;

// ── Firebase onSnapshot listeners ─────────────────────────────
let _membersLoaded    = false;
let _attendanceLoaded = false;

function _tryRunDashboard() {
    if (_settingsLoaded && _membersLoaded && _attendanceLoaded) {
        _recomputeDashboard();
        loadTodayPresentFromFirebase();
    }
}

function syncFromFirebase() {
    onSnapshot(collection(db, COL.members), snap => {
        _fbMembers = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
        _invalidateCache();
        if (!_membersLoaded) {
            _membersLoaded = true;
            _tryRunDashboard();
        } else {
            _debouncedDashboard();
            if (_fbAttendance.length > 0) loadTodayPresentFromFirebase();
        }
    }, err => console.warn('members onSnapshot error:', err));

    onSnapshot(collection(db, COL.attendance), snap => {
        _fbAttendance = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!_attendanceLoaded) {
            _attendanceLoaded = true;
            _tryRunDashboard();
        } else {
            _debouncedDashboard();
            loadTodayPresentFromFirebase();
        }
    }, err => console.warn('attendance onSnapshot error:', err));

    onSnapshot(collection(db, COL.fees), snap => {
        _fbFees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _cache.paidSetThisMonth = null;
        if (_settingsLoaded && _membersLoaded && _attendanceLoaded) _debouncedDashboard();
    }, err => console.warn('fees onSnapshot error:', err));

    onSnapshot(collection(db, COL.sales), snap => {
        _fbSales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (_settingsLoaded && _membersLoaded && _attendanceLoaded) _debouncedDashboard();
    }, err => console.warn('supplement_sales onSnapshot error:', err));

    onSnapshot(collection(db, COL.staff), snap => {
        _fbStaff = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }, err => console.warn('staff onSnapshot error:', err));

    onSnapshot(collection(db, COL.equipment), snap => {
        _fbEquipment = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        document.getElementById('statEquipmentCount').textContent = _fbEquipment.length;
    }, err => console.warn('equipment onSnapshot error:', err));

    onSnapshot(collection(db, COL.supplements), snap => {
        _fbSupplements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }, err => console.warn('supplements onSnapshot error:', err));
}

// ── Navigation ────────────────────────────────────────────────
const REDIRECT_SECTIONS = {
    members:'members.html', attendance:'attendance.html', fees:'fees.html',
    supplements:'supplement.html', equipment:'equipment.html',
    sales:'suppliment_sales.html', staff:'staff.html', settings:'settings.html',
    reports:'reports.html', excel:'excel.html'
};
const ALLOWED = ['dashboard'];

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function() {
        const section = this.dataset.section;
        if (!section) return;
        if (REDIRECT_SECTIONS[section]) { window.location.href = REDIRECT_SECTIONS[section]; return; }
        if (!ALLOWED.includes(section)) return;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        const target = document.getElementById('section-' + section);
        if (target) target.classList.add('active');
        document.getElementById('sidebar').classList.remove('open');
        if (section === 'dashboard') { _recomputeDashboard(); loadTodayPresentFromFirebase(); }
    });
});
document.getElementById('mobileMenuBtn').addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('open')
);

// ── Toast ─────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, type) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMsg').textContent = msg;
    toast.className = 'toast show ' + (type || '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// ── Inside Gym Now ────────────────────────────────────────────
let _insideGymInterval = null;
let MAX_SESSION_MIN = 90;

function _timeStrToMinutes(t) {
    if (!t || t === '—') return null;
    t = t.trim();
    const ampm = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampm) {
        let h = parseInt(ampm[1]), m = parseInt(ampm[2]);
        if (ampm[3].toUpperCase() === 'PM' && h !== 12) h += 12;
        if (ampm[3].toUpperCase() === 'AM' && h === 12) h = 0;
        return h * 60 + m;
    }
    const hr24 = t.match(/^(\d{1,2}):(\d{2})$/);
    if (hr24) return parseInt(hr24[1]) * 60 + parseInt(hr24[2]);
    return null;
}

function _minToTimeStr(m) {
    const h = Math.floor(m / 60) % 24, min = m % 60;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(min).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ── CHANGED: reads directly from _settings.gymTiming nested object ──
function _getSessionsFromSettings() {
    const today    = new Date();
    const isSunday = today.getDay() === 0;
    const sessions = [];

    if (isSunday) {
        const status = (_settings.gymTiming?.sunday?.status || 'closed').toLowerCase();
        if (status === 'closed') return [];
        const open  = _timeStrToMinutes(_settings.gymTiming?.sunday?.open  || '');
        const close = _timeStrToMinutes(_settings.gymTiming?.sunday?.close || '');
        if (open !== null && close !== null && close > open)
            sessions.push({ label: 'Sunday', open, close });
        return sessions;
    }

    const mOpen  = _timeStrToMinutes(_settings.gymTiming?.morningOpen  || '');
    const mClose = _timeStrToMinutes(_settings.gymTiming?.morningClose || '');
    if (mOpen !== null && mClose !== null && mClose > mOpen)
        sessions.push({ label: 'Morning', open: mOpen, close: mClose });

    const eOpen  = _timeStrToMinutes(_settings.gymTiming?.eveningOpen  || '');
    const eClose = _timeStrToMinutes(_settings.gymTiming?.eveningClose || '');
    if (eOpen !== null && eClose !== null && eClose > eOpen)
        sessions.push({ label: 'Evening', open: eOpen, close: eClose });

    return sessions;
}

function _buildSlots(session) {
    const slots = [];
    let cursor = session.open;
    while (cursor < session.close) {
        const end = Math.min(cursor + MAX_SESSION_MIN, session.close);
        slots.push({ start: cursor, end });
        cursor += MAX_SESSION_MIN;
    }
    return slots;
}

function _resolveSessionForEntry(entryMin, nowMin) {
    const sessions = _getSessionsFromSettings();
    for (const s of sessions) {
        if (entryMin >= s.open && entryMin <= s.close) return s;
        if (entryMin >= (s.open - MAX_SESSION_MIN) && entryMin < s.open) {
            if (nowMin >= s.open && nowMin <= s.close) return s;
            if (nowMin >= entryMin && nowMin < s.open) return s;
        }
    }
    return null;
}

function _getCurrentSession(nowMin) {
    const sessions = _getSessionsFromSettings();
    for (const s of sessions) {
        if (nowMin >= (s.open - MAX_SESSION_MIN) && nowMin <= s.close) return s;
    }
    return null;
}

function _computeInsideGym() {
    const now      = new Date();
    const nowMin   = now.getHours() * 60 + now.getMinutes();
    const todayStr = getLocalDateString();
    const session  = _getCurrentSession(nowMin);

    if (!session) return { count: 0, members: [], session: null, reason: 'closed' };

    const memberMap   = _getMemberMap();
    const latestByPid = new Map();

    for (const a of _fbAttendance) {
        if (normalizeDate(a.date) !== todayStr) continue;
        const status = (a.status || '').toLowerCase();
        if (!['present', 'inside', 'checkin', 'check-in', 'entry'].includes(status)) continue;
        const pid  = pidOf(a);
        if (!pid) continue;
        const tMin = _timeStrToMinutes(extractTime(a));
        if (tMin === null) continue;
        const entrySessionMatch = _resolveSessionForEntry(tMin, nowMin);
        if (!entrySessionMatch) continue;
        if (entrySessionMatch.open !== session.open) continue;
        const prev = latestByPid.get(pid);
        if (!prev || tMin > prev.tMin) latestByPid.set(pid, { tMin, rec: a });
    }

    const inside = [];
    for (const [pid, { tMin, rec }] of latestByPid) {
        const elapsed  = nowMin - tMin;
        if (elapsed < 0 || elapsed >= MAX_SESSION_MIN) continue;
        const minsLeft = MAX_SESSION_MIN - elapsed;
        const member   = memberMap.get(pid) || memberMap.get(String(Number(pid))) || {};
        inside.push({
            pid,
            name:          rec.name || member.name || 'Unknown',
            entryTime:     extractTime(rec),
            entryMin:      tMin,
            estimatedExit: tMin + MAX_SESSION_MIN,
            minsLeft,
            package:       rec.package || member.package || '—'
        });
    }

    inside.sort((a, b) => a.minsLeft - b.minsLeft);
    return { count: inside.length, members: inside, session, reason: 'open' };
}

function _updateInsideGymCard() {
    const { count, session, reason } = _computeInsideGym();
    const el    = document.getElementById('statInsideGym');
    const meta  = document.getElementById('insideGymMeta');
    const pulse = document.getElementById('insidePulse');
    if (!el) return;
    el.textContent = count;
    if (reason === 'closed') {
        meta.textContent = 'Gym session not active right now';
        pulse.style.background = 'var(--text-muted)';
        pulse.style.animation  = 'none';
    } else {
        const nowMin     = new Date().getHours() * 60 + new Date().getMinutes();
        const slots      = _buildSlots(session);
        const activeSlot = slots.find(sl => nowMin >= sl.start && nowMin < sl.end);
        const slotLabel  = activeSlot
            ? ` • Slot ${_minToTimeStr(activeSlot.start)}–${_minToTimeStr(activeSlot.end)}`
            : '';
        const avgHours = (MAX_SESSION_MIN / 60).toFixed(1);
        meta.textContent = `${session.label}${slotLabel} • ${avgHours}h avg stay`;
        pulse.style.background = 'var(--success)';
        pulse.style.animation  = 'pulse 2s infinite';
    }
}

function showInsideModal() {
    const modal  = document.getElementById('insideGymModal');
    const listEl = document.getElementById('insideModalList');
    const metaEl = document.getElementById('insideModalMeta');
    const { members, session, reason } = _computeInsideGym();
    modal.style.display = 'flex';
    if (reason === 'closed') {
        metaEl.textContent = 'No active gym session right now';
    } else {
        const avgHours = (MAX_SESSION_MIN / 60).toFixed(1);
        const slots = _buildSlots(session);
        const slotLabels = slots.map(sl => `${_minToTimeStr(sl.start)}–${_minToTimeStr(sl.end)}`).join(' | ');
        metaEl.textContent = `${session.label}: ${_minToTimeStr(session.open)}–${_minToTimeStr(session.close)} • Slots: ${slotLabels} • Avg ${avgHours}h`;
    }
    if (members.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);">${reason === 'closed' ? '🔒 No active session right now.' : '🏋️ No members estimated inside right now.'}</div>`;
        return;
    }
    listEl.innerHTML = members.map(m => {
        const barPct   = Math.max(5, Math.round((m.minsLeft / MAX_SESSION_MIN) * 100));
        const barColor = m.minsLeft < 15 ? 'var(--danger)' : m.minsLeft < 30 ? 'var(--warning)' : 'var(--success)';
        return `<div style="padding:12px 0;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div><span style="font-weight:600;">${m.name}</span><span style="font-size:0.75rem;color:var(--text-muted);margin-left:8px;">#${m.pid}</span></div>
                <span style="font-size:0.78rem;color:${barColor};font-weight:600;">~${m.minsLeft}m left</span>
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);display:flex;gap:14px;">
                <span>Entry: <b>${m.entryTime}</b></span>
                <span>Est. exit: <b>${_minToTimeStr(m.estimatedExit)}</b></span>
                <span>Avg stay: <b>${(MAX_SESSION_MIN/60).toFixed(1)}h</b></span>
            </div>
            <div style="height:4px;background:var(--border);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${barPct}%;background:${barColor};border-radius:4px;"></div>
            </div>
        </div>`;
    }).join('');
}
window.showInsideModal = showInsideModal;

// ── Global Refresh ────────────────────────────────────────────
function refreshAll() {
    _recomputeDashboard();
    loadTodayPresentFromFirebase();
    _updateInsideGymCard();
}

// ── Diet Chart embedded nav ───────────────────────────────────
function showDietChart() {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('nav-diet').classList.add('active');
    const sec = document.getElementById('section-diet');
    sec.classList.add('active');
    const frame = document.getElementById('dietChartFrame');
    if (!frame.src || frame.src === window.location.href || frame.src === '') {
        frame.src = 'diet_chart.html';
    }
    document.getElementById('sidebar').classList.remove('open');
}

window.addEventListener('message', (e) => {
    if (e.data === 'goBack') {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.querySelector('[data-section="dashboard"]').classList.add('active');
        document.getElementById('section-dashboard').classList.add('active');
        document.getElementById('dietChartFrame').src = '';
    }
});
window.showDietChart = showDietChart;

// ── Expose globals ────────────────────────────────────────────
Object.assign(window, {
    refreshAll, updateDashboard: _recomputeDashboard,
    showToast
});

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    _applySettingsToUI();
    _subscribeSettings(() => {
        syncFromFirebase();
        _insideGymInterval = setInterval(_updateInsideGymCard, 60_000);
    });
});