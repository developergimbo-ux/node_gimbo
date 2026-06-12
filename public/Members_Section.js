        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
        import {
            getFirestore,
            collection,
            getDocs,
            addDoc,
            query,
            where,
            serverTimestamp,
            orderBy,
            onSnapshot
        } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

        const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

        let members            = [];
        let todayAttendanceMap = new Map(); // key: padded "001"
        let currentSearchId    = null;
        let pendingPowerId     = null;
        let unsubMembers       = null;
        let unsubAttendance    = null;

        // SINGLE key format: always padded "001"
        function padId(id) {
            return String(id).trim().padStart(3, '0');
        }

        function getDateString(d) {
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        }
        function getToday() { return getDateString(new Date()); }
        function isSunday(dateStr) { return new Date(dateStr + 'T00:00:00').getDay() === 0; }
        function formatEnergonId(id) { return padId(id); }
        function getCurrentDayIndex() {
            const d = new Date().getDay();
            return d === 0 ? -1 : d - 1;
        }
        function canEditAttendance() { const d = getCurrentDayIndex(); return d >= 0 && d <= 5; }
        function getStreakClass(s) {
            if (s <= 0) return 'streak-0';
            if (s >= 6) return 'streak-6';
            return `streak-${s}`;
        }
        function getStreakBadgeHTML(s) {
            const cls  = getStreakClass(s);
            const fire = s >= 5 ? '<span class="fire-icon">🔥</span>' : '';
            const day  = s === 1 ? 'Day' : 'Days';
            return `<span class="streak-badge ${cls}">${fire}${s} ${day}</span>`;
        }
        function resolvePowerId(data) {
            const raw = data.powerId ?? data.energonId ?? data.energon_id ?? data.power_id
                ?? data.memberId ?? data.member_id ?? data.id ?? null;
            return raw != null ? padId(raw) : null;
        }

        function buildDateRange(startDateStr, endDateStr) {
            const dates = [];
            const cur = new Date(startDateStr + 'T00:00:00');
            const end = new Date(endDateStr   + 'T00:00:00');
            while (cur <= end) {
                dates.push(getDateString(cur));
                cur.setDate(cur.getDate() + 1);
            }
            return dates;
        }

        // Fetch historical attendance from Firestore for date range
        // Also merges in todayAttendanceMap for today's live status
        async function fetchMemberAttendanceMap(powerId, startDate, endDate) {
            const key        = padId(powerId);
            const altKey     = String(Number(key)); // "001" → "1" for legacy docs
            const idsToQuery = [...new Set([key, altKey])];
            const recordMap  = new Map();

            // Inject today's live attendance first (most accurate source)
            const today    = getToday();
            const liveRec  = todayAttendanceMap.get(key);
            if (liveRec && today >= startDate && today <= endDate) {
                recordMap.set(today, liveRec.status);
            }

            try {
                await Promise.all(idsToQuery.map(async (idVariant) => {
                    const q    = query(collection(db, 'attendance'), where('powerId', '==', idVariant));
                    const snap = await getDocs(q);
                    snap.forEach(d => {
                        const data = d.data();
                        if (!data.date) return;
                        if (data.date < startDate || data.date > endDate) return;
                        // Don't overwrite today's live value
                        if (data.date === today) return;
                        if (!recordMap.has(data.date) || data.status === 'present') {
                            recordMap.set(data.date, data.status);
                        }
                    });
                }));
            } catch(e) { console.error('fetchMemberAttendanceMap error:', e); }
            return recordMap;
        }

        async function calcStreakAndBreak(member) {
            const today        = getToday();
            const lookbackDate = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return getDateString(d); })();
            const startDate    = member.joinDate && member.joinDate > lookbackDate ? member.joinDate : lookbackDate;
            const recordMap    = await fetchMemberAttendanceMap(member.powerId, startDate, today);
            const membershipDays = member.membershipDays || 30;

            // All non-Sunday days from startDate up to today
            // Sundays are excluded entirely - they never count as a gap
            const dates = buildDateRange(startDate, today).filter(d => !isSunday(d));

            let streak = 0;

            // Walk backwards from today counting the current unbroken run.
            // Rules:
            //   - Today is skipped if not yet marked (may be early in the day)
            //   - Any absent/unmarked non-Sunday day that is NOT today breaks streak immediately -> reset to 0 and stop
            for (let i = dates.length - 1; i >= 0; i--) {
                const d      = dates[i];
                const status = recordMap.get(d);

                if (status === 'present') {
                    streak++;
                } else {
                    // Allow skipping today only - attendance may not be saved yet
                    if (d === today) continue;
                    // Any other gap (Mon-Sat, not Sunday) breaks the streak immediately
                    break;
                }
            }

            if (streak === 0) {
                return { streak: 0, breakDays: 0, brokeStreak: false, inactive: false };
            }
            if (streak > membershipDays) {
                return { streak: 0, breakDays: streak, inactive: true };
            }
            return { streak, breakDays: 0, brokeStreak: false, inactive: false };
        }

        async function refreshStreaks() {
            await Promise.all(members.map(async (m) => {
                const result  = await calcStreakAndBreak(m);
                m.streak      = result.streak;
                m.breakDays   = result.breakDays;
                m.brokeStreak = result.brokeStreak;
                m.inactive    = result.inactive;
                updateMemberCard(m);
            }));
        }

        const el = {
            daysRow:           document.getElementById('daysRow'),
            searchInput:       document.getElementById('searchInput'),
            clearSearch:       document.getElementById('clearSearch'),
            memberList:        document.getElementById('memberList'),
            noResults:         document.getElementById('noResults'),
            loadingOverlay:    document.getElementById('loadingOverlay'),
            errorBanner:       document.getElementById('errorBanner'),
            retryBtn:          document.getElementById('retryBtn'),
            fullscreenBtn:     document.getElementById('fullscreenBtn'),
            exitFullscreenBtn: document.getElementById('exitFullscreenBtn'),
            confirmModal:      document.getElementById('confirmModal'),
            confirmClose:      document.getElementById('confirmClose'),
            confirmSave:       document.getElementById('confirmSave'),
            confirmCancel:     document.getElementById('confirmCancel'),
            confirmMemberName: document.getElementById('confirmMemberName'),
            graphModal:        document.getElementById('graphModal'),
            graphClose:        document.getElementById('graphClose'),
            graphAvatar:       document.getElementById('graphAvatar'),
            graphMemberName:   document.getElementById('graphMemberName'),
            graphMemberId:     document.getElementById('graphMemberId'),
            graphPresent:      document.getElementById('graphPresent'),
            graphAbsent:       document.getElementById('graphAbsent'),
            lineGraphSvg:      document.getElementById('lineGraphSvg'),
            graphLoading:      document.getElementById('graphLoading'),
            trendArrow:        document.getElementById('trendArrow'),
            trendText:         document.getElementById('trendText'),
            journeyText:       document.getElementById('journeyText'),
            toast:             document.getElementById('toast'),
            graphXLabels:      document.getElementById('graphXLabels'),
            planProgressWrap:  document.getElementById('planProgressWrap'),
            planProgressFill:  document.getElementById('planProgressFill'),
            planProgressUsed:  document.getElementById('planProgressUsed'),
            planProgressTotal: document.getElementById('planProgressTotal'),
            toastText:         document.getElementById('toastText'),
        };

        function showToast(message, isError = false) {
            el.toastText.textContent = message;
            el.toast.classList.toggle('error', isError);
            el.toast.classList.add('show');
            setTimeout(() => el.toast.classList.remove('show'), 3000);
        }
        function enterFullscreen() {
            const e = document.documentElement;
            (e.requestFullscreen || e.webkitRequestFullscreen || e.msRequestFullscreen)?.call(e);
        }
        function exitFullscreen() {
            (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen)?.call(document);
        }
        function openModal(m)  { m.classList.add('active');    document.body.style.overflow = 'hidden'; }
        function closeModal(m) { m.classList.remove('active'); document.body.style.overflow = ''; }

        function listenMembersRealtime() {
            if (unsubMembers) { unsubMembers(); unsubMembers = null; }
            el.loadingOverlay.classList.add('visible');
            el.errorBanner.classList.remove('visible');
            el.memberList.innerHTML = '';
            const membersQuery = query(collection(db, 'members'), orderBy('powerId', 'asc'));
            unsubMembers = onSnapshot(membersQuery,
                (snap) => {
                    el.loadingOverlay.classList.remove('visible');
                    if (snap.empty) {
                        el.memberList.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:40px 20px;"><div style="font-size:2rem;margin-bottom:12px;">📭</div><div style="font-size:1rem;font-weight:600;margin-bottom:8px;">No members found</div></div>`;
                        return;
                    }
                    const prevMap = new Map(members.map(m => [m.powerId, m]));
                    members = snap.docs.map(d => {
                        const data    = d.data();
                        const rawId   = data.powerId ?? data.energonId ?? data.energon_id ?? data.power_id ?? data.memberId ?? data.member_id ?? d.id;
                        const powerId = padId(rawId); // always "001" format
                        const name    = data.name ?? data.memberName ?? data.fullName ?? data.full_name ?? 'Unknown';
                        const prev    = prevMap.get(powerId);

                        let joinDate = null;
                        if (data.createdAt?.toDate) {
                            joinDate = getDateString(data.createdAt.toDate());
                        } else if (data.joinDate) {
                            joinDate = data.joinDate;
                        } else if (data.startDate) {
                            joinDate = data.startDate;
                        }

                        const liveRec = todayAttendanceMap.get(powerId);
                        const isPresent = liveRec
                            ? liveRec.status === 'present'
                            : (prev ? prev.present : false);

                        return {
                            docId:         d.id,
                            powerId,
                            powerIdNum:    parseInt(powerId, 10),
                            name,
                            package:       data.package ?? data.plan ?? '',
                            status:        data.status  ?? 'active',
                            joinDate,
                            membershipDays: Number(data.membershipDays ?? data.membership_days ?? data.duration ?? 30),
                            present:     isPresent,
                            streak:      prev ? prev.streak      : 0,
                            breakDays:   prev ? prev.breakDays   : 0,
                            brokeStreak: prev ? prev.brokeStreak : false,
                            inactive:    prev ? prev.inactive    : false,
                        };
                    }).filter(m => m.powerId && m.name && m.name !== 'Unknown');
                    members.sort((a, b) => a.powerIdNum - b.powerIdNum);
                    renderMemberList();
                    if (!unsubAttendance) {
                        listenAttendanceRealtime();
                    } else {
                        members.forEach(m => updateMemberCard(m));
                    }
                    refreshStreaks();
                },
                (err) => {
                    el.loadingOverlay.classList.remove('visible');
                    const isPerm = err.code === 'permission-denied'
                        || err.message?.toLowerCase().includes('permission')
                        || err.message?.toLowerCase().includes('missing or insufficient');
                    if (isPerm) { el.errorBanner.classList.add('visible'); }
                    else { showToast(`Firebase error: ${err.message}`, true); }
                }
            );
        }

        function listenAttendanceRealtime() {
            if (unsubAttendance) { unsubAttendance(); unsubAttendance = null; }
            const today = getToday();
            const q     = query(collection(db, 'attendance'), where('date', '==', today));
            unsubAttendance = onSnapshot(q,
                (snap) => {
                    todayAttendanceMap.clear();
                    snap.forEach(d => {
                        const data = d.data();
                        const key  = resolvePowerId(data); // always padded
                        if (!key) return;
                        const existing = todayAttendanceMap.get(key);
                        if (!existing || data.status === 'present') {
                            todayAttendanceMap.set(key, { docId: d.id, status: data.status || 'absent' });
                        }
                    });
                    members.forEach(m => {
                        const rec = todayAttendanceMap.get(m.powerId);
                        m.present = rec ? rec.status === 'present' : false;
                        updateMemberCard(m);
                    });
                    refreshStreaks();
                },
                (err) => { console.error('listenAttendanceRealtime error:', err); showToast('Real-time sync failed', true); }
            );
        }

        async function markAttendance(member) {
            const today  = getToday();
            const key    = padId(member.powerId);
            const existing = todayAttendanceMap.get(key);
            try {
                if (existing) { showToast(`${member.name} — Already marked today ✅`); return; }
                const card = document.querySelector(`.member-card[data-id="${member.powerId}"]`);
                if (card) card.classList.add('saving');
                await addDoc(collection(db, 'attendance'), {
                    powerId   : key,
                    name      : member.name,
                    date      : today,
                    status    : 'present',
                    timestamp : serverTimestamp()
                });
                showToast(`${member.name} marked Present ✅`);
            } catch (err) {
                console.error('markAttendance error:', err);
                const card = document.querySelector(`.member-card[data-id="${member.powerId}"]`);
                if (card) card.classList.remove('saving');
                showToast('Failed to save attendance', true);
            }
        }

        async function getMemberHistory(member) {
            const today     = getToday();
            const startDate = member.joinDate || (() => { const d = new Date(); d.setDate(d.getDate() - 89); return getDateString(d); })();
            const recordMap = await fetchMemberAttendanceMap(member.powerId, startDate, today);
            const allDates  = buildDateRange(startDate, today).filter(d => !isSunday(d));
            return allDates.map(date => ({ date, present: recordMap.get(date) === 'present' ? 1 : 0 }));
        }

        function getStreakBadgeWithBreakHTML(member) {
            if (member.inactive) {
                return `<span class="streak-badge streak-0">Inactive</span>`;
            }
            // Only show "broke" if they have NO current streak at all
            if (member.brokeStreak && member.breakDays > 0 && member.streak === 0) {
                return `<span class="streak-badge streak-0">Broke ${member.breakDays}d ago</span>`;
            }
            return getStreakBadgeHTML(member.streak);
        }

        function renderMemberList() {
            if (!members.length) {
                if (!el.errorBanner.classList.contains('visible')) {
                    el.memberList.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px">No members found in Firebase.</p>';
                }
                return;
            }
            el.memberList.innerHTML = members.map(member => {
                const statusClass = member.present ? 'present' : 'absent';
                const statusText  = member.present ? 'Present'  : 'Absent';
                const highlighted = currentSearchId === member.powerId ? 'highlighted' : '';
                return `
                    <div class="member-card ${statusClass} ${highlighted}" data-id="${member.powerId}" role="button" tabindex="0">
                        <div class="member-info">
                            <div class="member-avatar">${member.name.charAt(0).toUpperCase()}</div>
                            <div class="member-details">
                                <div class="member-name">${member.name}</div>
                                <div class="member-id">
                                    <span class="id-label">Energon ID:</span>
                                    <span class="id-value">${formatEnergonId(member.powerId)}</span>
                                </div>
                            </div>
                        </div>
                        <div class="member-right">
                            <button class="graph-btn" data-graph-id="${member.powerId}" title="View Progress Journey">
                                <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                            </button>
                            ${getStreakBadgeWithBreakHTML(member)}
                            <div class="status-btn ${statusClass}">
                                <span class="status-indicator"></span>${statusText}
                            </div>
                        </div>
                    </div>`;
            }).join('');
            attachMemberCardListeners();
        }

        function updateMemberCard(member) {
            const card = document.querySelector(`.member-card[data-id="${member.powerId}"]`);
            if (!card) return;
            const statusClass = member.present ? 'present' : 'absent';
            const statusText  = member.present ? 'Present'  : 'Absent';
            card.className    = card.className.replace(/\b(present|absent)\b/g, '').trim() + ` ${statusClass}`;
            const statusBtn   = card.querySelector('.status-btn');
            if (statusBtn) {
                statusBtn.className = `status-btn ${statusClass}`;
                statusBtn.innerHTML = `<span class="status-indicator"></span>${statusText}`;
            }
            const streakEl = card.querySelector('.streak-badge');
            if (streakEl) streakEl.outerHTML = getStreakBadgeWithBreakHTML(member);
            card.classList.remove('saving');
        }

        async function updateGraph(member) {
            el.graphLoading.style.display = 'flex';
            el.lineGraphSvg.style.display = 'none';
            el.graphPresent.textContent   = '---';
            el.graphAbsent.textContent    = '---';
            el.trendText.textContent      = 'Loading...';

            const history      = await getMemberHistory(member);
            const presentCount = history.filter(d => d.present === 1).length;
            const absentCount  = history.filter(d => d.present === 0).length;

            el.graphPresent.textContent = presentCount;
            el.graphAbsent.textContent  = absentCount;

            // Trend: compare first half vs second half attendance
            const half        = Math.floor(history.length / 2);
            const prev        = history.slice(0, half).reduce((a, b) => a + b.present, 0);
            const last        = history.slice(half).reduce((a, b) => a + b.present, 0);
            const isImproving = last >= prev;
            el.trendArrow.textContent = isImproving ? '⬆' : '⬇';
            el.trendArrow.className   = `trend-arrow ${isImproving ? 'up' : 'down'}`;
            el.trendText.textContent  = isImproving ? 'Improving' : 'Needs Focus';

            const msgs = isImproving
                ? ['Great progress! Keep the momentum going! 🚀', 'Your dedication is paying off! 💪', 'Excellent improvement trend! ⭐']
                : ['Every day is a new opportunity! 🌟', 'Small steps lead to big changes! 💫', 'Stay focused, you got this! 🎯'];
            el.journeyText.textContent = msgs[Math.floor(Math.random() * msgs.length)];

            // -----------------------------------------------------------
            // Score logic: each day's score = cumulative fitness level
            //   Present  -> score += GAIN  (going up, momentum builds)
            //   Absent   -> score -= PENALTY (going down, but floor at 0)
            //
            // We use a variable GAIN so consecutive attendance rewards more:
            //   - consecutive streak of 1  -> +1
            //   - consecutive streak of 2  -> +2
            //   - consecutive streak of 3+ -> +3 (capped)
            //   Absent always = -2 (punishes harder than a single-day gain)
            // -----------------------------------------------------------
            const ABSENT_PENALTY = 2;
            const MAX_GAIN = 3;

            const progress = [];
            let score = 0;
            let consec = 0; // consecutive present days

            // Anchor at day 0, score 0 (graph always starts from bottom-left)
            progress.push({ day: 0, score: 0, present: false, anchor: true });

            history.forEach((d, i) => {
                if (d.present === 1) {
                    consec++;
                    const gain = Math.min(consec, MAX_GAIN);
                    score += gain;
                } else {
                    consec = 0;
                    score = Math.max(0, score - ABSENT_PENALTY);
                }
                progress.push({ day: i + 1, score, present: d.present === 1, anchor: false });
            });

            const totalDays = history.length; // actual days elapsed since join (no Sundays)
            const planDays  = member.membershipDays || 30;
            const pct       = Math.min(100, Math.round((totalDays / planDays) * 100));

            // --- Dynamic x-axis labels: Day 1 ... quarter ... half ... totalDays ---
            const q1 = Math.round(totalDays * 0.33);
            const q2 = Math.round(totalDays * 0.66);
            el.graphXLabels.innerHTML = `
                <span class="graph-x-label">Day 1</span>
                <span class="graph-x-label">Day ${q1 || ''}</span>
                <span class="graph-x-label">Day ${q2 || ''}</span>
                <span class="graph-x-label">Day ${totalDays}</span>`;

            // --- Plan progress bar ---
            el.planProgressWrap.style.display = 'block';
            el.planProgressFill.style.width    = pct + '%';
            el.planProgressUsed.textContent    = `${totalDays} days used`;
            el.planProgressTotal.textContent   = `/ ${planDays} day plan`;

            renderLineGraph(progress);
            el.graphLoading.style.display = 'none';
            el.lineGraphSvg.style.display = 'block';
        }

                function renderLineGraph(progress) {
            if (!progress || progress.length < 2) return;
            const svg     = el.lineGraphSvg;
            const width   = 560;
            const height  = 140;
            const padding = 10;
            const maxScore = Math.max(...progress.map(p => p.score), 1);
            const { path, points } = generateSmoothPath(progress, width - padding * 2, height - padding * 2, maxScore);

            let svgContent = `<defs><linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#00ff88;stop-opacity:0.3"/>
                <stop offset="100%" style="stop-color:#00ff88;stop-opacity:0"/>
            </linearGradient></defs>`;

            for (let i = 0; i <= 4; i++) {
                const y = padding + (height - padding * 2) * i / 4;
                svgContent += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" class="graph-grid-line"/>`;
            }

            // Baseline at bottom (score = 0)
            const baselineY = padding + (height - padding * 2);
            svgContent += `<line x1="${padding}" y1="${baselineY}" x2="${width - padding}" y2="${baselineY}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;

            if (points.length > 1) {
                const areaPath = `${path} L ${points[points.length-1].x + padding} ${height - padding} L ${padding} ${height - padding} Z`;
                svgContent += `<path d="${areaPath}" fill="url(#areaGradient)"/>`;
            }

            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i], p2 = points[i+1];
                const isUp  = p2.score >= p1.score;
                const color = isUp ? 'var(--graph-up)' : 'var(--graph-down)';
                const glow  = isUp ? 'var(--present-glow)' : 'var(--absent-glow)';
                const t = 0.3;
                svgContent += `<path d="M ${p1.x+padding} ${p1.y+padding} C ${p1.x+(p2.x-p1.x)*t+padding} ${p1.y+padding}, ${p2.x-(p2.x-p1.x)*t+padding} ${p2.y+padding}, ${p2.x+padding} ${p2.y+padding}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${glow})"/>`;
            }

            points.forEach((p, i) => {
                if (p.anchor) return; // skip the silent anchor dot
                // Show dot on every day so present/absent is visually clear on all days
                if (true) {
                    const color = p.present ? 'var(--graph-up)' : 'var(--graph-down)';
                    const glow  = p.present ? 'var(--present-glow)' : 'var(--absent-glow)';
                    svgContent += `<circle cx="${p.x+padding}" cy="${p.y+padding}" r="4" fill="${color}" style="filter:drop-shadow(0 0 4px ${glow})"/>`;
                }
            });

            svg.innerHTML = svgContent;
        }

        function generateSmoothPath(pts, width, height, maxScore) {
            if (pts.length < 2) return { path: '', points: [] };
            const xScale = width  / (pts.length - 1);
            const yScale = maxScore > 0 ? height / maxScore : height;
            const scaled = pts.map((p, i) => ({
                x: i * xScale,
                y: height - p.score * yScale,
                score: p.score,
                present: p.present,
                anchor: p.anchor || false
            }));
            let path = `M ${scaled[0].x} ${scaled[0].y}`;
            for (let i = 0; i < scaled.length - 1; i++) {
                const p0 = scaled[i], p1 = scaled[i+1];
                const t  = 0.3;
                path += ` C ${p0.x+(p1.x-p0.x)*t} ${p0.y}, ${p1.x-(p1.x-p0.x)*t} ${p1.y}, ${p1.x} ${p1.y}`;
            }
            return { path, points: scaled };
        }

        function renderDayLockSystem() {
            const cur = getCurrentDayIndex();
            el.daysRow.innerHTML = DAYS.map((day, i) => {
                let cls = '', txt = '';
                if (cur === -1 || i < cur) { cls = 'locked'; txt = 'Locked'; }
                else if (i === cur)         { cls = 'current'; txt = 'Active'; }
                else                        { cls = 'future'; txt = 'Upcoming'; }
                return `<div class="day-cell ${cls}">
                    <span class="lock-badge"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
                    <span class="day-name">${day}</span>
                    <span class="day-cell-status">${txt}</span>
                </div>`;
            }).join('');
        }

        function attachMemberCardListeners() {
            document.querySelectorAll('.member-card').forEach(card => {
                card.addEventListener('click', e => {
                    if (e.target.closest('.graph-btn')) return;
                    if (canEditAttendance()) showConfirmModal(card.dataset.id);
                });
                card.addEventListener('keydown', e => {
                    if ((e.key === 'Enter' || e.key === ' ') && canEditAttendance()) {
                        e.preventDefault(); showConfirmModal(card.dataset.id);
                    }
                });
            });
            document.querySelectorAll('.graph-btn').forEach(btn => {
                btn.addEventListener('click', e => { e.stopPropagation(); showGraphModal(btn.dataset.graphId); });
            });
        }

        function showConfirmModal(powerId) {
            const member = members.find(m => m.powerId === powerId);
            if (!member) return;
            // Already marked present today — don't open modal, just show toast
            if (member.present) {
                showToast(`${member.name} — Already marked Present today ✅`);
                return;
            }
            pendingPowerId = powerId;
            el.confirmMemberName.textContent = member.name;
            openModal(el.confirmModal);
        }

        async function confirmSaveAttendance() {
            if (!pendingPowerId) return;
            const member = members.find(m => m.powerId === pendingPowerId);
            if (!member) return;
            el.confirmSave.disabled    = true;
            el.confirmSave.textContent = 'Saving…';
            await markAttendance(member);
            el.confirmSave.disabled    = false;
            el.confirmSave.textContent = 'Save';
            closeModal(el.confirmModal);
            pendingPowerId = null;
        }

        async function showGraphModal(powerId) {
            const member = members.find(m => m.powerId === powerId);
            if (!member) return;
            el.graphAvatar.textContent     = member.name.charAt(0).toUpperCase();
            el.graphMemberName.textContent = member.name;
            el.graphMemberId.textContent   = `Energon ID: ${formatEnergonId(member.powerId)}`;
            openModal(el.graphModal);
            await updateGraph(member);
        }

        function handleSearch(queryStr) {
            const trimmed = queryStr.trim();
            el.clearSearch.classList.toggle('visible', trimmed.length > 0);
            document.querySelectorAll('.member-card').forEach(c => c.classList.remove('hidden', 'highlighted'));
            if (!trimmed) { currentSearchId = null; el.noResults.classList.remove('visible'); return; }
            const match = members.find(m =>
                padId(m.powerId) === trimmed.padStart(3, '0') ||
                m.powerId === trimmed ||
                m.name.toUpperCase().includes(trimmed.toUpperCase())
            );
            if (match) {
                document.querySelectorAll('.member-card').forEach(c => { if (c.dataset.id !== match.powerId) c.classList.add('hidden'); });
                const card = document.querySelector(`.member-card[data-id="${match.powerId}"]`);
                if (card) { card.classList.add('highlighted'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                currentSearchId = match.powerId;
                el.noResults.classList.remove('visible');
            } else {
                document.querySelectorAll('.member-card').forEach(c => c.classList.add('hidden'));
                el.noResults.classList.add('visible');
                currentSearchId = null;
            }
        }

        function clearSearch() {
            el.searchInput.value = '';
            currentSearchId = null;
            el.clearSearch.classList.remove('visible');
            el.noResults.classList.remove('visible');
            document.querySelectorAll('.member-card').forEach(c => c.classList.remove('hidden', 'highlighted'));
            el.searchInput.focus();
        }

        function initEventListeners() {
            el.searchInput.addEventListener('input',   e => handleSearch(e.target.value));
            el.clearSearch.addEventListener('click',   clearSearch);
            el.searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') clearSearch(); });
            el.fullscreenBtn.addEventListener('click',     enterFullscreen);
            el.exitFullscreenBtn.addEventListener('click', exitFullscreen);
            el.confirmClose.addEventListener('click',  () => closeModal(el.confirmModal));
            el.confirmCancel.addEventListener('click', () => closeModal(el.confirmModal));
            el.confirmSave.addEventListener('click',   confirmSaveAttendance);
            el.graphClose.addEventListener('click',    () => closeModal(el.graphModal));
            el.confirmModal.addEventListener('click',  e => { if (e.target === el.confirmModal) closeModal(el.confirmModal); });
            el.graphModal.addEventListener('click',    e => { if (e.target === el.graphModal)   closeModal(el.graphModal);   });
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') { closeModal(el.confirmModal); closeModal(el.graphModal); }
            });
            el.retryBtn.addEventListener('click', () => { el.errorBanner.classList.remove('visible'); listenMembersRealtime(); });
        }

        async function init() {
            renderDayLockSystem();
            initEventListeners();
            listenMembersRealtime();
        }

        init();

        window.AttendanceSection = {
            getMembers:       () => JSON.parse(JSON.stringify(members)),
            getSummary:       () => ({ total: members.length, present: members.filter(m => m.present).length, absent: members.filter(m => !m.present).length }),
            refresh:          () => { listenMembersRealtime(); },
            listenAttendance: () => { listenAttendanceRealtime(); }
        };
