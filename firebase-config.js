// ============================================================
// CONFIGURACIÓN DE FIREBASE
// ============================================================
// 1. Ve a https://console.firebase.google.com y crea un proyecto (gratis, plan Spark).
// 2. En el proyecto: ⚙️ Configuración del proyecto → "Tus apps" → ícono </> (Web) → registra la app.
// 3. Firebase te mostrará un objeto "firebaseConfig". Copia esos valores aquí abajo.
// 4. Activa Authentication → Sign-in method → Correo/contraseña.
// 5. Crea una base de datos Firestore (modo producción) y pega las reglas de FIREBASE_SETUP.md.
// 6. Lee FIREBASE_SETUP.md para el resto de los pasos (incluyendo cómo crear tu primer admin).
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD1RUmv4lAFsRuk9h4XikIFHFOGJaV9XmA",
  authDomain: "cangrejal-alerta.firebaseapp.com",
  projectId: "cangrejal-alerta",
  storageBucket: "cangrejal-alerta.firebasestorage.app",
  messagingSenderId: "939458535803",
  appId: "1:939458535803:web:0c660e442712a41bac9dde",
  measurementId: "G-PMCF0HZCL5"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
