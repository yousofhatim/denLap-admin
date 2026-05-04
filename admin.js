const firebaseConfig = {
    apiKey: "AIzaSyDhdID2wAdkpl-Hc-8mWvMz83PNfAgRto8",
    authDomain: "kid-id.firebaseapp.com",
    databaseURL: "https://kid-id-default-rtdb.firebaseio.com",
    projectId: "kid-id",
    storageBucket: "kid-id.appspot.com",
    messagingSenderId: "921217378956"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

let currentAdmin = null;
let allDoctors = [];
let allCases = [];
let filteredCases = [];
let currentPage = 1;
const itemsPerPage = 20;
let currentSearchTerm = '';
let currentFilterDoctor = '';
let currentFilterStatus = '';
let currentFilterPayment = '';
let currentFilterDate = '';
let currentFilterHasScanner = '';
let currentAICase = null;
let currentAIConversation = [];
let openAiApiKey = null;

let revenueDates = [];
let currentRevenueDateIndex = 0;

async function loadOpenAiApiKey() {
    if (openAiApiKey) return openAiApiKey;
    try {
        const snap = await database.ref('1/splashActivity/mainActivity').once('value');
        openAiApiKey = snap.val();
        return openAiApiKey;
    } catch (e) {
        return null;
    }
}

async function handleLogout() {
    await auth.signOut();
    localStorage.removeItem('adminUser');
    window.location.href = 'index.html';
}

async function loadDoctors() {
    try {
        const snapshot = await database.ref('dental lap/users/doctors/data').once('value');
        const doctorsData = snapshot.val() || {};

        allDoctors = [];
        for (const [key, data] of Object.entries(doctorsData)) {
            if (key === '_counters') continue;
            allDoctors.push({
                doctorKey: key,
                doctorName: data.doctorName || key,
                clinicName: data.clinicName || '',
                governorate: data.governorate || '',
                area: data.area || '',
                phoneNumber: data.phoneNumber || '',
                email: data.email || '',
                clinicId: data.clinicId || '',
                invoiceTotal: data.invoiceTotal || { amount: 0, casesCount: 0, paidAmount: 0, outstandingAmount: 0 }
            });
        }

        renderDoctors();
        updateDoctorFilter();
        return allDoctors;
    } catch (error) {
        return [];
    }
}

async function loadAllCases() {
    try {
        const snapshot = await database.ref('dental lap/case data').once('value');
        const allData = snapshot.val() || {};

        allCases = [];

        for (const [year, yearData] of Object.entries(allData)) {
            if (year === 'index' || year === 'waiting' || year === 'pool' || year === 'case type') continue;

            for (const [month, monthData] of Object.entries(yearData)) {
                for (const [day, dayData] of Object.entries(monthData)) {
                    for (const [doctorName, casesData] of Object.entries(dayData)) {
                        if (doctorName === '_counters') continue;

                        for (const [caseId, caseInfo] of Object.entries(casesData)) {
                            if (caseInfo && typeof caseInfo === 'object') {
                                const fullDate = `${year}/${month}/${day}`;
                                allCases.push({
                                    ...caseInfo,
                                    _year: year,
                                    _month: month,
                                    _day: day,
                                    _doctorName: doctorName,
                                    _fullDate: fullDate,
                                    caseId: caseId,
                                    hasScannerFile: !!(caseInfo.scannerFile || caseInfo.scannerFileUrl)
                                });
                            }
                        }
                    }
                }
            }
        }

        allCases.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        buildRevenueByPaymentDate();
        currentRevenueDateIndex = 0;

        updateStats();
        updateRevenueDisplay();
        applyFilters();
        return allCases;
    } catch (error) {
        return [];
    }
}

let revenueByDate = {};

function buildRevenueByPaymentDate() {
    revenueByDate = {};
    for (const c of allCases) {
        const history = c.paymentHistory || [];
        if (Array.isArray(history) && history.length > 0) {
            for (const p of history) {
                let payDate = '';
                if (p.date) {
                    const datePart = p.date.split(' ')[0];
                    const parts = datePart.split('/').map(Number);
                    if (parts.length === 3) {
                        payDate = `${parts[0]}/${parts[1]}/${parts[2]}`;
                    }
                } else if (p.timestamp) {
                    const d = new Date(p.timestamp);
                    payDate = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
                }
                if (payDate) {
                    if (!revenueByDate[payDate]) revenueByDate[payDate] = 0;
                    revenueByDate[payDate] += (p.amount || 0);
                }
            }
        }
    }

    revenueDates = Object.keys(revenueByDate).sort((a, b) => {
        const [ay, am, ad] = a.split('/').map(Number);
        const [by, bm, bd] = b.split('/').map(Number);
        return (by * 10000 + bm * 100 + bd) - (ay * 10000 + am * 100 + ad);
    });

    const now = new Date();
    const todayStr = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()}`;
    const todayIdx = revenueDates.indexOf(todayStr);
    currentRevenueDateIndex = todayIdx >= 0 ? todayIdx : 0;
}

function computeDayRevenue(dateStr) {
    return revenueByDate[dateStr] || 0;
}

function updateRevenueDisplay() {
    const revenueCard = document.getElementById('revenueCard');
    if (!revenueCard) return;

    if (revenueDates.length === 0) {
        revenueCard.innerHTML = `
            <div class="stat-icon">💰</div>
            <div class="stat-info">
                <h3>0 ج.م</h3>
                <p>لا توجد بيانات</p>
            </div>
        `;
        return;
    }

    const currentDate = revenueDates[currentRevenueDateIndex];
    const dayRevenue = computeDayRevenue(currentDate);

    revenueCard.innerHTML = `
        <button class="revenue-nav-btn" id="revenuePrev">◀</button>
        <div style="text-align: center; flex: 1;">
            <div class="stat-icon">💰</div>
            <div class="stat-info">
                <h3>${dayRevenue.toLocaleString('en-US')} ج.م</h3>
                <p>إيرادات ${currentDate}</p>
            </div>
        </div>
        <button class="revenue-nav-btn" id="revenueNext">▶</button>
    `;

    document.getElementById('revenuePrev').addEventListener('click', () => {
        if (currentRevenueDateIndex < revenueDates.length - 1) {
            currentRevenueDateIndex++;
            updateRevenueDisplay();
        }
    });
    document.getElementById('revenueNext').addEventListener('click', () => {
        if (currentRevenueDateIndex > 0) {
            currentRevenueDateIndex--;
            updateRevenueDisplay();
        }
    });
}

async function loadWaitingCases() {
    try {
        const snapshot = await database.ref('dental lap/case data/waiting').once('value');
        const waitingData = snapshot.val() || {};

        const waitingCases = [];

        for (const [year, yearData] of Object.entries(waitingData)) {
            for (const [month, monthData] of Object.entries(yearData)) {
                for (const [day, dayData] of Object.entries(monthData)) {
                    for (const [doctorName, casesData] of Object.entries(dayData)) {
                        if (doctorName === '_counters') continue;
                        for (const [caseId, caseInfo] of Object.entries(casesData)) {
                            if (caseInfo && typeof caseInfo === 'object') {
                                waitingCases.push({
                                    ...caseInfo,
                                    _year: year,
                                    _month: month,
                                    _day: day,
                                    _doctorName: doctorName,
                                    _fullDate: `${year}/${month}/${day}`,
                                    caseId: caseId,
                                    hasScannerFile: !!(caseInfo.scannerFile || caseInfo.scannerFileUrl)
                                });
                            }
                        }
                    }
                }
            }
        }

        renderWaitingCases(waitingCases);
        return waitingCases;
    } catch (error) {
        return [];
    }
}

async function loadInvoices() {
    try {
        const invoicesList = [];

        for (const doctor of allDoctors) {
            const snapshot = await database.ref(`dental lap/users/doctors/data/${doctor.doctorKey}/invoices`).once('value');
            const invoices = snapshot.val() || {};

            for (const [caseId, invoice] of Object.entries(invoices)) {
                invoicesList.push({
                    ...invoice,
                    doctorName: doctor.doctorName,
                    doctorKey: doctor.doctorKey,
                    caseId: caseId,
                    hasScannerFile: !!(invoice.scannerFile || invoice.scannerFileUrl)
                });
            }
        }

        invoicesList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        renderInvoices(invoicesList);

        const totalRevenue = invoicesList.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
        const totalOutstanding = invoicesList.reduce((sum, inv) => sum + ((inv.total || 0) - (inv.paidAmount || 0)), 0);

        document.getElementById('invoicesSummary').innerHTML = `
            <div class="waiting-summary">
                <div class="waiting-total">💰 الإيرادات المؤكدة (المدفوع): <strong>${totalRevenue.toLocaleString('en-US')} ج.م</strong></div>
                <div class="waiting-total">📊 المستحقات الخارجية: <strong>${totalOutstanding.toLocaleString('en-US')} ج.م</strong></div>
                <div class="waiting-total">📋 عدد الفواتير: <strong>${invoicesList.length}</strong></div>
            </div>
        `;

        return invoicesList;
    } catch (error) {
        return [];
    }
}

function updateStats() {
    const totalDoctors = allDoctors.length;
    const totalCases = allCases.length;
    const totalOutstanding = allCases.reduce((sum, c) => sum + ((c.total || 0) - (c.paidAmount || 0)), 0);

    document.getElementById('totalDoctors').textContent = totalDoctors;
    document.getElementById('totalCases').textContent = totalCases;
    document.getElementById('totalOutstanding').textContent = totalOutstanding.toLocaleString('en-US') + ' ج.م';
}

function updateDoctorFilter() {
    const filterSelect = document.getElementById('filterDoctor');
    filterSelect.innerHTML = '<option value="">جميع الأطباء</option>';
    allDoctors.forEach(doctor => {
        const option = document.createElement('option');
        option.value = doctor.doctorKey;
        option.textContent = doctor.doctorName;
        filterSelect.appendChild(option);
    });
}

function applyFilters() {
    filteredCases = allCases.filter(caseItem => {
        if (currentSearchTerm) {
            const s = currentSearchTerm.toLowerCase();
            const m1 = (caseItem.patientName || '').toLowerCase().includes(s);
            const m2 = (caseItem.randomCode || '').toLowerCase().includes(s);
            const m3 = (caseItem._doctorName || '').toLowerCase().includes(s);
            if (!m1 && !m2 && !m3) return false;
        }
        if (currentFilterDoctor && caseItem._doctorName !== currentFilterDoctor) return false;
        if (currentFilterStatus && caseItem.orderStatus != currentFilterStatus) return false;
        if (currentFilterPayment) {
            const total = caseItem.total || 0;
            const remaining = (caseItem.remainingAmount !== undefined) ? caseItem.remainingAmount : (total - (caseItem.paidAmount || 0));
            const isPaid = remaining <= 0;
            const isPartial = !isPaid && (caseItem.paidAmount || 0) > 0;
            if (currentFilterPayment === 'paid' && !isPaid) return false;
            if (currentFilterPayment === 'partial' && !isPartial) return false;
            if (currentFilterPayment === 'unpaid' && (isPaid || isPartial)) return false;
        }
        if (currentFilterHasScanner) {
            const hasScanner = !!(caseItem.scannerFile || caseItem.scannerFileUrl);
            if (currentFilterHasScanner === 'yes' && !hasScanner) return false;
            if (currentFilterHasScanner === 'no' && hasScanner) return false;
        }
        if (currentFilterDate) {
            const caseDate = `${caseItem._year || ''}-${caseItem._month || ''}-${caseItem._day || ''}`;
            if (caseDate !== currentFilterDate) return false;
        }
        return true;
    });
    currentPage = 1;
    renderCases();
}

function renderDoctors() {
    const grid = document.getElementById('doctorsGrid');
    if (!grid) return;

    if (allDoctors.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👨‍⚕️</div><p>لا يوجد أطباء مسجلون</p></div>';
        return;
    }

    grid.innerHTML = allDoctors.map(doctor => `
        <div class="doctor-card">
            <div class="doctor-header">
                <div class="doctor-avatar">🦷</div>
                <div class="doctor-name">
                    <h3>د. ${escapeHtml(doctor.doctorName)}</h3>
                    <p>${escapeHtml(doctor.clinicName || 'عيادة أسنان')}</p>
                </div>
            </div>
            <div class="doctor-stats">
                <div class="stat-badge">
                    <div class="number">${doctor.invoiceTotal?.casesCount || 0}</div>
                    <div class="label">عدد الحالات</div>
                </div>
                <div class="stat-badge">
                    <div class="number">${(doctor.invoiceTotal?.paidAmount || 0).toLocaleString('en-US')}</div>
                    <div class="label">المدفوع</div>
                </div>
                <div class="stat-badge">
                    <div class="number">${(doctor.invoiceTotal?.outstandingAmount || 0).toLocaleString('en-US')}</div>
                    <div class="label">المستحقات</div>
                </div>
            </div>
            <div class="doctor-info">
                <p>📍 ${escapeHtml(doctor.governorate)} ${doctor.area ? '- ' + doctor.area : ''}</p>
                <p>📞 ${escapeHtml(doctor.phoneNumber || 'غير متوفر')}</p>
            </div>
            <div class="doctor-actions">
                <button class="btn-view-cases" data-doctor="${escapeHtml(doctor.doctorKey)}">📋 عرض الحالات</button>
                <button class="btn-view-invoice" data-doctor="${escapeHtml(doctor.doctorKey)}">💰 الفواتير</button>
            </div>
        </div>
    `).join('');

    document.querySelectorAll('.btn-view-cases').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilterDoctor = btn.dataset.doctor;
            document.getElementById('filterDoctor').value = btn.dataset.doctor;
            applyFilters();
            document.querySelector('.tab-btn[data-tab="cases"]').click();
        });
    });

    document.querySelectorAll('.btn-view-invoice').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilterDoctor = btn.dataset.doctor;
            document.getElementById('filterDoctor').value = btn.dataset.doctor;
            applyFilters();
            document.querySelector('.tab-btn[data-tab="invoices"]').click();
        });
    });
}

function renderCases() {
    const container = document.getElementById('casesList');
    if (!container) return;

    const totalPages = Math.ceil(filteredCases.length / itemsPerPage);
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageCases = filteredCases.slice(start, end);

    if (pageCases.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>لا توجد حالات مطابقة للبحث</p></div>';
        document.getElementById('casesPagination').innerHTML = '';
        return;
    }

    const statusNames = {
        1: '📥 مجمع الحالات',
        2: '📦 وصول الطلب',
        3: '🛵 وصول المندوب',
        4: '🏭 المعمل',
        5: '🏥 الشحن للعيادة'
    };

    container.className = 'cases-grid';
    container.innerHTML = pageCases.map((caseItem, idx) => {
        const total = caseItem.total || 0;
        const paid = caseItem.paidAmount || 0;
        const remaining = (caseItem.remainingAmount !== undefined) ? caseItem.remainingAmount : (total - paid);
        const isPaid = remaining <= 0;
        const isPartial = !isPaid && paid > 0;
        let paymentClass = 'pay-unpaid';
        let paymentText = 'غير مدفوعة ❌';
        if (isPaid) { paymentClass = 'pay-paid'; paymentText = 'مدفوعة ✅'; }
        else if (isPartial) { paymentClass = 'pay-partial'; paymentText = `جزئي (${paid.toLocaleString('en-US')})`; }

        const hasScanner = !!(caseItem.scannerFile || caseItem.scannerFileUrl);
        const scannerClass = hasScanner ? 'has-scanner' : '';

        return `
            <div class="case-card ${scannerClass}" data-idx="${idx}">
                <div class="case-header">
                    <span class="case-patient">👤 ${escapeHtml(caseItem.patientName)}</span>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        ${hasScanner ? '<span class="scanner-badge">📎 سكان</span>' : ''}
                        <span class="case-code">🔐 ${escapeHtml((caseItem.randomCode || '').slice(-8))}</span>
                    </div>
                </div>
                <div class="case-details-grid">
                    <div class="case-detail-item">👨‍⚕️ ${escapeHtml(caseItem._doctorName)}</div>
                    <div class="case-detail-item">📅 ${caseItem._fullDate || ''}</div>
                    <div class="case-detail-item"><span class="status-badge status-${caseItem.orderStatus || 1}">${statusNames[caseItem.orderStatus] || 'جديد'}</span></div>
                    <div class="case-detail-item"><span class="pay-badge ${paymentClass}">${paymentText}</span></div>
                </div>
                <div class="case-footer-grid">
                    <div class="case-price-row">
                        <span class="case-price">💰 ${total.toLocaleString('en-US')} ج.م</span>
                        <span class="case-paid-inline">💵 مدفوع: ${paid.toLocaleString('en-US')} ج.م</span>
                        ${remaining > 0 && !isPaid ? `<span class="case-remaining-inline">📊 متبقي: ${remaining.toLocaleString('en-US')} ج.م</span>` : ''}
                    </div>
                    <div class="case-actions-grid">
                        <button class="btn-open-card" data-idx="${idx}">📋 فتح</button>
                        ${hasScanner ? `<button class="btn-download-scanner" data-idx="${idx}">⬇️ سكان</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.btn-open-card').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            openCaseCardView(pageCases[idx]);
        });
    });

    document.querySelectorAll('.btn-download-scanner').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            const c = pageCases[idx];
            if (c.scannerFileUrl) {
                downloadScannerDirect(c.scannerFileUrl, c.scannerFile || 'scanner_file');
            }
        });
    });

    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const paginationDiv = document.getElementById('casesPagination');
    if (!paginationDiv) return;
    if (totalPages <= 1) { paginationDiv.innerHTML = ''; return; }

    let buttons = '';
    for (let i = 1; i <= totalPages; i++) {
        buttons += `<button class="${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    paginationDiv.innerHTML = buttons;
    paginationDiv.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            currentPage = parseInt(btn.dataset.page);
            renderCases();
        });
    });
}

function renderWaitingCases(waitingCases) {
    const container = document.getElementById('waitingList');
    const summaryDiv = document.getElementById('waitingSummary');
    if (!container) return;

    const totalWaiting = waitingCases.length;
    const totalAmount = waitingCases.reduce((sum, c) => sum + (c.total || 0), 0);

    if (summaryDiv) {
        summaryDiv.innerHTML = `
            <div class="waiting-total">📥 عدد الحالات المنتظرة: <strong>${totalWaiting}</strong></div>
            <div class="waiting-total">💰 إجمالي المبالغ: <strong>${totalAmount.toLocaleString('en-US')} ج.م</strong></div>
            <button class="dispatch-all-btn" id="dispatchAllWaitingBtn">🛵 إرسال جميع الحالات للمعمل</button>
        `;
        const dispatchBtn = document.getElementById('dispatchAllWaitingBtn');
        if (dispatchBtn) dispatchBtn.addEventListener('click', () => dispatchAllWaiting(waitingCases));
    }

    if (waitingCases.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📥</div><p>لا توجد حالات في مجمع الحالات</p></div>';
        return;
    }

    container.className = 'cases-grid';
    container.innerHTML = waitingCases.map((caseItem, idx) => {
        const hasScanner = !!(caseItem.scannerFile || caseItem.scannerFileUrl);
        const scannerClass = hasScanner ? 'has-scanner' : '';
        return `
            <div class="case-card ${scannerClass}">
                <div class="case-header">
                    <span class="case-patient">👤 ${escapeHtml(caseItem.patientName)}</span>
                    <div style="display: flex; gap: 6px;">
                        ${hasScanner ? '<span class="scanner-badge">📎 سكان</span>' : ''}
                        <span class="case-code">🆔 ${escapeHtml(caseItem.caseId.slice(-12))}</span>
                    </div>
                </div>
                <div class="case-details-grid">
                    <div class="case-detail-item">👨‍⚕️ ${escapeHtml(caseItem._doctorName)}</div>
                    <div class="case-detail-item">📅 ${caseItem._fullDate || ''}</div>
                    <div class="case-detail-item">💰 ${(caseItem.total || 0).toLocaleString('en-US')} ج.م</div>
                    <div class="case-detail-item">🦷 ${Object.keys(caseItem.toothTreatments || {}).length} سن</div>
                </div>
                <div class="case-footer-grid">
                    <div class="case-actions-grid">
                        <button class="btn-open-waiting" data-widx="${idx}">📋 فتح</button>
                        ${hasScanner ? `<button class="btn-dl-waiting" data-widx="${idx}">⬇️ سكان</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.btn-open-waiting').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.widx);
            openCaseCardView(waitingCases[idx]);
        });
    });
    document.querySelectorAll('.btn-dl-waiting').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.widx);
            const c = waitingCases[idx];
            if (c.scannerFileUrl) downloadScannerDirect(c.scannerFileUrl, c.scannerFile || 'scanner_file');
        });
    });
}

async function dispatchAllWaiting(waitingCases) {
    if (!confirm(`هل أنت متأكد من إرسال ${waitingCases.length} حالة للمعمل؟`)) return;
    let success = 0, failed = 0;
    for (const caseItem of waitingCases) {
        try {
            const waitingPath = `dental lap/case data/waiting/${caseItem._year}/${caseItem._month}/${caseItem._day}/${caseItem._doctorName}/${caseItem.caseId}`;
            const normalPath = `dental lap/case data/${caseItem._year}/${caseItem._month}/${caseItem._day}/${caseItem._doctorName}/${caseItem.caseId}`;
            const sh = caseItem.statusHistory || {};
            sh["الإضافة لمجمع الحالات"] = true;
            sh["استلام الطلب"] = true;
            if (caseItem.scannerFile) { sh["ارسال مندوب للعياده"] = true; sh["استلام الحاله"] = true; }
            caseItem.statusHistory = sh;
            caseItem.orderStatus = caseItem.scannerFile ? 4 : 2;
            caseItem.dispatchedAt = Date.now();
            caseItem.isReadOnly = true;
            await database.ref(normalPath).set(caseItem);
            await database.ref(waitingPath).remove();
            await database.ref(`dental lap/users/doctors/data/${caseItem._doctorName}/waiting/${caseItem.caseId}`).remove();
            success++;
        } catch (err) { failed++; }
    }
    alert(`✅ تم إرسال ${success} حالة بنجاح\n❌ فشل ${failed} حالة`);
    loadWaitingCases();
    loadAllCases();
}

function renderInvoices(invoices) {
    const container = document.getElementById('invoicesList');
    if (!container) return;
    if (invoices.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><p>لا توجد فواتير</p></div>';
        return;
    }
    container.className = 'cases-grid';
    container.innerHTML = invoices.map((inv, idx) => {
        const hasScanner = !!(inv.scannerFile || inv.scannerFileUrl);
        const scannerClass = hasScanner ? 'has-scanner' : '';
        const total = inv.total || 0;
        const paid = inv.paidAmount || 0;
        const remaining = total - paid;
        return `
            <div class="case-card ${scannerClass}">
                <div class="case-header">
                    <span class="case-patient">👤 ${escapeHtml(inv.patientName)}</span>
                    ${hasScanner ? '<span class="scanner-badge">📎 سكان</span>' : ''}
                </div>
                <div class="case-details-grid">
                    <div class="case-detail-item">👨‍⚕️ ${escapeHtml(inv.doctorName)}</div>
                    <div class="case-detail-item">📅 ${inv.date || ''}</div>
                </div>
                <div class="case-footer-grid">
                    <div class="case-price-row">
                        <span class="case-price">💰 ${total.toLocaleString('en-US')} ج.م</span>
                        <span class="case-paid-inline">💵 ${paid.toLocaleString('en-US')} ج.م</span>
                        ${remaining > 0 ? `<span class="case-remaining-inline">📊 ${remaining.toLocaleString('en-US')} ج.م</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

let _currentCardCaseData = null;
let _workflowData = null;
let _workflowStations = [];

async function loadWorkflow() {
    const container = document.getElementById('workflowContent');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner">⏳ جاري تحميل سير العمل...</div>';

    try {
        const snap = await database.ref('dental lap/users/workers/jops/Career ladder/مندوب').once('value');
        _workflowData = snap.val() || {};
        _workflowStations = [];
        extractStations(_workflowData, [], _workflowStations);
        renderWorkflow(container);
    } catch (err) {
        container.innerHTML = '<div class="empty-state"><p>❌ خطأ في تحميل سير العمل: ' + escapeHtml(err.message) + '</p></div>';
    }
}

function extractStations(node, pathSoFar, result) {
    if (!node || typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node)) {
        if (key === 'استلام') {
            const cases = [];
            extractCasesFromReceive(value, cases);
            const stationName = pathSoFar.length > 0 ? pathSoFar[pathSoFar.length - 1] : 'مندوب';
            result.push({
                name: stationName,
                path: [...pathSoFar],
                firebasePath: buildFirebasePath(pathSoFar) + '/استلام',
                cases: cases,
                nextStations: findNextStations(node, key)
            });
        } else if (key !== 'تسليم' && typeof value === 'object' && value !== null && key !== '') {
            extractStations(value, [...pathSoFar, key], result);
        }
    }
}

function extractCasesFromReceive(receiveNode, cases) {
    if (!receiveNode || typeof receiveNode !== 'object') return;
    if (receiveNode === '') return;

    for (const [groupKey, groupVal] of Object.entries(receiveNode)) {
        if (!groupVal || typeof groupVal !== 'object') continue;

        if (groupVal.caseId) {
            cases.push({ ...groupVal, _groupKey: groupKey });
        } else {
            for (const [caseKey, caseVal] of Object.entries(groupVal)) {
                if (caseVal && typeof caseVal === 'object' && caseVal.caseId) {
                    cases.push({ ...caseVal, _groupKey: groupKey });
                }
            }
        }
    }
}

function findNextStations(parentNode, currentKey) {
    const nexts = [];
    for (const [key, value] of Object.entries(parentNode)) {
        if (key === 'استلام' || key === 'تسليم' || key === '' || typeof value !== 'object') continue;
        if (value && typeof value === 'object') {
            nexts.push(key);
        }
    }
    return nexts;
}

function buildFirebasePath(pathArr) {
    let base = 'dental lap/users/workers/jops/Career ladder/مندوب';
    for (const segment of pathArr) {
        base += '/' + segment;
    }
    return base;
}

function getNextStationsForCase(caseData, currentStation) {
    const caseType = caseData.caseType || '';
    const stationIdx = _workflowStations.findIndex(s => s.name === currentStation.name && s.firebasePath === currentStation.firebasePath);

    const nexts = currentStation.nextStations || [];
    if (nexts.length > 0) return nexts;

    if (stationIdx >= 0 && stationIdx < _workflowStations.length - 1) {
        return [_workflowStations[stationIdx + 1].name];
    }
    return ['تسليم'];
}

function findStationByName(name) {
    return _workflowStations.find(s => s.name === name);
}

function renderWorkflow(container) {
    const totalCases = _workflowStations.reduce((sum, s) => sum + s.cases.length, 0);
    const activeStations = _workflowStations.filter(s => s.cases.length > 0).length;

    let html = `
        <div class="workflow-summary-bar">
            <div class="wf-summary-item"><span class="label">📊 إجمالي الحالات في خط الإنتاج</span><span class="value">${totalCases}</span></div>
            <div class="wf-summary-item"><span class="label">🏭 المحطات النشطة</span><span class="value">${activeStations}</span></div>
            <div class="wf-summary-item"><span class="label">📋 إجمالي المحطات</span><span class="value">${_workflowStations.length}</span></div>
        </div>
        <div class="workflow-pipeline">
    `;

    const stationIcons = {
        'مندوب': '🛵', 'الاداره': '🏢', 'فني جبس': '🪨', 'تفتيح مارجن': '✂️',
        'سكانر زيركون': '📡', 'ديزاينر زيركون': '🎨', 'خراطة': '⚙️', 'خراطة مؤقت': '🔧',
        'زيركون': '💎', 'فينيش زيركون': '✨', 'سكانر معدن': '📡', 'ديزاينر معدن': '🎨',
        'طباعة معدن': '🖨️', 'فينيش معدن': '✨', 'بروفه': '🔍', 'ووش و اوبيك': '🎨',
        'فني بورسلين': '🏺', 'طباعة ريزن': '🖨️', 'فني اكريل': '🔬', 'تسليم': '📦'
    };

    _workflowStations.forEach((station, idx) => {
        const icon = stationIcons[station.name] || '🔹';
        const count = station.cases.length;
        const countClass = count > 0 ? '' : 'empty';
        const depth = station.path.length;

        let casesHtml = '';
        if (count > 0) {
            casesHtml = station.cases.map((c, ci) => {
                const nextOptions = getNextStationsForCase(c, station);
                const nextBtns = nextOptions.map(next => {
                    const nextIcon = stationIcons[next] || '➡️';
                    return `<button class="wf-move-btn" data-station-idx="${idx}" data-case-idx="${ci}" data-next="${escapeHtml(next)}">${nextIcon} نقل → ${escapeHtml(next)}</button>`;
                }).join('');

                return `
                    <div class="wf-case-card">
                        <div class="wf-case-info">
                            <div class="wf-case-patient">👤 ${escapeHtml(c.caseId || '')}</div>
                            <div class="wf-case-meta">
                                <span>👨‍⚕️ ${escapeHtml(c.doctorName || '')}</span>
                                <span>📅 ${c.year || ''}/${c.month || ''}/${c.day || ''}</span>
                                <span>🔐 ${escapeHtml(c.randomCode || '')}</span>
                                <span>🦷 ${escapeHtml(c.caseType || '')}</span>
                            </div>
                        </div>
                        <div class="wf-case-actions">
                            <button class="wf-view-btn" data-code="${escapeHtml(c.randomCode || '')}" data-doctor="${escapeHtml(c.doctorName || '')}" data-year="${c.year || ''}" data-month="${c.month || ''}" data-day="${c.day || ''}" data-caseid="${escapeHtml(c.caseId || '')}">📋 فتح</button>
                            ${nextBtns}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            casesHtml = '<p style="color: #546e7a; text-align: center; padding: 10px;">لا توجد حالات في هذه المحطة</p>';
        }

        html += `
            <div class="workflow-station" data-station-idx="${idx}" style="${depth > 0 ? 'margin-right: ' + (depth * 20) + 'px;' : ''}">
                <div class="station-header">
                    <div class="station-name">${icon} ${escapeHtml(station.name)}</div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="station-count-badge ${countClass}">${count}</span>
                        <span class="station-arrow">◀</span>
                    </div>
                </div>
                <div class="station-cases">${casesHtml}</div>
            </div>
        `;

        if (idx < _workflowStations.length - 1) {
            html += '<div class="station-connector"><div class="station-connector-line"></div></div>';
        }
    });

    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.station-header').forEach(header => {
        header.addEventListener('click', () => {
            const station = header.closest('.workflow-station');
            station.classList.toggle('active-station');
        });
    });

    container.querySelectorAll('.wf-move-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const stationIdx = parseInt(btn.dataset.stationIdx);
            const caseIdx = parseInt(btn.dataset.caseIdx);
            const nextName = btn.dataset.next;
            await moveWorkflowCase(stationIdx, caseIdx, nextName);
        });
    });

    container.querySelectorAll('.wf-view-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const doctor = btn.dataset.doctor;
            const year = btn.dataset.year;
            const month = btn.dataset.month;
            const day = btn.dataset.day;
            const caseId = btn.dataset.caseid;
            openCaseFromWorkflow(year, month, day, doctor, caseId);
        });
    });
}

async function openCaseFromWorkflow(year, month, day, doctor, caseId) {
    try {
        const casePath = `dental lap/case data/${year}/${month}/${day}/${doctor}/${caseId}`;
        const snap = await database.ref(casePath).once('value');
        const caseData = snap.val();
        if (caseData) {
            openCaseCardView({
                ...caseData,
                _year: year, _month: month, _day: day,
                _doctorName: doctor, caseId: caseId,
                _fullDate: `${year}/${month}/${day}`
            });
        } else {
            alert('⚠️ الحالة غير موجودة في بيانات الحالات');
        }
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
    }
}

async function moveWorkflowCase(stationIdx, caseIdx, nextStationName) {
    const station = _workflowStations[stationIdx];
    if (!station) return;
    const caseData = station.cases[caseIdx];
    if (!caseData) return;

    const confirmMsg = `نقل حالة "${caseData.caseId}" من "${station.name}" إلى "${nextStationName}"؟`;
    if (!confirm(confirmMsg)) return;

    try {
        const currentReceivePath = station.firebasePath;
        let caseFirebaseKey = null;

        if (caseData._groupKey) {
            const groupSnap = await database.ref(currentReceivePath + '/' + caseData._groupKey).once('value');
            const groupData = groupSnap.val();
            if (groupData && typeof groupData === 'object') {
                if (groupData.caseId === caseData.caseId) {
                    caseFirebaseKey = caseData._groupKey;
                } else {
                    for (const [k, v] of Object.entries(groupData)) {
                        if (v && typeof v === 'object' && v.caseId === caseData.caseId) {
                            caseFirebaseKey = caseData._groupKey + '/' + k;
                            break;
                        }
                    }
                }
            }
        }

        if (!caseFirebaseKey) {
            const receiveSnap = await database.ref(currentReceivePath).once('value');
            const receiveData = receiveSnap.val();
            if (receiveData) {
                caseFirebaseKey = findCaseKeyInReceive(receiveData, caseData.caseId);
            }
        }

        if (!caseFirebaseKey) {
            alert('❌ لم يتم العثور على الحالة في المحطة الحالية');
            return;
        }

        const casePayload = { ...caseData };
        delete casePayload._groupKey;

        let targetReceivePath = null;
        if (nextStationName === 'تسليم') {
            const parentPath = station.firebasePath.replace(/\/استلام$/, '');
            targetReceivePath = parentPath.substring(0, parentPath.lastIndexOf('/')) + '/تسليم';
        } else {
            const targetStation = _workflowStations.find(s => s.name === nextStationName);
            if (targetStation) {
                targetReceivePath = targetStation.firebasePath;
            } else {
                const parentPath = station.firebasePath.replace(/\/استلام$/, '');
                targetReceivePath = findNextReceivePath(_workflowData, station.path, nextStationName);
                if (!targetReceivePath) {
                    alert('❌ لم يتم العثور على محطة الاستلام التالية');
                    return;
                }
            }
        }

        const groupKey = `${caseData.doctorName || 'unknown'}`;
        await database.ref(targetReceivePath + '/' + groupKey + '/' + caseData.caseId).set(casePayload);
        await database.ref(currentReceivePath + '/' + caseFirebaseKey).remove();

        alert(`✅ تم نقل الحالة "${caseData.caseId}" إلى "${nextStationName}"`);
        await loadWorkflow();
    } catch (err) {
        alert('❌ خطأ في نقل الحالة: ' + err.message);
    }
}

function findCaseKeyInReceive(receiveData, caseId) {
    if (!receiveData || typeof receiveData !== 'object') return null;
    for (const [key, val] of Object.entries(receiveData)) {
        if (val && typeof val === 'object') {
            if (val.caseId === caseId) return key;
            for (const [subKey, subVal] of Object.entries(val)) {
                if (subVal && typeof subVal === 'object' && subVal.caseId === caseId) {
                    return key + '/' + subKey;
                }
            }
        }
    }
    return null;
}

function findNextReceivePath(tree, currentPath, nextName) {
    let node = tree;
    for (const segment of currentPath) {
        if (node && node[segment]) {
            node = node[segment];
        } else {
            return null;
        }
    }

    function searchForReceive(obj, targetName, basePath) {
        if (!obj || typeof obj !== 'object') return null;
        for (const [key, val] of Object.entries(obj)) {
            if (key === targetName && val && typeof val === 'object' && 'استلام' in val) {
                return basePath + '/' + key + '/استلام';
            }
            if (typeof val === 'object' && val !== null) {
                const found = searchForReceive(val, targetName, basePath + '/' + key);
                if (found) return found;
            }
        }
        return null;
    }

    const result = searchForReceive(node, nextName, 'dental lap/users/workers/jops/Career ladder/مندوب/' + currentPath.join('/'));
    return result;
}

function openCaseCardView(caseData) {
    const modal = document.getElementById('caseCardModal');
    if (!modal) return;

    _currentCardCaseData = caseData;

    const toothTreatments = caseData.toothTreatments || {};
    const total = caseData.total || Object.values(toothTreatments).reduce((sum, t) => sum + ((typeof t === 'object' ? t : {}).price || 0), 0);
    const paid = caseData.paidAmount || 0;
    const remaining = (caseData.remainingAmount !== undefined) ? caseData.remainingAmount : (total - paid);

    const statusNames = {
        1: '📥 مجمع الحالات', 2: '📦 وصول الطلب', 3: '🛵 وصول المندوب', 4: '🏭 المعمل', 5: '🏥 الشحن للعيادة'
    };

    const hasScanner = !!(caseData.scannerFile || caseData.scannerFileUrl);

    document.getElementById('cardPatientName').textContent = caseData.patientName || '';
    document.getElementById('cardDoctorName').textContent = 'د. ' + (caseData._doctorName || '');
    document.getElementById('cardDate').textContent = caseData._fullDate || '';
    document.getElementById('cardStatus').innerHTML = `<span class="status-badge status-${caseData.orderStatus || 1}">${statusNames[caseData.orderStatus] || 'جديد'}</span>`;
    document.getElementById('cardCode').textContent = caseData.randomCode || '';
    document.getElementById('cardTotal').textContent = total.toLocaleString('en-US') + ' ج.م';
    document.getElementById('cardPaid').textContent = paid.toLocaleString('en-US') + ' ج.م';
    document.getElementById('cardRemaining').textContent = remaining.toLocaleString('en-US') + ' ج.م';

    const scannerArea = document.getElementById('cardScannerArea');
    if (hasScanner) {
        scannerArea.innerHTML = `<button class="scanner-download-btn" id="cardDownloadScanner">📎 تحميل ملف السكان (${escapeHtml(caseData.scannerFile || '')})</button>`;
        document.getElementById('cardDownloadScanner').addEventListener('click', () => {
            downloadScannerDirect(caseData.scannerFileUrl, caseData.scannerFile || 'scanner_file');
        });
    } else {
        scannerArea.innerHTML = '<p style="color: #90a4ae;">لا يوجد ملف سكان</p>';
    }

    const notesArea = document.getElementById('cardNotesArea');
    const caseNotes = caseData.notes || '';
    if (caseNotes) {
        notesArea.innerHTML = `<div class="card-notes-box"><strong>📝 ملاحظات:</strong><p>${escapeHtml(caseNotes)}</p></div>`;
    } else {
        notesArea.innerHTML = '';
    }

    const copyArea = document.getElementById('cardCopyArea');
    copyArea.innerHTML = `
        <div class="copy-buttons-row">
            <button class="copy-data-btn copy-text-btn" id="cardCopyTextBtn">📋 نسخ النصوص والرابط</button>
            <button class="copy-data-btn copy-image-btn" id="cardCopyImageBtn">🖼️ نسخ صورة الأسنان</button>
        </div>`;
    document.getElementById('cardCopyTextBtn').addEventListener('click', () => {
        copyTextData(caseData);
    });
    document.getElementById('cardCopyImageBtn').addEventListener('click', () => {
        copyTeethImage(caseData);
    });

    renderCardTeethDiagram(caseData);
    renderCardInvoice(caseData);
    loadCardConversation(caseData);

    modal.dataset.caseYear = caseData._year || '';
    modal.dataset.caseMonth = caseData._month || '';
    modal.dataset.caseDay = caseData._day || '';
    modal.dataset.caseDoctor = caseData._doctorName || '';
    modal.dataset.caseId = caseData.caseId || '';

    document.querySelectorAll('.card-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.card-tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector('.card-tab-btn[data-card-tab="details"]').classList.add('active');
    document.getElementById('cardDetailsTab').classList.add('active');

    modal.classList.add('active');
}

function renderCardTeethDiagram(caseData) {
    const wrapper = document.getElementById('cardTeethWrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const toothTreatments = caseData.toothTreatments || {};
    const toothConnections = caseData.toothConnections || {};

    const upperTeeth = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
    const lowerTeeth = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

    const containerWidth = wrapper.parentElement?.clientWidth || 600;
    const centerX = containerWidth / 2;
    const totalHeight = 560;
    const centerY = totalHeight / 2;
    const JAW_GAP = 45;

    const arcWidth = Math.min(containerWidth * 0.4, 240);
    const upperArcHeight = (totalHeight / 2 - JAW_GAP) * 0.85;
    const lowerArcHeight = (totalHeight / 2 - JAW_GAP) * 0.85;

    wrapper.style.minHeight = totalHeight + 'px';
    wrapper.style.height = totalHeight + 'px';

    const toothPositions = {};

    const drawTooth = (number, x, y) => {
        toothPositions[number] = { x, y };

        const button = document.createElement('button');
        button.className = 'tooth-btn-admin';
        button.dataset.toothNum = number;
        button.innerText = number;
        button.style.left = (x - 20) + 'px';
        button.style.top = (y - 20) + 'px';
        button.style.width = '40px';
        button.style.height = '40px';

        const treatment = toothTreatments[number];
        if (treatment) {
            const td = typeof treatment === 'object' ? treatment : { label: treatment, color: '#546e7a' };
            button.style.background = td.color || '#546e7a';
            button.style.color = 'white';
            button.classList.add('has-treatment');
            const tooltip = document.createElement('span');
            tooltip.className = 'treatment-tooltip';
            tooltip.textContent = `${td.label || td.key || 'علاج'} - ${td.price || 0} ج.م`;
            button.appendChild(tooltip);
        }

        button.addEventListener('click', () => {
            openToothEditDialog(number, caseData);
        });

        wrapper.appendChild(button);
    };

    upperTeeth.forEach((number, index) => {
        const t = (index + 0.5) / upperTeeth.length;
        const angle = Math.PI + t * Math.PI;
        const squeeze = 0.7 + 0.3 * Math.abs(Math.sin(angle));
        const x = centerX + arcWidth * squeeze * Math.cos(angle);
        const baseY = centerY - JAW_GAP;
        const y = baseY + upperArcHeight * Math.sin(angle);
        drawTooth(number, x, y);
    });

    lowerTeeth.forEach((number, index) => {
        const t = (index + 0.5) / lowerTeeth.length;
        const angle = t * Math.PI;
        const squeeze = 0.7 + 0.3 * Math.abs(Math.sin(angle));
        const x = centerX + arcWidth * squeeze * Math.cos(angle);
        const baseY = centerY + JAW_GAP;
        const y = baseY + lowerArcHeight * Math.sin(angle);
        drawTooth(number, x, y);
    });

    const infoDiv = document.createElement('div');
    infoDiv.className = 'teeth-inner-info';
    infoDiv.style.position = 'absolute';
    const infoWidth = arcWidth * 0.85;
    infoDiv.style.left = (centerX - infoWidth / 2) + 'px';
    infoDiv.style.top = (centerY - 55) + 'px';
    infoDiv.style.width = infoWidth + 'px';

    let infoHTML = '';
    infoHTML += `<div class="inner-info-line"><span class="inner-label">👨‍⚕️</span> <span>د. ${escapeHtml(caseData._doctorName || '')}</span></div>`;
    infoHTML += `<div class="inner-info-line"><span class="inner-label">👤</span> <span>${escapeHtml(caseData.patientName || '')}</span></div>`;
    if (caseData.notes) {
        infoHTML += `<div class="inner-info-line inner-notes"><span class="inner-label">📝</span> <span>${escapeHtml(caseData.notes)}</span></div>`;
    }

    const colorMap = {};
    for (const [num, t] of Object.entries(toothTreatments)) {
        const td = typeof t === 'object' ? t : { label: t, color: '#546e7a' };
        const key = td.label || td.key || 'علاج';
        if (!colorMap[key]) colorMap[key] = td.color || '#546e7a';
    }
    if (Object.keys(colorMap).length > 0) {
        infoHTML += `<div class="inner-legend">`;
        for (const [label, color] of Object.entries(colorMap)) {
            infoHTML += `<span class="legend-item"><span class="legend-dot" style="background:${color};"></span>${escapeHtml(label)}</span>`;
        }
        infoHTML += `</div>`;
    }

    infoDiv.innerHTML = infoHTML;
    wrapper.appendChild(infoDiv);

    setTimeout(() => {
        const adjacentPairs = [];
        for (let i = 0; i < upperTeeth.length - 1; i++) adjacentPairs.push([upperTeeth[i], upperTeeth[i+1]]);
        for (let i = 0; i < lowerTeeth.length - 1; i++) adjacentPairs.push([lowerTeeth[i], lowerTeeth[i+1]]);

        adjacentPairs.forEach(pair => {
            const pos1 = toothPositions[pair[0]];
            const pos2 = toothPositions[pair[1]];
            if (!pos1 || !pos2) return;

            const midX = (pos1.x + pos2.x) / 2;
            const midY = (pos1.y + pos2.y) / 2;

            const dot = document.createElement('div');
            dot.className = 'connection-dot-admin';
            const pairKey = `${pair[0]}_${pair[1]}`;
            dot.dataset.pairKey = pairKey;
            dot.dataset.tooth1 = pair[0];
            dot.dataset.tooth2 = pair[1];
            if (toothConnections[pairKey]) dot.classList.add('connected');

            dot.style.left = (midX - 7) + 'px';
            dot.style.top = (midY - 7) + 'px';
            dot.style.cursor = 'pointer';

            dot.addEventListener('click', async (e) => {
                e.stopPropagation();
                await toggleConnector(pairKey, dot, caseData);
            });

            wrapper.appendChild(dot);
        });
    }, 50);
}

async function toggleConnector(pairKey, dotEl, caseData) {
    const modal = document.getElementById('caseCardModal');
    const casePath = `dental lap/case data/${modal.dataset.caseYear}/${modal.dataset.caseMonth}/${modal.dataset.caseDay}/${modal.dataset.caseDoctor}/${modal.dataset.caseId}`;

    const isConnected = dotEl.classList.contains('connected');

    try {
        if (isConnected) {
            await database.ref(`${casePath}/toothConnections/${pairKey}`).remove();
            dotEl.classList.remove('connected');
        } else {
            await database.ref(`${casePath}/toothConnections/${pairKey}`).set(true);
            dotEl.classList.add('connected');
        }
        if (_currentCardCaseData) {
            if (!_currentCardCaseData.toothConnections) _currentCardCaseData.toothConnections = {};
            if (isConnected) {
                delete _currentCardCaseData.toothConnections[pairKey];
            } else {
                _currentCardCaseData.toothConnections[pairKey] = true;
            }
        }
    } catch (err) {
        alert('❌ خطأ في تحديث الكونكتور: ' + err.message);
    }
}

function openToothEditDialog(toothNumber, caseData) {
    const existing = caseData.toothTreatments?.[toothNumber];
    const td = existing ? (typeof existing === 'object' ? existing : { label: existing, price: 0 }) : null;

    const dialog = document.createElement('div');
    dialog.className = 'tooth-edit-overlay';
    dialog.innerHTML = `
        <div class="tooth-edit-dialog">
            <h3>🦷 سن رقم ${toothNumber}</h3>
            <div class="form-group">
                <label>اسم العلاج</label>
                <input type="text" id="toothLabel" value="${td ? escapeHtml(td.label || td.key || '') : ''}" placeholder="مثال: زركونيا، بورسلين..." />
            </div>
            <div class="form-group">
                <label>السعر (ج.م)</label>
                <input type="number" id="toothPrice" value="${td ? (td.price || 0) : ''}" placeholder="0" />
            </div>
            <div class="form-group">
                <label>اللون</label>
                <input type="color" id="toothColor" value="${td?.color || '#546e7a'}" />
            </div>
            <div class="tooth-edit-actions">
                <button class="save-tooth-btn" id="saveToothBtn">💾 حفظ</button>
                ${td ? '<button class="delete-tooth-btn" id="deleteToothBtn">🗑️ حذف</button>' : ''}
                <button class="cancel-tooth-btn" id="cancelToothBtn">إلغاء</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);

    document.getElementById('cancelToothBtn').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });

    document.getElementById('saveToothBtn').addEventListener('click', async () => {
        const label = document.getElementById('toothLabel').value.trim();
        const price = parseFloat(document.getElementById('toothPrice').value) || 0;
        const color = document.getElementById('toothColor').value;

        if (!label) { alert('يرجى إدخال اسم العلاج'); return; }

        const modal = document.getElementById('caseCardModal');
        const casePath = `dental lap/case data/${modal.dataset.caseYear}/${modal.dataset.caseMonth}/${modal.dataset.caseDay}/${modal.dataset.caseDoctor}/${modal.dataset.caseId}`;

        try {
            await database.ref(`${casePath}/toothTreatments/${toothNumber}`).set({
                label: label, key: label, price: price, color: color
            });

            const snap = await database.ref(casePath).once('value');
            const updatedCase = snap.val();
            if (updatedCase) {
                const treatments = updatedCase.toothTreatments || {};
                const newTotal = Object.values(treatments).reduce((sum, t) => sum + ((typeof t === 'object' ? t : {}).price || 0), 0);
                const currentPaid = updatedCase.paidAmount || 0;
                await database.ref(casePath).update({
                    total: newTotal,
                    remainingAmount: Math.max(0, newTotal - currentPaid)
                });
                await database.ref(`dental lap/users/doctors/data/${modal.dataset.caseDoctor}/invoices/${modal.dataset.caseId}`).update({
                    total: newTotal,
                    remainingAmount: Math.max(0, newTotal - currentPaid)
                });
            }

            dialog.remove();
            const freshSnap = await database.ref(casePath).once('value');
            const freshCase = { ...freshSnap.val(), _year: modal.dataset.caseYear, _month: modal.dataset.caseMonth, _day: modal.dataset.caseDay, _doctorName: modal.dataset.caseDoctor, caseId: modal.dataset.caseId, _fullDate: `${modal.dataset.caseYear}/${modal.dataset.caseMonth}/${modal.dataset.caseDay}` };
            openCaseCardView(freshCase);
        } catch (err) {
            alert('❌ خطأ: ' + err.message);
        }
    });

    if (td) {
        document.getElementById('deleteToothBtn').addEventListener('click', async () => {
            if (!confirm(`هل تريد حذف العلاج من سن ${toothNumber}؟`)) return;
            const modal = document.getElementById('caseCardModal');
            const casePath = `dental lap/case data/${modal.dataset.caseYear}/${modal.dataset.caseMonth}/${modal.dataset.caseDay}/${modal.dataset.caseDoctor}/${modal.dataset.caseId}`;
            try {
                await database.ref(`${casePath}/toothTreatments/${toothNumber}`).remove();

                const snap = await database.ref(casePath).once('value');
                const updatedCase = snap.val();
                if (updatedCase) {
                    const treatments = updatedCase.toothTreatments || {};
                    const newTotal = Object.values(treatments).reduce((sum, t) => sum + ((typeof t === 'object' ? t : {}).price || 0), 0);
                    const currentPaid = updatedCase.paidAmount || 0;
                    await database.ref(casePath).update({
                        total: newTotal,
                        remainingAmount: Math.max(0, newTotal - currentPaid)
                    });
                    await database.ref(`dental lap/users/doctors/data/${modal.dataset.caseDoctor}/invoices/${modal.dataset.caseId}`).update({
                        total: newTotal,
                        remainingAmount: Math.max(0, newTotal - currentPaid)
                    });
                }

                dialog.remove();
                const freshSnap = await database.ref(casePath).once('value');
                const freshCase = { ...freshSnap.val(), _year: modal.dataset.caseYear, _month: modal.dataset.caseMonth, _day: modal.dataset.caseDay, _doctorName: modal.dataset.caseDoctor, caseId: modal.dataset.caseId, _fullDate: `${modal.dataset.caseYear}/${modal.dataset.caseMonth}/${modal.dataset.caseDay}` };
                openCaseCardView(freshCase);
            } catch (err) {
                alert('❌ خطأ: ' + err.message);
            }
        });
    }
}

function renderCardInvoice(caseData) {
    const container = document.getElementById('cardInvoiceContent');
    if (!container) return;

    const toothTreatments = caseData.toothTreatments || {};
    const total = caseData.total || Object.values(toothTreatments).reduce((sum, t) => sum + ((typeof t === 'object' ? t : {}).price || 0), 0);
    const paid = caseData.paidAmount || 0;
    const remaining = (caseData.remainingAmount !== undefined) ? caseData.remainingAmount : (total - paid);
    const paymentHistory = caseData.paymentHistory || [];

    const itemsHtml = Object.entries(toothTreatments).map(([tooth, t]) => {
        const td = typeof t === 'object' ? t : { label: t, price: 0 };
        return `<div class="invoice-item-row"><span>🦷 سن ${tooth}</span><span>${escapeHtml(td.label || td.key || '')}</span><span style="color:#ffd700;">${(td.price || 0).toLocaleString('en-US')} ج.م</span></div>`;
    }).join('');

    const historyHtml = paymentHistory.length > 0 ? paymentHistory.map((p, i) => `
        <div class="payment-history-item">
            <span>💵 دفعة ${i + 1}: ${(p.amount || 0).toLocaleString('en-US')} ج.م</span>
            <span style="color: #90a4ae; font-size: 0.75rem;">${p.date || ''} ${p.note ? '- ' + escapeHtml(p.note) : ''}</span>
        </div>
    `).join('') : '<p style="color: #90a4ae;">لا توجد دفعات مسجلة</p>';

    container.innerHTML = `
        <div class="payment-summary-card" id="invoiceSummaryCard">
            <div class="payment-item">
                <div class="payment-label">💰 الإجمالي</div>
                <div class="payment-value" id="liveTotal">${total.toLocaleString('en-US')} ج.م</div>
            </div>
            <div class="payment-item">
                <div class="payment-label">💵 المدفوع</div>
                <div class="payment-value paid" id="livePaid">${paid.toLocaleString('en-US')} ج.م</div>
            </div>
            <div class="payment-item">
                <div class="payment-label">📊 المتبقي</div>
                <div class="payment-value ${remaining <= 0 ? 'paid' : 'remaining'}" id="liveRemaining">${remaining.toLocaleString('en-US')} ج.م</div>
            </div>
        </div>

        <div class="new-payment-section">
            <h4>💵 تسجيل دفعة جديدة</h4>
            <div class="new-payment-form">
                <input type="number" id="newPaymentAmount" placeholder="المبلغ المدفوع" />
                <input type="text" id="newPaymentNote" placeholder="ملاحظة (اختياري)" />
                <button class="save-invoice-btn" id="saveNewPayment">💾 تسجيل الدفعة</button>
            </div>
        </div>

        <h4 style="margin: 20px 0 10px;">📝 سجل الدفعات</h4>
        <div class="payment-history-list">${historyHtml}</div>

        <h4 style="margin: 20px 0 10px;">🦷 تفاصيل العلاجات</h4>
        <div class="invoice-items-list">${itemsHtml || '<p style="color:#90a4ae;">لا توجد علاجات</p>'}</div>
    `;

    const paymentInput = document.getElementById('newPaymentAmount');
    paymentInput.addEventListener('input', () => {
        const typedAmount = parseFloat(paymentInput.value) || 0;
        const previewPaid = paid + typedAmount;
        const previewRemaining = Math.max(0, total - previewPaid);

        document.getElementById('livePaid').textContent = previewPaid.toLocaleString('en-US') + ' ج.م';
        document.getElementById('liveRemaining').textContent = previewRemaining.toLocaleString('en-US') + ' ج.م';

        const remEl = document.getElementById('liveRemaining');
        remEl.className = 'payment-value ' + (previewRemaining <= 0 ? 'paid' : 'remaining');

        document.getElementById('cardPaid').textContent = previewPaid.toLocaleString('en-US') + ' ج.م';
        document.getElementById('cardRemaining').textContent = previewRemaining.toLocaleString('en-US') + ' ج.م';
    });

    document.getElementById('saveNewPayment').addEventListener('click', async () => {
        const amount = parseFloat(document.getElementById('newPaymentAmount').value);
        const note = document.getElementById('newPaymentNote').value.trim();

        if (!amount || amount <= 0) { alert('يرجى إدخال مبلغ صحيح'); return; }

        const modal = document.getElementById('caseCardModal');
        const casePath = `dental lap/case data/${modal.dataset.caseYear}/${modal.dataset.caseMonth}/${modal.dataset.caseDay}/${modal.dataset.caseDoctor}/${modal.dataset.caseId}`;

        try {
            const snap = await database.ref(casePath).once('value');
            const currentCase = snap.val();
            if (!currentCase) { alert('❌ الحالة غير موجودة'); return; }

            const currentTotal = currentCase.total || 0;
            const currentPaid = currentCase.paidAmount || 0;
            const newPaid = currentPaid + amount;
            const newRemaining = Math.max(0, currentTotal - newPaid);
            const history = currentCase.paymentHistory || [];

            const now = new Date();
            history.push({
                amount: amount,
                note: note,
                date: `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`,
                timestamp: Date.now()
            });

            await database.ref(casePath).update({
                paidAmount: newPaid,
                remainingAmount: newRemaining,
                isPaid: newRemaining <= 0,
                paymentHistory: history,
                paymentUpdatedAt: Date.now()
            });

            await database.ref(`dental lap/users/doctors/data/${modal.dataset.caseDoctor}/invoices/${modal.dataset.caseId}`).update({
                paidAmount: newPaid,
                remainingAmount: newRemaining,
                isPaid: newRemaining <= 0,
                paymentHistory: history,
                paymentUpdatedAt: Date.now()
            });

            await updateDoctorTotals(modal.dataset.caseDoctor);

            alert('✅ تم تسجيل الدفعة بنجاح');
            const freshSnap = await database.ref(casePath).once('value');
            const freshCase = { ...freshSnap.val(), _year: modal.dataset.caseYear, _month: modal.dataset.caseMonth, _day: modal.dataset.caseDay, _doctorName: modal.dataset.caseDoctor, caseId: modal.dataset.caseId, _fullDate: `${modal.dataset.caseYear}/${modal.dataset.caseMonth}/${modal.dataset.caseDay}` };
            openCaseCardView(freshCase);
            loadAllCases();
            loadDoctors();
        } catch (err) {
            alert('❌ خطأ: ' + err.message);
        }
    });
}

async function loadCardConversation(caseData) {
    const container = document.getElementById('cardConversationContent');
    if (!container) return;

    const casePath = `dental lap/case data/${caseData._year}/${caseData._month}/${caseData._day}/${caseData._doctorName}/${caseData.caseId}`;

    try {
        const snap = await database.ref(`${casePath}/conversation`).once('value');
        const conversation = snap.val() || [];

        let messagesHtml = '';
        if (Array.isArray(conversation) && conversation.length > 0) {
            messagesHtml = conversation.map(msg => {
                let cls = 'ai-msg-bot';
                let prefix = '🤖';
                if (msg.role === 'user') { cls = 'ai-msg-user'; prefix = '👨‍⚕️'; }
                else if (msg.role === 'admin') { cls = 'ai-msg-admin'; prefix = '🏢'; }
                return `<div class="${cls}">${prefix} ${escapeHtml(msg.content || '')}</div>`;
            }).join('');
        } else {
            messagesHtml = '<div class="empty-state"><p>لا توجد محادثات</p></div>';
        }

        container.innerHTML = `
            <div class="ai-conversation">
                <div class="ai-messages" id="cardAiMessages">${messagesHtml}</div>
                <div class="ai-input-row">
                    <input type="text" class="ai-input" id="cardAdminReply" placeholder="الرد كإدارة المعمل..." />
                    <button class="ai-send-btn" id="cardSendAdminReply">إرسال</button>
                </div>
            </div>
        `;

        const messagesDiv = document.getElementById('cardAiMessages');
        if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;

        document.getElementById('cardSendAdminReply').addEventListener('click', () => sendAdminReply(caseData, conversation));
        document.getElementById('cardAdminReply').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendAdminReply(caseData, conversation);
        });
    } catch (err) {
        container.innerHTML = '<div class="empty-state"><p>❌ خطأ في تحميل المحادثة</p></div>';
    }
}

async function sendAdminReply(caseData, conversation) {
    const input = document.getElementById('cardAdminReply');
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';

    const casePath = `dental lap/case data/${caseData._year}/${caseData._month}/${caseData._day}/${caseData._doctorName}/${caseData.caseId}`;

    const updatedConv = Array.isArray(conversation) ? [...conversation] : [];
    updatedConv.push({ role: 'admin', content: text });

    try {
        await database.ref(`${casePath}/conversation`).set(updatedConv);

        const messagesDiv = document.getElementById('cardAiMessages');
        if (messagesDiv) {
            const div = document.createElement('div');
            div.className = 'ai-msg-admin';
            div.textContent = '🏢 ' + text;
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        conversation.push({ role: 'admin', content: text });
    } catch (err) {
        alert('❌ خطأ في إرسال الرد: ' + err.message);
    }
}

async function updateDoctorTotals(doctorKey) {
    try {
        const invoicesSnap = await database.ref(`dental lap/users/doctors/data/${doctorKey}/invoices`).once('value');
        const invoices = invoicesSnap.val() || {};
        let totalAmount = 0, paidAmount = 0, casesCount = 0;
        for (const [caseId, inv] of Object.entries(invoices)) {
            totalAmount += inv.total || 0;
            paidAmount += inv.paidAmount || 0;
            casesCount++;
        }
        await database.ref(`dental lap/users/doctors/data/${doctorKey}/invoiceTotal`).set({
            amount: totalAmount, paidAmount, outstandingAmount: totalAmount - paidAmount, casesCount, lastUpdate: Date.now()
        });
    } catch (err) {}
}

async function copyTextData(caseData) {
    const btn = document.getElementById('cardCopyTextBtn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ جاري النسخ...';
    btn.disabled = true;

    try {
        const patientName = caseData.patientName || 'غير محدد';
        const scannerUrl = caseData.scannerFileUrl || '';
        const caseNotes = caseData.notes || '';
        const doctorName = caseData._doctorName || '';
        const caseDate = caseData._fullDate || '';
        const caseType = caseData.caseType || '';
        const randomCode = caseData.randomCode || '';

        const toothTreatments = caseData.toothTreatments || {};
        const toothConnections = caseData.toothConnections || {};
        let treatmentLines = [];
        for (const [num, t] of Object.entries(toothTreatments)) {
            const td = typeof t === 'object' ? t : { label: t };
            treatmentLines.push(`  سن ${num}: ${td.label || td.key || 'علاج'} - ${td.price || 0} ج.م`);
        }
        let connectionLines = [];
        for (const key of Object.keys(toothConnections)) {
            if (toothConnections[key]) {
                const [t1, t2] = key.split('_');
                connectionLines.push(`  ${t1} ↔ ${t2}`);
            }
        }

        let textContent = `🦷 *بيانات الحالة*\n`;
        textContent += `━━━━━━━━━━━━━━━\n`;
        textContent += `👤 *اسم المريض:* ${patientName}\n`;
        textContent += `👨‍⚕️ *الطبيب:* د. ${doctorName}\n`;
        textContent += `📅 *التاريخ:* ${caseDate}\n`;
        if (caseType) textContent += `📦 *نوع الحالة:* ${caseType}\n`;
        if (randomCode) textContent += `🔐 *الكود:* ${randomCode}\n`;
        textContent += `━━━━━━━━━━━━━━━\n`;
        if (scannerUrl) {
            textContent += `📎 *رابط السكان:*\n${scannerUrl}\n`;
        }
        if (treatmentLines.length > 0) {
            textContent += `━━━━━━━━━━━━━━━\n`;
            textContent += `🦷 *العلاجات:*\n${treatmentLines.join('\n')}\n`;
        }
        if (connectionLines.length > 0) {
            textContent += `🔗 *الكونكتورات:*\n${connectionLines.join('\n')}\n`;
        }
        if (caseNotes) {
            textContent += `━━━━━━━━━━━━━━━\n`;
            textContent += `📝 *ملاحظات:*\n${caseNotes}\n`;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(textContent);
        } else {
            const ta = document.createElement('textarea');
            ta.value = textContent;
            ta.style.cssText = 'position:fixed;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        btn.textContent = '✅ تم نسخ النصوص!';
    } catch (err) {
        btn.textContent = '❌ خطأ في النسخ';
        console.error('Copy text error:', err);
    }

    btn.disabled = false;
    setTimeout(() => { btn.textContent = originalText; }, 3000);
}

async function copyTeethImage(caseData) {
    const btn = document.getElementById('cardCopyImageBtn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ جاري التقاط الصورة...';
    btn.disabled = true;

    try {
        const teethWrapper = document.getElementById('cardTeethWrapper');
        if (!teethWrapper || typeof html2canvas === 'undefined') {
            btn.textContent = '❌ لا يمكن التقاط الصورة';
            btn.disabled = false;
            setTimeout(() => { btn.textContent = originalText; }, 3000);
            return;
        }

        const canvas = await html2canvas(teethWrapper, {
            backgroundColor: '#1a1a2e',
            scale: 2,
            useCORS: true,
            logging: false
        });
        const teethImageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

        if (!teethImageBlob) {
            btn.textContent = '❌ فشل إنشاء الصورة';
            btn.disabled = false;
            setTimeout(() => { btn.textContent = originalText; }, 3000);
            return;
        }

        let copied = false;
        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
            try {
                const clipboardItem = new ClipboardItem({ 'image/png': teethImageBlob });
                await navigator.clipboard.write([clipboardItem]);
                copied = true;
                btn.textContent = '✅ تم نسخ الصورة!';
            } catch (clipErr) {}
        }

        if (!copied) {
            const url = URL.createObjectURL(teethImageBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `teeth_${caseData.patientName || 'case'}_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            btn.textContent = '✅ تم تحميل الصورة!';
        }
    } catch (err) {
        btn.textContent = '❌ خطأ في الصورة';
        console.error('Copy image error:', err);
    }

    btn.disabled = false;
    setTimeout(() => { btn.textContent = originalText; }, 3000);
}

function downloadScannerDirect(fileUrl, fileName) {
    if (!fileUrl) {
        alert('❌ لا يوجد رابط تحميل');
        return;
    }

    const progressDiv = document.getElementById('downloadProgress');
    const progressFill = document.getElementById('downloadProgressFill');
    const progressText = document.getElementById('downloadProgressText');

    if (progressDiv) {
        progressDiv.style.display = 'block';
        progressFill.style.width = '50%';
        progressText.textContent = 'جاري فتح رابط التحميل...';
    }

    const a = document.createElement('a');
    a.href = fileUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (fileName) a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (progressDiv) {
        progressFill.style.width = '100%';
        progressText.textContent = '✅ تم فتح رابط التحميل';
        setTimeout(() => { progressDiv.style.display = 'none'; }, 2000);
    }
}

function setupModals() {
    const modals = ['caseCardModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            const closeBtn = modal.querySelector('.modal-close');
            if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('active'));
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
        }
    });

    document.querySelectorAll('.card-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.cardTab;
            document.querySelectorAll('.card-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.card-tab-content').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`card${tabId.charAt(0).toUpperCase() + tabId.slice(1)}Tab`).classList.add('active');
        });
    });
}

function initEventListeners() {
    document.getElementById('searchBtn').addEventListener('click', () => {
        currentSearchTerm = document.getElementById('searchInput').value;
        applyFilters();
    });
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            currentSearchTerm = document.getElementById('searchInput').value;
            applyFilters();
        }
    });
    document.getElementById('resetSearchBtn').addEventListener('click', () => {
        document.getElementById('searchInput').value = '';
        currentSearchTerm = '';
        currentFilterDoctor = '';
        currentFilterStatus = '';
        currentFilterPayment = '';
        currentFilterHasScanner = '';
        currentFilterDate = '';
        document.getElementById('filterDoctor').value = '';
        document.getElementById('filterStatus').value = '';
        document.getElementById('filterPayment').value = '';
        document.getElementById('filterHasScanner').value = '';
        document.getElementById('filterDate').value = '';
        applyFilters();
    });
    document.getElementById('filterDoctor').addEventListener('change', (e) => { currentFilterDoctor = e.target.value; applyFilters(); });
    document.getElementById('filterStatus').addEventListener('change', (e) => { currentFilterStatus = e.target.value; applyFilters(); });
    document.getElementById('filterPayment').addEventListener('change', (e) => { currentFilterPayment = e.target.value; applyFilters(); });
    document.getElementById('filterHasScanner').addEventListener('change', (e) => { currentFilterHasScanner = e.target.value; applyFilters(); });
    document.getElementById('filterDate').addEventListener('change', (e) => { currentFilterDate = e.target.value; applyFilters(); });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${tabId}Tab`).classList.add('active');
            if (tabId === 'workflow') loadWorkflow();
            if (tabId === 'waiting') loadWaitingCases();
            if (tabId === 'invoices') loadInvoices();
        });
    });

    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        if (m === "'") return '&#39;';
        return m;
    });
}

async function initAdmin() {
    setupModals();
    initEventListeners();
    document.getElementById('adminName').textContent = 'مرحباً المدير';
    await loadDoctors();
    await loadAllCases();
    await loadWaitingCases();
}

document.addEventListener('DOMContentLoaded', initAdmin);
