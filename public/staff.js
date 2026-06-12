import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
    getFirestore, collection, addDoc, deleteDoc,
    updateDoc, doc, onSnapshot, serverTimestamp
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

let allStaff      = [];
let currentEditId = null;
let pendingDeleteId = null;

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Add/Edit Modal ─────────────────────────────────────────────
function openAddModal() {
    currentEditId = null;
    document.getElementById('modalTitle').textContent = 'Add Staff';
    document.getElementById('saveBtn').textContent    = 'Save';
    document.getElementById('staffForm').reset();
    document.getElementById('staffModal').classList.add('show');
}

function openEditModal(s) {
    currentEditId = s.id;
    document.getElementById('modalTitle').textContent    = 'Edit Staff';
    document.getElementById('saveBtn').textContent       = 'Update';
    document.getElementById('nameInput').value           = s.name    || '';
    document.getElementById('phoneInput').value          = s.phone   || '';
    document.getElementById('emailInput').value          = s.email   || '';
    document.getElementById('roleInput').value           = s.role    || '';
    document.getElementById('salaryInput').value         = s.salary  || '';
    document.getElementById('staffModal').classList.add('show');
}

function closeModal() {
    document.getElementById('staffModal').classList.remove('show');
    document.getElementById('staffForm').reset();
    currentEditId = null;
}

// ── Delete Modal ───────────────────────────────────────────────
function openDeleteModal(id) {
    const s = allStaff.find(x => x.id === id);
    pendingDeleteId = id;
    document.getElementById('delName').textContent = s ? `"${s.name}" will be permanently removed.` : 'This action cannot be undone.';
    document.getElementById('deleteModal').classList.add('show');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('show');
    pendingDeleteId = null;
}

document.getElementById('delCancelBtn').addEventListener('click', closeDeleteModal);
document.getElementById('deleteModal').addEventListener('click', e => { if (e.target === document.getElementById('deleteModal')) closeDeleteModal(); });

document.getElementById('delConfirmBtn').addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    const btn = document.getElementById('delConfirmBtn');
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
        await deleteDoc(doc(db, 'staff', pendingDeleteId));
        showToast('Staff member deleted');
        closeDeleteModal();
    } catch (err) {
        console.error(err);
        showToast('Error deleting staff', 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Delete';
    }
});

// ── Firebase listener ──────────────────────────────────────────
onSnapshot(collection(db, 'staff'), snapshot => {
    allStaff = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    applyFilter();
}, err => {
    console.error(err);
    showToast('Failed to load staff', 'error');
});

// ── Render ─────────────────────────────────────────────────────
function renderTable(list) {
    const tbody = document.getElementById('staffTableBody');
    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">No staff found</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(s => {
        const isPaid = (s.paymentStatus || '').toUpperCase() === 'PAID';
        return `<tr>
            <td class="name">${s.name || '—'}</td>
            <td>${s.phone || '—'}</td>
            <td>${s.role || '—'}</td>
            <td class="salary">₹${Number(s.salary || 0).toLocaleString('en-IN')}</td>
            <td><span class="badge ${isPaid ? 'paid' : 'unpaid'}">${isPaid ? 'PAID' : 'UNPAID'}</span></td>
            <td>
                <button class="btn btn-edit"   data-id="${s.id}" data-action="edit">Edit</button>
                <button class="btn ${isPaid ? 'btn-unpay' : 'btn-pay'}" data-id="${s.id}" data-action="pay" data-status="${s.paymentStatus || 'UNPAID'}">${isPaid ? 'Unpay' : 'Pay'}</button>
                <button class="btn btn-delete" data-id="${s.id}" data-action="delete">Delete</button>
            </td>
        </tr>`;
    }).join('');
}

// ── Table click delegation ─────────────────────────────────────
document.getElementById('staffTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id     = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'edit') {
        const s = allStaff.find(x => x.id === id);
        if (s) openEditModal(s);
    }
    else if (action === 'pay') {
        const current    = (btn.dataset.status || 'UNPAID').toUpperCase();
        const newStatus  = current === 'PAID' ? 'UNPAID' : 'PAID';
        btn.disabled = true;
        try {
            await updateDoc(doc(db, 'staff', id), { paymentStatus: newStatus });
            showToast(`Marked as ${newStatus}`);
        } catch (err) {
            console.error(err);
            showToast('Error updating payment status', 'error');
        } finally {
            btn.disabled = false;
        }
    }
    else if (action === 'delete') {
        openDeleteModal(id);
    }
});

// ── Filter ─────────────────────────────────────────────────────
function applyFilter() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    renderTable(allStaff.filter(s =>
        !search ||
        (s.name  || '').toLowerCase().includes(search) ||
        (s.phone || '').includes(search) ||
        (s.role  || '').toLowerCase().includes(search)
    ));
}
document.getElementById('searchInput').addEventListener('input', applyFilter);

// ── Form submit ────────────────────────────────────────────────
document.getElementById('staffForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name   = document.getElementById('nameInput').value.trim();
    const phone  = document.getElementById('phoneInput').value.trim();
    const email  = document.getElementById('emailInput').value.trim();
    const role   = document.getElementById('roleInput').value.trim();
    const salary = Number(document.getElementById('salaryInput').value);

    if (!name || !phone || !role || !salary) {
        showToast('Please fill all required fields', 'error'); return;
    }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    try {
        if (currentEditId) {
            await updateDoc(doc(db, 'staff', currentEditId), { name, phone, email, role, salary });
            showToast('Staff updated successfully');
        } else {
            await addDoc(collection(db, 'staff'), {
                name, phone, email, role, salary,
                paymentStatus: 'UNPAID',
                status: 'active',
                joinDate: serverTimestamp()
            });
            showToast('Staff added successfully');
        }
        closeModal();
    } catch (err) {
        console.error(err);
        showToast('Error saving staff', 'error');
    } finally {
        btn.disabled = false;
    }
});

// ── Events ─────────────────────────────────────────────────────
document.getElementById('addBtn').addEventListener('click', openAddModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
document.getElementById('staffModal').addEventListener('click', e => {
    if (e.target === document.getElementById('staffModal')) closeModal();
});
