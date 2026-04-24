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

// Elements
const loginFormDiv = document.getElementById('loginForm');
const signupFormDiv = document.getElementById('signupForm');
const tabBtns = document.querySelectorAll('.tab-btn');
const loginErrorDiv = document.getElementById('loginError');
const signupErrorDiv = document.getElementById('signupError');

// Save admin data to Firebase
async function saveAdminData(adminName, labName, phone, email, userId, governorate, area) {
    const adminRef = database.ref(`dental lap/workers/admin/users/${adminName}`);
    try {
        await adminRef.set({
            adminName: adminName,
            labName: labName,
            phone: phone,
            email: email,
            userId: userId,
            governorate: governorate,
            area: area,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            role: 'admin',
            isActive: true
        });
        return true;
    } catch (error) {
        console.error("Error saving admin data:", error);
        return false;
    }
}

// Save login credentials
async function saveAdminLoginData(email, password, adminName) {
    const emailKey = email.replace(/\./g, ',');
    const userRef = database.ref(`dental lap/workers/admin/auth/${emailKey}`);
    try {
        await userRef.set({
            email: email,
            password: password,
            adminName: adminName,
            role: 'admin',
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });
        return true;
    } catch (error) {
        console.error("Error saving login data:", error);
        return false;
    }
}

// Get admin name by email
async function getAdminNameByEmail(email) {
    const emailKey = email.replace(/\./g, ',');
    const snapshot = await database.ref(`dental lap/workers/admin/auth/${emailKey}/adminName`).once('value');
    return snapshot.val();
}

// Get admin data
async function getAdminData(adminName) {
    const snapshot = await database.ref(`dental lap/workers/admin/users/${adminName}`).once('value');
    return snapshot.val();
}

// Handle Login
async function handleLogin(email, password) {
    loginErrorDiv.style.display = 'none';
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;
        const adminName = await getAdminNameByEmail(email);
        
        if (!adminName) throw new Error("لم يتم العثور على بيانات الإداري");
        
        const adminData = await getAdminData(adminName);
        if (!adminData) throw new Error("بيانات الإداري غير مكتملة");

        localStorage.setItem('currentAdmin', JSON.stringify({
            uid: user.uid,
            email: email,
            adminName: adminName,
            labName: adminData.labName,
            phone: adminData.phone,
            governorate: adminData.governorate,
            area: adminData.area,
            role: 'admin'
        }));
        
        window.location.href = 'adminDashboard.html';
    } catch (error) {
        loginErrorDiv.textContent = error.message;
        loginErrorDiv.style.display = 'block';
    }
}

// Handle Signup
async function handleSignup(adminName, labName, phone, email, password, governorate, area) {
    signupErrorDiv.style.display = 'none';
    
    const adminExists = await database.ref(`dental lap/workers/admin/users/${adminName}`).once('value');
    if (adminExists.exists()) {
        signupErrorDiv.textContent = "اسم المستخدم الإداري موجود بالفعل";
        signupErrorDiv.style.display = 'block';
        return;
    }
    
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        await saveAdminData(adminName, labName, phone, email, user.uid, governorate, area);
        await saveAdminLoginData(email, password, adminName);
        await handleLogin(email, password);
    } catch (error) {
        signupErrorDiv.textContent = error.message;
        signupErrorDiv.style.display = 'block';
    }
}

// Tab switching
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        if (tab === 'login') {
            loginFormDiv.classList.remove('hidden');
            signupFormDiv.classList.add('hidden');
        } else {
            loginFormDiv.classList.add('hidden');
            signupFormDiv.classList.remove('hidden');
        }
        loginErrorDiv.style.display = 'none';
        signupErrorDiv.style.display = 'none';
    });
});

// Login button
document.getElementById('doLoginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) {
        loginErrorDiv.textContent = "الرجاء ملء البريد الإلكتروني وكلمة المرور";
        loginErrorDiv.style.display = 'block';
        return;
    }
    await handleLogin(email, password);
});

// Signup button
document.getElementById('doSignupBtn').addEventListener('click', async () => {
    const adminName = document.getElementById('adminName').value.trim();
    const labName = document.getElementById('labName').value.trim();
    const phone = document.getElementById('adminPhone').value.trim();
    const email = document.getElementById('adminEmail').value.trim();
    const password = document.getElementById('adminPassword').value;
    const confirmVal = document.getElementById('confirmPassword').value;
    const governorate = document.getElementById('governorate').value.trim();
    const area = document.getElementById('area').value.trim();

    if (!adminName || !labName || !phone || !email || !password || !governorate || !area) {
        signupErrorDiv.textContent = "جميع الحقول المطلوبة ضرورية";
        signupErrorDiv.style.display = 'block';
        return;
    }
    
    if (password !== confirmVal) {
        signupErrorDiv.textContent = "كلمة المرور وتأكيدها غير متطابقين";
        signupErrorDiv.style.display = 'block';
        return;
    }
    
    if (password.length < 6) {
        signupErrorDiv.textContent = "كلمة المرور يجب أن تكون 6 أحرف على الأقل";
        signupErrorDiv.style.display = 'block';
        return;
    }
    
    await handleSignup(adminName, labName, phone, email, password, governorate, area);
});

// Check auth state
auth.onAuthStateChanged(async (user) => {
    if (user) {
        const email = user.email;
        const adminName = await getAdminNameByEmail(email);
        if (adminName) {
            const adminData = await getAdminData(adminName);
            if (adminData) {
                localStorage.setItem('currentAdmin', JSON.stringify({
                    uid: user.uid,
                    email: email,
                    adminName: adminName,
                    labName: adminData.labName,
                    phone: adminData.phone,
                    governorate: adminData.governorate,
                    area: adminData.area,
                    role: 'admin'
                }));
                window.location.href = 'adminDashboard.html';
            }
        }
    }
});