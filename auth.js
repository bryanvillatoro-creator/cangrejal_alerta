// ============================================================
// AUTENTICACIÓN Y APROBACIÓN DE USUARIOS
// Registro / login con Firebase Auth. Cada cuenta nueva queda "pending"
// hasta que un admin la aprueba desde admin.html.
// ============================================================
import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// "export let" (live binding): script.js siempre lee el valor más actual.
export let currentUser = null;
export let currentUserData = null;

const authScreen = document.getElementById('authScreen');
const appRoot = document.getElementById('appRoot');
const pendingScreen = document.getElementById('pendingScreen');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');
const showRegisterBtn = document.getElementById('showRegisterBtn');
const showLoginBtn = document.getElementById('showLoginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const pendingLogoutBtn = document.getElementById('pendingLogoutBtn');
const currentUserName = document.getElementById('currentUserName');
const adminLink = document.getElementById('adminLink');

function translateAuthError(err){
  const map = {
    'auth/email-already-in-use': 'Ese correo ya está registrado. Intenta iniciar sesión.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento e intenta de nuevo.'
  };
  return map[err.code] || 'Ocurrió un error. Intenta de nuevo.';
}

function showScreen(which){
  authScreen.hidden = which !== 'login' && which !== 'register';
  pendingScreen.hidden = which !== 'pending';
  appRoot.hidden = which !== 'app';
  document.getElementById('loginPanel').hidden = which !== 'login';
  document.getElementById('registerPanel').hidden = which !== 'register';
}

showRegisterBtn.addEventListener('click', () => { registerError.hidden = true; showScreen('register'); });
showLoginBtn.addEventListener('click', () => { loginError.hidden = true; showScreen('login'); });

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerError.hidden = true;
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const submitBtn = registerForm.querySelector('button[type="submit"]');

  if(!name){
    registerError.textContent = 'Escribe tu nombre.';
    registerError.hidden = false;
    return;
  }
  submitBtn.disabled = true;
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, 'users', cred.user.uid), {
      name,
      email,
      status: 'pending', // un admin debe cambiarlo a 'approved' en admin.html
      createdAt: serverTimestamp()
    });
    // onAuthStateChanged se encarga de mostrar la pantalla de "pendiente"
  }catch(err){
    registerError.textContent = translateAuthError(err);
    registerError.hidden = false;
  }finally{
    submitBtn.disabled = false;
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try{
    await signInWithEmailAndPassword(auth, email, password);
  }catch(err){
    loginError.textContent = translateAuthError(err);
    loginError.hidden = false;
  }finally{
    submitBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => signOut(auth));
pendingLogoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if(!user){
    currentUserData = null;
    loginForm.reset();
    registerForm.reset();
    showScreen('login');
    return;
  }

  const userDocRef = doc(db, 'users', user.uid);
  let snap = await getDoc(userDocRef);

  if(!snap.exists()){
    // Cuenta creada sin perfil (caso raro / recuperación) — crear como pendiente
    await setDoc(userDocRef, {
      name: user.email,
      email: user.email,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    snap = await getDoc(userDocRef);
  }

  currentUserData = { uid: user.uid, ...snap.data() };

  if(currentUserData.status === 'pending'){
    showScreen('pending');
    return;
  }

  currentUserName.textContent = currentUserData.name;
  adminLink.hidden = currentUserData.status !== 'admin';
  showScreen('app');

  // Avisa a script.js que ya hay un usuario aprobado listo (conecta los listeners de Firestore)
  window.dispatchEvent(new CustomEvent('cangrejal:userReady', { detail: currentUserData }));
});
