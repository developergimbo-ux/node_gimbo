import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const XLSX = window.XLSX;

const app = initializeApp({
    apiKey: "AIzaSyBawDWPi-NvWl3bKyGVIFi-v9FX7yHraEI",
    authDomain: "gimbo-dc910.firebaseapp.com",
    projectId: "gimbo-dc910",
    storageBucket: "gimbo-dc910.firebasestorage.app",
    messagingSenderId: "294864961933",
    appId: "1:294864961933:web:61d6c4086c09a506bf3dc4"
});
const db = getFirestore(app);

const COL = { members:'members', attendance:'attendance', fees:'fees' };

// ── Helpers ───────────────────────────────────────────────────
const _dateFmtCache = new Map();
function normalizeDate(v) {
    if (!v) return '';
    if (typeof v === 'number') return new Date(Math.round((v-25569)*86400000)).toISOString().slice(0,10);
    if (v instanceof Date) return isNaN(v)?'':v.toISOString().slice(0,10);
    const s=String(v).trim(); if(!s) return '';
    if (_dateFmtCache.has(s)) return _dateFmtCache.get(s);
    let r = /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):(d=>isNaN(d)?s:d.toISOString().slice(0,10))(new Date(s));
    if (_dateFmtCache.size<2000) _dateFmtCache.set(s,r);
    return r;
}
function safeLocalDate(v) {
    if(!v) return null;
    if(typeof v.toDate==='function') return v.toDate();
    if(v instanceof Date) return isNaN(v)?null:v;
    if(typeof v==='number') return new Date(v);
    const s=String(v).trim(); if(!s) return null;
    const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return new Date(Number(iso[1]),Number(iso[2])-1,Number(iso[3]));
    const d=new Date(s); return isNaN(d)?null:d;
}
function safeNum(v){const n=parseFloat(v);return isNaN(n)?0:n;}
function pidOf(r){return String(r.powerId||r.memberid||r['power id']||'').trim();}
function feeDate(f){return f.paymentDate||f.lastpayment||f.date||f.month||'';}
function _rptPkgMonths(pkg){
    if(!pkg) return 1;
    const s=pkg.toLowerCase();
    if(s.includes('year')){const n=parseFloat(s)||1;return Math.round(n*12);}
    if(s.includes('half')) return 6;
    if(s.includes('quarter')) return 3;
    if(s.includes('annual')) return 12;
    const mm=s.match(/(\d+\.?\d*)\s*month/);if(mm) return parseFloat(mm[1]);
    const num=parseFloat(s);return(!isNaN(num)&&num>0)?num:1;
}
function _rptAddMonths(d,m){const r=new Date(d);r.setMonth(r.getMonth()+Math.floor(m));return r;}
function _getPickerMonth(id){
    const el=document.getElementById(id);
    if(el&&el.value){const[y,m]=el.value.split('-').map(Number);return{year:y,month:m-1};}
    const n=new Date();return{year:n.getFullYear(),month:n.getMonth()};
}
function _sortByPid(rows,k='Power ID'){
    return rows.slice().sort((a,b)=>{
        const an=parseFloat(String(a[k]||'')),bn=parseFloat(String(b[k]||''));
        return(!isNaN(an)&&!isNaN(bn))?an-bn:String(a[k]||'').localeCompare(String(b[k]||''));
    });
}

// ── Live state ────────────────────────────────────────────────
let _fbMembers=[], _fbFees=[], _fbAttendance=[];
let _cache={memberMap:null, activeMembers:null};

function _invalidateCache(){_cache.memberMap=null;_cache.activeMembers=null;}
function _getMemberMap(){
    if(!_cache.memberMap){
        _cache.memberMap=new Map();
        _fbMembers.forEach(m=>{const pid=pidOf(m);if(pid) _cache.memberMap.set(pid,m);});
    }
    return _cache.memberMap;
}
function _getActiveMembers(){
    if(!_cache.activeMembers)
        _cache.activeMembers=_fbMembers.filter(m=>(m.status||'').toLowerCase()==='active');
    return _cache.activeMembers;
}
function _buildLatestFeeMap(){
    const map=new Map();
    for(const f of _fbFees){
        if((f.status||'').toLowerCase()!=='paid') continue;
        const pid=pidOf(f);
        const fd=safeLocalDate(feeDate(f));
        if(!fd) continue;
        if(!map.has(pid)||fd>map.get(pid)) map.set(pid,fd);
    }
    return map;
}

// ── Firebase sync ─────────────────────────────────────────────
onSnapshot(collection(db,COL.members),snap=>{
    _fbMembers=snap.docs.map(d=>({_docId:d.id,...d.data()}));
    _invalidateCache(); _refreshActive();
},e=>console.warn(e));
onSnapshot(collection(db,COL.attendance),snap=>{
    _fbAttendance=snap.docs.map(d=>({id:d.id,...d.data()}));
    _refreshActive();
},e=>console.warn(e));
onSnapshot(collection(db,COL.fees),snap=>{
    _fbFees=snap.docs.map(d=>({id:d.id,...d.data()}));
    _refreshActive();
},e=>console.warn(e));

function _refreshActive(){
    const fp=document.getElementById('rptPanelFees');
    const gp=document.getElementById('rptPanelGrowth');
    const cp=document.getElementById('rptPanelCrowd');
    _initGrowthYear(); // always keep year dropdown in sync with data
    if(fp&&fp.style.display!=='none') updateFeesReport();
    else if(gp&&gp.style.display!=='none') updateGrowthCharts();
    else if(cp&&cp.style.display!=='none') updateCrowdAnalysis();
    else updateReports();
    _renderTopPayers();
    _renderPlanDist();
}

// ── Attendance Report ─────────────────────────────────────────
function updateReports(){
    const{year:selYear,month:selMonth}=_getPickerMonth('rptMonthPicker');
    const today=new Date();today.setHours(23,59,59,999);
    const monthStart=new Date(selYear,selMonth,1);
    const rawEnd=new Date(selYear,selMonth+1,0,23,59,59,999);
    const monthEnd=rawEnd<today?rawEnd:today;

    const activeMembers=_getActiveMembers().slice().sort((a,b)=>{
        const an=parseFloat(String(a.powerId||'')),bn=parseFloat(String(b.powerId||''));
        return(!isNaN(an)&&!isNaN(bn))?an-bn:String(a.powerId||'').localeCompare(String(b.powerId||''));
    });
    document.getElementById('rptActiveMembers').textContent=activeMembers.length;

    const tbody=document.getElementById('rptAttendanceSummaryBody');
    if(!activeMembers.length){
        tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">No active members.</td></tr>';
        ['rptTotalPresent','rptTotalAbsent','rptPerfectAttendance'].forEach(id=>document.getElementById(id).textContent=0);
        return;
    }

    const latestFeeMap=_buildLatestFeeMap();
    const attByPid=new Map(),attByName=new Map();
    for(const a of _fbAttendance){
        const nd=normalizeDate(a.date);if(!nd) continue;
        const d=safeLocalDate(nd);
        if(!d||d.getFullYear()!==selYear||d.getMonth()!==selMonth) continue;
        const pid=pidOf(a),name=(a.name||'').trim().toLowerCase();
        if(pid){if(!attByPid.has(pid)) attByPid.set(pid,[]);attByPid.get(pid).push(a);}
        if(name){if(!attByName.has(name)) attByName.set(name,[]);attByName.get(name).push(a);}
    }

    let totalPresent=0,totalAbsent=0,perfectCount=0;
    const html=[],chartData=[];

    for(const member of activeMembers){
        const memberId=pidOf(member),memberName=member.name||'—',pkg=member.package||member.plan||'—';
        const joinRaw=member.joined||member.joinDate||member.joindate||member.startDate||member.startdate||'';
        const joinDate=safeLocalDate(joinRaw);
        const lastPaidDate=latestFeeMap.get(memberId)||null;
        let startBase=joinDate;
        if(lastPaidDate&&(!joinDate||lastPaidDate>joinDate)){startBase=lastPaidDate;}
        const rangeStart=startBase&&startBase>monthStart?startBase:monthStart;
        const eligibleDays=rangeStart<=monthEnd?Math.round((monthEnd-rangeStart)/86400000)+1:0;

        const seen=new Set(),memberAtt=[];
        for(const a of [...(attByPid.get(memberId)||[]),...(attByName.get(memberName.toLowerCase())||[])]){
            const key=a.id||(normalizeDate(a.date)+'|'+pidOf(a));
            if(!seen.has(key)){seen.add(key);memberAtt.push(a);}
        }
        let presentDays=0;
        for(const a of memberAtt){const s=(a.status||'').toLowerCase();if(s==='present'||s==='inside') presentDays++;}

        const absentDays=Math.max(0,eligibleDays-presentDays);
        totalPresent+=presentDays;totalAbsent+=absentDays;
        if(eligibleDays>0&&absentDays===0&&presentDays>0) perfectCount++;
        const attPct=eligibleDays>0?Math.round((presentDays/eligibleDays)*100):0;
        const pctColor=attPct>=80?'var(--success)':attPct>=50?'var(--warning)':'var(--danger)';

        const todayNow=new Date();
        let daysLeftHtml;
        if(!lastPaidDate){
            daysLeftHtml=`<span style="color:var(--danger);font-weight:600;">Expired</span>`;
        } else {
            const nextDue=_rptAddMonths(lastPaidDate,_rptPkgMonths(pkg));
            const daysLeft=Math.ceil((nextDue-todayNow)/86400000);
            daysLeftHtml=daysLeft<0?`<span style="color:var(--danger);font-weight:600;">Expired</span>`:
                daysLeft<=7?`<span style="color:var(--warning);font-weight:600;">${daysLeft}d</span>`:
                `<span style="color:var(--success);font-weight:600;">${daysLeft}d</span>`;
        }
        html.push(`<tr>
            <td><strong>${memberId||'—'}</strong></td>
            <td>${memberName}</td><td>${pkg}</td>
            <td style="color:var(--success);font-weight:600;">${presentDays}</td>
            <td style="color:var(--danger);font-weight:600;">${absentDays}</td>
            <td style="color:${pctColor};font-weight:600;">${attPct}%</td>
            <td>${daysLeftHtml}</td></tr>`);
        chartData.push({name:memberName.split(' ')[0],present:presentDays,eligible:eligibleDays});
    }
    tbody.innerHTML=html.join('');
    document.getElementById('rptTotalPresent').textContent=totalPresent;
    document.getElementById('rptTotalAbsent').textContent=totalAbsent;
    document.getElementById('rptPerfectAttendance').textContent=perfectCount;
    _renderTopPayers();
    _renderPlanDist();
}

// ── Top Paying Customers ──────────────────────────────────────
function _renderTopPayers(){
    const totals=new Map();
    for(const f of _fbFees){
        if((f.status||'').toLowerCase()!=='paid') continue;
        const pid=pidOf(f); if(!pid) continue;
        totals.set(pid,(totals.get(pid)||0)+safeNum(f.amount));
    }
    const memberMap=_getMemberMap();
    const topN=parseInt(_gymConfig?.topPayersCount)||10;
    const sorted=[...totals.entries()].sort((a,b)=>{
        if(b[1]!==a[1]) return b[1]-a[1]; // higher paid first
        const an=parseFloat(a[0]),bn=parseFloat(b[0]); // tiebreak: lower powerId first
        return(!isNaN(an)&&!isNaN(bn))?an-bn:String(a[0]).localeCompare(String(b[0]));
    }).slice(0,topN);
    const tbody=document.getElementById('topPayersBody');
    if(!sorted.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);">No fee data found.</td></tr>';return;}
    tbody.innerHTML=sorted.map(([pid,total],i)=>{
        const m=memberMap.get(pid)||{};
        const name=m.name||pid, phone=m.phone||m.mobile||m.contact||'—', pkg=m.package||m.plan||'—';
        const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}`;
        return `<tr style="cursor:pointer;" onclick="showMemberModal('${pid}')" title="Click to view details">
            <td style="font-weight:700;font-size:1rem;">${medal}</td>
            <td style="font-family:monospace;color:var(--accent);">${pid}</td>
            <td style="font-weight:600;">${name}</td>
            <td style="color:var(--text-secondary);">${phone}</td>
            <td>${pkg}</td>
            <td style="color:var(--success);font-weight:700;">₹${total.toLocaleString('en-IN')}</td>
        </tr>`;
    }).join('');
}

// ── Plan Distribution ─────────────────────────────────────────
function _renderPlanDist(){
    const planCount=new Map();
    for(const m of _fbMembers){
        if((m.status||'').toLowerCase()==='left') continue;
        const pkg=(m.package||m.plan||'Unknown').trim()||'Unknown';
        planCount.set(pkg,(planCount.get(pkg)||0)+1);
    }
    const sorted=[...planCount.entries()].sort((a,b)=>b[1]-a[1]);
    const total=sorted.reduce((s,[,c])=>s+c,0)||1;

    // Plan distribution bars
    const distEl=document.getElementById('planDistBody');
    const colors=['var(--accent)','var(--success)','var(--purple)','var(--warning)','var(--danger)'];
    distEl.innerHTML=sorted.map(([plan,count],i)=>{
        const pct=Math.round((count/total)*100);
        return `<div style="padding:10px 20px;border-bottom:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
                <span style="font-size:.9rem;font-weight:500;">${plan}</span>
                <span style="font-size:.85rem;color:var(--text-muted);">${count} members · ${pct}%</span>
            </div>
            <div style="height:6px;background:var(--border);border-radius:4px;">
                <div style="height:100%;width:${pct}%;background:${colors[i%colors.length]};border-radius:4px;transition:width .4s;"></div>
            </div>
        </div>`;
    }).join('')||`<div style="padding:30px;text-align:center;color:var(--text-muted);">No plan data.</div>`;

    // Most & Least popular
    const topBotEl=document.getElementById('planTopBotBody');
    if(!sorted.length){topBotEl.innerHTML='<div style="color:var(--text-muted);padding:10px;">No data.</div>';return;}
    const top=sorted[0], bot=sorted[sorted.length-1];
    topBotEl.innerHTML=`
        <div style="margin-bottom:18px;">
            <div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Most Popular</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--success);">${top[0]}</div>
            <div style="font-size:.85rem;color:var(--text-secondary);margin-top:3px;">${top[1]} members · ${Math.round(top[1]/total*100)}% of gym</div>
            <div style="height:4px;background:var(--border);border-radius:4px;margin-top:8px;"><div style="height:100%;width:${Math.round(top[1]/total*100)}%;background:var(--success);border-radius:4px;"></div></div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:18px;">
            <div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Least Popular</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--danger);">${bot[0]}</div>
            <div style="font-size:.85rem;color:var(--text-secondary);margin-top:3px;">${bot[1]} member${bot[1]>1?'s':''} · ${Math.round(bot[1]/total*100)}% of gym</div>
            <div style="height:4px;background:var(--border);border-radius:4px;margin-top:8px;"><div style="height:100%;width:${Math.max(2,Math.round(bot[1]/total*100))}%;background:var(--danger);border-radius:4px;"></div></div>
        </div>
        ${sorted.length>2?`<div style="border-top:1px solid var(--border);padding-top:14px;margin-top:14px;">
            <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:8px;">ALL PLANS RANKED</div>
            ${sorted.map(([p,c],i)=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:.82rem;"><span>${i+1}. ${p}</span><span style="color:var(--text-muted);">${c}</span></div>`).join('')}
        </div>`:''}`;
}

// ── Member Modal ──────────────────────────────────────────────
window.showMemberModal=function(pid){
    const m=_getMemberMap().get(pid)||{};
    const totals=new Map();
    for(const f of _fbFees){
        if((f.status||'').toLowerCase()!=='paid') continue;
        const p=pidOf(f);if(p) totals.set(p,(totals.get(p)||0)+safeNum(f.amount));
    }
    const totalPaid=totals.get(pid)||0;
    const fees=_fbFees.filter(f=>pidOf(f)===pid&&(f.status||'').toLowerCase()==='paid')
        .sort((a,b)=>{const da=safeLocalDate(feeDate(a)),db=safeLocalDate(feeDate(b));return (db||0)-(da||0);});

    document.getElementById('memberModalContent').innerHTML=`
        <div style="margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border);">
            <div style="font-size:.72rem;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:4px;">Member Details</div>
            <div style="font-size:1.4rem;font-weight:700;margin-bottom:2px;">${m.name||pid}</div>
            <div style="font-family:monospace;color:var(--accent);font-size:.9rem;">ID: ${pid}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            ${_mRow('Phone',m.phone||m.mobile||m.contact||'—')}
            ${_mRow('Package',m.package||m.plan||'—')}
            ${_mRow('Status',m.status||'—')}
            ${_mRow('Joined',m.joined||m.joinDate||m.startDate||'—')}
            ${_mRow('Email',m.email||'—')}
            ${_mRow('Gender',m.gender||'—')}
        </div>
        <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
            <span style="color:var(--text-secondary);font-size:.9rem;">Total Amount Paid</span>
            <span style="font-size:1.3rem;font-weight:700;color:var(--success);">₹${totalPaid.toLocaleString('en-IN')}</span>
        </div>
        ${fees.length?`<div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Payment History (${fees.length})</div>
        <div style="max-height:140px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
        ${fees.map(f=>`<div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border);font-size:.82rem;"><span style="color:var(--text-secondary);">${normalizeDate(feeDate(f))||'—'}</span><span style="font-weight:600;">₹${safeNum(f.amount).toLocaleString('en-IN')}</span></div>`).join('')}
        </div>`:''}`;
    document.getElementById('memberModal').style.display='flex';
};
function _mRow(label,val){return `<div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;"><div style="font-size:.7rem;color:var(--text-muted);margin-bottom:3px;">${label}</div><div style="font-size:.88rem;font-weight:500;">${val}</div></div>`;}

// Close modal on backdrop click
document.getElementById('memberModal').addEventListener('click',function(e){if(e.target===this)this.style.display='none';});

// ── Fees Report ───────────────────────────────────────────────
function updateFeesReport(){
    const{year:selYear,month:selMonth}=_getPickerMonth('rptFeesMonthPicker');
    const today=new Date();
    const monthStart=new Date(selYear,selMonth,1);
    const monthEnd=new Date(selYear,selMonth+1,0,23,59,59,999);
    const memberMap=_getMemberMap(),latestFeeMap=_buildLatestFeeMap();
    const nonLeft=_fbMembers.filter(m=>(m.status||'').toLowerCase()!=='left');
    document.getElementById('rptTotalMembers').textContent=nonLeft.length;

    let monthlyRevenue=0;
    for(const f of _fbFees){
        if((f.status||'').toLowerCase()!=='paid') continue;
        const fd=safeLocalDate(normalizeDate(feeDate(f)));
        if(!fd) continue;
        if(fd>=monthStart&&fd<=monthEnd) monthlyRevenue+=safeNum(f.amount);
    }

    const rows=[];let paidCount=0,unpaidCount=0;
    for(const member of nonLeft){
        const pid=pidOf(member),name=member.name||'—',pkg=member.package||member.plan||'—';
        const lastPaidDate=latestFeeMap.get(pid)||null;
        let status,nextDueDateStr,amountDisplay;
        if(!lastPaidDate){
            status='unpaid';nextDueDateStr='—';
            const anyFee=_fbFees.find(f=>pidOf(f)===pid);
            amountDisplay=anyFee?safeNum(anyFee.amount):safeNum(member.fee||member.monthlyFee||0);
            unpaidCount++;
        } else {
            const nextDue=_rptAddMonths(lastPaidDate,_rptPkgMonths(pkg));
            nextDueDateStr=`${nextDue.getFullYear()}-${String(nextDue.getMonth()+1).padStart(2,'0')}-${String(nextDue.getDate()).padStart(2,'0')}`;
            if(nextDue>=today){status='paid';paidCount++;}else{status='unpaid';unpaidCount++;}
            const latestFeeRec=_fbFees.find(f=>pidOf(f)===pid&&(f.status||'').toLowerCase()==='paid'&&safeLocalDate(feeDate(f))?.getTime()===lastPaidDate.getTime());
            amountDisplay=latestFeeRec?safeNum(latestFeeRec.amount):safeNum(member.fee||member.monthlyFee||0);
        }
        const lastPaidStr=lastPaidDate?`${lastPaidDate.getFullYear()}-${String(lastPaidDate.getMonth()+1).padStart(2,'0')}-${String(lastPaidDate.getDate()).padStart(2,'0')}`:'—';
        rows.push({pid,name,pkg,amount:amountDisplay,lastPaid:lastPaidStr,nextDue:nextDueDateStr,status});
    }
    rows.sort((a,b)=>{const an=parseFloat(a.pid),bn=parseFloat(b.pid);return(!isNaN(an)&&!isNaN(bn))?an-bn:String(a.pid).localeCompare(String(b.pid));});

    const feesTbody=document.getElementById('reportFeesBody');
    if(!rows.length){feesTbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">No members found.</td></tr>';return;}
    feesTbody.innerHTML=rows.map((r,i)=>`<tr>
        <td>${i+1}</td>
        <td style="font-family:monospace;color:var(--accent);">${r.pid||'—'}</td>
        <td style="font-weight:600;">${r.name}</td><td>${r.pkg}</td>
        <td>₹${safeNum(r.amount).toLocaleString('en-IN')}</td>
        <td>${r.lastPaid}</td>
        <td><span class="badge badge-${r.status==='paid'?'paid':'unpaid'}">${r.status}</span></td>
    </tr>`).join('');
    document.getElementById('rptMonthlyRevenue').textContent='₹'+monthlyRevenue.toLocaleString('en-IN');
    document.getElementById('rptFeesPaid').textContent=paidCount;
    document.getElementById('rptUnpaidFees').textContent=unpaidCount;
}

// ── Tab switch ────────────────────────────────────────────────
window.switchReportTab=function(tab){
    const panels={attendance:'rptPanelAttendance',fees:'rptPanelFees',growth:'rptPanelGrowth',crowd:'rptPanelCrowd'};
    const btns={attendance:'rptTabAttendance',fees:'rptTabFees',growth:'rptTabGrowth',crowd:'rptTabCrowd'};
    Object.entries(panels).forEach(([t,id])=>{
        const el=document.getElementById(id);if(el) el.style.display=t===tab?'':'none';
    });
    Object.entries(btns).forEach(([t,id])=>{
        const btn=document.getElementById(id);if(!btn) return;
        btn.classList.toggle('btn-primary',t===tab);
        btn.classList.toggle('btn-secondary',t!==tab);
    });
    if(tab==='attendance') updateReports();
    else if(tab==='fees') updateFeesReport();
    else if(tab==='growth') updateGrowthCharts();
    else if(tab==='crowd') updateCrowdAnalysis();
};

// ── Growth Charts ─────────────────────────────────────────────
const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function _initGrowthYear(){
    const sel=document.getElementById('rptGrowthYear');
    if(!sel) return;
    // Derive years from actual data (fees + member join dates)
    const years=new Set();
    const curYear=new Date().getFullYear();
    years.add(curYear); // always include current year
    for(const f of _fbFees){
        const d=safeLocalDate(normalizeDate(feeDate(f)));
        if(d&&d.getFullYear()>=2020) years.add(d.getFullYear());
    }
    for(const m of _fbMembers){
        const raw=m.joined||m.joinDate||m.joindate||m.startDate||m.startdate||'';
        const d=safeLocalDate(normalizeDate(raw));
        if(d&&d.getFullYear()>=2020) years.add(d.getFullYear());
    }
    const sorted=[...years].sort((a,b)=>b-a);
    const prev=sel.value;
    sel.innerHTML='';
    sorted.forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;sel.appendChild(o);});
    // restore selection if still valid, else default to current year
    if(prev&&years.has(parseInt(prev))) sel.value=prev;
    else sel.value=curYear;
}

window.updateGrowthCharts=function(){
    _initGrowthYear();
    const sel=document.getElementById('rptGrowthYear');
    const year=sel?parseInt(sel.value):new Date().getFullYear();

    // Build revenue per month from fees
    const revByMonth=Array(12).fill(0);
    const feeCountByMonth=Array(12).fill(0);
    for(const f of _fbFees){
        if((f.status||'').toLowerCase()!=='paid') continue;
        const d=safeLocalDate(normalizeDate(feeDate(f)));
        if(!d||d.getFullYear()!==year) continue;
        revByMonth[d.getMonth()]+=safeNum(f.amount);
        feeCountByMonth[d.getMonth()]++;
    }

    // Build new members per month from join date
    const newByMonth=Array(12).fill(0);
    for(const m of _fbMembers){
        const joinRaw=m.joined||m.joinDate||m.joindate||m.startDate||m.startdate||'';
        const d=safeLocalDate(normalizeDate(joinRaw));
        if(!d||d.getFullYear()!==year) continue;
        newByMonth[d.getMonth()]++;
    }

    // Summary cards
    const maxRev=Math.max(...revByMonth);
    const maxRevIdx=revByMonth.indexOf(maxRev);
    const annualRev=revByMonth.reduce((a,b)=>a+b,0);
    const activeMos=revByMonth.filter(v=>v>0).length||1;
    const maxNew=Math.max(...newByMonth);
    const maxNewIdx=newByMonth.indexOf(maxNew);

    document.getElementById('growthBestRev').textContent=maxRev>0?'₹'+maxRev.toLocaleString('en-IN'):'—';
    document.getElementById('growthBestRevMonth').textContent=maxRev>0?MONTH_NAMES[maxRevIdx]+' '+year:'';
    document.getElementById('growthAnnualRev').textContent=annualRev>0?'₹'+annualRev.toLocaleString('en-IN'):'—';
    document.getElementById('growthAvgRev').textContent=annualRev>0?'₹'+Math.round(annualRev/activeMos).toLocaleString('en-IN'):'—';
    document.getElementById('growthPeakMembers').textContent=maxNew>0?maxNew:'—';
    document.getElementById('growthPeakMembersMonth').textContent=maxNew>0?MONTH_NAMES[maxNewIdx]+' '+year:'';

    _drawBarChart('growthRevenueChart',revByMonth,'₹','#3b82f6');
    _drawBarChart('growthMembersChart',newByMonth,'','#22c55e');
    _renderGrowthTable(revByMonth,newByMonth,feeCountByMonth);
};

function _drawBarChart(containerId,data,prefix,color){
    const el=document.getElementById(containerId);if(!el) return;
    const maxVal=Math.max(...data,1);
    const W=Math.max(600,el.clientWidth||860),H=180,padL=60,padR=20,padT=12,padB=36;
    const chartW=W-padL-padR,chartH=H-padT-padB;
    const barW=Math.floor(chartW/12)-8,gap=chartW/12;
    let grid='',bars='',labels='';

    // Grid lines & Y labels
    for(let i=0;i<=4;i++){
        const y=padT+(chartH/4)*i,val=Math.round(maxVal*(1-i/4));
        grid+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#2a2a2a" stroke-width="1"/>`;
        const lbl=prefix==='₹'&&val>=1000?'₹'+(val/1000).toFixed(val%1000?1:0)+'k':(prefix+val);
        grid+=`<text x="${padL-6}" y="${y+4}" text-anchor="end" fill="#666" font-size="10">${lbl}</text>`;
    }

    data.forEach((val,i)=>{
        const x=padL+i*gap+(gap-barW)/2;
        const bh=maxVal>0?(val/maxVal)*chartH:0;
        const by=padT+chartH-bh;
        const alpha=val>0?1:0.2;
        // Bar with gradient effect via two rects
        bars+=`<rect x="${x}" y="${by.toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" fill="${color}" rx="3" opacity="${alpha}">
            <title>${MONTH_NAMES[i]}: ${prefix}${val>0?val.toLocaleString('en-IN'):0}</title></rect>`;
        if(val>0){
            const lbl=prefix==='₹'&&val>=1000?'₹'+(val/1000).toFixed(1)+'k':(prefix+val);
            bars+=`<text x="${(x+barW/2).toFixed(1)}" y="${(by-4).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="9" font-weight="600">${lbl}</text>`;
        }
        labels+=`<text x="${(x+barW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#666" font-size="10">${MONTH_NAMES[i]}</text>`;
    });

    el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">${grid}${bars}${labels}</svg>`;
}

function _renderGrowthTable(revByMonth,newByMonth,feeCountByMonth){
    const tbody=document.getElementById('growthTableBody');
    const rows=MONTH_NAMES.map((mn,i)=>{
        const rev=revByMonth[i],prev=i>0?revByMonth[i-1]:null;
        let changeHtml='—';
        if(prev!==null&&(rev>0||prev>0)){
            if(prev===0){changeHtml=`<span style="color:var(--success);">New</span>`;}
            else{
                const pct=Math.round(((rev-prev)/prev)*100);
                const col=pct>0?'var(--success)':pct<0?'var(--danger)':'var(--text-muted)';
                const arr=pct>0?'▲':pct<0?'▼':'—';
                changeHtml=`<span style="color:${col};font-weight:600;">${arr} ${Math.abs(pct)}%</span>`;
            }
        }
        const revStr=rev>0?'₹'+rev.toLocaleString('en-IN'):`<span style="color:var(--text-muted);">—</span>`;
        const newStr=newByMonth[i]>0?`<span style="color:var(--success);font-weight:600;">+${newByMonth[i]}</span>`:`<span style="color:var(--text-muted);">—</span>`;
        return `<tr>
            <td style="font-weight:600;">${mn}</td>
            <td style="font-weight:700;color:var(--success);">${revStr}</td>
            <td>${changeHtml}</td>
            <td>${newStr}</td>
            <td style="color:var(--text-muted);">${feeCountByMonth[i]||'—'}</td>
        </tr>`;
    });
    tbody.innerHTML=rows.join('');
}

// ── Excel Exports ─────────────────────────────────────────────
function _makeSheet(rows,colWidths){
    const ws=XLSX.utils.json_to_sheet(rows);
    if(colWidths) ws['!cols']=colWidths.map(w=>({wch:w}));
    return ws;
}
window.exportAttendanceReport=function(){
    const{year:selYear,month:selMonth}=_getPickerMonth('rptMonthPicker');
    const today=new Date();today.setHours(23,59,59,999);
    const monthStart=new Date(selYear,selMonth,1);
    const rawEnd=new Date(selYear,selMonth+1,0,23,59,59,999);
    const monthEnd=rawEnd<today?rawEnd:today;
    const active=_getActiveMembers();
    const latestFeeMap=_buildLatestFeeMap();

    const monthAtt=_fbAttendance.filter(a=>{const d=safeLocalDate(normalizeDate(a.date));return d&&d.getFullYear()===selYear&&d.getMonth()===selMonth;});
    const attByPid=new Map(),attByName=new Map();
    for(const a of monthAtt){
        const pid=pidOf(a),nm=(a.name||'').trim().toLowerCase();
        if(pid){if(!attByPid.has(pid))attByPid.set(pid,[]);attByPid.get(pid).push(a);}
        if(nm){if(!attByName.has(nm))attByName.set(nm,[]);attByName.get(nm).push(a);}
    }

    const rows=active.map(member=>{
        const mid=pidOf(member),memberName=member.name||'—',pkg=member.package||member.plan||'—';
        const joinRaw=member.joined||member.joinDate||member.joindate||member.startDate||member.startdate||'';
        const joinDate=safeLocalDate(joinRaw);
        const lastPaidDate=latestFeeMap.get(mid)||null;
        let startBase=joinDate;
        if(lastPaidDate&&(!joinDate||lastPaidDate>joinDate)) startBase=lastPaidDate;
        const rangeStart=startBase&&startBase>monthStart?startBase:monthStart;
        const eligibleDays=rangeStart<=monthEnd?Math.round((monthEnd-rangeStart)/86400000)+1:0;

        const seen=new Set(),memberAtt=[];
        for(const a of [...(attByPid.get(mid)||[]),...(attByName.get(memberName.toLowerCase())||[])]){
            const key=a.id||(normalizeDate(a.date)+'|'+pidOf(a));
            if(!seen.has(key)){seen.add(key);memberAtt.push(a);}
        }
        let presentDays=0;
        for(const a of memberAtt){const s=(a.status||'').toLowerCase();if(s==='present'||s==='inside') presentDays++;}
        const absentDays=Math.max(0,eligibleDays-presentDays);
        const attPct=eligibleDays>0?Math.round((presentDays/eligibleDays)*100):0;
        return{'Power ID':mid,'Name':memberName,'Package':pkg,'Eligible Days':eligibleDays,'Present Days':presentDays,'Absent Days':absentDays,'Attendance %':attPct+'%'};
    });

    if(!rows.length){showToast('No data to export.','error');return;}
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,_makeSheet(_sortByPid(rows),[10,22,16,13,13,12,14]),'Attendance Report');
    XLSX.writeFile(wb,`AttendanceReport_${selYear}-${String(selMonth+1).padStart(2,'0')}.xlsx`);
    showToast('Attendance report exported.','success');
};
window.exportFeesReport=function(){
    const{year:selYear,month:selMonth}=_getPickerMonth('rptFeesMonthPicker');
    const monthStart=new Date(selYear,selMonth,1);
    const monthEnd=new Date(selYear,selMonth+1,0,23,59,59,999);
    const memberMap=_getMemberMap();
    const rows=_fbFees.filter(f=>{
        const pid=pidOf(f);
        if(!pid||(!memberMap.has(pid)&&!memberMap.has(String(Number(pid))))) return false;
        const ds=normalizeDate(feeDate(f));if(!ds) return false;
        const fd=safeLocalDate(ds);return fd&&fd>=monthStart&&fd<=monthEnd;
    }).map(f=>{
        const pid=pidOf(f),member=memberMap.get(pid)||memberMap.get(String(Number(pid)))||{};
        return{'Power ID':pid||'—','Name':f.name||member.name||'—','Package':f.package||member.package||'—','Amount (₹)':safeNum(f.amount),'Last Paid':normalizeDate(feeDate(f))||'—','Status':(f.status||'').toLowerCase()==='paid'?'Paid':'Unpaid'};
    });
    if(!rows.length){showToast('No fees data for this month.','error');return;}
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,_makeSheet(_sortByPid(rows),[10,22,16,14,14,10]),'Fees Report');
    XLSX.writeFile(wb,`FeesReport_${selYear}-${String(selMonth+1).padStart(2,'0')}.xlsx`);
    showToast('Fees report exported.','success');
};

// ── Toast ─────────────────────────────────────────────────────
let _toastTimer=null;
window.showToast=function(msg,type){
    const toast=document.getElementById('toast');
    document.getElementById('toastMsg').textContent=msg;
    toast.className='toast show '+(type||'');
    clearTimeout(_toastTimer);
    _toastTimer=setTimeout(()=>toast.classList.remove('show'),3500);
};

// ── Init ──────────────────────────────────────────────────────
const now=new Date();
const yyyy=now.getFullYear(),mm=String(now.getMonth()+1).padStart(2,'0');
const set=(id,v)=>{const el=document.getElementById(id);if(el) el.value=v;};
set('rptMonthPicker',`${yyyy}-${mm}`);
set('rptFeesMonthPicker',`${yyyy}-${mm}`);
set('rptCrowdMonthPicker',`${yyyy}-${mm}`);
_initGrowthYear();
window.updateReports=updateReports;
window.updateFeesReport=updateFeesReport;

// ── Crowd Analysis ────────────────────────────────────────────
let _gymConfig=null;

// Read gym_settings/config for timings + avg_time_spent_by_mem
onSnapshot(doc(db,'gym_settings','config'),snap=>{
    _gymConfig=snap.exists()?snap.data():null;
    const st=document.getElementById('crowdConfigStatus');
    if(st){
        if(_gymConfig){
            const chunk=parseFloat(_gymConfig.avg_time_spent_by_mem)||1.5;
            st.textContent=`Gym: ${_gymConfig.gymName||'Unknown'} · Slot: ${chunk}h`;
            st.style.color='var(--text-muted)';
        } else {
            st.textContent='gym_settings/config not found';
            st.style.color='var(--danger)';
        }
    }
    const cp=document.getElementById('rptPanelCrowd');
    if(cp&&cp.style.display!=='none') updateCrowdAnalysis();
},err=>{
    console.error('gym_settings listener error:',err);
    _gymConfig=null;
    const st=document.getElementById('crowdConfigStatus');
    if(st){st.textContent='Config load failed: '+err.message;st.style.color='var(--danger)';}
});

function _crowdTimeToMins(t){if(!t)return null;const[h,m]=t.split(':').map(Number);return isNaN(h)?null:h*60+(m||0);}
function _crowdMinsToLabel(m){const h=Math.floor(m/60)%24,min=m%60,ampm=h<12?'AM':'PM',h12=h%12===0?12:h%12;return`${h12}:${String(min).padStart(2,'0')} ${ampm}`;}

function _buildCrowdSlots(gymConfig){
    const chunk=Math.round((parseFloat(gymConfig.avg_time_spent_by_mem)||1.5)*60);
    const gt=gymConfig.gymTiming||{};
    // support both nested gymTiming and flat fields on config doc
    const timings={
        morningOpen: gt.morningOpen||gymConfig.morningOpen||null,
        morningClose:gt.morningClose||gymConfig.morningClose||null,
        eveningOpen: gt.eveningOpen||gymConfig.eveningOpen||null,
        eveningClose:gt.eveningClose||gymConfig.eveningClose||null
    };
    const slots=[];
    const ranges=[[timings.morningOpen,timings.morningClose],[timings.eveningOpen,timings.eveningClose]];
    for(const[open,close]of ranges){
        const s0=_crowdTimeToMins(open),s1=_crowdTimeToMins(close);
        if(s0==null||s1==null||s1<=s0) continue;
        for(let s=s0;s<s1;s+=chunk){const end=Math.min(s+chunk,s1);slots.push({label:`${_crowdMinsToLabel(s)} – ${_crowdMinsToLabel(end)}`,startMin:s,endMin:end});}
    }
    return slots;
}

function _extractCrowdMins(data){
    if(data.checkIn){
        if(typeof data.checkIn==='string') return _crowdTimeToMins(data.checkIn.substring(0,5));
        if(data.checkIn.toDate){const d=data.checkIn.toDate();return d.getHours()*60+d.getMinutes();}
    }
    if(data.timestamp){const d=data.timestamp.toDate?data.timestamp.toDate():new Date(data.timestamp);if(!isNaN(d)) return d.getHours()*60+d.getMinutes();}
    return null;
}

function _extractCrowdDate(data){
    if(data.date){
        if(typeof data.date==='string') return data.date.slice(0,10);
        if(data.date.toDate) return data.date.toDate().toISOString().slice(0,10);
    }
    if(data.timestamp){const d=data.timestamp.toDate?data.timestamp.toDate():new Date(data.timestamp);if(!isNaN(d)) return d.toISOString().slice(0,10);}
    if(data.checkIn&&typeof data.checkIn==='object'&&data.checkIn.toDate) return data.checkIn.toDate().toISOString().slice(0,10);
    return null;
}

window.updateCrowdAnalysis=function(){
    if(!_gymConfig){
        const w=document.getElementById('crowdSlotChartWrap');
        if(w) w.innerHTML='<div style="text-align:center;padding:40px;color:var(--text-muted);">Waiting for gym config… check console if this persists.</div>';
        return;
    }
    const el=document.getElementById('rptCrowdMonthPicker');
    if(!el||!el.value) return;
    const[selYear,selMonth]=el.value.split('-').map(Number);
    const slots=_buildCrowdSlots(_gymConfig);
    const chunkH=parseFloat(_gymConfig.avg_time_spent_by_mem)||1.5;
    document.getElementById('crowdSlotLabel').textContent=`Each slot = ${chunkH}h (default 1.5h if not set in gym config)`;

    if(!slots.length){
        ['crowdSlotChartWrap','crowdHeatmapWrap','crowdWeekChart'].forEach(id=>{const e=document.getElementById(id);if(e) e.innerHTML='<div style="text-align:center;padding:30px;color:var(--text-muted);">No valid gym timings in config. Check morningOpen/Close and eveningOpen/Close fields.</div>';});
        return;
    }

    const monthStr=`${selYear}-${String(selMonth).padStart(2,'0')}`;
    const monthRecs=_fbAttendance.filter(a=>{const d=_extractCrowdDate(a);return d&&d.startsWith(monthStr);});

    const daysInMonth=new Date(selYear,selMonth,0).getDate();
    const dayMap={};
    for(let d=1;d<=daysInMonth;d++){dayMap[`${monthStr}-${String(d).padStart(2,'0')}`]=new Array(slots.length).fill(0);}

    for(const rec of monthRecs){
        const date=_extractCrowdDate(rec),mins=_extractCrowdMins(rec);
        if(!date||mins==null||!dayMap[date]) continue;
        for(let i=0;i<slots.length;i++){if(mins>=slots[i].startMin&&mins<slots[i].endMin){dayMap[date][i]++;break;}}
    }

    const sortedDays=Object.keys(dayMap).sort();
    const activeDays=sortedDays.filter(d=>dayMap[d].some(c=>c>0));
    const slotTotals=new Array(slots.length).fill(0);
    for(const d of sortedDays) dayMap[d].forEach((c,i)=>slotTotals[i]+=c);
    const totalCheckins=slotTotals.reduce((a,b)=>a+b,0);
    const maxSlot=Math.max(...slotTotals)||1;

    // Summary cards
    const peakIdx=slotTotals.indexOf(Math.max(...slotTotals));
    const nonZero=slotTotals.map((v,i)=>({v,i})).filter(x=>x.v>0);
    const quietIdx=nonZero.length?nonZero.reduce((a,b)=>a.v<b.v?a:b).i:0;
    const _setStat=(id,v)=>{const e=document.getElementById(id);if(e) e.textContent=v;};
    _setStat('crowdSummPeak',slots[peakIdx]?.label||'—');
    _setStat('crowdSummQuiet',nonZero.length?slots[quietIdx].label:'—');
    _setStat('crowdSummTotal',totalCheckins);
    _setStat('crowdSummDays',activeDays.length);
    _setStat('crowdSummAvg',activeDays.length?(totalCheckins/activeDays.length).toFixed(1):'0');

    // Slot bar chart
    const slotWrap=document.getElementById('crowdSlotChartWrap');
    if(!totalCheckins){slotWrap.innerHTML='<div style="text-align:center;padding:40px;color:var(--text-muted);">No attendance data for this month.</div>';}
    else{
        slotWrap.innerHTML=`<div style="display:flex;flex-direction:column;gap:8px;">${slots.map((s,i)=>{
            const cnt=slotTotals[i],pct=(cnt/maxSlot*100).toFixed(1),ratio=cnt/totalCheckins;
            let cClass,cLabel,barColor;
            if(ratio>=0.35){cClass='crowd-high';cLabel='High';barColor='#ef4444';}
            else if(ratio>=0.18){cClass='crowd-mid';cLabel='Medium';barColor='#f59e0b';}
            else{cClass='crowd-low';cLabel='Low';barColor='#22c55e';}
            return`<div style="display:flex;align-items:center;gap:10px;">
                <div style="width:130px;font-size:.75rem;color:var(--text-secondary);text-align:right;flex-shrink:0;">${s.label}</div>
                <div style="flex:1;height:28px;background:var(--bg-secondary);border-radius:6px;overflow:hidden;position:relative;">
                    <div style="height:100%;width:${pct}%;background:${barColor};border-radius:6px;display:flex;align-items:center;padding-left:8px;font-size:.72rem;font-weight:600;color:#fff;transition:width .5s ease;">
                        ${parseFloat(pct)>15?cnt+' visits':''}
                    </div>
                </div>
                <div style="width:40px;text-align:right;font-size:.75rem;color:var(--text-muted);">${cnt}</div>
                <span style="font-size:.68rem;padding:2px 7px;border-radius:10px;font-weight:600;background:${barColor}22;color:${barColor};">${cLabel}</span>
            </div>`;
        }).join('')}</div>`;
    }

    // Day of week chart
    const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dowTotals=new Array(7).fill(0),dowCounts=new Array(7).fill(0);
    for(const d of sortedDays){const dow=new Date(d).getDay(),tot=dayMap[d].reduce((a,b)=>a+b,0);dowTotals[dow]+=tot;if(tot>0)dowCounts[dow]++;}
    const dowAvg=dowTotals.map((t,i)=>dowCounts[i]?+(t/dowCounts[i]).toFixed(1):0);
    const maxDow=Math.max(...dowAvg)||1;
    const weekEl=document.getElementById('crowdWeekChart');
    if(weekEl) weekEl.innerHTML=DOW.map((name,i)=>{
        const h=Math.round(dowAvg[i]/maxDow*110),ratio=dowAvg[i]/maxDow;
        const col=ratio>=0.7?'#ef4444':ratio>=0.4?'#f59e0b':'#22c55e';
        return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;">
            <div style="font-size:.68rem;color:var(--text-muted);height:16px;">${dowAvg[i]||''}</div>
            <div style="flex:1;display:flex;align-items:flex-end;width:100%;">
                <div style="width:100%;height:${h||2}px;background:${col};border-radius:6px 6px 0 0;transition:height .5s;"></div>
            </div>
            <div style="font-size:.7rem;color:var(--text-muted);">${name}</div>
        </div>`;
    }).join('');

    // Heatmap
    const hmWrap=document.getElementById('crowdHeatmapWrap');
    if(!hmWrap) return;
    if(!totalCheckins){hmWrap.innerHTML='<div style="text-align:center;padding:30px;color:var(--text-muted);">No data to display.</div>';return;}
    let cellMax=1;
    for(const d of sortedDays) dayMap[d].forEach(c=>{if(c>cellMax)cellMax=c;});
    const dayNums=sortedDays.map(d=>d.slice(8));
    const dayLabels=`<div style="display:flex;gap:4px;margin-left:116px;margin-bottom:4px;">${dayNums.map(d=>`<div style="flex:1;text-align:center;font-size:.6rem;color:var(--text-muted);min-width:18px;">${parseInt(d)}</div>`).join('')}</div>`;
    const rows=slots.map((s,i)=>{
        const bars=sortedDays.map(d=>{
            const c=dayMap[d][i],intensity=c/cellMax,alpha=c===0?0.05:0.15+intensity*0.85;
            const col=intensity>=0.6?`rgba(239,68,68,${alpha})`:intensity>=0.3?`rgba(245,158,11,${alpha})`:`rgba(34,197,94,${alpha})`;
            return`<div style="flex:1;min-width:18px;position:relative;" title="${d} · ${s.label}: ${c} check-in${c!==1?'s':''}">
                <div style="height:28px;background:${col};border-radius:4px;"></div></div>`;
        }).join('');
        return`<div style="display:flex;align-items:center;gap:6px;min-height:36px;">
            <div style="width:110px;font-size:.72rem;color:var(--text-muted);text-align:right;flex-shrink:0;line-height:1.2;">${s.label}</div>
            <div style="display:flex;gap:4px;flex:1;">${bars}</div>
        </div>`;
    }).join('');
    hmWrap.innerHTML=`<div style="overflow-x:auto;">${dayLabels}<div>${rows}</div></div>`;
};