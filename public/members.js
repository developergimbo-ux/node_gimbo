import { initializeApp }        from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
  import { getAnalytics }         from "https://www.gstatic.com/firebasejs/12.12.0/firebase-analytics.js";
  import {
    getFirestore, collection, addDoc, getDocs,
    updateDoc, deleteDoc, doc, onSnapshot, Timestamp, query, where
  } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

  const firebaseConfig = {
    apiKey:            "AIzaSyBawDWPi-NvWl3bKyGVIFi-v9FX7yHraEI",
    authDomain:        "gimbo-dc910.firebaseapp.com",
    projectId:         "gimbo-dc910",
    storageBucket:     "gimbo-dc910.firebasestorage.app",
    messagingSenderId: "294864961933",
    appId:             "1:294864961933:web:61d6c4086c09a506bf3dc4",
    measurementId:     "G-XSBFDNVXKD"
  };

  const app       = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
  const db        = getFirestore(app);

  let allMembers = [];
  let editingId  = null;

  // Always pad powerId to 3 digits
  function padPowerId(n) {
    return String(parseInt(n) || 0).padStart(3, '0');
  }

  function generatePowerId(members) {
    const ids = members.map(m => parseInt(m.powerId)).filter(n => !isNaN(n)).sort((a,b) => a-b);
    let expected = 1;
    for (let id of ids) { if (id !== expected) break; expected++; }
    return padPowerId(expected);
  }

  const PACKAGE_DAYS = { '1 month':30, '3 months':90, '6 months':180, '1 year':365, '5 years':1825 };
  function getPackageDays(pkg) { if (!pkg) return null; return PACKAGE_DAYS[pkg.toLowerCase()] || null; }

  // Build fees doc with canonical structure
  function buildFeeDoc(memberId, powerId, name, amount, joinDateStr, pkg) {
    return {
      memberId:    memberId,
      powerId:     powerId,
      name:        name,
      amount:      amount,
      month:       joinDateStr.substring(0, 7),
      status:      'paid',
      date:        joinDateStr,
      package:     pkg,
      paymentDate: joinDateStr,
      nextPayment: addMonthsToDate(joinDateStr, PACKAGE_MONTHS[(pkg||'').toLowerCase()] || 1)
    };
  }

  async function checkExpiredPausedMembers(members) {
    const now = Date.now();
    const expired = members.filter(m => {
      if (m.status !== 'paused') return false;
      if (!m.pausedDate) return false;
      const days = getPackageDays(m.package);
      if (!days) return false;
      const pausedMs = m.pausedDate.seconds ? m.pausedDate.seconds * 1000
        : (typeof m.pausedDate.toDate === 'function' ? m.pausedDate.toDate().getTime() : null);
      if (!pausedMs) return false;
      return ((now - pausedMs) / 86400000) > days;
    });
    for (const m of expired) {
      try {
        await updateDoc(doc(db, 'members', m.id), { status: 'left' });
        showToast(`${m.name || 'Member'} marked as Left (package expired while paused)`, 'error');
      } catch(err) { console.error('Auto-expire error', m.id, err); }
    }
  }

  const membersCol = collection(db, 'members');

  onSnapshot(membersCol, (snapshot) => {
    allMembers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    checkExpiredPausedMembers(allMembers);
    renderMembers();
  }, (err) => {
    console.error('Snapshot error:', err);
    showToast('Failed to load members: ' + err.message, 'error');
  });

  function renderMembers() {
    const search = (document.getElementById('memberSearch').value || '').toLowerCase();
    const filter = document.getElementById('memberStatusFilter').value;
    const tbody  = document.getElementById('membersTableBody');
    let list = [...allMembers].sort((a,b) => parseInt(a.powerId||0) - parseInt(b.powerId||0));
    if (filter !== 'all') list = list.filter(m => m.status === filter);
    if (search) list = list.filter(m =>
      (m.name||'').toLowerCase().includes(search) ||
      (m.powerId||'').toLowerCase().includes(search) ||
      (m.phone||'').toLowerCase().includes(search) ||
      (m.email||'').toLowerCase().includes(search)
    );
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><p class="empty-state-text">No members found.</p></td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(m => {
      const badgeClass = m.status === 'active' ? 'badge-active' : m.status === 'paused' ? 'badge-paused' : 'badge-left';
      let actionBtns = '';
      if (m.status === 'active') {
        actionBtns = `
          <button class="btn btn-sm btn-secondary" onclick="window._editMember('${m.id}')">Edit</button>
          <button class="btn btn-sm btn-warning"   onclick="window._pauseMember('${m.id}')">Pause</button>
          <button class="btn btn-sm btn-danger"    onclick="window._deleteMember('${m.id}')">Delete</button>`;
      } else if (m.status === 'paused') {
        actionBtns = `
          <button class="btn btn-sm btn-secondary" onclick="window._editMember('${m.id}')">Edit</button>
          <button class="btn btn-sm btn-success"   onclick="window._activateMember('${m.id}')">Activate</button>
          <button class="btn btn-sm btn-danger"    onclick="window._deleteMember('${m.id}')">Delete</button>`;
      } else {
        actionBtns = `
          <button class="btn btn-sm btn-success" onclick="window._openRejoinModal('${m.id}', '${(m.name||'').replace(/'/g, "\\'")}')">Rejoin</button>
          <button class="btn btn-sm btn-danger"  onclick="window._deleteMember('${m.id}')">Delete</button>`;
      }
      const displayDate = m.joinDate ? formatDate(m.joinDate) : formatDate(m.joinedDate);
      return `
        <tr>
          <td><strong>${m.powerId||'-'}</strong></td>
          <td>${m.name||'-'}</td>
          <td>${m.phone||'-'}</td>
          <td>${m.package||'-'}</td>
          <td>${m.fitnessGoal||'-'}</td>
          <td><span class="badge ${badgeClass}">${(m.status||'unknown').toUpperCase()}</span></td>
          <td>${displayDate}</td>
          <td><div class="btn-group">${actionBtns}</div></td>
        </tr>`;
    }).join('');
  }

  // ── Smart Time Recommendation ─────────────────────────────────
  let _cachedSlots      = [];
  let _cachedAttendance = [];
  let _cachedChunkMins  = 120; // runtime value — always overwritten from DB

  function timeStrToMinutes(t) {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h)) return null;
    return h * 60 + (m || 0);
  }

  function minsToLabel(m) {
    const h    = Math.floor(m / 60) % 24;
    const min  = m % 60;
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12  = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(min).padStart(2,'0')} ${ampm}`;
  }

  // chunkMins is always passed in from DB value — no hardcoded 120 inside
  function generateSlots(timings, chunkMins) {
    const slots = [];
    if (!timings || !chunkMins) return slots;
    const ranges = [
      [timings.morningOpen, timings.morningClose],
      [timings.eveningOpen, timings.eveningClose]
    ];
    for (const [open, close] of ranges) {
      const startMin = timeStrToMinutes(open);
      const endMin   = timeStrToMinutes(close);
      if (startMin == null || endMin == null || endMin <= startMin) continue;
      for (let s = startMin; s < endMin; s += chunkMins) {
        const slotEnd = Math.min(s + chunkMins, endMin);
        slots.push({ label: `${minsToLabel(s)} – ${minsToLabel(slotEnd)}`, startMin: s, endMin: slotEnd, count: 0 });
      }
    }
    return slots;
  }

  function extractMinsFromDoc(data) {
    if (data.checkIn) {
      if (typeof data.checkIn === 'string') return timeStrToMinutes(data.checkIn.substring(0, 5));
      if (data.checkIn.toDate) { const dt = data.checkIn.toDate(); return dt.getHours() * 60 + dt.getMinutes(); }
    }
    if (data.timestamp) {
      const dt = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
      if (!isNaN(dt)) return dt.getHours() * 60 + dt.getMinutes();
    }
    return null;
  }

  function getBestSlot() {
    if (!_cachedSlots.length) return null;
    const total = _cachedAttendance.length;
    if (total < 10) return null;

    const scored = _cachedSlots.map(s => ({ ...s, count: 0 }));
    for (const mins of _cachedAttendance) {
      for (const slot of scored) {
        if (mins >= slot.startMin && mins < slot.endMin) { slot.count++; break; }
      }
    }

    const threshold = Math.max(5, total * 0.02);
    for (const slot of scored) {
      slot.load_ratio = slot.count / total;
      const penalty   = slot.count < threshold ? 0.05 : 0;
      slot.score      = slot.load_ratio + penalty;
    }

    let candidates = scored.filter(s => s.count >= threshold);
    if (!candidates.length) candidates = scored;

    candidates.sort((a, b) => a.score - b.score);
    return candidates[0] || null;
  }

  function updateSmartTimeUI(slot) {
    const el = document.getElementById('smartTimeText');
    if (!el) return;
    if (!slot) { el.textContent = 'Flexible Timing ✨'; return; }
    let tag;
    if (slot.load_ratio < 0.20)      tag = 'Low Crowd 🟢';
    else if (slot.load_ratio < 0.40) tag = 'Medium Crowd 🟡';
    else                              tag = 'High Crowd 🔴';
    el.textContent = `${slot.label} · ${tag}`;
  }

  function recalcAndDisplay() {
    if (!document.getElementById('memberModal')?.classList.contains('active')) return;
    updateSmartTimeUI(getBestSlot());
  }

  function loadSmartRecommendation() {
    const el = document.getElementById('smartTimeText');
    if (el) el.textContent = 'Calculating…';
    recalcAndDisplay();
  }

  // ✅ BUG FIXED: was data.avg_time_spent_by_mem — field name didn't match Firebase
  // Firebase stores: avg_time_spent_on_gym_by_member
  onSnapshot(doc(db, 'gym_settings', 'config'), (snap) => {
    const data      = snap.exists() ? snap.data() : {};
    const gymTiming = data.gymTiming || {};
    const timings   = {
      morningOpen:  gymTiming.morningOpen  || data.morningOpen  || null,
      morningClose: gymTiming.morningClose || data.morningClose || null,
      eveningOpen:  gymTiming.eveningOpen  || data.eveningOpen  || null,
      eveningClose: gymTiming.eveningClose || data.eveningClose || null,
    };
    // ✅ FIXED: correct field name matching Firebase document
    const avgHours   = parseFloat(data.avg_time_spent_on_gym_by_member) || 2;
    _cachedChunkMins = Math.round(avgHours * 60);
    _cachedSlots     = generateSlots(timings, _cachedChunkMins);
    recalcAndDisplay();
  }, () => { _cachedSlots = []; recalcAndDisplay(); });

  // Live attendance — recalc slots on every update
  onSnapshot(collection(db, 'attendance'), (snap) => {
    _cachedAttendance = [];
    snap.forEach(d => {
      const mins = extractMinsFromDoc(d.data());
      if (mins != null) _cachedAttendance.push(mins);
    });
    recalcAndDisplay();
  }, () => { _cachedAttendance = []; recalcAndDisplay(); });
  // ── End Smart Time Recommendation ────────────────────────────

  window.openMemberModal = function(id = null) {
    editingId = id;
    document.getElementById('memberModalTitle').textContent = id ? 'Edit Member' : 'Add New Member';
    document.getElementById('memberForm').reset();
    document.getElementById('memberId').value = id || '';
    if (id) {
      const m = allMembers.find(x => x.id === id);
      if (m) {
        document.getElementById('memberPowerId').value     = m.powerId     || '';
        document.getElementById('memberName').value        = m.name        || '';
        document.getElementById('memberPhone').value       = m.phone       || '';
        document.getElementById('memberEmail').value       = m.email       || '';
        document.getElementById('memberPackage').value     = m.package     || '1 Month';
        document.getElementById('memberFitnessGoal').value = m.fitnessGoal || 'Cardio';
        document.getElementById('memberStatus').value      = m.status      || 'active';
        document.getElementById('memberFee').value         = m.fee != null  ? m.fee : 1000;
        const jd = m.joinDate || '';
        document.getElementById('memberJoinDate').value = jd;
        const pkg = (m.package || '1 Month').toLowerCase();
        const months = PACKAGE_MONTHS[pkg] || 1;
        document.getElementById('memberNextPayment').value = jd ? addMonthsToDate(jd, months) : '';
      }
    } else {
      document.getElementById('memberPowerId').value = generatePowerId(allMembers);
      document.getElementById('memberFee').value = 1000;
      const today = todayString();
      document.getElementById('memberJoinDate').value = today;
      document.getElementById('memberNextPayment').value = addMonthsToDate(today, 1);
    }
    openModal('memberModal');
    loadSmartRecommendation();
  };

  window.saveMember = async function(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('memberSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const docId       = document.getElementById('memberId').value;
    let powerId       = document.getElementById('memberPowerId').value.trim();
    if (!docId) powerId = generatePowerId(allMembers);
    else powerId = padPowerId(powerId);

    const name        = document.getElementById('memberName').value.trim();
    const phone       = document.getElementById('memberPhone').value.trim();
    const email       = document.getElementById('memberEmail').value.trim();
    const pkg         = document.getElementById('memberPackage').value;
    const fitnessGoal = document.getElementById('memberFitnessGoal').value;
    const status      = document.getElementById('memberStatus').value.toLowerCase();
    const fee         = parseFloat(document.getElementById('memberFee').value) || 0;
    const joinDateStr = document.getElementById('memberJoinDate').value || todayString();
    const pkgLower    = pkg.toLowerCase();
    const membershipDays = { '1 month':30,'3 months':90,'6 months':180,'1 year':365,'5 years':1825 }[pkgLower] || 30;
    const months      = PACKAGE_MONTHS[pkgLower] || 1;
    const nextPaymentStr = addMonthsToDate(joinDateStr, months);
    const joinTimestamp  = Timestamp.fromDate(new Date(joinDateStr + 'T00:00:00'));

    try {
      if (docId) {
        await updateDoc(doc(db, 'members', docId), {
          powerId, name, phone, email,
          package: pkg, fitnessGoal, status, fee,
          membershipDays,
          joinDate:    joinDateStr,
          joinedDate:  joinTimestamp,
          lastPayment: joinTimestamp
        });

        const feesQ    = query(collection(db, 'fees'), where('memberId', '==', docId));
        const feesSnap = await getDocs(feesQ);
        const feeDoc   = buildFeeDoc(docId, powerId, name, fee, joinDateStr, pkg);
        if (!feesSnap.empty) {
          await updateDoc(feesSnap.docs[0].ref, feeDoc);
        } else {
          await addDoc(collection(db, 'fees'), feeDoc);
        }
        showToast('Member updated successfully', 'success');
      } else {
        const memberRef = await addDoc(collection(db, 'members'), {
          powerId, name, phone, email,
          package: pkg, fitnessGoal, status, fee,
          membershipDays,
          joinDate:    joinDateStr,
          joinedDate:  joinTimestamp,
          lastPayment: joinTimestamp
        });
        await addDoc(collection(db, 'fees'), buildFeeDoc(memberRef.id, powerId, name, fee, joinDateStr, pkg));
        showToast('Member added successfully', 'success');
      }
      closeModal('memberModal');
    } catch(err) {
      console.error('Save member error:', err);
      showToast('Error saving member: ' + err.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Member';
    }
  };

  window._editMember    = id => window.openMemberModal(id);
  window.editMember     = window._editMember;

  window._pauseMember = async function(id) {
    try {
      await updateDoc(doc(db, 'members', id), { status:'paused', pausedDate: Timestamp.now() });
      showToast('Member paused', 'success');
    } catch(err) { showToast('Error: ' + err.message, 'error'); }
  };
  window.pauseMember = window._pauseMember;

  window._activateMember = async function(id) {
    try {
      await updateDoc(doc(db, 'members', id), { status:'active' });
      showToast('Member activated', 'success');
    } catch(err) { showToast('Error: ' + err.message, 'error'); }
  };
  window.activateMember = window._activateMember;

  window._deleteMember = async function(id) {
    if (!confirm('Are you sure you want to delete this member?')) return;
    try {
      await deleteDoc(doc(db, 'members', id));
      showToast('Member deleted', 'success');
    } catch(err) { showToast('Error: ' + err.message, 'error'); }
  };
  window.deleteMember = window._deleteMember;

  window.filterMembers = function() { renderMembers(); };

  window.openDeleteAllModal = function() {
    document.getElementById('confirmDeleteAllBtn').disabled = false;
    openModal('deleteAllModal');
  };

  window.deleteAllMembers = async function() {
    const btn = document.getElementById('confirmDeleteAllBtn');
    btn.disabled = true; btn.textContent = 'Deleting...';
    try {
      const snapshot = await getDocs(membersCol);
      await Promise.all(snapshot.docs.map(d => deleteDoc(doc(db, 'members', d.id))));
      showToast('All members deleted successfully', 'success');
      closeModal('deleteAllModal');
    } catch(err) {
      console.error('Delete all error:', err);
      showToast('Error deleting members: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Yes, Delete All';
    }
  };

  window._openRejoinModal = function(memberId, memberName) {
    document.getElementById('rejoinMemberId').value         = memberId;
    document.getElementById('rejoinMemberName').textContent = memberName;
    document.getElementById('rejoinDate').value             = new Date().toLocaleDateString('en-CA');
    openModal('rejoinModal');
  };
  window.openRejoinModal = function(memberId) {
    const m = allMembers.find(x => x.id === memberId);
    window._openRejoinModal(memberId, m ? m.name : 'Member');
  };

  window.confirmRejoin = async function() {
    const id   = document.getElementById('rejoinMemberId').value;
    const date = document.getElementById('rejoinDate').value;
    if (!date) { showToast('Please select a rejoin date', 'error'); return; }
    if (!id)   { showToast('Invalid member ID', 'error'); return; }
    try {
      const m       = allMembers.find(x => x.id === id);
      const pkg     = (m?.package || '1 Month');
      const months  = PACKAGE_MONTHS[pkg.toLowerCase()] || 1;
      const powerId = padPowerId(m?.powerId || '0');

      await updateDoc(doc(db, 'members', id), {
        status:      'active',
        joinDate:    date,
        joinedDate:  Timestamp.fromDate(new Date(date + 'T00:00:00')),
        lastPayment: Timestamp.fromDate(new Date(date + 'T00:00:00'))
      });

      await addDoc(collection(db, 'fees'), buildFeeDoc(id, powerId, m?.name || '', m?.fee || 0, date, pkg));

      showToast('Member rejoined successfully', 'success');
      closeModal('rejoinModal');
    } catch(err) {
      console.error('Rejoin error:', err);
      showToast('Error: ' + err.message, 'error');
    }
  };
