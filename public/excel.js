// ════════════════════════════════════════════════════════════════
//  excel.js  —  Standalone Excel Import / Export for GYM Admin
//  Extracted from gym_owner_panel.js
//  All non-Excel logic is preserved below as commented reference
// ════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
    getFirestore, collection, getDocs, onSnapshot, addDoc, doc
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const XLSX = window.XLSX;

// ── Firebase init ─────────────────────────────────────────────
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
    members:          'members',
    attendance:       'attendance',
    fees:             'fees',
    sales:            'supplement_sales',
    supplements:      'supplements',
    equipment:        'equipment',
    staff:            'staff',
    zumba_members:    'zumba_members',
    zumba_attendance: 'zumba_attendance',
    zumba_fees:       'zumba_fees',
};

// ── Live Firebase state ───────────────────────────────────────
// (Only collections needed for export are loaded here)
let _fbMembers          = [];
let _fbFees             = [];
let _fbSales            = [];
let _fbAttendance       = [];
let _fbSupplements      = [];
let _fbEquipment        = [];
let _fbStaff            = [];
let _fbZumbaMembers     = [];
let _fbZumbaAttendance  = [];
let _fbZumbaFees        = [];

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

function pidOf(r) {
    return String(r.powerId || r.memberid || r['power id'] || '').trim();
}

function feeDate(f) {
    return f.paymentDate || f.lastpayment || f.date || f.month || '';
}

function _getMemberMap() {
    const map = new Map();
    _fbMembers.forEach(m => { const pid = pidOf(m); if (pid) map.set(pid, m); });
    return map;
}

// ── Toast ─────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, type) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMsg').textContent = msg;
    toast.className = 'toast show ' + (type || '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}
window.showToast = showToast;

// ════════════════════════════════════════════════════════════════
//  EXCEL EXPORT
// ════════════════════════════════════════════════════════════════

function _makeSheet(rows, colWidths) {
    const ws = XLSX.utils.json_to_sheet(rows);
    if (colWidths) ws['!cols'] = colWidths.map(w => ({ wch: w }));
    return ws;
}

function _attRowToExport(r, memberMap) {
    const pid    = pidOf(r) || '—';
    const member = (memberMap && pid !== '—')
        ? (memberMap.get(pid) || memberMap.get(String(Number(pid))) || {}) : {};
    const time   = r.time || r.checkintime ||
        (r.timestamp && typeof r.timestamp.toDate === 'function'
            ? r.timestamp.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
            : '') || '—';
    return {
        'Power ID': pid,
        'Name':     r.name    || member.name    || '—',
        'Date':     r.date    || '—',
        'CheckIn':  r.checkIn || r.checkin || '—',
        'Time':     time,
        'Shift':    r.shift   || '—',
        'Status':   r.status  || '—',
        'Package':  r.package || member.package || '—'
    };
}

function _sortByPowerId(rows, pidKey) {
    const k = pidKey || 'Power ID';
    return rows.slice().sort((a, b) => {
        const an = parseFloat(String(a[k] || '')), bn = parseFloat(String(b[k] || ''));
        return (!isNaN(an) && !isNaN(bn)) ? an - bn : String(a[k] || '').localeCompare(String(b[k] || ''));
    });
}

// ── Daily Attendance Export ───────────────────────────────────
function exportDailyAttendance() {
    const dateVal = document.getElementById('exportDailyDate').value;
    if (!dateVal) { showToast('Please select a date.', 'error'); return; }
    const day = _fbAttendance.filter(a => normalizeDate(a.date) === dateVal);
    if (!day.length) { showToast('No attendance for ' + dateVal, 'error'); return; }
    const memberMap = _getMemberMap();
    const sorted    = _sortByPowerId(day.map(r => _attRowToExport(r, memberMap)));
    const wb        = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, _makeSheet(sorted, [10, 22, 12, 10, 10, 10, 10, 16]), 'Daily Attendance');
    XLSX.writeFile(wb, 'Attendance_Daily_' + dateVal + '.xlsx');
    showToast('Exported daily attendance for ' + dateVal, 'success');
}
window.exportDailyAttendance = exportDailyAttendance;

// ── Monthly Attendance Export ─────────────────────────────────
function exportMonthlyAttendance() {
    const monthVal = document.getElementById('exportMonthlyMonth').value;
    if (!monthVal) { showToast('Please select a month.', 'error'); return; }
    const [y, m] = monthVal.split('-').map(Number);
    const monthly = _fbAttendance.filter(a => {
        const d = new Date(normalizeDate(a.date));
        return d.getFullYear() === y && d.getMonth() === m - 1;
    });
    if (!monthly.length) { showToast('No attendance for ' + monthVal, 'error'); return; }
    const memberMap = _getMemberMap();
    const sorted    = _sortByPowerId(monthly.map(r => _attRowToExport(r, memberMap)));
    const wb        = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, _makeSheet(sorted, [10, 22, 12, 10, 10, 10, 10, 16]), 'Monthly Attendance');
    XLSX.writeFile(wb, 'Attendance_Monthly_' + monthVal + '.xlsx');
    showToast('Exported monthly attendance for ' + monthVal, 'success');
}
window.exportMonthlyAttendance = exportMonthlyAttendance;

// ── Pending Fees Export ───────────────────────────────────────
function exportFeesPending() {
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const memberMap = _getMemberMap();
    const rows = _fbFees
        .filter(f => (f.status || '').toLowerCase() !== 'paid')
        .map(f => {
            const pid    = pidOf(f);
            const member = memberMap.get(pid) || {};
            const ds     = feeDate(f);
            const fDate  = ds ? new Date(normalizeDate(ds)) : null;
            return {
                'Power ID':        pid || '—',
                'Name':            f.name || member.name || '—',
                'Phone':           member.phone || '—',
                'Package':         f.package || member.package || '—',
                'Amount Due (₹)':  safeNum(f.amount),
                'Amount Paid (₹)': safeNum(f.amountPaid || 0),
                'Outstanding (₹)': safeNum((f.amount || 0) - (f.amountPaid || 0)),
                'Due Date':        ds || '—',
                'Status':          (fDate && fDate < monthStart) ? 'Overdue' : 'Unpaid'
            };
        });
    if (!rows.length) { showToast('No pending fees found.', 'error'); return; }
    const sortedRows = _sortByPowerId(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, _makeSheet(sortedRows, [10, 22, 14, 14, 14, 14, 14, 14, 10]), 'Pending Fees');
    XLSX.writeFile(wb, 'Fees_Pending_' + getLocalDateString() + '.xlsx');
    showToast('Exported pending fees.', 'success');
}
window.exportFeesPending = exportFeesPending;

// ── General Export ────────────────────────────────────────────
function exportData(type) {
    const wb = XLSX.utils.book_new();
    let hasData = false;
    const addSheet = (name, rows, widths) => {
        if (rows && rows.length) {
            XLSX.utils.book_append_sheet(wb, _makeSheet(rows, widths), name);
            hasData = true;
        }
    };

    // ── Members ──
    if (type === 'members' || type === 'all') {
        const memberMap  = _getMemberMap();
        const memberRows = _sortByPowerId(_fbMembers.map(m => {
            const pid            = pidOf(m);
            const memberFees     = _fbFees.filter(f => pidOf(f) === pid) || [];
            const paidFees       = memberFees.filter(f => (f.status || '').toLowerCase() === 'paid') || [];
            const pendingFeesList = memberFees.filter(f => (f.status || '').toLowerCase() === 'pending') || [];
            const totalPaid      = paidFees.reduce((s, f) => s + safeNum(f.amount || f.amountPaid || 0), 0);
            const totalPending   = pendingFeesList.reduce((s, f) => s + safeNum(f.amount || f.amountPaid || 0), 0);
            const pendingCount   = pendingFeesList.length;
            let monthlyFee       = safeNum(m.fee || m.monthlyFee || 0);
            if (!monthlyFee && memberFees.length > 0) {
                const amounts = memberFees.map(f => safeNum(f.amount || f.amountPaid || 0)).filter(a => a > 0);
                if (amounts.length > 0) monthlyFee = Math.max(...amounts);
            }
            return {
                'Power ID':          pid || '—',
                'Name':              m.name || '—',
                'Phone':             m.phone || '—',
                'Email':             m.email || '—',
                'Gender':            m.gender || '—',
                'Package':           m.package || '—',
                'Fitness Goal':      m.fitnessGoal || m.fitnessgoal || '—',
                'Status':            m.status || '—',
                'Join Date':         m.joinDate || m.joindate || '—',
                'Membership Days':   safeNum(m.membershipDays || m.membershipdays || 0),
                'Monthly Fee (₹)':   monthlyFee,
                'Total Paid (₹)':    totalPaid,
                'Total Pending (₹)': totalPending,
                'Pending Count':     pendingCount
            };
        }));
        addSheet('Members', memberRows, [10, 22, 14, 24, 10, 14, 18, 10, 12, 14, 12, 12, 12, 10]);
    }

    // ── Supplements ──
    if (type === 'supplements' || type === 'all')
        addSheet('Supplements', _fbSupplements.map(s => ({
            'Name': s.name || '—', 'Brand': s.brand || '—',
            'Price (₹)': safeNum(s.price || 0), 'Stock': safeNum(s.stock || 0)
        })), [24, 16, 12, 10]);

    // ── Equipment ──
    if (type === 'equipment' || type === 'all') {
        function _resolveEqDate(val) {
            if (!val) return '—';
            if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate().toISOString().slice(0, 10);
            if (val instanceof Date) return isNaN(val) ? '—' : val.toISOString().slice(0, 10);
            if (typeof val === 'object' && val.seconds) return new Date(val.seconds * 1000).toISOString().slice(0, 10);
            return normalizeDate(val) || String(val);
        }
        function _compressNotes(text) {
            if (!text || text === '—') return text || '—';
            const words = text.trim().split(/\s+/);
            if (words.length <= 10) return text;
            const lines = [];
            for (let i = 0; i < words.length; i += 10) lines.push(words.slice(i, i + 10).join(' '));
            return lines.join('\n');
        }
        const eqRows = _fbEquipment.slice()
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .map(e => ({
                'Name':          e.name || '—',
                'Type':          e.type || e.category || e.equipmentType || '—',
                'Quantity':      safeNum(e.quantity || e.qty || 0),
                'Condition':     e.condition || '—',
                'Purchase Date': _resolveEqDate(e.purchaseDate || e.purchasedate || e.bought || e.buydate || e.date || null),
                'Notes':         _compressNotes(e.notes || '—')
            }));
        const eqWs    = XLSX.utils.json_to_sheet(eqRows);
        eqWs['!cols'] = [22, 16, 10, 12, 14, 40].map(w => ({ wch: w }));
        const range   = XLSX.utils.decode_range(eqWs['!ref'] || 'A1');
        if (!eqWs['!rows']) eqWs['!rows'] = [];
        for (let R = range.s.r + 1; R <= range.e.r; R++) {
            const cellAddr = XLSX.utils.encode_cell({ r: R, c: 5 });
            const cell     = eqWs[cellAddr];
            if (cell && typeof cell.v === 'string' && cell.v.includes('\n')) {
                cell.t = 's';
                if (!eqWs['!rows'][R]) eqWs['!rows'][R] = {};
                eqWs['!rows'][R].hpx = Math.min(20 * Math.ceil(cell.v.split('\n').length * 1.4), 120);
            }
        }
        if (eqRows.length) { XLSX.utils.book_append_sheet(wb, eqWs, 'Equipment'); hasData = true; }
    }

    // ── Staff ──
    if (type === 'staff' || type === 'all')
        addSheet('Staff', _fbStaff.slice()
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .map(s => {
                const rawJoin = s.joinDate || s.joindate || s.startDate || s.startdate || s.joiningDate || s.joiningdate || '';
                let joinDateStr = '—';
                if (rawJoin) {
                    if (typeof rawJoin.toDate === 'function')       joinDateStr = rawJoin.toDate().toISOString().slice(0, 10);
                    else if (rawJoin instanceof Date)               joinDateStr = rawJoin.toISOString().slice(0, 10);
                    else                                            joinDateStr = normalizeDate(rawJoin) || String(rawJoin);
                }
                return {
                    'Name':           s.name || '—',
                    'Role':           s.role || s.designation || '—',
                    'Phone':          s.phone || s.mobile || '—',
                    'Email':          s.email || s.emailAddress || '—',
                    'Salary (₹)':     safeNum(s.salary || 0),
                    'Join Date':      joinDateStr,
                    'Status':         s.status || s.employmentStatus || '—',
                    'Payment Status': s.paymentStatus || '—'
                };
            }), [22, 16, 14, 28, 12, 12, 10, 14]);

    // ── Fees ──
    if (type === 'fees' || type === 'all') {
        const memberMap = _getMemberMap();
        addSheet('Fees', _sortByPowerId(_fbFees.map(f => {
            const pid    = pidOf(f);
            const member = memberMap.get(pid) || {};
            return {
                'Power ID':         pid || '—',
                'Name':             f.name || member.name || '—',
                'Package':          f.package || member.package || '—',
                'Amount (₹)':       safeNum(f.amount || f.amountPaid || 0),
                'Amount Paid (₹)':  safeNum(f.amountPaid || 0),
                'Payment Date':     f.paymentDate || f.date || '—',
                'Status':           f.status || '—',
                'Due Date':         f.dueDate || feeDate(f) || '—'
            };
        })), [10, 22, 14, 12, 14, 14, 10, 12]);
    }

    // ── Supplement Sales ──
    if (type === 'sales' || type === 'all')
        addSheet('Supplement Sales', _fbSales.map(s => ({
            'Date':          s.date || '—',
            'Supplement':    s.supplement || s.supplementName || s.name || '—',
            'Quantity':      safeNum(s.quantity || 0),
            'Unit Price (₹)': safeNum(s.unitPrice || 0),
            'Total (₹)':     safeNum(s.totalAmount || 0)
        })), [12, 22, 10, 14, 12]);

    // ── Zumba Members ──
    if (type === 'zumba_members' || type === 'all')
        addSheet('Zumba Members', _sortByPowerId(_fbZumbaMembers.map(m => {
            const joinedDateStr  = m.joinedDate && typeof m.joinedDate.toDate === 'function'
                ? m.joinedDate.toDate().toISOString().slice(0, 10) : (m.joinedDate ? normalizeDate(m.joinedDate) : '—');
            const lastPaymentStr = m.lastPayment && typeof m.lastPayment.toDate === 'function'
                ? m.lastPayment.toDate().toISOString().slice(0, 10) : (m.lastPayment ? normalizeDate(m.lastPayment) : '—');
            return {
                'Power ID':       pidOf(m) || '—',
                'Name':           m.name || '—',
                'Phone':          m.phone || '—',
                'Email':          m.email || '—',
                'Package':        m.package || '—',
                'Fee (₹)':        safeNum(m.fee || 0),
                'Fitness Goal':   m.fitnessGoal || '—',
                'Status':         m.status || '—',
                'Join Date':      m.joinDate || '—',
                'Joined Date':    joinedDateStr,
                'Last Payment':   lastPaymentStr,
                'Membership Days': safeNum(m.membershipDays || 0)
            };
        })), [10, 22, 14, 24, 14, 10, 16, 10, 12, 12, 12, 14]);

    // ── Zumba Attendance ──
    if (type === 'zumba_attendance' || type === 'all')
        addSheet('Zumba Attendance', _sortByPowerId(_fbZumbaAttendance.map(a => ({
            'Power ID': pidOf(a) || '—',
            'Name':     a.name   || '—',
            'Date':     a.date   || '—',
            'Time':     a.time   || '—',
            'Status':   a.status || '—'
        }))), [10, 22, 12, 10, 10]);

    // ── Zumba Fees ──
    if (type === 'zumba_fees' || type === 'all')
        addSheet('Zumba Fees', _sortByPowerId(_fbZumbaFees.map(f => ({
            'Power ID':      f.powerId      || '—',
            'Name':          f.name         || '—',
            'Amount (₹)':    safeNum(f.amount || 0),
            'Date':          f.date         || '—',
            'Payment Date':  f.paymentDate  || f.date || '—',
            'Package':       f.package      || '—',
            'Status':        f.status       || '—',
            'Next Payment':  f.nextPayment  || '—',
            'Month':         f.month        || '—',
            'Member ID':     f.memberId     || '—'
        }))), [10, 22, 12, 12, 12, 14, 10, 14, 10, 26]);

    if (!hasData) { showToast('No data to export for: ' + type, 'error'); return; }
    const fname = type === 'all'
        ? `GymAdmin_Export_${getLocalDateString()}.xlsx`
        : `GymAdmin_${type.charAt(0).toUpperCase() + type.slice(1)}_${getLocalDateString()}.xlsx`;
    XLSX.writeFile(wb, fname);
    showToast('Exported successfully.', 'success');
}
window.exportData = exportData;

// ════════════════════════════════════════════════════════════════
//  EXCEL IMPORT
// ════════════════════════════════════════════════════════════════

async function saveToFirestore(colName, records) {
    let added = 0, skipped = 0;
    for (const record of records) {
        try { await addDoc(collection(db, colName), record); added++; }
        catch (e) { console.error(`addDoc error [${colName}]:`, e); skipped++; }
    }
    return { added, skipped };
}

async function _fbKeySet(colName, keyFn) {
    const snap = await getDocs(collection(db, colName)).catch(() => null);
    const s    = new Set();
    if (snap) snap.forEach(d => { const k = keyFn(d.data()); if (k) s.add(k); });
    return s;
}

async function handleExcelImport(input, forceType) {
    const file = input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('importStatus');
    statusEl.style.display = 'block';
    statusEl.style.color   = 'var(--text-muted)';
    statusEl.textContent   = '⏳ Reading file…';

    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const wb       = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
            const rows     = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).map(normalizeKeys);
            const imported = [];
            const now      = new Date().toISOString();

            // ── Attendance ──
            if (forceType === 'attendance') {
                const fbKeys   = await _fbKeySet(COL.attendance, r => (r.powerId && r.date) ? `${r.powerId}|${r.date}` : null);
                const seen     = new Set(fbKeys);
                const toInsert = [];
                for (const r of rows) {
                    const powerId = String(pick(r, 'powerid', 'power id', 'memberid', 'member id', 'id') || '').trim();
                    const date    = normalizeDate(pick(r, 'date', 'attendancedate', 'datetime'));
                    if (!powerId || !date) continue;
                    const key = `${powerId}|${date}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    toInsert.push({
                        powerId,
                        name:    String(pick(r, 'name', 'membername', 'member name') || '').trim(),
                        date,
                        status:  String(pick(r, 'status', 'attendancestatus') || 'present').toLowerCase().trim(),
                        time:    String(pick(r, 'time', 'checkintime', 'intime') || '').trim(),
                        checkIn: String(pick(r, 'checkin', 'check in', 'checkintime') || '').trim(),
                        shift:   String(pick(r, 'shift', 'session', 'batch') || '').trim()
                    });
                }
                const res = await saveToFirestore(COL.attendance, toInsert);
                imported.push(`✅ attendance: ${res.added} added → Firebase`);

            // ── Members ──
            } else if (forceType === 'members') {
                const fbMemberIds = await _fbKeySet(COL.members, r => r.powerId ? String(r.powerId).trim() : null);
                const fbFeeKeys   = await _fbKeySet(COL.fees, r => (r.powerId && r.paymentDate) ? `${r.powerId}|${r.paymentDate}` : null);
                const seenM = new Set(fbMemberIds), seenF = new Set(fbFeeKeys);
                const newMembers = [], newFees = [];
                for (const r of rows) {
                    const powerId        = String(pick(r, 'powerid', 'power id', 'memberid', 'member id', 'id') || '').trim();
                    const name           = String(pick(r, 'name', 'membername', 'member name', 'fullname') || '').trim();
                    if (!powerId || !name) continue;
                    const phone          = String(pick(r, 'phone', 'mobile', 'contact', 'phonenumber') || '').trim();
                    const email          = String(pick(r, 'email', 'emailaddress', 'e-mail') || '').trim();
                    const pkg            = String(pick(r, 'package', 'plan', 'membership', 'packagename') || '').trim();
                    const fitnessGoal    = String(pick(r, 'fitnessgoal', 'fitness goal', 'goal') || '').trim();
                    const status         = String(pick(r, 'status', 'memberstatus') || 'active').toLowerCase().trim();
                    const joinDate       = normalizeDate(pick(r, 'joindate', 'joined', 'join date', 'startdate', 'start date'));
                    const membershipDays = safeNum(pick(r, 'membershipdays', 'membership days', 'duration', 'days'));
                    const feeAmount      = safeNum(pick(r, 'fee', 'fees', 'amount', 'monthlyfee', 'monthly fee'));
                    const lastPayment    = normalizeDate(pick(r, 'lastpayment', 'last payment', 'lastpaid', 'paiddate', 'paid date'));
                    const gender = String(pick(r, 'gender', 'sex') || '').trim();
                    if (!seenM.has(powerId)) {
                        newMembers.push({ powerId, name, phone, email, package: pkg, fitnessGoal, gender, status, joinDate, membershipDays, fee: feeAmount });
                        seenM.add(powerId);
                    }
                    if (feeAmount > 0 || lastPayment) {
                        const pd     = lastPayment || getLocalDateString();
                        const feeKey = `${powerId}|${pd}`;
                        if (!seenF.has(feeKey)) {
                            newFees.push({ powerId, name, amount: feeAmount, paymentDate: pd, package: pkg, status: 'paid' });
                            seenF.add(feeKey);
                        }
                    }
                }
                const mRes = await saveToFirestore(COL.members, newMembers);
                const fRes = await saveToFirestore(COL.fees, newFees);
                imported.push(`✅ members: ${mRes.added} added → Firebase`);
                if (newFees.length) imported.push(`✅ fees: ${fRes.added} added → Firebase`);

            // ── Supplements ──
            } else if (forceType === 'supplements') {
                const toInsert = [];
                for (const r of rows) {
                    const name = String(pick(r, 'name', 'supplement', 'supplementname', 'product') || '').trim();
                    if (!name) continue;
                    toInsert.push({
                        name,
                        brand:      String(pick(r, 'brand', 'brandname', 'company') || '').trim(),
                        price:      safeNum(pick(r, 'price', 'rate', 'cost', 'mrp')),
                        stock:      safeNum(pick(r, 'stock', 'quantity', 'qty', 'units')),
                        importedAt: now
                    });
                }
                const res = await saveToFirestore(COL.supplements, toInsert);
                imported.push(`✅ supplements: ${res.added} added → Firebase`);

            // ── Equipment ──
            } else if (forceType === 'equipment') {
                const toInsert = [];
                for (const r of rows) {
                    const name = String(pick(r, 'name', 'equipment', 'equipmentname', 'machine') || '').trim();
                    if (!name) continue;
                    toInsert.push({
                        name,
                        category:     String(pick(r, 'category', 'type', 'equipmenttype') || '').trim(),
                        quantity:     safeNum(pick(r, 'quantity', 'qty', 'count', 'units')),
                        condition:    String(pick(r, 'condition', 'status', 'state') || '').trim(),
                        purchaseDate: normalizeDate(pick(r, 'purchasedate', 'purchase date', 'bought', 'buydate', 'date')),
                        notes:        String(pick(r, 'notes', 'remarks', 'description', 'comment') || '').trim(),
                        importedAt:   now
                    });
                }
                const res = await saveToFirestore(COL.equipment, toInsert);
                imported.push(`✅ equipment: ${res.added} added → Firebase`);

            // ── Supplement Sales ──
            } else if (forceType === 'sales') {
                const toInsert = [];
                for (const r of rows) {
                    const supplement = String(pick(r, 'supplement', 'supplementname', 'supplement name', 'product', 'name', 'item') || '').trim();
                    if (!supplement) continue;
                    const quantity  = safeNum(pick(r, 'quantity', 'qty', 'units', 'sold'));
                    const unitPrice = safeNum(pick(r, 'unitprice', 'unit price', 'price', 'rate', 'perprice'));
                    const total     = safeNum(pick(r, 'totalamount', 'total amount', 'total', 'amount'));
                    toInsert.push({
                        date:        normalizeDate(pick(r, 'date', 'saledate', 'sale date', 'orderdate')) || getLocalDateString(),
                        supplement,
                        quantity,
                        unitPrice,
                        totalAmount: total || (quantity * unitPrice),
                        importedAt:  now
                    });
                }
                const res = await saveToFirestore(COL.sales, toInsert);
                imported.push(`✅ supplement sales: ${res.added} added → Firebase (supplement_sales)`);

            // ── Staff ──
            } else if (forceType === 'staff') {
                const fbKeys   = await _fbKeySet(COL.staff, r => `${(r.name || '').toLowerCase()}|${r.phone || r.mobile || ''}`);
                const seen     = new Set(fbKeys);
                const toInsert = [];
                for (const r of rows) {
                    const name  = String(pick(r, 'name', 'staffname', 'staff name', 'fullname', 'employee') || '').trim();
                    if (!name) continue;
                    const phone = String(pick(r, 'phone', 'mobile', 'contact', 'phonenumber', 'phone number') || '').trim();
                    const key   = `${name.toLowerCase()}|${phone}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    toInsert.push({
                        name, phone,
                        role:          String(pick(r, 'role', 'designation', 'position', 'title', 'jobtitle', 'job title') || '').trim(),
                        email:         String(pick(r, 'email', 'emailaddress', 'e-mail') || '').trim(),
                        salary:        safeNum(pick(r, 'salary', 'pay', 'wage', 'monthlysalary', 'monthly salary')),
                        joinDate:      normalizeDate(pick(r, 'joindate', 'join date', 'joiningdate', 'startdate', 'start date', 'joined')),
                        status:        String(pick(r, 'status', 'employmentstatus') || 'active').trim(),
                        paymentStatus: String(pick(r, 'paymentstatus', 'payment status', 'salarystatus') || 'UNPAID').toUpperCase().trim(),
                        importedAt:    now
                    });
                }
                const res = await saveToFirestore(COL.staff, toInsert);
                imported.push(`✅ staff: ${res.added} added → Firebase`);

            // ── Zumba Members ──
            } else if (forceType === 'zumba_members') {
                const fbKeys   = await _fbKeySet(COL.zumba_members, r => r.powerId ? String(r.powerId).trim() : null);
                const seen     = new Set(fbKeys);
                const toInsert = [];
                for (const r of rows) {
                    const powerId = String(pick(r, 'powerid', 'power id', 'memberid', 'id') || '').trim();
                    const name    = String(pick(r, 'name', 'membername', 'fullname') || '').trim();
                    if (!powerId || !name) continue;
                    if (seen.has(powerId)) continue;
                    seen.add(powerId);
                    const zJoinDateStr = normalizeDate(pick(r, 'joindate', 'join date', 'joined', 'startdate'));
                    const zJoinedDate  = zJoinDateStr ? new Date(zJoinDateStr) : null;
                    const zLastPayStr  = normalizeDate(pick(r, 'lastpayment', 'last payment', 'lastpaid', 'paiddate'));
                    const zLastPayDate = zLastPayStr  ? new Date(zLastPayStr)  : null;
                    toInsert.push({
                        powerId,
                        name,
                        phone:          String(pick(r, 'phone', 'mobile', 'contact') || '').trim(),
                        email:          String(pick(r, 'email', 'emailaddress') || '').trim(),
                        package:        String(pick(r, 'package', 'plan', 'membership') || '').trim(),
                        fee:            safeNum(pick(r, 'fee', 'fees', 'amount')),
                        fitnessGoal:    String(pick(r, 'fitnessgoal', 'fitness goal', 'goal') || 'Zumba').trim(),
                        status:         String(pick(r, 'status') || 'active').toLowerCase().trim(),
                        joinDate:       zJoinDateStr,
                        joinedDate:     zJoinedDate,
                        lastPayment:    zLastPayDate,
                        membershipDays: safeNum(pick(r, 'membershipdays', 'membership days', 'days', 'duration')),
                        importedAt:     now
                    });
                }
                const res = await saveToFirestore(COL.zumba_members, toInsert);
                imported.push(`✅ zumba members: ${res.added} added → Firebase`);

            // ── Zumba Attendance ──
            } else if (forceType === 'zumba_attendance') {
                const fbKeys   = await _fbKeySet(COL.zumba_attendance, r => (r.powerId && r.date) ? `${r.powerId}|${r.date}` : null);
                const seen     = new Set(fbKeys);
                const toInsert = [];
                for (const r of rows) {
                    const powerId = String(pick(r, 'powerid', 'power id', 'memberid', 'id') || '').trim();
                    const date    = normalizeDate(pick(r, 'date', 'attendancedate'));
                    if (!powerId || !date) continue;
                    const key = `${powerId}|${date}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    toInsert.push({
                        powerId,
                        name:   String(pick(r, 'name', 'membername') || '').trim(),
                        date,
                        status: String(pick(r, 'status') || 'present').toLowerCase().trim(),
                        time:   String(pick(r, 'time', 'checkintime') || '').trim()
                    });
                }
                const res = await saveToFirestore(COL.zumba_attendance, toInsert);
                imported.push(`✅ zumba attendance: ${res.added} added → Firebase`);

            // ── Zumba Fees ──
            } else if (forceType === 'zumba_fees') {
                const fbKeys   = await _fbKeySet(COL.zumba_fees, r => (r.powerId && r.date) ? `${r.powerId}|${r.date}` : null);
                const seen     = new Set(fbKeys);
                const toInsert = [];
                for (const r of rows) {
                    const powerId = String(pick(r, 'powerid', 'power id') || '').trim();
                    const date    = normalizeDate(pick(r, 'date', 'paymentdate', 'payment date')) || getLocalDateString();
                    if (!powerId) continue;
                    const key = `${powerId}|${date}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    toInsert.push({
                        powerId,
                        name:        String(pick(r, 'name', 'membername') || '').trim(),
                        amount:      safeNum(pick(r, 'amount', 'fee', 'fees')),
                        date,
                        paymentDate: normalizeDate(pick(r, 'paymentdate', 'payment date', 'date')) || date,
                        package:     String(pick(r, 'package', 'plan') || '').trim(),
                        status:      String(pick(r, 'status') || 'paid').toLowerCase().trim(),
                        nextPayment: normalizeDate(pick(r, 'nextpayment', 'next payment', 'nextdue', 'duedate')),
                        month:       String(pick(r, 'month') || date.slice(0, 7)).trim(),
                        memberId:    String(pick(r, 'memberid', 'member id', 'docid') || '').trim(),
                        importedAt:  now
                    });
                }
                const res = await saveToFirestore(COL.zumba_fees, toInsert);
                imported.push(`✅ zumba fees: ${res.added} added → Firebase`);
            }

            statusEl.style.color = imported.length ? 'var(--success)' : 'var(--danger)';
            statusEl.textContent = imported.length ? imported.join(' | ') : '❌ No matching data found.';
            showToast(imported.length ? 'Import successful!' : 'No data imported.', imported.length ? 'success' : 'error');
            updateDataStatus(); // refresh counts after import

        } catch (err) {
            console.error('Import error:', err);
            statusEl.style.color = 'var(--danger)';
            statusEl.textContent = '❌ Error: ' + err.message;
            showToast('Import failed. Check file format.', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
}
window.handleExcelImport = handleExcelImport;

// ════════════════════════════════════════════════════════════════
//  DATA STATUS + CLEAR
// ════════════════════════════════════════════════════════════════

function updateDataStatus() {
    const counts = {
        members:          _fbMembers.length,
        attendance:       _fbAttendance.length,
        fees:             _fbFees.length,
        staff:            _fbStaff.length,
        supplements:      _fbSupplements.length,
        equipment:        _fbEquipment.length,
        sales:            _fbSales.length,
        zumba_members:    _fbZumbaMembers.length,
        zumba_attendance: _fbZumbaAttendance.length,
        zumba_fees:       _fbZumbaFees.length,
    };
    document.getElementById('dataStatusList').innerHTML = Object.entries(counts).map(([t, n]) =>
        `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
            <span style="text-transform:capitalize;">${t.replace('_', ' ')}</span>
            <span style="color:${n > 0 ? 'var(--success)' : 'var(--text-muted)'};font-weight:600;">${n} records</span>
        </div>`
    ).join('');
}
window.updateDataStatus = updateDataStatus;

function clearAllData() {
    if (!confirm('Clear ALL stored data? This cannot be undone.')) return;
    showToast('Use Firebase console to delete records directly.', 'error');
}
window.clearAllData = clearAllData;

// ════════════════════════════════════════════════════════════════
//  FIREBASE SYNC  (loads all collections for export)
// ════════════════════════════════════════════════════════════════

function syncFromFirebase() {
    const listen = (colName, setter) =>
        onSnapshot(collection(db, colName),
            snap => { setter(snap.docs.map(d => ({ id: d.id, ...d.data() }))); updateDataStatus(); },
            err  => console.warn(colName + ' onSnapshot error:', err)
        );

    listen(COL.members,          v => _fbMembers         = v);
    listen(COL.attendance,       v => _fbAttendance      = v);
    listen(COL.fees,             v => _fbFees            = v);
    listen(COL.sales,            v => _fbSales           = v);
    listen(COL.supplements,      v => _fbSupplements     = v);
    listen(COL.equipment,        v => _fbEquipment       = v);
    listen(COL.staff,            v => _fbStaff           = v);
    listen(COL.zumba_members,    v => _fbZumbaMembers    = v);
    listen(COL.zumba_attendance, v => _fbZumbaAttendance = v);
    listen(COL.zumba_fees,       v => _fbZumbaFees       = v);
}

// ════════════════════════════════════════════════════════════════
//  SETTINGS  (gym name in footer)
// ════════════════════════════════════════════════════════════════

function loadGymName() {
    onSnapshot(doc(db, 'gym_settings', 'config'), snap => {
        if (snap.exists()) {
            const name = snap.data().gymName || 'GYM Admin Panel';
            const el   = document.getElementById('gymNameFooter');
            if (el) el.textContent = name;
            document.title = name + ' — Excel';
        }
    }, () => {});
}

// ════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Set date pickers to today / current month
    const now  = new Date();
    const yyyy = now.getFullYear();
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const dd   = String(now.getDate()).padStart(2, '0');
    const set  = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('exportDailyDate',    `${yyyy}-${mm}-${dd}`);
    set('exportMonthlyMonth', `${yyyy}-${mm}`);

    loadGymName();
    syncFromFirebase();
});

// ════════════════════════════════════════════════════════════════
//  COMMENTED REFERENCE — Non-Excel code from gym_owner_panel.js
//  (kept here for linkage context; not active in this file)
// ════════════════════════════════════════════════════════════════

/*
// ── Dashboard ─────────────────────────────────────────────────
// function _recomputeDashboard() { ... }
// → Handles: statTotalMembers, statActiveMembers, statPausedMembers,
//   statLeftMembers, statTodayPresent, statMonthlyRevenue,
//   statRevenueFees, statRevenueSales, statUnpaidFees, statUnpaidCount,
//   statEquipmentCount, _updateInsideGymCard()

// ── Today Present Table ───────────────────────────────────────
// function loadTodayPresentFromFirebase() { ... }
// → onSnapshot on attendance where date == today
// → Populates #todayPresentBody and #todayPresentBadge

// ── Inside Gym Now ────────────────────────────────────────────
// let MAX_SESSION_MIN = 90;
// function _computeInsideGym() { ... }
// function _updateInsideGymCard() { ... }
// function showInsideModal() { ... }
// → Reads gym timing from gym_settings/config (gymTiming nested object)
// → Uses morningOpen/Close, eveningOpen/Close, sundayStatus/open/close
// → Calculates who is currently inside based on attendance + session window

// ── Settings Listener ─────────────────────────────────────────
// function _subscribeSettings(onFirstLoad) { ... }
// → onSnapshot on gym_settings/config
// → Reads gymName, gymTiming, avg_time_spent_on_gym_by_member
// → Sets MAX_SESSION_MIN, applies UI gym name

// ── Navigation ────────────────────────────────────────────────
// REDIRECT_SECTIONS = { members, attendance, fees, supplements,
//   equipment, sales, staff, settings, reports }
// ALLOWED = ['dashboard', 'excel']
// → .nav-item click either redirects or toggles active section

// ── Diet Chart ────────────────────────────────────────────────
// function showDietChart() { ... }
// → Activates section-diet, loads diet_chart.html in #dietChartFrame
// → Listens for postMessage 'goBack' to return to dashboard

// ── Global Refresh ────────────────────────────────────────────
// function refreshAll() { ... }
// → Calls _recomputeDashboard, updateDataStatus,
//   loadTodayPresentFromFirebase, _updateInsideGymCard

// ── Cache ─────────────────────────────────────────────────────
// _cache = { memberMap, activeMembers, paidSetThisMonth }
// function _invalidateCache() / _getMemberMap() / _getActiveMembers() / _getPaidSetThisMonth()
*/
