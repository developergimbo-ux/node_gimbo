import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, updateDoc, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

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
const modal = document.getElementById('equipmentModal');
const addBtn = document.getElementById('addBtn');
const cancelBtn = document.getElementById('cancelBtn');
const equipmentForm = document.getElementById('equipmentForm');
const tableBody = document.getElementById('tableBody');
const searchInput = document.getElementById('searchInput');
const modalTitle = document.getElementById('modalTitle');

// State
let currentEditId = null;
let allEquipment = [];

// Modal Functions
function openModal(editId = null) {
    currentEditId = editId;
    
    if (editId) {
        modalTitle.textContent = 'Edit Equipment';
        const equipment = allEquipment.find(e => e.id === editId);
        if (equipment) {
            document.getElementById('equipmentName').value = equipment.name;
            document.getElementById('equipmentType').value = equipment.type;
            document.getElementById('equipmentCondition').value = equipment.condition;
            document.getElementById('equipmentQuantity').value = equipment.quantity;
        }
    } else {
        modalTitle.textContent = 'Add Equipment';
        equipmentForm.reset();
    }
    
    modal.classList.add('active');
}

function closeModal() {
    modal.classList.remove('active');
    equipmentForm.reset();
    currentEditId = null;
}

// Load Equipment from Firestore (real-time)
function loadEquipment() {
    onSnapshot(collection(db, 'equipment'), (querySnapshot) => {
        allEquipment = [];
        querySnapshot.forEach((doc) => {
            allEquipment.push({
                id: doc.id,
                ...doc.data()
            });
        });
        renderTable(allEquipment);
    }, (error) => {
        console.error('Error loading equipment:', error);
        tableBody.innerHTML = '<tr><td colspan="5" class="empty-message">Error loading equipment</td></tr>';
    });
}

// Add/Update Equipment
async function saveEquipment(e) {
    e.preventDefault();
    
    const name = document.getElementById('equipmentName').value.trim();
    const type = document.getElementById('equipmentType').value.trim();
    const condition = document.getElementById('equipmentCondition').value;
    const quantity = parseInt(document.getElementById('equipmentQuantity').value);
    
    if (!name || !type || !condition || !quantity) {
        alert('Please fill in all fields');
        return;
    }
    
    try {
        if (currentEditId) {
            // Update existing equipment
            await updateDoc(doc(db, 'equipment', currentEditId), {
                name,
                type,
                condition,
                quantity
            });
        } else {
            // Add new equipment
            await addDoc(collection(db, 'equipment'), {
                name,
                type,
                condition,
                quantity,
                createdAt: new Date()
            });
        }
        
        closeModal();
    } catch (error) {
        console.error('Error saving equipment:', error);
        alert('Error saving equipment');
    }
}

// Delete Equipment
async function deleteEquipment(id) {
    if (!confirm('Are you sure you want to delete this equipment?')) {
        return;
    }
    
    try {
        await deleteDoc(doc(db, 'equipment', id));
    } catch (error) {
        console.error('Error deleting equipment:', error);
        alert('Error deleting equipment');
    }
}

// Render Table
function renderTable(equipmentList) {
    if (!equipmentList || equipmentList.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="empty-message">No equipment found</td></tr>';
        return;
    }
    
    tableBody.innerHTML = equipmentList.map(equipment => `
        <tr>
            <td style="font-weight:600;">${equipment.name}</td>
            <td>${equipment.type}</td>
            <td><span class="badge ${equipment.condition.toLowerCase()}">${equipment.condition}</span></td>
            <td>${equipment.quantity}</td>
            <td>
                <button class="action-btn edit" onclick="window.editEquipment('${equipment.id}')">Edit</button>
                <button class="action-btn delete" onclick="window.deleteEquipment('${equipment.id}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

// Search/Filter
function filterEquipment() {
    const searchTerm = searchInput.value.toLowerCase();
    const filtered = allEquipment.filter(equipment =>
        equipment.name.toLowerCase().includes(searchTerm) ||
        equipment.type.toLowerCase().includes(searchTerm)
    );
    renderTable(filtered);
}

// Event Listeners
addBtn.addEventListener('click', () => openModal());
cancelBtn.addEventListener('click', closeModal);
equipmentForm.addEventListener('submit', saveEquipment);
searchInput.addEventListener('input', filterEquipment);

// Close modal on outside click
modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        closeModal();
    }
});

// Global functions for inline handlers
window.editEquipment = (id) => openModal(id);
window.deleteEquipment = (id) => deleteEquipment(id);

// Load equipment on page load
loadEquipment();
