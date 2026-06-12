import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
    getFirestore, doc, onSnapshot, setDoc
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

// ── In-memory settings (raw Firebase shape) ───────────────────
let _settings = {};

// ── Read helpers ──────────────────────────────────────────────
function getSetting(key, fallback = '') {
    return _settings[key] !== undefined ? String(_settings[key]) : (localStorage.getItem('gym_setting_' + key) ?? fallback);
}
function getTimingSetting(key, fallback = '') {
    const t = _settings.gymTiming || {};
    return t[key] !== undefined ? String(t[key]) : (localStorage.getItem('gym_timing_' + key) ?? fallback);
}
function getSundaySetting(key, fallback = '') {
    const s = (_settings.gymTiming || {}).sunday || {};
    return s[key] !== undefined ? String(s[key]) : (localStorage.getItem('gym_sunday_' + key) ?? fallback);
}

// ── Apply settings to UI ──────────────────────────────────────
function _applySettingsToUI() {
    ['gymName', 'ownerName', 'phone', 'address'].forEach(k => {
        const el = document.getElementById('setting' + k.charAt(0).toUpperCase() + k.slice(1));
        if (el) el.value = getSetting(k, '');
    });

    ['morningOpen', 'morningClose', 'eveningOpen', 'eveningClose'].forEach(k => {
        const el = document.getElementById('setting' + k.charAt(0).toUpperCase() + k.slice(1));
        if (el) el.value = getTimingSetting(k, '');
    });

    ['morningOpenAmpm', 'morningCloseAmpm', 'eveningOpenAmpm', 'eveningCloseAmpm', 'sundayOpenAmpm', 'sundayCloseAmpm'].forEach(k => {
        const el = document.getElementById('setting' + k.charAt(0).toUpperCase() + k.slice(1));
        if (el) { const v = getSetting(k, ''); if (v) el.value = v; }
    });

    const sundayOpenEl  = document.getElementById('settingSundayOpen');
    const sundayCloseEl = document.getElementById('settingSundayClose');
    if (sundayOpenEl)  sundayOpenEl.value  = getSundaySetting('open', '');
    if (sundayCloseEl) sundayCloseEl.value = getSundaySetting('close', '');

    const sundayStatus = document.getElementById('sundayStatus');
    if (sundayStatus) sundayStatus.value = getSundaySetting('status', 'closed');

    ['feeReminder', 'membershipAlert', 'stockAlert'].forEach(k => {
        const el = document.getElementById('toggle' + k.charAt(0).toUpperCase() + k.slice(1));
        if (el) el.classList.toggle('active', getSetting(k) === 'true');
    });

    _updateSundayVisibility();

    const gymName = getSetting('gymName', 'GYM Admin Panel') || 'GYM Admin Panel';
    document.getElementById('gymNameFooter').textContent = gymName;
    document.title = 'Settings — ' + gymName;
}

// ── Sunday visibility ─────────────────────────────────────────
function _updateSundayVisibility() {
    const val = document.getElementById('sundayStatus')?.value;
    document.getElementById('sundayTimingFields').style.display = val === 'open' ? 'block' : 'none';
}

// ── Cache helpers ─────────────────────────────────────────────
function _cacheSettings(data) {
    const timing  = (data.gymTiming && typeof data.gymTiming === 'object') ? data.gymTiming : {};
    const sunday  = (timing.sunday  && typeof timing.sunday  === 'object') ? timing.sunday  : {};

    ['gymName', 'ownerName', 'phone', 'address', 'feeReminder', 'membershipAlert', 'stockAlert'].forEach(k => {
        if (data[k] !== undefined && data[k] !== null)
            localStorage.setItem('gym_setting_' + k, String(data[k]));
    });
    ['morningOpen', 'morningClose', 'eveningOpen', 'eveningClose'].forEach(k => {
        if (timing[k] !== undefined) localStorage.setItem('gym_timing_' + k, String(timing[k]));
    });
    ['open', 'close', 'status'].forEach(k => {
        if (sunday[k] !== undefined) localStorage.setItem('gym_sunday_' + k, String(sunday[k]));
    });
}

// ── Subscribe to Firebase settings ───────────────────────────
function _subscribeSettings() {
    const syncDot   = document.getElementById('syncDot');
    const syncLabel = document.getElementById('syncLabel');

    syncDot.classList.add('syncing');
    syncLabel.textContent = 'Connecting…';

    onSnapshot(doc(db, 'gym_settings', 'config'), snap => {
        syncDot.classList.remove('syncing');
        syncLabel.textContent = 'Live sync';

        if (snap.exists()) {
            _settings = snap.data();
            _cacheSettings(_settings);
        }
        _applySettingsToUI();
    }, err => {
        console.warn('settings onSnapshot error:', err);
        syncDot.style.background = 'var(--danger)';
        syncLabel.textContent = 'Offline';
        _applySettingsToUI();
    });
}

// ── Helper: convert "12:30" + "AM"/"PM" → 24h string ────────
function to24h(timeVal, ampm) {
    if (!timeVal) return '';
    const [hStr, mStr] = timeVal.split(':');
    let h = parseInt(hStr), m = parseInt(mStr) || 0;
    if (isNaN(h)) return timeVal;
    const period = (ampm || '').toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── Save settings ─────────────────────────────────────────────
async function saveSettings() {
    // ── Root fields ──────────────────────────────────────────
    const gymName   = document.getElementById('settingGymName')?.value.trim()   ?? getSetting('gymName');
    const ownerName = document.getElementById('settingOwnerName')?.value.trim() ?? getSetting('ownerName');
    const phone     = document.getElementById('settingPhone')?.value.trim()     ?? getSetting('phone');
    const address   = document.getElementById('settingAddress')?.value.trim()   ?? getSetting('address');

    // ── gymTiming fields — converted to 24h before saving ───
    const morningOpen  = to24h(
        document.getElementById('settingMorningOpen')?.value.trim(),
        document.getElementById('settingMorningOpenAmpm')?.value
    );
    const morningClose = to24h(
        document.getElementById('settingMorningClose')?.value.trim(),
        document.getElementById('settingMorningCloseAmpm')?.value
    );
    const eveningOpen  = to24h(
        document.getElementById('settingEveningOpen')?.value.trim(),
        document.getElementById('settingEveningOpenAmpm')?.value
    );
    const eveningClose = to24h(
        document.getElementById('settingEveningClose')?.value.trim(),
        document.getElementById('settingEveningCloseAmpm')?.value
    );

    // ── Sunday ───────────────────────────────────────────────
    const sundayOpen   = to24h(
        document.getElementById('settingSundayOpen')?.value.trim(),
        document.getElementById('settingSundayOpenAmpm')?.value
    );
    const sundayClose  = to24h(
        document.getElementById('settingSundayClose')?.value.trim(),
        document.getElementById('settingSundayCloseAmpm')?.value
    );
    const sundayStatus = document.getElementById('sundayStatus')?.value ?? getSundaySetting('status', 'closed');

    // ── Toggle states ────────────────────────────────────────
    const feeReminder     = getSetting('feeReminder',     'false');
    const membershipAlert = getSetting('membershipAlert', 'false');
    const stockAlert      = getSetting('stockAlert',      'false');

    // ── Build payload ────────────────────────────────────────
    const payload = {
        gymName,
        ownerName,
        phone,
        address,
        feeReminder,
        membershipAlert,
        stockAlert,
        gymTiming: {
            morningOpen,
            morningClose,
            eveningOpen,
            eveningClose,
            sunday: {
                open:   sundayOpen,
                close:  sundayClose,
                status: sundayStatus,
            },
        },
    };

    if (_settings.createdAt) payload.createdAt = _settings.createdAt;

    try {
        await setDoc(doc(db, 'gym_settings', 'config'), payload, { merge: true });
        showToast('Settings saved!', 'success');
    } catch (e) {
        console.error('Settings save error:', e);
        showToast('Save failed. Check connection.', 'error');
    }
}

// ── Toggle notification setting ───────────────────────────────
function toggleSetting(key) {
    const el = document.getElementById('toggle' + key.charAt(0).toUpperCase() + key.slice(1));
    if (!el) return;
    const newVal = String(!el.classList.contains('active'));
    el.classList.toggle('active', newVal === 'true');

    setDoc(doc(db, 'gym_settings', 'config'), { [key]: newVal }, { merge: true })
        .catch(e => console.warn('toggleSetting error:', e));
}

// ── Clear all data ────────────────────────────────────────────
function clearAllData() {
    if (!confirm('Clear ALL stored data? This cannot be undone.')) return;
    showToast('Use Firebase console to delete records directly.', 'error');
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

// ── Expose globals ────────────────────────────────────────────
Object.assign(window, { saveSettings, toggleSetting, clearAllData, showToast });

// ── Mobile sidebar ────────────────────────────────────────────
document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('sundayStatus').addEventListener('change', _updateSundayVisibility);

// ── Init ──────────────────────────────────────────────────────
_applySettingsToUI();
_subscribeSettings();