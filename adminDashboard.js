// ============= تهيئة Firebase =============
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
const storage = firebase.storage();

// ============= المتغيرات العامة =============
let currentAdmin = null;
let currentCaseData = null;
let allCasesCache = [];
let allDoctorsCache = [];
let availableDates = []; // قائمة التواريخ المتوفرة في قاعدة البيانات
let currentDateIndex = 0; // index التاريخ الحالي في قائمة availableDates
let currentViewDate = null; // التاريخ المعروض حالياً

// ============= دوال مساعدة =============
function formatDate(timestamp) {
    if (!timestamp) return 'غير محدد';
    const date = new Date(timestamp);
    return date.toLocaleDateString('ar-EG');
}

function formatDateTime(timestamp) {
    if (!timestamp) return 'غير محدد';
    const date = new Date(timestamp);
    return date.toLocaleString('ar-EG');
}

function formatDateYMD(date) {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return 'اليوم';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
}

function getStatusText(status) {
    const statusMap = {
        1: '📦 وصول الطلب',
        2: '🚚 إرسال مندوب',
        3: '⚙️ قيد العمل',
        4: '🏥 الشحن للعيادة'
    };
    return statusMap[status] || 'غير محدد';
}

function getStatusClass(status) {
    return `status-${status}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m));
}

// ============= تحميل بيانات الإداري =============
function loadAdminData() {
    const adminData = localStorage.getItem('currentAdmin');
    if (!adminData) {
        window.location.href = 'admin.html';
        return null;
    }
    currentAdmin = JSON.parse(adminData);
    document.getElementById('adminName').textContent = currentAdmin.adminName;
    document.getElementById('adminNameDisplay').textContent = currentAdmin.adminName;
    updateDateTime();
    setInterval(updateDateTime, 1000);
    return currentAdmin;
}

function updateDateTime() {
    const now = new Date();
    document.getElementById('dateTime').textContent = now.toLocaleString('ar-EG');
}

// ============= التنقل بين الصفحات =============
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const page = btn.dataset.page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(`${page}Page`).classList.add('active');
        document.getElementById('pageTitle').textContent = btn.querySelector('span:last-child').textContent;
        
        if (page === 'dashboard') loadDashboard();
        else if (page === 'cases') loadAllCases();
        else if (page === 'search') initSearchPage();
        else if (page === 'doctors') loadDoctors();
        else if (page === 'messages') loadConversations();
        else if (page === 'files') loadFiles();
        else if (page === 'settings') loadSettings();
    });
});

// ============= جلب التواريخ المتوفرة من قاعدة البيانات =============
async function fetchAvailableDates() {
    try {
        const caseDataRef = database.ref('dental lap/case data');
        const snapshot = await caseDataRef.once('value');
        const datesSet = new Set();
        
        function extractDates(obj) {
            if (!obj) return;
            for (const key in obj) {
                if (obj[key] && typeof obj[key] === 'object') {
                    // التحقق إذا كان هذا هو مستوى السنة (أرقام)
                    if (key.match(/^\d{4}$/)) {
                        const year = key;
                        for (const month in obj[key]) {
                            if (month.match(/^\d{2}$/)) {
                                for (const day in obj[key][month]) {
                                    if (day.match(/^\d{2}$/)) {
                                        datesSet.add(`${year}-${month}-${day}`);
                                    }
                                }
                            }
                        }
                    } else {
                        extractDates(obj[key]);
                    }
                }
            }
        }
        
        extractDates(snapshot.val());
        
        availableDates = Array.from(datesSet).sort();
        return availableDates;
    } catch (error) {
        console.error("Error fetching available dates:", error);
        return [];
    }
}

// ============= 1. لوحة المعلومات (Dashboard) المحسنة =============
async function loadDashboard(dateFilter = null) {
    try {
        showLoading('dashboard');
        
        // جلب جميع الحالات من جميع الأطباء
        const casesRef = database.ref('dental lap/case data');
        const snapshot = await casesRef.once('value');
        const allCases = [];
        
        function extractCases(obj, currentPath = '') {
            if (!obj) return;
            for (const key in obj) {
                if (obj[key] && typeof obj[key] === 'object') {
                    if (obj[key].caseId && obj[key].patientName) {
                        allCases.push({
                            ...obj[key],
                            _refPath: `${currentPath}/${key}`,
                            _doctorName: extractDoctorNameFromPath(currentPath)
                        });
                    } else {
                        extractCases(obj[key], `${currentPath}/${key}`);
                    }
                }
            }
        }
        
        function extractDoctorNameFromPath(path) {
            const parts = path.split('/');
            for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i] && !parts[i].match(/^\d+$/) && parts[i] !== 'case data') {
                    return parts[i];
                }
            }
            return 'غير محدد';
        }
        
        extractCases(snapshot.val());
        allCasesCache = allCases;
        
        // جلب التواريخ المتوفرة
        if (availableDates.length === 0) {
            await fetchAvailableDates();
        }
        
        // تحديث أزرار التنقل في التاريخ
        updateDateNavigation();
        
        // تحديد التاريخ المراد عرضه
        let targetDate = dateFilter;
        if (!targetDate && currentViewDate) {
            targetDate = currentViewDate;
        }
        if (!targetDate && availableDates.length > 0) {
            targetDate = availableDates[availableDates.length - 1]; // آخر تاريخ (الأحدث)
            currentDateIndex = availableDates.length - 1;
        }
        if (targetDate) {
            currentViewDate = targetDate;
            document.getElementById('currentDateDisplay').textContent = formatDateDisplay(targetDate);
        }
        
        // فلترة الحالات حسب التاريخ المحدد
        let filteredCases = allCases;
        if (targetDate) {
            filteredCases = allCases.filter(c => c.date === targetDate);
        }
        
        // الإحصائيات
        const totalCases = filteredCases.length;
        const inProgress = filteredCases.filter(c => c.orderStatus === 3).length;
        const completed = filteredCases.filter(c => c.orderStatus === 4).length;
        const newOrders = filteredCases.filter(c => c.orderStatus === 1).length;
        const shipping = filteredCases.filter(c => c.orderStatus === 2).length;
        
        document.getElementById('totalCases').textContent = totalCases;
        document.getElementById('inProgressCases').textContent = inProgress;
        document.getElementById('completedCases').textContent = completed;
        document.getElementById('newOrdersCount').textContent = newOrders;
        document.getElementById('shippingCount').textContent = shipping;
        document.getElementById('casesCount').textContent = totalCases;
        
        // عرض إحصائيات إضافية
        const totalTeeth = filteredCases.reduce((sum, c) => sum + Object.keys(c.toothTreatments || {}).length, 0);
        const hasFiles = filteredCases.filter(c => c.scannerFile).length;
        
        document.getElementById('totalTeethCount').textContent = totalTeeth;
        document.getElementById('filesCount').textContent = hasFiles;
        
        // عرض الحالات (جميعها أو آخر 10 حسب التاريخ)
        const casesToShow = targetDate ? filteredCases : filteredCases.slice(0, 10);
        const tbody = document.getElementById('recentCasesList');
        
        if (casesToShow.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="no-data-cell">📭 لا توجد حالات في هذا التاريخ</td></tr>`;
        } else {
            tbody.innerHTML = casesToShow.map(c => `
                <tr>
                    <td><strong>${escapeHtml(c.patientName || 'غير محدد')}</strong><br><small class="case-id-small">${escapeHtml(c.caseId || '')}</small></td>
                    <td>د. ${escapeHtml(c.doctorName || c.clinicName || 'غير محدد')}</td>
                    <td><span class="status-badge ${getStatusClass(c.orderStatus)}">${getStatusText(c.orderStatus)}</span></td>
                    <td>${formatDateDisplay(c.date)}</td>
                    <td><span class="teeth-count">${Object.keys(c.toothTreatments || {}).length}</span> سن</td>
                    <td>
                        <button class="view-btn small" onclick="viewCase('${c.caseId}')">🔍 عرض</button>
                        <button class="view-btn small outline" onclick="viewCaseQuick('${c.caseId}')">📋 تفاصيل</button>
                    </td>
                </tr>
            `).join('');
        }
        
        // عدد الأطباء المسجلين
        const doctorsRef = database.ref('dental lap/data');
        const doctorsSnap = await doctorsRef.once('value');
        const doctorsData = doctorsSnap.val();
        const doctorsCount = doctorsData ? Object.keys(doctorsData).length : 0;
        document.getElementById('totalDoctors').textContent = doctorsCount;
        
        // عرض آخر 5 أطباء نشطين
        const activeDoctors = doctorsData ? Object.entries(doctorsData).slice(0, 5) : [];
        const doctorsListHtml = activeDoctors.map(([name, data]) => `
            <div class="doctor-mini-card">
                <div class="doctor-mini-avatar">👨‍⚕️</div>
                <div class="doctor-mini-info">
                    <div class="doctor-mini-name">د. ${escapeHtml(name)}</div>
                    <div class="doctor-mini-clinic">${escapeHtml(data.clinicName || name)}</div>
                </div>
            </div>
        `).join('');
        
        document.getElementById('recentDoctorsList').innerHTML = doctorsListHtml || '<div class="no-data-mini">لا يوجد أطباء</div>';
        
        // إحصائيات العلاج
        const treatmentStats = { zircon: 0, porcelain: 0, other: 0 };
        filteredCases.forEach(c => {
            const treatments = Object.values(c.toothTreatments || {});
            treatments.forEach(t => {
                if (t === 'zircon') treatmentStats.zircon++;
                else if (t === 'porcelain') treatmentStats.porcelain++;
                else treatmentStats.other++;
            });
        });
        
        document.getElementById('zirconCount').textContent = treatmentStats.zircon;
        document.getElementById('porcelainCount').textContent = treatmentStats.porcelain;
        
        hideLoading('dashboard');
        
    } catch (error) {
        console.error("خطأ في تحميل لوحة المعلومات:", error);
        hideLoading('dashboard');
        showToast('حدث خطأ في تحميل البيانات', 'error');
    }
}

// تحديث أزرار التنقل بين التواريخ
function updateDateNavigation() {
    const prevBtn = document.getElementById('prevDateBtn');
    const nextBtn = document.getElementById('nextDateBtn');
    const dateDisplay = document.getElementById('currentDateDisplay');
    
    if (!prevBtn || !nextBtn) return;
    
    // تعطيل الأزرار إذا لم تكن هناك تواريخ
    if (availableDates.length === 0) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        if (dateDisplay) dateDisplay.textContent = 'لا توجد بيانات';
        return;
    }
    
    // تحديث حالة الأزرار
    prevBtn.disabled = (currentDateIndex <= 0);
    nextBtn.disabled = (currentDateIndex >= availableDates.length - 1);
}

// دوال التنقل بين التواريخ
function goToPrevDate() {
    if (currentDateIndex > 0) {
        currentDateIndex--;
        currentViewDate = availableDates[currentDateIndex];
        loadDashboard(currentViewDate);
    }
}

function goToNextDate() {
    if (currentDateIndex < availableDates.length - 1) {
        currentDateIndex++;
        currentViewDate = availableDates[currentDateIndex];
        loadDashboard(currentViewDate);
    }
}

function goToToday() {
    const today = formatDateYMD(new Date());
    const todayIndex = availableDates.indexOf(today);
    if (todayIndex !== -1) {
        currentDateIndex = todayIndex;
        currentViewDate = today;
    } else {
        // إذا لم يكن اليوم موجوداً، اذهب إلى أحدث تاريخ
        currentDateIndex = availableDates.length - 1;
        currentViewDate = availableDates[currentDateIndex];
    }
    loadDashboard(currentViewDate);
}

// عرض سريع للحالة
function viewCaseQuick(caseId) {
    viewCase(caseId);
}

// ============= 2. عرض جميع الحالات =============
async function loadAllCases() {
    try {
        showLoading('cases');
        
        let allCases = allCasesCache;
        if (allCases.length === 0) {
            const casesRef = database.ref('dental lap/case data');
            const snapshot = await casesRef.once('value');
            allCases = [];
            
            function extractAllCases(obj, currentPath = '') {
                if (!obj) return;
                for (const key in obj) {
                    if (obj[key] && typeof obj[key] === 'object') {
                        if (obj[key].caseId && obj[key].patientName) {
                            allCases.push({
                                ...obj[key],
                                _refPath: `${currentPath}/${key}`
                            });
                        } else {
                            extractAllCases(obj[key], `${currentPath}/${key}`);
                        }
                    }
                }
            }
            extractAllCases(snapshot.val());
            allCasesCache = allCases;
        }
        
        // ترتيب حسب التاريخ (الأحدث أولاً)
        const sortedCases = [...allCases].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        displayCasesList(sortedCases);
        
        const statusFilter = document.getElementById('statusFilter');
        const searchInput = document.getElementById('searchCases');
        const dateFilterCases = document.getElementById('dateFilterCases');
        
        const filterCases = () => {
            const status = statusFilter.value;
            const search = searchInput.value.toLowerCase();
            const dateFilter = dateFilterCases.value;
            
            let filtered = [...sortedCases];
            if (status !== 'all') {
                filtered = filtered.filter(c => c.orderStatus == status);
            }
            if (search) {
                filtered = filtered.filter(c => 
                    (c.patientName && c.patientName.toLowerCase().includes(search)) ||
                    (c.doctorName && c.doctorName.toLowerCase().includes(search)) ||
                    (c.caseId && c.caseId.toLowerCase().includes(search)) ||
                    (c.randomCode && c.randomCode.toLowerCase().includes(search))
                );
            }
            if (dateFilter) {
                filtered = filtered.filter(c => c.date === dateFilter);
            }
            displayCasesList(filtered);
        };
        
        statusFilter.onchange = filterCases;
        searchInput.oninput = filterCases;
        dateFilterCases.onchange = filterCases;
        
        hideLoading('cases');
        
    } catch (error) {
        console.error("خطأ في تحميل الحالات:", error);
        hideLoading('cases');
        showToast('حدث خطأ في تحميل الحالات', 'error');
    }
}

function displayCasesList(cases) {
    const container = document.getElementById('allCasesList');
    if (!cases || cases.length === 0) {
        container.innerHTML = '<div class="no-data">📭 لا توجد حالات لعرضها</div>';
        return;
    }
    
    container.innerHTML = cases.map(c => `
        <div class="case-item" data-case-id="${c.caseId}">
            <div class="case-header">
                <div class="case-patient">
                    <span class="patient-icon">👤</span>
                    <strong>${escapeHtml(c.patientName || 'غير محدد')}</strong>
                    <span class="case-id">#${escapeHtml(c.caseId || '')}</span>
                </div>
                <div class="case-status">
                    <span class="status-badge ${getStatusClass(c.orderStatus)}">${getStatusText(c.orderStatus)}</span>
                </div>
            </div>
            <div class="case-details">
                <div class="detail-item">
                    <span class="detail-icon">👨‍⚕️</span>
                    <span>د. ${escapeHtml(c.doctorName || c.clinicName || 'غير محدد')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-icon">🔐</span>
                    <span>الرقم التأكيدي: <strong class="secret-code">${escapeHtml(c.randomCode || 'غير متوفر')}</strong></span>
                </div>
                <div class="detail-item">
                    <span class="detail-icon">📅</span>
                    <span>التاريخ: ${formatDateDisplay(c.date)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-icon">🦷</span>
                    <span>الأسنان: ${Object.keys(c.toothTreatments || {}).length}</span>
                </div>
                ${c.notes ? `<div class="detail-item notes-preview"><span class="detail-icon">📝</span><span>${escapeHtml(c.notes.substring(0, 80))}${c.notes.length > 80 ? '...' : ''}</span></div>` : ''}
            </div>
            <div class="case-actions">
                <button class="action-btn small" onclick="viewCase('${c.caseId}')">🔍 التفاصيل</button>
                <button class="action-btn small" onclick="viewCaseConversation('${c.caseId}')">💬 المحادثة</button>
                ${c.scannerFile ? `<button class="action-btn small" onclick="downloadFileFromCase('${c.caseId}')">📁 الملف</button>` : ''}
                <button class="action-btn small" onclick="updateCaseStatusQuick('${c.caseId}', ${c.orderStatus || 1})">🔄 تحديث</button>
            </div>
        </div>
    `).join('');
}

// ============= 3. صفحة البحث المتقدم =============
function initSearchPage() {
    const searchBtn = document.getElementById('doSearchBtn');
    if (searchBtn) {
        searchBtn.onclick = performAdvancedSearch;
    }
}

async function performAdvancedSearch() {
    const patientName = document.getElementById('searchPatientName').value.trim();
    const doctorName = document.getElementById('searchDoctorName').value.trim();
    const secretCode = document.getElementById('searchSecretCode').value.trim();
    const searchDate = document.getElementById('searchDate').value;
    const status = document.getElementById('searchStatus').value;
    const treatment = document.getElementById('searchTreatment').value;
    
    showLoading('search');
    
    try {
        if (secretCode) {
            const indexRef = database.ref(`dental lap/case data/index/${secretCode}`);
            const indexSnap = await indexRef.once('value');
            if (indexSnap.exists()) {
                const caseId = indexSnap.val();
                const caseData = await findCaseByPath(caseId);
                if (caseData) {
                    displaySearchResults([caseData]);
                    hideLoading('search');
                    return;
                }
            }
        }
        
        let results = [...allCasesCache];
        if (allCasesCache.length === 0) {
            const casesRef = database.ref('dental lap/case data');
            const snapshot = await casesRef.once('value');
            results = [];
            function extract(obj) {
                if (!obj) return;
                for (const key in obj) {
                    if (obj[key] && typeof obj[key] === 'object') {
                        if (obj[key].caseId && obj[key].patientName) {
                            results.push(obj[key]);
                        } else {
                            extract(obj[key]);
                        }
                    }
                }
            }
            extract(snapshot.val());
        } else {
            results = [...allCasesCache];
        }
        
        if (patientName) {
            results = results.filter(c => c.patientName && c.patientName.toLowerCase().includes(patientName.toLowerCase()));
        }
        if (doctorName) {
            results = results.filter(c => (c.doctorName && c.doctorName.toLowerCase().includes(doctorName.toLowerCase())) ||
                                        (c.clinicName && c.clinicName.toLowerCase().includes(doctorName.toLowerCase())));
        }
        if (searchDate) {
            results = results.filter(c => c.date === searchDate);
        }
        if (status) {
            results = results.filter(c => c.orderStatus == status);
        }
        if (treatment) {
            results = results.filter(c => {
                const treatments = Object.values(c.toothTreatments || {});
                return treatments.includes(treatment);
            });
        }
        
        displaySearchResults(results);
        
    } catch (error) {
        console.error("خطأ في البحث:", error);
        showToast('حدث خطأ في البحث', 'error');
    }
    
    hideLoading('search');
}

async function findCaseByPath(caseId) {
    for (const c of allCasesCache) {
        if (c.caseId === caseId) return c;
    }
    return null;
}

function displaySearchResults(results) {
    const container = document.getElementById('searchResults');
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="no-data">🔍 لم يتم العثور على نتائج</div>';
        return;
    }
    
    container.innerHTML = `
        <div class="search-summary">🔍 تم العثور على <strong>${results.length}</strong> نتيجة</div>
        <div class="search-results-list">
            ${results.map(c => `
                <div class="case-item compact">
                    <div class="case-header">
                        <div class="case-patient">👤 ${escapeHtml(c.patientName)}</div>
                        <div class="case-status"><span class="status-badge ${getStatusClass(c.orderStatus)}">${getStatusText(c.orderStatus)}</span></div>
                    </div>
                    <div class="case-details">
                        <div>👨‍⚕️ د. ${escapeHtml(c.doctorName || c.clinicName)}</div>
                        <div>🔐 <span class="secret-code">${escapeHtml(c.randomCode || '')}</span></div>
                        <div>📅 ${formatDateDisplay(c.date)}</div>
                    </div>
                    <div class="case-actions">
                        <button class="action-btn small" onclick="viewCase('${c.caseId}')">🔍 عرض</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ============= 4. إدارة الأطباء =============
async function loadDoctors() {
    try {
        showLoading('doctors');
        
        const doctorsRef = database.ref('dental lap/data');
        const snapshot = await doctorsRef.once('value');
        const doctors = snapshot.val();
        
        const container = document.getElementById('doctorsList');
        if (!doctors || Object.keys(doctors).length === 0) {
            container.innerHTML = '<div class="no-data">👨‍⚕️ لا يوجد أطباء مسجلين</div>';
            hideLoading('doctors');
            return;
        }
        
        const casesCount = {};
        for (const c of allCasesCache) {
            const doctorKey = c.doctorName || c.clinicName;
            if (doctorKey) {
                casesCount[doctorKey] = (casesCount[doctorKey] || 0) + 1;
            }
        }
        
        const doctorsArray = Object.entries(doctors).map(([name, data]) => ({
            name,
            ...data,
            casesCount: casesCount[name] || 0
        })).sort((a, b) => b.casesCount - a.casesCount);
        
        container.innerHTML = doctorsArray.map(doc => `
            <div class="doctor-card" data-doctor="${escapeHtml(doc.name)}">
                <div class="doctor-avatar">
                    <span class="avatar-icon">👨‍⚕️</span>
                </div>
                <div class="doctor-info">
                    <div class="doctor-name">د. ${escapeHtml(doc.name)}</div>
                    <div class="doctor-details">
                        <span class="detail-badge">🏥 ${escapeHtml(doc.clinicName || doc.name)}</span>
                        <span class="detail-badge">📞 ${escapeHtml(doc.phoneNumber || doc.clinicNumber || 'غير محدد')}</span>
                        <span class="detail-badge">📧 ${escapeHtml(doc.email || 'غير محدد')}</span>
                        <span class="detail-badge">📍 ${escapeHtml(doc.governorate || '')} ${doc.area ? '- ' + escapeHtml(doc.area) : ''}</span>
                        <span class="detail-badge cases-badge">📋 ${doc.casesCount} حالة</span>
                    </div>
                </div>
                <div class="doctor-actions">
                    <button class="action-btn small" onclick="viewDoctorCases('${escapeHtml(doc.name)}')">📋 الحالات</button>
                    <button class="action-btn small" onclick="sendMessageToDoctor('${escapeHtml(doc.name)}')">💬 رسالة</button>
                    <button class="action-btn small" onclick="editDoctorInfo('${escapeHtml(doc.name)}')">✏️ تعديل</button>
                </div>
            </div>
        `).join('');
        
        document.getElementById('totalDoctorsCount').textContent = doctorsArray.length;
        hideLoading('doctors');
        
    } catch (error) {
        console.error("خطأ في تحميل الأطباء:", error);
        hideLoading('doctors');
        showToast('حدث خطأ في تحميل بيانات الأطباء', 'error');
    }
}

async function viewDoctorCases(doctorName) {
    const doctorCases = allCasesCache.filter(c => 
        (c.doctorName === doctorName) || (c.clinicName === doctorName)
    );
    
    if (doctorCases.length === 0) {
        showToast(`لا توجد حالات للدكتور ${doctorName}`, 'info');
        return;
    }
    
    document.querySelector('.nav-btn[data-page="cases"]').click();
    setTimeout(() => {
        document.getElementById('searchCases').value = doctorName;
        document.getElementById('searchCases').dispatchEvent(new Event('input'));
    }, 100);
}

async function editDoctorInfo(doctorName) {
    try {
        const doctorRef = database.ref(`dental lap/data/${doctorName}`);
        const snapshot = await doctorRef.once('value');
        const doctorData = snapshot.val();
        
        if (!doctorData) {
            showToast('لم يتم العثور على بيانات الطبيب', 'error');
            return;
        }
        
        const newPhone = prompt('📞 رقم الهاتف الجديد:', doctorData.phoneNumber || doctorData.clinicNumber || '');
        const newEmail = prompt('📧 البريد الإلكتروني الجديد:', doctorData.email || '');
        
        const updates = {};
        if (newPhone && newPhone !== (doctorData.phoneNumber || doctorData.clinicNumber)) {
            updates.phoneNumber = newPhone;
            updates.clinicNumber = newPhone;
        }
        if (newEmail && newEmail !== doctorData.email) {
            updates.email = newEmail;
        }
        
        if (Object.keys(updates).length > 0) {
            await doctorRef.update(updates);
            showToast('✅ تم تحديث بيانات الطبيب بنجاح', 'success');
            loadDoctors();
        } else {
            showToast('لم يتم إجراء أي تغييرات', 'info');
        }
        
    } catch (error) {
        console.error("خطأ في تعديل بيانات الطبيب:", error);
        showToast('حدث خطأ في تعديل البيانات', 'error');
    }
}

// ============= 5. المحادثات والرسائل =============
async function loadConversations() {
    try {
        showLoading('messages');
        
        const conversations = [];
        for (const c of allCasesCache) {
            if (c.conversation && c.conversation.length > 0) {
                conversations.push({
                    caseId: c.caseId,
                    patientName: c.patientName,
                    doctorName: c.doctorName || c.clinicName,
                    conversation: c.conversation,
                    lastUpdated: c.lastMessageTime || c.createdAt,
                    lastMessage: c.conversation[c.conversation.length - 1]?.content || '',
                    messageCount: c.conversation.length
                });
            }
        }
        
        const sortedConv = conversations.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
        const container = document.getElementById('conversationsList');
        
        if (sortedConv.length === 0) {
            container.innerHTML = '<div class="no-data">💬 لا توجد محادثات</div>';
            hideLoading('messages');
            return;
        }
        
        container.innerHTML = sortedConv.map(c => `
            <div class="conversation-card" onclick="viewFullConversation('${c.caseId}')">
                <div class="conversation-header">
                    <div class="conversation-info">
                        <span class="conversation-patient">👤 ${escapeHtml(c.patientName)}</span>
                        <span class="conversation-doctor">👨‍⚕️ د. ${escapeHtml(c.doctorName)}</span>
                    </div>
                    <div class="conversation-date">${formatDateTime(c.lastUpdated)}</div>
                </div>
                <div class="conversation-preview">
                    💬 ${escapeHtml(c.lastMessage.substring(0, 100))}${c.lastMessage.length > 100 ? '...' : ''}
                </div>
                <div class="conversation-stats">
                    <span class="msg-count">📨 ${c.messageCount} رسالة</span>
                </div>
            </div>
        `).join('');
        
        document.getElementById('unreadCount').textContent = sortedConv.length;
        hideLoading('messages');
        
    } catch (error) {
        console.error("خطأ في تحميل المحادثات:", error);
        hideLoading('messages');
        showToast('حدث خطأ في تحميل المحادثات', 'error');
    }
}

async function viewFullConversation(caseId) {
    try {
        const caseData = await findCaseByPath(caseId);
        if (!caseData || !caseData.conversation) {
            showToast('لا توجد محادثة لهذه الحالة', 'info');
            return;
        }
        
        const modalBody = document.getElementById('caseModalBody');
        const conversationHtml = caseData.conversation.map(msg => `
            <div class="conversation-message ${msg.role === 'user' ? 'user-msg' : msg.role === 'admin' ? 'admin-msg' : 'bot-msg'}">
                <div class="message-sender">
                    ${msg.role === 'user' ? '👤 الطبيب' : msg.role === 'admin' ? '👨‍💼 الإدارة' : '🤖 المساعد'}
                </div>
                <div class="message-content">${escapeHtml(msg.content)}</div>
                <div class="message-time">${msg.timestamp ? formatDateTime(msg.timestamp) : ''}</div>
            </div>
        `).join('');
        
        modalBody.innerHTML = `
            <div class="conversation-full-view">
                <div class="conv-header">
                    <h4>💬 محادثة حالة المريض: ${escapeHtml(caseData.patientName)}</h4>
                    <p>👨‍⚕️ د. ${escapeHtml(caseData.doctorName || caseData.clinicName)}</p>
                    <p>🔐 الرقم التأكيدي: <strong class="secret-code">${escapeHtml(caseData.randomCode || 'غير متوفر')}</strong></p>
                </div>
                <div class="conv-messages">
                    ${conversationHtml}
                </div>
                <div class="conv-reply">
                    <textarea id="adminReplyMsg" rows="3" placeholder="✏️ اكتب ردك هنا..."></textarea>
                    <button class="action-btn" onclick="sendAdminReply('${caseId}')">📤 إرسال رد</button>
                </div>
            </div>
        `;
        
        document.getElementById('caseModal').classList.add('active');
        
    } catch (error) {
        console.error("خطأ:", error);
        showToast('حدث خطأ في عرض المحادثة', 'error');
    }
}

async function sendAdminReply(caseId) {
    const replyMsg = document.getElementById('adminReplyMsg')?.value.trim();
    if (!replyMsg) {
        showToast('الرجاء كتابة رسالة', 'warning');
        return;
    }
    
    try {
        const caseData = await findCaseByPath(caseId);
        if (!caseData) {
            showToast('لم يتم العثور على الحالة', 'error');
            return;
        }
        
        const conversation = caseData.conversation || [];
        conversation.push({
            role: 'admin',
            content: replyMsg,
            timestamp: Date.now(),
            from: currentAdmin.adminName
        });
        
        const caseRef = await getCaseRef(caseId);
        if (caseRef) {
            await caseRef.update({
                conversation: conversation,
                lastMessageTime: Date.now(),
                lastMessageFrom: 'admin'
            });
            
            showToast('✅ تم إرسال الرد بنجاح', 'success');
            document.getElementById('adminReplyMsg').value = '';
            viewFullConversation(caseId);
            loadConversations();
        }
        
    } catch (error) {
        console.error("خطأ في إرسال الرد:", error);
        showToast('حدث خطأ في إرسال الرد', 'error');
    }
}

// ============= 6. ملفات الاسكانر =============
async function loadFiles() {
    try {
        showLoading('files');
        
        const files = [];
        for (const c of allCasesCache) {
            if (c.scannerFile && c.scannerFileUrl) {
                files.push({
                    fileName: c.scannerFile,
                    fileUrl: c.scannerFileUrl,
                    caseId: c.caseId,
                    patientName: c.patientName,
                    doctorName: c.doctorName || c.clinicName,
                    uploadedAt: c.scannerUploadedAt,
                    fileType: c.scannerFile.split('.').pop().toUpperCase()
                });
            }
        }
        
        const container = document.getElementById('filesGrid');
        if (files.length === 0) {
            container.innerHTML = '<div class="no-data">📁 لا توجد ملفات مرفوعة</div>';
            hideLoading('files');
            return;
        }
        
        container.innerHTML = files.map(f => `
            <div class="file-card">
                <div class="file-icon">${getFileIcon(f.fileType)}</div>
                <div class="file-name" title="${escapeHtml(f.fileName)}">${escapeHtml(f.fileName.substring(0, 35))}${f.fileName.length > 35 ? '...' : ''}</div>
                <div class="file-meta">
                    <div><span class="meta-label">👤 المريض:</span> ${escapeHtml(f.patientName)}</div>
                    <div><span class="meta-label">👨‍⚕️ الطبيب:</span> د. ${escapeHtml(f.doctorName)}</div>
                    <div><span class="meta-label">📅 الرفع:</span> ${formatDateTime(f.uploadedAt)}</div>
                    <div><span class="meta-label">📄 النوع:</span> ${f.fileType}</div>
                </div>
                <div class="file-actions">
                    <a href="${f.fileUrl}" target="_blank" class="file-action-btn">👁️ معاينة</a>
                    <button class="file-action-btn" onclick="downloadFile('${f.fileUrl}', '${f.fileName}')">📥 تحميل</button>
                    <button class="file-action-btn" onclick="viewCase('${f.caseId}')">🔍 الحالة</button>
                </div>
            </div>
        `).join('');
        
        document.getElementById('totalFilesCount').textContent = files.length;
        
        const fileSearch = document.getElementById('fileSearch');
        fileSearch.oninput = () => {
            const search = fileSearch.value.toLowerCase();
            const cards = document.querySelectorAll('.file-card');
            cards.forEach(card => {
                const text = card.textContent.toLowerCase();
                card.style.display = text.includes(search) ? 'flex' : 'none';
            });
        };
        
        hideLoading('files');
        
    } catch (error) {
        console.error("خطأ في تحميل الملفات:", error);
        hideLoading('files');
        showToast('حدث خطأ في تحميل الملفات', 'error');
    }
}

function getFileIcon(fileType) {
    const type = fileType.toLowerCase();
    if (type === 'pdf') return '📕';
    if (type === 'jpg' || type === 'jpeg') return '🖼️';
    if (type === 'png') return '🖼️';
    if (type === 'zip' || type === 'rar' || type === '7z') return '📦';
    return '📄';
}

function downloadFile(url, fileName) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`جاري تحميل: ${fileName}`, 'info');
}

function downloadFileFromCase(caseId) {
    const caseData = allCasesCache.find(c => c.caseId === caseId);
    if (caseData && caseData.scannerFileUrl) {
        downloadFile(caseData.scannerFileUrl, caseData.scannerFile);
    } else {
        showToast('لا يوجد ملف لهذه الحالة', 'warning');
    }
}

// ============= 7. الإعدادات =============
async function loadSettings() {
    try {
        const promptSnap = await database.ref('dental lap/ai/prompt').once('value');
        document.getElementById('aiPromptSetting').value = promptSnap.val() || '';
        
        const welcomeSnap = await database.ref('dental lap/ai/welcomeMessage').once('value');
        document.getElementById('welcomeMessageSetting').value = welcomeSnap.val() || 'مرحبا دكتور، انا هنا لمساعدتك';
        
    } catch (error) {
        console.error("خطأ في تحميل الإعدادات:", error);
    }
}

document.getElementById('saveAiPromptBtn')?.addEventListener('click', async () => {
    const prompt = document.getElementById('aiPromptSetting').value;
    try {
        await database.ref('dental lap/ai/prompt').set(prompt);
        showToast('✅ تم حفظ إعدادات الذكاء الاصطناعي', 'success');
    } catch (error) {
        showToast('❌ حدث خطأ: ' + error.message, 'error');
    }
});

document.getElementById('saveWelcomeMsgBtn')?.addEventListener('click', async () => {
    const message = document.getElementById('welcomeMessageSetting').value;
    try {
        await database.ref('dental lap/ai/welcomeMessage').set(message);
        showToast('✅ تم حفظ الرسالة الترحيبية', 'success');
    } catch (error) {
        showToast('❌ حدث خطأ: ' + error.message, 'error');
    }
});

// ============= عرض تفاصيل الحالة =============
async function viewCase(caseId) {
    try {
        const caseData = await findCaseByPath(caseId);
        if (!caseData) {
            showToast('لم يتم العثور على الحالة', 'error');
            return;
        }
        
        currentCaseData = caseData;
        
        const treatmentsList = caseData.toothTreatments 
            ? Object.entries(caseData.toothTreatments).map(([t, v]) => `<span class="treatment-tag">🦷 سن ${t}: ${v}</span>`).join('')
            : '<span class="no-data-mini">لا يوجد</span>';
        
        const modalBody = document.getElementById('caseModalBody');
        modalBody.innerHTML = `
            <div class="case-detail-full">
                <div class="detail-section">
                    <h4>📋 معلومات أساسية</h4>
                    <div class="detail-grid">
                        <div class="detail-row"><span class="label">🆔 معرف الحالة:</span> <span class="value">${escapeHtml(caseData.caseId)}</span></div>
                        <div class="detail-row"><span class="label">🔐 الرقم التأكيدي:</span> <strong class="secret-code">${escapeHtml(caseData.randomCode || 'غير متوفر')}</strong></div>
                        <div class="detail-row"><span class="label">👤 اسم المريض:</span> <span class="value">${escapeHtml(caseData.patientName)}</span></div>
                        <div class="detail-row"><span class="label">👨‍⚕️ الطبيب:</span> <span class="value">د. ${escapeHtml(caseData.doctorName || caseData.clinicName)}</span></div>
                        <div class="detail-row"><span class="label">🏥 العيادة:</span> <span class="value">${escapeHtml(caseData.clinicName || 'غير محدد')}</span></div>
                        <div class="detail-row"><span class="label">📅 تاريخ التسجيل:</span> <span class="value">${formatDateDisplay(caseData.date)}</span></div>
                        <div class="detail-row"><span class="label">📊 حالة الطلب:</span> <span class="status-badge ${getStatusClass(caseData.orderStatus)}">${getStatusText(caseData.orderStatus)}</span></div>
                    </div>
                </div>
                
                <div class="detail-section">
                    <h4>🦷 الأسنان والعلاجات</h4>
                    <div class="treatments-list">${treatmentsList}</div>
                </div>
                
                ${caseData.notes ? `
                <div class="detail-section">
                    <h4>📝 الملاحظات</h4>
                    <div class="notes-box">${escapeHtml(caseData.notes)}</div>
                </div>
                ` : ''}
                
                ${caseData.scannerFile ? `
                <div class="detail-section">
                    <h4>📎 ملفات الاسكانر</h4>
                    <div class="files-list">
                        <a href="${caseData.scannerFileUrl}" target="_blank" class="file-link">📄 ${escapeHtml(caseData.scannerFile)}</a>
                        <button class="action-btn small" onclick="downloadFile('${caseData.scannerFileUrl}', '${caseData.scannerFile}')">📥 تحميل</button>
                    </div>
                </div>
                ` : ''}
                
                <div class="detail-section">
                    <h4>📅 تتبع الحالة</h4>
                    <div class="timeline">
                        ${caseData.statusHistory ? Object.entries(caseData.statusHistory).sort((a,b) => a[0]-b[0]).map(([status, time]) => `
                            <div class="timeline-item">
                                <div class="timeline-icon">${getStatusIcon(parseInt(status))}</div>
                                <div class="timeline-content">
                                    <div class="timeline-title">${getStatusText(parseInt(status))}</div>
                                    <div class="timeline-date">${formatDateTime(time)}</div>
                                </div>
                            </div>
                        `).join('') : '<div class="no-data-mini">لا يوجد سجل</div>'}
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('caseModal').classList.add('active');
        
    } catch (error) {
        console.error("خطأ:", error);
        showToast('حدث خطأ في عرض الحالة', 'error');
    }
}

function getStatusIcon(status) {
    const icons = {1: '📦', 2: '🚚', 3: '⚙️', 4: '🏥'};
    return icons[status] || '📋';
}

async function updateCaseStatusQuick(caseId, currentStatus) {
    const newStatus = prompt(`حالة الطلب الحالية: ${getStatusText(currentStatus)}\n\nأدخل الحالة الجديدة (1-4):\n1 = وصول الطلب\n2 = إرسال مندوب\n3 = قيد العمل\n4 = الشحن للعيادة`, currentStatus);
    
    if (!newStatus) return;
    const statusNum = parseInt(newStatus);
    if (isNaN(statusNum) || statusNum < 1 || statusNum > 4) {
        showToast('الرجاء إدخال رقم صحيح بين 1 و 4', 'warning');
        return;
    }
    
    try {
        const caseRef = await getCaseRef(caseId);
        if (caseRef) {
            const caseData = await findCaseByPath(caseId);
            const now = Date.now();
            const statusHistory = caseData?.statusHistory || {};
            statusHistory[statusNum] = now;
            
            await caseRef.update({
                orderStatus: statusNum,
                statusHistory: statusHistory,
                lastStatusUpdate: now
            });
            
            showToast(`✅ تم تحديث حالة الطلب إلى: ${getStatusText(statusNum)}`, 'success');
            loadDashboard(currentViewDate);
            loadAllCases();
        }
    } catch (error) {
        console.error("خطأ:", error);
        showToast('حدث خطأ في تحديث الحالة', 'error');
    }
}

async function getCaseRef(caseId) {
    for (const c of allCasesCache) {
        if (c.caseId === caseId && c.date) {
            const dateParts = c.date.split('-');
            if (dateParts.length === 3) {
                const year = dateParts[0];
                const month = dateParts[1];
                const day = dateParts[2];
                const doctorName = c.doctorName || c.clinicName;
                if (doctorName) {
                    return database.ref(`dental lap/case data/${year}/${month}/${day}/${doctorName}/${caseId}`);
                }
            }
        }
    }
    return null;
}

// ============= دوال مساعدة إضافية =============
function showLoading(pageId) {
    const container = document.getElementById(`${pageId}Page`);
    if (container && !container.querySelector('.loading-overlay')) {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loading-overlay';
        loadingDiv.innerHTML = '<div class="spinner"></div><p>جاري التحميل...</p>';
        container.style.position = 'relative';
        container.appendChild(loadingDiv);
    }
}

function hideLoading(pageId) {
    const container = document.getElementById(`${pageId}Page`);
    const loadingDiv = container?.querySelector('.loading-overlay');
    if (loadingDiv) loadingDiv.remove();
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toastNotification');
    if (toast) {
        toast.className = `toast-notification ${type}`;
        toast.innerHTML = `<span class="toast-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span><span>${message}</span>`;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

function viewCaseConversation(caseId) {
    viewFullConversation(caseId);
}

function sendMessageToDoctor(doctorName) {
    const message = prompt(`💬 إرسال رسالة إلى د. ${doctorName}\n\nاكتب رسالتك:`);
    if (message && message.trim()) {
        saveNotification(doctorName, message);
    }
}

async function saveNotification(doctorName, message) {
    try {
        const notificationRef = database.ref(`dental lap/notifications/${doctorName}`);
        await notificationRef.push({
            message: message,
            from: 'admin',
            fromName: currentAdmin?.adminName || 'الإدارة',
            timestamp: Date.now(),
            read: false
        });
        showToast('✅ تم إرسال الرسالة بنجاح', 'success');
    } catch (error) {
        console.error("خطأ:", error);
        showToast('❌ حدث خطأ في إرسال الرسالة', 'error');
    }
}

// ============= تسجيل الخروج =============
async function handleLogout() {
    await auth.signOut();
    localStorage.removeItem('currentAdmin');
    window.location.href = 'admin.html';
}

document.getElementById('logoutAdminBtn')?.addEventListener('click', handleLogout);
document.getElementById('refreshBtn')?.addEventListener('click', () => {
    const activePage = document.querySelector('.nav-btn.active')?.dataset.page;
    if (activePage === 'dashboard') loadDashboard(currentViewDate);
    else if (activePage === 'cases') loadAllCases();
    else if (activePage === 'doctors') loadDoctors();
    else if (activePage === 'messages') loadConversations();
    else if (activePage === 'files') loadFiles();
    showToast('🔄 تم تحديث البيانات', 'success');
});

document.getElementById('prevDateBtn')?.addEventListener('click', goToPrevDate);
document.getElementById('nextDateBtn')?.addEventListener('click', goToNextDate);
document.getElementById('todayBtn')?.addEventListener('click', goToToday);

// ============= إغلاق المودال =============
document.querySelectorAll('.modal-close, .modal .cancel').forEach(btn => {
    btn?.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    });
});

// ============= تهيئة الصفحة =============
document.addEventListener('DOMContentLoaded', async () => {
    if (!loadAdminData()) return;
    await fetchAvailableDates();
    await loadDashboard();
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
});
