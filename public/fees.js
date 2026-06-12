import { initializeApp }   from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, query, orderBy }
  from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const app = initializeApp({
  apiKey:"AIzaSyBawDWPi-NvWl3bKyGVIFi-v9FX7yHraEI",
  authDomain:"gimbo-dc910.firebaseapp.com",
  projectId:"gimbo-dc910",
  storageBucket:"gimbo-dc910.firebasestorage.app",
  messagingSenderId:"294864961933",
  appId:"1:294864961933:web:61d6c4086c09a506bf3dc4"
});
const db = getFirestore(app);

const tableBody    = document.getElementById("tableBody");
const searchInput  = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");

let _members = [], _fees = [], dataList = [];
let _pendingPay = null; // { pid, name, defaultAmount, pkg }

// ── Helpers ──────────────────────────────────────────────────
function packageToMonths(pkg) {
  if (!pkg) return 1;
  const s = pkg.toLowerCase().trim();
  if (s.includes('year'))    { const n = parseFloat(s)||1; return Math.round(n*12); }
  if (s.includes('half'))    return 6;
  if (s.includes('quarter')) return 3;
  if (s.includes('annual'))  return 12;
  if (s.includes('weekly'))  return 0.25;
  const mm = s.match(/(\d+\.?\d*)\s*month/);
  if (mm) return parseFloat(mm[1]);
  const num = parseFloat(s);
  return (!isNaN(num) && num > 0) ? num : 1;
}

function addMonths(date, months) {
  const whole = Math.floor(months), extra = Math.round((months-whole)*30);
  const d = new Date(date);
  d.setMonth(d.getMonth()+whole);
  if (extra>0) d.setDate(d.getDate()+extra);
  return d;
}

function parseDate(v) {
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

function fmtDate(v) {
  const d = parseDate(v);
  if (!d||isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

function todayStr() {
  const n=new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show '+(type||'');
  setTimeout(()=>t.className='toast',3000);
}

// ── Core logic: compute status from data only ─────────────────
// Status rules:
//  - If most-recent fee doc is "paid" AND nextDue > today  → Paid
//  - If most-recent fee doc is "paid" AND nextDue ≤ today  → Overdue (auto-expired)
//  - If no fee doc OR fee doc not paid                     → Pending
function computeRow(m, feesMap) {
  const pid = String(m.powerId||'').trim();
  const pkg = m.package || '—';
  const dur = packageToMonths(pkg);

  // Get most recent paid fee for this member
  const allFees = feesMap[pid] || [];
  const paidFees = allFees.filter(f=>(f.status||'').toLowerCase()==='paid');
  paidFees.sort((a,b)=>{
    const da=parseDate(a.paymentDate), db=parseDate(b.paymentDate);
    return (db&&da) ? db-da : 0;
  });
  const latestPaid = paidFees[0] || null;

  let lastPayment = null;
  if (latestPaid)          lastPayment = parseDate(latestPaid.paymentDate);
  if (!lastPayment && m.lastPayment)  lastPayment = parseDate(m.lastPayment);
  if (!lastPayment && m.joinDate)     lastPayment = parseDate(m.joinDate);
  if (!lastPayment && m.joinedDate)   lastPayment = parseDate(m.joinedDate);

  const nextDue = lastPayment ? addMonths(lastPayment, dur) : null;
  const now     = new Date();

  let status;
  if (latestPaid) {
    status = (nextDue && nextDue <= now) ? 'Overdue' : 'Paid';
  } else {
    status = 'Pending';
  }

  const amount = (latestPaid && latestPaid.amount != null) ? latestPaid.amount
               : (m.fee != null) ? m.fee : null;

  return { pid, name:m.name||'', package:pkg, amount, lastPayment, nextDue, status };
}

function processAndRender() {
  // feesMap: pid → fee[]
  const feesMap = {};
  _fees.forEach(f => {
    const pid = String(f.powerId||'').trim();
    if (!pid) return;
    if (!feesMap[pid]) feesMap[pid]=[];
    feesMap[pid].push(f);
  });

  dataList = _members
    .filter(m=>(m.status||'').toLowerCase()!=='left')
    .map(m=>computeRow(m,feesMap))
    .sort((a,b)=>String(a.pid).localeCompare(String(b.pid),undefined,{numeric:true}));

  // Stats
  const now = new Date();
  const mnStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let paid=0, overdue=0, pending=0, revenue=0;
  dataList.forEach(d=>{
    if(d.status==='Paid')    paid++;
    else if(d.status==='Overdue') overdue++;
    else pending++;
  });
  _fees.forEach(f=>{
    if((f.status||'').toLowerCase()!=='paid') return;
    let fd = parseDate(f.paymentDate);
    if(!fd || isNaN(fd)) return;
    // Normalise UTC-midnight strings to local date by shifting with timezone offset
    if(typeof f.paymentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.paymentDate.trim())) {
      const [y,mo,d] = f.paymentDate.trim().split('-').map(Number);
      fd = new Date(y, mo-1, d);
    }
    if(fd >= mnStart && fd <= now) revenue += Number(f.amount||0);
  });
  // Pending outstanding amount — sum fee/package amount for each pending member
  let pendingAmt = 0;
  dataList.forEach(d=>{ if(d.status==='Pending'||d.status==='Overdue') pendingAmt += Number(d.amount||0); });
  document.getElementById('sPaid').textContent         = paid;
  document.getElementById('sOverdue').textContent      = overdue;
  document.getElementById('sPendingCount').textContent = pending + overdue;
  document.getElementById('sPendingAmt').textContent   = '₹'+pendingAmt.toLocaleString('en-IN');
  document.getElementById('sRevenue').textContent      = '₹'+revenue.toLocaleString('en-IN');

  render();
}

// ── Render ────────────────────────────────────────────────────
function render() {
  const search = searchInput.value.toLowerCase();
  const filter = statusFilter.value;

  const filtered = dataList.filter(d=>{
    if (filter!=='All' && d.status!==filter) return false;
    if (search && !d.name.toLowerCase().includes(search) && !d.pid.includes(search)) return false;
    return true;
  });

  document.getElementById('countBadge').textContent = filtered.length + ' records';

  if (!filtered.length) {
    tableBody.innerHTML = '<tr><td colspan="8" class="loading">No records found</td></tr>';
    return;
  }

  tableBody.innerHTML = filtered.map(d=>{
    const badgeCls = d.status==='Paid' ? 'badge-paid' : d.status==='Overdue' ? 'badge-overdue' : 'badge-pending';
    const showBtn  = d.status !== 'Paid';
    const amtStr   = d.amount!=null ? '₹'+Number(d.amount).toLocaleString('en-IN') : '—';
    return `<tr>
      <td><strong>${d.pid||'—'}</strong></td>
      <td style="text-align:left">${d.name}</td>
      <td>${d.package}</td>
      <td>${amtStr}</td>
      <td>${fmtDate(d.lastPayment)}</td>
      <td style="color:${d.status==='Overdue'?'#f59e0b':''}">${fmtDate(d.nextDue)}</td>
      <td><span class="badge ${badgeCls}">${d.status}</span></td>
      <td>${showBtn
        ? `<button class="btn-mark" onclick="openModal('${d.pid}','${escQ(d.name)}','${escQ(d.package)}',${d.amount||0})">Mark Paid</button>`
        : '<span style="color:#555;font-size:12px;">—</span>'
      }</td>
    </tr>`;
  }).join('');
}

function escQ(s){ return String(s||'').replace(/'/g,"\\'"); }

// ── Mark as Paid ──────────────────────────────────────────────
window.openModal = function(pid, name, pkg, defaultAmt) {
  _pendingPay = { pid, name, pkg, defaultAmt };
  document.getElementById('modalSub').textContent = `${name}  (ID: ${pid})  · ${pkg}`;
  document.getElementById('modalAmount').value = defaultAmt || '';
  document.getElementById('modalDate').value   = todayStr();
  document.getElementById('payModal').classList.add('open');
};

window.closeModal = function() {
  document.getElementById('payModal').classList.remove('open');
  _pendingPay = null;
};

window.confirmPay = async function() {
  if (!_pendingPay) return;
  const amount = parseFloat(document.getElementById('modalAmount').value);
  const date   = document.getElementById('modalDate').value;
  if (!date || isNaN(amount) || amount <= 0) {
    showToast('Enter valid amount and date.', 'error'); return;
  }
  const btn = document.getElementById('confirmPayBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await addDoc(collection(db, 'fees'), {
      powerId:     _pendingPay.pid,
      name:        _pendingPay.name,
      package:     _pendingPay.pkg,
      amount,
      paymentDate: date,
      status:      'paid',
      paidAt:      new Date().toISOString()
    });
    showToast('Payment recorded!', 'success');
    closeModal();
  } catch(e) {
    console.error(e);
    showToast('Error saving. Check connection.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Confirm Payment';
  }
};

// Close modal on overlay click
document.getElementById('payModal').addEventListener('click', function(e){
  if(e.target===this) closeModal();
});

// ── Firebase listeners ────────────────────────────────────────
onSnapshot(collection(db,'members'), snap=>{
  _members = snap.docs.map(d=>d.data());
  processAndRender();
}, err=>{ console.error(err); tableBody.innerHTML='<tr><td colspan="8" class="loading">Error loading members</td></tr>'; });

onSnapshot(collection(db,'fees'), snap=>{
  _fees = snap.docs.map(d=>d.data());
  processAndRender();
}, err=>console.error(err));

searchInput.addEventListener('input', render);
statusFilter.addEventListener('change', render);
