import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
    getFirestore,
    collection,
    getDocs,
    addDoc,
    deleteDoc,
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
    appId: "1:294864961933:web:61d6c4086c09a506bf3dc4",
    measurementId: "G-XSBFDNVXKD"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

const tableBody   = document.getElementById('tableBody');
const searchInput = document.getElementById('searchInput');
const addBtn      = document.getElementById('addBtn');

// Modal refs
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle   = document.getElementById('modalTitle');
const modalCancel  = document.getElementById('modalCancel');
const modalSave    = document.getElementById('modalSave');
const fieldName    = document.getElementById('fieldName');
const fieldBrand   = document.getElementById('fieldBrand');
const fieldPrice   = document.getElementById('fieldPrice');
const fieldStock   = document.getElementById('fieldStock');

let allSupplements = [];
let editingDocId   = null; // null = add mode, string = edit mode

// ── MODAL HELPERS ─────────────────────────────────────────────────────────────

function openModal(mode, supp = null) {
    editingDocId = mode === 'edit' ? supp.docId : null;
    modalTitle.textContent = mode === 'edit' ? 'Edit Supplement' : 'Add Supplement';

    fieldName.value  = supp ? supp.name  : '';
    fieldBrand.value = supp ? supp.brand : '';
    fieldPrice.value = supp ? supp.price : '';
    fieldStock.value = supp ? supp.stock : '';

    // Name & brand only editable in add mode
    fieldName.disabled  = mode === 'edit';
    fieldBrand.disabled = mode === 'edit';

    modalOverlay.classList.add('open');
    (mode === 'edit' ? fieldPrice : fieldName).focus();
}

function closeModal() {
    modalOverlay.classList.remove('open');
    editingDocId = null;
}

modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// ── SAVE (ADD or EDIT) ────────────────────────────────────────────────────────

modalSave.addEventListener('click', async () => {
    const name  = fieldName.value.trim();
    const brand = fieldBrand.value.trim();
    const price = parseFloat(fieldPrice.value) || 0;
    const stock = parseInt(fieldStock.value)   || 0;

    if (!editingDocId && !name) { fieldName.focus(); return; }

    modalSave.disabled = true;
    modalSave.textContent = 'Saving...';

    try {
        if (editingDocId) {
            await updateDoc(doc(db, 'supplements', editingDocId), { price, stock });
        } else {
            await addDoc(collection(db, 'supplements'), { name, brand, price, stock });
        }
        closeModal();
    } finally {
        modalSave.disabled = false;
        modalSave.textContent = 'Save';
    }
});

// ── FETCH (real-time) ────────────────────────────────────────────────────────

function fetchSupplements() {
    onSnapshot(collection(db, 'supplements'), (snap) => {
        allSupplements = [];
        snap.forEach(d => {
            const data = d.data();
            allSupplements.push({
                docId : d.id,
                name  : data.name  || '',
                brand : data.brand || '',
                price : data.price ?? '',
                stock : data.stock ?? ''
            });
        });
        renderTable();
    }, (err) => {
        console.error('Error loading supplements:', err);
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:40px;">Error loading supplements.</td></tr>`;
    });
}

// ── RENDER ───────────────────────────────────────────────────────────────────

function renderTable() {
    const search = searchInput.value.trim().toLowerCase();

    const filtered = allSupplements.filter(s =>
        !search ||
        s.name.toLowerCase().includes(search) ||
        s.brand.toLowerCase().includes(search)
    );

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:40px;">No supplements found.</td></tr>`;
        return;
    }

    tableBody.innerHTML = filtered.map(s => `
        <tr>
            <td>${s.name}</td>
            <td>${s.brand}</td>
            <td>₹${Number(s.price).toLocaleString('en-IN')}</td>
            <td style="text-align:center">${s.stock}</td>
            <td>
                <button class="action-btn edit"   onclick="window._editSupp('${s.docId}')">Edit</button>
                <button class="action-btn delete" onclick="window._deleteSupp('${s.docId}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

// ── ADD BUTTON ────────────────────────────────────────────────────────────────

addBtn.addEventListener('click', () => openModal('add'));

// ── DELETE CONFIRM MODAL ──────────────────────────────────────────────────────

const deleteOverlay    = document.getElementById('deleteOverlay');
const deleteSupName    = document.getElementById('deleteSupName');
const deleteCancelBtn  = document.getElementById('deleteCancelBtn');
const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

let pendingDeleteId = null;

function openDeleteModal(docId) {
    const supp = allSupplements.find(s => s.docId === docId);
    if (!supp) return;
    pendingDeleteId = docId;
    deleteSupName.textContent = '"' + supp.name + '"';
    deleteOverlay.classList.add('open');
}

function closeDeleteModal() {
    deleteOverlay.classList.remove('open');
    pendingDeleteId = null;
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = 'Delete';
}

deleteCancelBtn.addEventListener('click', closeDeleteModal);
deleteOverlay.addEventListener('click', e => { if (e.target === deleteOverlay) closeDeleteModal(); });

deleteConfirmBtn.addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Deleting...';
    try {
        await deleteDoc(doc(db, 'supplements', pendingDeleteId));
        closeDeleteModal();
    } catch(err) {
        console.error('Delete error:', err);
        deleteConfirmBtn.disabled = false;
        deleteConfirmBtn.textContent = 'Delete';
    }
});

// ── EDIT ─────────────────────────────────────────────────────────────────────

window._editSupp = (docId) => {
    const supp = allSupplements.find(s => s.docId === docId);
    if (supp) openModal('edit', supp);
};

// ── DELETE ────────────────────────────────────────────────────────────────────

window._deleteSupp = (docId) => {
    openDeleteModal(docId);
};

// ── SEARCH ────────────────────────────────────────────────────────────────────

searchInput.addEventListener('input', renderTable);

// ── INIT ──────────────────────────────────────────────────────────────────────

fetchSupplements();
