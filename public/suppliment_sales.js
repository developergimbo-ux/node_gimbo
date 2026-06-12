import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

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
const db = getFirestore(app);

// DOM Elements
const modal          = document.getElementById('saleModal');
const recordSaleBtn  = document.getElementById('recordSaleBtn');
const cancelBtn      = document.getElementById('cancelBtn');
const saleForm       = document.getElementById('saleForm');
const tableBody      = document.getElementById('tableBody');
const searchInput    = document.getElementById('searchInput');
const totalSalesEl   = document.getElementById('totalSales');
const itemsSoldEl    = document.getElementById('itemsSold');
const exportMonthlyBtn = document.getElementById('exportMonthlyBtn');
const exportRangeBtn = document.getElementById('exportRangeBtn');
const errorBox       = document.getElementById('errorBox');
const dateFromInput  = document.getElementById('dateFrom');
const dateToInput    = document.getElementById('dateTo');

// Select & price
const suppSelect     = document.getElementById('supplementName');
const unitPriceInput = document.getElementById('unitPrice');
const suppLoadStatus = document.getElementById('suppLoadStatus');

// Delete confirm
const deleteOverlay   = document.getElementById('deleteOverlay');
const deleteCancelBtn = document.getElementById('deleteCancelBtn');
const deleteConfirmBtn= document.getElementById('deleteConfirmBtn');

// State
let allSales = [];
let allSupplements = []; // { name, price }
let pendingDeleteId = null;

// ── SHOW ERROR ────────────────────────────────────────────────
function showError(message) {
    errorBox.textContent = '✕ ' + message;
    errorBox.classList.add('show');
    setTimeout(() => errorBox.classList.remove('show'), 3000);
}

// ── LOAD SUPPLEMENTS into dropdown ───────────────────────────
async function loadSupplements() {
    suppLoadStatus.textContent = 'Loading supplements...';
    try {
        const snap = await getDocs(collection(db, 'supplements'));
        allSupplements = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.name) allSupplements.push({ name: data.name, price: data.price ?? 0 });
        });
        allSupplements.sort((a, b) => a.name.localeCompare(b.name));

        suppSelect.innerHTML = '';
        if (allSupplements.length === 0) {
            suppSelect.innerHTML = '<option value="" disabled selected>No supplements found — add one first</option>';
            suppLoadStatus.textContent = 'No supplements in inventory.';
            return;
        }
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.selected = true;
        placeholder.textContent = 'Select a supplement...';
        suppSelect.appendChild(placeholder);

        allSupplements.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.name;
            opt.textContent = `${s.name}  —  ₹${Number(s.price).toLocaleString('en-IN')}`;
            opt.dataset.price = s.price;
            suppSelect.appendChild(opt);
        });
        suppLoadStatus.textContent = '';
    } catch (err) {
        console.error('Error loading supplements:', err);
        suppSelect.innerHTML = '<option value="" disabled selected>Error loading supplements</option>';
        suppLoadStatus.textContent = 'Failed to load supplements.';
    }
}

// Auto-fill unit price when supplement selected
suppSelect.addEventListener('change', () => {
    const selected = suppSelect.options[suppSelect.selectedIndex];
    if (selected && selected.dataset.price !== undefined) {
        unitPriceInput.value = selected.dataset.price;
    }
});

// ── MODAL ─────────────────────────────────────────────────────
async function openModal() {
    modal.classList.add('active');
    document.getElementById('saleDate').value = new Date().toISOString().split('T')[0];
    // Reload supplements each time modal opens to stay fresh
    await loadSupplements();
}

function closeModal() {
    modal.classList.remove('active');
    saleForm.reset();
}

// ── DELETE CONFIRM MODAL ──────────────────────────────────────
function openDeleteModal(id) {
    pendingDeleteId = id;
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = 'Delete';
    deleteOverlay.classList.add('active');
}

function closeDeleteModal() {
    deleteOverlay.classList.remove('active');
    pendingDeleteId = null;
}

deleteCancelBtn.addEventListener('click', closeDeleteModal);
deleteOverlay.addEventListener('click', e => { if (e.target === deleteOverlay) closeDeleteModal(); });

deleteConfirmBtn.addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Deleting...';
    try {
        await deleteDoc(doc(db, 'supplement_sales', pendingDeleteId));
        closeDeleteModal();
    } catch (err) {
        console.error('Delete error:', err);
        showError('Error deleting sale');
        deleteConfirmBtn.disabled = false;
        deleteConfirmBtn.textContent = 'Delete';
    }
});

// ── LOAD SALES (real-time) ────────────────────────────────────
function loadSales() {
    onSnapshot(collection(db, 'supplement_sales'), (querySnapshot) => {
        allSales = [];
        querySnapshot.forEach(d => allSales.push({ id: d.id, ...d.data() }));
        allSales.sort((a, b) => new Date(b.date) - new Date(a.date));
        renderTable(allSales);
        updateStats();
    }, (error) => {
        console.error('Error loading sales:', error);
        showError('Error loading sales data');
        tableBody.innerHTML = '<tr><td colspan="6" class="empty">Error loading data</td></tr>';
    });
}

// ── ADD SALE ──────────────────────────────────────────────────
async function addSale(e) {
    e.preventDefault();
    const supplement = suppSelect.value.trim();
    const quantity   = parseInt(document.getElementById('quantity').value);
    const unitPrice  = parseFloat(unitPriceInput.value);
    const date       = document.getElementById('saleDate').value;

    if (!supplement) { showError('Please select a supplement'); suppSelect.focus(); return; }
    if (!quantity || quantity < 1) { showError('Please enter a valid quantity'); return; }
    if (!unitPrice || unitPrice < 0) { showError('Please enter a valid unit price'); return; }
    if (!date) { showError('Please select a date'); return; }

    const saveBtn = saleForm.querySelector('.btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        await addDoc(collection(db, 'supplement_sales'), {
            supplement:  supplement,
            quantity:    quantity,
            unitPrice:   unitPrice,
            totalAmount: quantity * unitPrice,
            date:        date
        });
        closeModal();
    } catch (error) {
        console.error('Error adding sale:', error);
        showError('Error saving sale');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Sale';
    }
}

// ── RENDER TABLE ──────────────────────────────────────────────
function renderTable(sales) {
    if (!sales || sales.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="empty">No sales found</td></tr>';
        return;
    }
    tableBody.innerHTML = sales.map(sale => {
        const supplementName = sale.supplement || sale.supplementName || sale.name || 'N/A';
        return `
        <tr>
            <td>${sale.date || 'N/A'}</td>
            <td>${supplementName}</td>
            <td>${sale.quantity || 0}</td>
            <td>₹${parseFloat(sale.unitPrice || 0).toFixed(2)}</td>
            <td>₹${parseFloat(sale.totalAmount || 0).toFixed(2)}</td>
            <td><button class="action-btn" onclick="window._deleteSale('${sale.id}')">Delete</button></td>
        </tr>`;
    }).join('');
}

// ── UPDATE STATS ──────────────────────────────────────────────
function updateStats() {
    const now = new Date();
    const monthSales = allSales.filter(sale => {
        const d = new Date(sale.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const totalAmount = monthSales.reduce((sum, s) => sum + (parseFloat(s.totalAmount) || 0), 0);
    const totalItems  = monthSales.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0);
    totalSalesEl.textContent = '₹' + totalAmount.toFixed(2);
    itemsSoldEl.textContent  = totalItems;
}

// ── SEARCH ────────────────────────────────────────────────────
function filterSales() {
    const term = searchInput.value.toLowerCase();
    renderTable(allSales.filter(s =>
        ((s.supplement || s.supplementName || s.name || '').toLowerCase().includes(term))
    ));
}

// ── EXPORT XLSX ───────────────────────────────────────────────
function exportToXLSX(data, filename) {
    if (data.length === 0) { showError('No data to export'); return; }

    const XLSX = window.XLSX;

    // Build formatted rows
    const rows = data.map(s => ({
        'Date':         s.date || '',
        'Supplement':   s.supplement || s.supplementName || s.name || '',
        'Quantity':     parseInt(s.quantity) || 0,
        'Unit Price (₹)': parseFloat(s.unitPrice) || 0,
        'Total Amount (₹)': parseFloat(s.totalAmount) || 0
    }));

    // Totals row
    const totalQty    = rows.reduce((sum, r) => sum + r['Quantity'], 0);
    const totalAmount = rows.reduce((sum, r) => sum + r['Total Amount (₹)'], 0);
    rows.push({
        'Date': '',
        'Supplement': 'TOTAL',
        'Quantity': totalQty,
        'Unit Price (₹)': '',
        'Total Amount (₹)': totalAmount
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    // Column widths
    ws['!cols'] = [
        { wch: 14 },  // Date
        { wch: 24 },  // Supplement
        { wch: 10 },  // Quantity
        { wch: 16 },  // Unit Price
        { wch: 18 }   // Total Amount
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Supplement Sales');
    XLSX.writeFile(wb, filename);
}

function exportMonthly() {
    const now = new Date();
    const monthSales = allSales.filter(s => {
        const d = new Date(s.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const monthLabel = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }).replace(' ', '-');
    exportToXLSX(monthSales, `Supplement-Sales-${monthLabel}.xlsx`);
}

function exportRange() {
    const fromStr = dateFromInput.value;
    const toStr   = dateToInput.value;
    if (!fromStr || !toStr) { showError('Please select both dates'); return; }
    // yyyy-mm-dd from date inputs — compare as strings directly (safe, no timezone issues)
    const rangeSales = allSales.filter(s => {
        const d = (s.date || '');
        return d >= fromStr && d <= toStr;
    });
    if (rangeSales.length === 0) { showError('No sales found in this range'); return; }
    exportToXLSX(rangeSales, `Supplement-Sales-${fromStr}-to-${toStr}.xlsx`);
}

// ── EVENT LISTENERS ───────────────────────────────────────────
recordSaleBtn.addEventListener('click', openModal);
cancelBtn.addEventListener('click', closeModal);
saleForm.addEventListener('submit', addSale);
searchInput.addEventListener('input', filterSales);
exportMonthlyBtn.addEventListener('click', exportMonthly);
exportRangeBtn.addEventListener('click', exportRange);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

window._deleteSale = id => openDeleteModal(id);

// ── INIT ──────────────────────────────────────────────────────
loadSales();
