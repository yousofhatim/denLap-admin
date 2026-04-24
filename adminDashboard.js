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

function getStatusText(status) {
    const statusMap = {
        1: '📦 وصول الطلب للمعمل',
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
        
        // تحميل بيانات الصفحة
        if (page === 'dashboard') loadDashboard();
        else if (page === 'cases') loadAllCases();
        else if (page === 'search') initSearchPage();
        else if (page === 'doctors') loadDoctors();
        else if (page === 'messages') loadConversations();
        else if (page === 'files') loadFiles();
        else if (page === 'settings') loadSettings();
    });
});

// ============= 1. لوحة المعلومات (Dashboard) =============
async function loadDashboard() {
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
                    // التحقق إذا كان هذا كائن حالة (يحتوي على caseId)
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
            // المسار: /year/month/day/doctorName/caseId
            for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i] && !parts[i].match(/^\d+$/) && parts[i] !== 'case data') {
                    return parts[i];
                }
            }
            return 'غير محدد';
        }
        
        extractCases(snapshot.val());
        allCasesCache = allCases;
        
        // الإحصائيات
        const totalCases = allCases.length;
        const inProgress = allCases.filter(c => c.orderStatus === 3).length;
        const completed = allCases.filter(c => c.orderStatus === 4).length;
        const newOrders = allCases.filter(c => c.orderStatus === 1).length;
        
        document.getElementById('totalCases').textContent = totalCases;
        document.getElementById('inProgressCases').textContent = inProgress;
        document.getElementById('completedCases').textContent = completed;
        document.getElementById('newOrdersCount').textContent = newOrders;
        document.getElementById('casesCount').textContent = totalCases;
        
        // أحدث 10 حالات
        const recent = allCases.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 10);
        const tbody = document.getElementById('recentCasesList');
        tbody.innerHTML = recent.map(c => `
            <tr>
                <td><strong>${escapeHtml(c.patientName || 'غير محدد')}</strong></td>
                <td>د. ${escapeHtml(c.doctorName || c.clinicName || 'غير محدد')}</td>
                <td><span class="status-badge ${getStatusClass(c.orderStatus)}">${getStatusText(c.orderStatus)}</span></td>
                <td>${formatDate(c.date)}</td>
                <td>${Object.keys(c.toothTreatments || {}).length} سن</td>
                <td><button class="view-btn" onclick="viewCase('${c.caseId}')">🔍 عرض</button></td>
            </tr>
        `).join('');
        
        // عدد الأطباء
        const doctorsRef = database.ref('dental lap/data');
        const doctorsSnap = await doctorsRef.once('value');
        const doctorsCount = doctorsSnap.val() ? Object.keys(doctorsSnap.val()).length : 0;
        document.getElementById('totalDoctors').textContent = doctorsCount;
        
        // حالات اليوم
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const todayCases = allCases.filter(c => c.date === todayStr);
        document.getElementById('todayCasesCount').textContent = todayCases.length;
        
        hideLoading('dashboard');
        
    } catch (error) {
        console.error("خطأ في تحميل لوحة المعلومات:", error);
        hideLoading('dashboard');
        showToast('حدث خطأ في تحميل البيانات', 'error');
    }
}

// ============= 2. عرض جميع الحالات =============
async function loadAllCases() {
    try {
        showLoading('cases');
        
        // استخدام الكاش إذا كان موجوداً
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
        
        displayCasesList(allCases);
        
        // فلترة وبحث
        const statusFilter = document.getElementById('statusFilter');
        const searchInput = document.getElementById('searchCases');
        
        const filterCases = () => {
            const status = statusFilter.value;
            const search = searchInput.value.toLowerCase();
            let filtered = [...allCases];
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
            displayCasesList(filtered);
        };
        
        statusFilter.onchange = filterCases;
        searchInput.oninput = filterCases;
        
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
                    <span>الطبيب: د. ${escapeHtml(c.doctorName || c.clinicName || 'غير محدد')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-icon">🔐</span>
                    <span>الرقم التأكيدي: <strong class="secret-code">${escapeHtml(c.randomCode || 'غير متوفر')}</strong></span>
                </div>
                <div class="detail-item">
                    <span class="detail-icon">📅</span>
                    <span>التاريخ: ${formatDate(c.date)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-icon">🦷</span>
                    <span>الأسنان المعالجة: ${Object.keys(c.toothTreatments || {}).length}</span>
                </div>
                ${c.notes ? `<div class="detail-item notes-preview"><span class="detail-icon">📝</span><span>${escapeHtml(c.notes.substring(0, 100))}${c.notes.length > 100 ? '...' : ''}</span></div>` : ''}
            </div>
            <div class="case-actions">
                <button class="action-btn small" onclick="viewCase('${c.caseId}')">🔍 عرض التفاصيل</button>
                <button class="action-btn small" onclick="viewCaseConversation('${c.caseId}')">💬 المحادثة</button>
                ${c.scannerFile ? `<button class="action-btn small" onclick="viewCaseFiles('${c.caseId}')">📁 الملفات</button>` : ''}
                <button class="action-btn small" onclick="updateCaseStatus('${c.caseId}', ${c.orderStatus || 1})">🔄 تحديث الحالة</button>
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
        // استخدام الفهرس للبحث بالرقم التأكيدي إذا وجد
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
        
        // البحث في جميع الحالات
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
        
        // تطبيق الفلاتر
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
        <div class="search-summary">🔍 تم العثور على ${results.length} نتيجة</div>
        <div class="search-results-list">
            ${results.map(c => `
                <div class="case-item compact">
                    <div class="case-header">
                        <div class="case-patient">👤 ${escapeHtml(c.patientName)}</div>
                        <div class="case-status"><span class="status-badge ${getStatusClass(c.orderStatus)}">${getStatusText(c.orderStatus)}</span></div>
                    </div>
                    <div class="case-details">
                        <div>👨‍⚕️ د. ${escapeHtml(c.doctorName || c.clinicName)}</div>
                        <div>🔐 ${escapeHtml(c.randomCode || '')}</div>
                        <div>📅 ${formatDate(c.date)}</div>
                    </div>
                    <div class="case-actions">
                        <button class="action-btn small" onclick="viewCase('${c.caseId}')">عرض</button>
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
        
        // جلب عدد الحالات لكل طبيب
        const casesCount = {};
        for (const c of allCasesCache) {
            const doctorKey = c.doctorName || c.clinicName;
            if (doctorKey) {
                casesCount[doctorKey] = (casesCount[doctorKey] || 0) + 1;
            }
        }
        
        container.innerHTML = Object.entries(doctors).map(([name, data]) => `
            <div class="doctor-card" data-doctor="${escapeHtml(name)}">
                <div class="doctor-avatar">
                    <span class="avatar-icon">👨‍⚕️</span>
                </div>
                <div class="doctor-info">
                    <div class="doctor-name">د. ${escapeHtml(name)}</div>
                    <div class="doctor-details">
                        <span class="detail-badge">🏥 ${escapeHtml(data.clinicName || name)}</span>
                        <span class="detail-badge">📞 ${escapeHtml(data.phoneNumber || data.clinicNumber || 'غير محدد')}</span>
                        <span class="detail-badge">📧 ${escapeHtml(data.email || 'غير محدد')}</span>
                        <span class="detail-badge">📍 ${escapeHtml(data.governorate || '')} - ${escapeHtml(data.area || '')}</span>
                        <span class="detail-badge">📋 ${casesCount[name] || 0} حالة</span>
                    </div>
                </div>
                <div class="doctor-actions">
                    <button class="action-btn small" onclick="viewDoctorCases('${escapeHtml(name)}')">📋 الحالات</button>
                    <button class="action-btn small" onclick="sendMessageToDoctor('${escapeHtml(name)}')">💬 رسالة</button>
                    <button class="action-btn small" onclick="editDoctorInfo('${escapeHtml(name)}')">✏️ تعديل</button>
                </div>
            </div>
        `).join('');
        
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
    
    // التبديل إلى صفحة الحالات وعرض حالات هذا الطبيب
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
        
        // جمع جميع المحادثات من الحالات
        const conversations = [];
        for (const c of allCasesCache) {
            if (c.conversation && c.conversation.length > 0) {
                conversations.push({
                    caseId: c.caseId,
                    patientName: c.patientName,
                    doctorName: c.doctorName || c.clinicName,
                    conversation: c.conversation,
                    lastUpdated: c.lastMessageTime || c.createdAt,
                    lastMessage: c.conversation[c.conversation.length - 1]?.content || ''
                });
            }
        }
        
        const container = document.getElementById('conversationsList');
        if (conversations.length === 0) {
            container.innerHTML = '<div class="no-data">💬 لا توجد محادثات</div>';
            hideLoading('messages');
            return;
        }
        
        container.innerHTML = conversations.map(c => `
            <div class="conversation-card" onclick="viewFullConversation('${c.caseId}')">
                <div class="conversation-header">
                    <div class="conversation-info">
                        <span class="conversation-patient">👤 ${escapeHtml(c.patientName)}</span>
                        <span class="conversation-doctor">👨‍⚕️ د. ${escapeHtml(c.doctorName)}</span>
                    </div>
                    <div class="conversation-date">${formatDateTime(c.lastUpdated)}</div>
                </div>
                <div class="conversation-preview">
                    💬 ${escapeHtml(c.lastMessage.substring(0, 120))}${c.lastMessage.length > 120 ? '...' : ''}
                </div>
                <div class="conversation-stats">
                    <span class="msg-count">📨 ${c.conversation.length} رسالة</span>
                </div>
            </div>
        `).join('');
        
        document.getElementById('unreadCount').textContent = conversations.length;
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
            <div class="conversation-message ${msg.role === 'user' ? 'user-msg' : 'bot-msg'}">
                <div class="message-sender">${msg.role === 'user' ? '👤 الطبيب' : '🤖 المساعد'}</div>
                <div class="message-content">${escapeHtml(msg.content)}</div>
                <div class="message-time">${msg.timestamp ? formatDateTime(msg.timestamp) : ''}</div>
            </div>
        `).join('');
        
        modalBody.innerHTML = `
            <div class="conversation-full-view">
                <div class="conv-header">
                    <h4>محادثة حالة المريض: ${escapeHtml(caseData.patientName)}</h4>
                    <p>د. ${escapeHtml(caseData.doctorName || caseData.clinicName)}</p>
                </div>
                <div class="conv-messages">
                    ${conversationHtml}
                </div>
                <div class="conv-reply">
                    <textarea id="adminReplyMsg" rows="3" placeholder="اكتب ردك هنا..."></textarea>
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
        // البحث عن الحالة وتحديث المحادثة
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
        
        // تحديث في قاعدة البيانات
        const caseRef = await getCaseRef(caseId);
        if (caseRef) {
            await caseRef.update({
                conversation: conversation,
                lastMessageTime: Date.now(),
                lastMessageFrom: 'admin'
            });
            
            showToast('✅ تم إرسال الرد بنجاح', 'success');
            document.getElementById('adminReplyMsg').value = '';
            viewFullConversation(caseId); // تحديث العرض
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
                    uploadedAt: c.scannerUploadedAt
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
                <div class="file-icon">📄</div>
                <div class="file-name" title="${escapeHtml(f.fileName)}">${escapeHtml(f.fileName.substring(0, 30))}${f.fileName.length > 30 ? '...' : ''}</div>
                <div class="file-meta">
                    <div>👤 ${escapeHtml(f.patientName)}</div>
                    <div>👨‍⚕️ د. ${escapeHtml(f.doctorName)}</div>
                    <div>📅 ${formatDateTime(f.uploadedAt)}</div>
                </div>
                <div class="file-actions">
                    <a href="${f.fileUrl}" target="_blank" class="file-action-btn">👁️ معاينة</a>
                    <button class="file-action-btn" onclick="downloadFile('${f.fileUrl}', '${f.fileName}')">📥 تحميل</button>
                    <button class="file-action-btn" onclick="viewCase('${f.caseId}')">🔍 الحالة</button>
                </div>
            </div>
        `).join('');
        
        // فلترة الملفات
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

function downloadFile(url, fileName) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
            ? Object.entries(caseData.toothTreatments).map(([t, v]) => `<span class="treatment-tag">سن ${t}: ${v}</span>`).join('')
            : 'لا يوجد';
        
        const modalBody = document.getElementById('caseModalBody');
        modalBody.innerHTML = `
            <div class="case-detail-full">
                <div class="detail-section">
                    <h4>📋 معلومات أساسية</h4>
                    <div class="detail-grid">
                        <div><span class="label">🆔 معرف الحالة:</span> ${escapeHtml(caseData.caseId)}</div>
                        <div><span class="label">🔐 الرقم التأكيدي:</span> <strong class="secret-code">${escapeHtml(caseData.randomCode || 'غير متوفر')}</strong></div>
                        <div><span class="label">👤 اسم المريض:</span> ${escapeHtml(caseData.patientName)}</div>
                        <div><span class="label">👨‍⚕️ الطبيب:</span> د. ${escapeHtml(caseData.doctorName || caseData.clinicName)}</div>
                        <div><span class="label">🏥 العيادة:</span> ${escapeHtml(caseData.clinicName || 'غير محدد')}</div>
                        <div><span class="label">📅 تاريخ التسجيل:</span> ${formatDate(caseData.date)}</div>
                        <div><span class="label">📊 حالة الطلب:</span> <span class="status-badge ${getStatusClass(caseData.orderStatus)}">${getStatusText(caseData.orderStatus)}</span></div>
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
                        ${caseData.statusHistory ? Object.entries(caseData.statusHistory).map(([status, time]) => `
                            <div class="timeline-item">
                                <div class="timeline-icon">${getStatusIcon(parseInt(status))}</div>
                                <div class="timeline-content">
                                    <div class="timeline-title">${getStatusText(parseInt(status))}</div>
                                    <div class="timeline-date">${formatDateTime(time)}</div>
                                </div>
                            </div>
                        `).join('') : '<div>لا يوجد سجل</div>'}
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

async function updateCaseStatus(caseId, currentStatus) {
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
            const now = Date.now();
            const statusHistory = currentCaseData?.statusHistory || {};
            statusHistory[statusNum] = now;
            
            await caseRef.update({
                orderStatus: statusNum,
                statusHistory: statusHistory,
                lastStatusUpdate: now
            });
            
            showToast(`✅ تم تحديث حالة الطلب إلى: ${getStatusText(statusNum)}`, 'success');
            loadDashboard();
            loadAllCases();
        }
    } catch (error) {
        console.error("خطأ:", error);
        showToast('حدث خطأ في تحديث الحالة', 'error');
    }
}

// دالة مساعدة للحصول على مرجع الحالة
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
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }, 10);
}

function viewCaseFiles(caseId) {
    document.querySelector('.nav-btn[data-page="files"]').click();
    setTimeout(() => {
        const fileSearch = document.getElementById('fileSearch');
        if (fileSearch) {
            fileSearch.value = caseId;
            fileSearch.dispatchEvent(new Event('input'));
        }
    }, 100);
}

function viewCaseConversation(caseId) {
    viewFullConversation(caseId);
}

function sendMessageToDoctor(doctorName) {
    const message = prompt(`💬 إرسال رسالة إلى د. ${doctorName}\n\nاكتب رسالتك:`);
    if (message && message.trim()) {
        // حفظ الرسالة في إشعارات الطبيب
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
    if (activePage === 'dashboard') loadDashboard();
    else if (activePage === 'cases') loadAllCases();
    else if (activePage === 'doctors') loadDoctors();
    else if (activePage === 'messages') loadConversations();
    else if (activePage === 'files') loadFiles();
    showToast('🔄 تم تحديث البيانات', 'success');
});

// ============= إغلاق المودال =============
document.querySelectorAll('.modal-close, .modal .cancel').forEach(btn => {
    btn?.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    });
});

// ============= تهيئة الصفحة =============
document.addEventListener('DOMContentLoaded', () => {
    if (!loadAdminData()) return;
    loadDashboard();
    
    // إغلاق المودال عند الضغط على الخلفية
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
});