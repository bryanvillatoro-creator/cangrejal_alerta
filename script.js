import { db } from './firebase-config.js';
import { currentUserData } from './auth.js';
import {
  collection, doc, addDoc, updateDoc, onSnapshot,
  query, orderBy, serverTimestamp, arrayUnion, arrayRemove,
  setDoc, getDoc, increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------- Config ----------
const CATEGORY_LABELS = {
  derrumbe: '🚧 Derrumbe',
  inundacion: '🌊 Inundación',
  puente: '🌉 Puente dañado',
  arbol: '🌳 Árbol caído',
  accidente: '🚗 Accidente',
  felino: '🐆 Avistamiento de felinos',
  energia: '⚡ Corte de energía',
  bloqueo: '🚫 Carretera bloqueada',
  medica: '🚑 Emergencia médica',
  incendio: '🔥 Incendio',
  lluvia: '🌧 Lluvias fuertes',
  otro: 'Otro'
};
const SEVERITY_ORDER = { leve: 1, moderado: 2, grave: 3 };
const OPERATIONAL_STATUS = {
  activo:      { label: '🟡 Activo',       className: 'status-activo' },
  atencion:    { label: '🔵 En atención',  className: 'status-atencion' },
  resuelto:    { label: '🟢 Resuelto',     className: 'status-resuelto' },
  descartado:  { label: '🔴 Descartado',   className: 'status-descartado' }
};
const VERIFY_THRESHOLD = 3;   // net confirmations to mark as verified
const DENY_THRESHOLD = 3;     // net denials to mark as incorrect
const MAX_PHOTO_DIMENSION = 1000; // px, se redimensiona antes de subir

// ---------- State ----------
let reports = [];
let scores = {};
let activeFilter = 'todos';
let pendingPhoto = null;   // base64 string (ya comprimida)
let pendingLocation = null; // {lat, lng}
let unsubReports = null;
let unsubScores = null;

// ---------- Identity (viene de la cuenta autenticada, no editable) ----------
function getIdentity(){
  // currentUserData es un "live binding" exportado por auth.js
  return currentUserData ? currentUserData.name : 'Anónimo';
}

// ---------- Reputation (colección "scores", doc id = nombre de usuario) ----------
function scoreFor(name){ return scores[name] || 0; }
function adjustScore(name, delta){
  setDoc(doc(db, 'scores', name), { points: increment(delta) }, { merge: true })
    .catch(err => console.error('Error actualizando puntaje:', err));
}
function starsFor(score){
  const filled = Math.max(0, Math.min(5, Math.round(score / 10)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}
function renderUserRep(){
  const name = getIdentity();
  const s = scoreFor(name);
  const starsEl = document.getElementById('repStars');
  const scoreEl = document.getElementById('repScore');
  if(starsEl) starsEl.textContent = starsFor(s);
  if(scoreEl) scoreEl.textContent = `${s} pts`;
}

// ---------- Time formatting ----------
function toMillis(ts){
  if(!ts) return Date.now();
  if(typeof ts === 'number') return ts;
  if(ts.toMillis) return ts.toMillis(); // Firestore Timestamp
  return Date.now();
}
function timeAgo(ts){
  const diffMs = Date.now() - toMillis(ts);
  const min = Math.floor(diffMs / 60000);
  if(min < 1) return 'justo ahora';
  if(min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if(hr < 24) return `hace ${hr} h`;
  const d = Math.floor(hr / 24);
  return `hace ${d} d`;
}

// ---------- Rendering ----------
function render(){
  const feed = document.getElementById('feed');
  const empty = document.getElementById('emptyState');
  if(!feed) return;

  let list = [...reports];
  if(activeFilter !== 'todos') list = list.filter(r => r.category === activeFilter);
  list.sort((a,b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  feed.innerHTML = '';
  if(list.length === 0){
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.forEach(r => {
    const confirms = r.confirms || [];
    const denies = r.denies || [];
    const net = confirms.length - denies.length;
    const verified = net >= VERIFY_THRESHOLD;
    const incorrect = net <= -DENY_THRESHOLD;
    const myVote = getMyVote(r);
    const displayAuthor = r.anonymous ? 'Anónimo' : r.author;
    const statusInfo = OPERATIONAL_STATUS[r.manualStatus || 'activo'];

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-top">
        <span class="card-cat">${CATEGORY_LABELS[r.category] || r.category}</span>
        ${r.isOfficial ? '<span class="card-official">✔ Información oficial</span>' : ''}
      </div>
      <h3>${escapeHtml(r.title)}</h3>
      <p class="desc">${escapeHtml(r.description)}</p>
      ${r.photo ? `<img class="evidence" src="${r.photo}" alt="Foto del incidente">` : ''}
      <div class="gauge ${r.severity}">
        ${[1,2,3].map(i => `<span class="drop ${i <= SEVERITY_ORDER[r.severity] ? 'filled' : ''}">💧</span>`).join('')}
        <span style="color:var(--stone); font-size:12px; margin-left:4px;">${r.severity}</span>
      </div>
      <div class="meta-row">
        <span>👤 ${escapeHtml(displayAuthor)}</span>
        <span>🕒 ${timeAgo(r.updatedAt || r.createdAt)}</span>
        ${r.location ? `<span>📍 ${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)}</span>` : ''}
        <span class="status-badge ${statusInfo.className}">${statusInfo.label}</span>
        ${incorrect ? '<span>⚠️ No confirmado por la comunidad</span>' : ''}
      </div>
      ${verified ? '<div class="verified-badge">🟢 Información verificada por la comunidad</div>' : ''}
      ${incorrect ? '<div class="verified-badge" style="color:var(--coral); border-color:rgba(216,86,74,0.4); background:rgba(216,86,74,0.1);">❌ Marcado como información incorrecta</div>' : ''}
      <div class="vote-row">
        <div class="vote-btns">
          <button class="vote-btn confirm ${myVote === 'confirm' ? 'voted' : ''}" data-id="${r.id}" data-vote="confirm">✅ Confirmado (${confirms.length})</button>
          <button class="vote-btn deny ${myVote === 'deny' ? 'voted' : ''}" data-id="${r.id}" data-vote="deny">❌ Incorrecto (${denies.length})</button>
        </div>
        <span class="reported-count">Reportado por ${confirms.length + 1} persona(s)</span>
      </div>
      ${statusControlHtml(r)}
    `;
    feed.appendChild(card);
  });
}

function canChangeStatus(report){
  if(!currentUserData) return false;
  if(currentUserData.status === 'admin') return true;
  return report.author === currentUserData.name;
}

function statusControlHtml(report){
  if(!canChangeStatus(report)) return '';
  const current = report.manualStatus || 'activo';
  const options = Object.entries(OPERATIONAL_STATUS)
    .map(([value, cfg]) => `<option value="${value}" ${value === current ? 'selected' : ''}>${cfg.label}</option>`)
    .join('');
  return `
    <div class="status-control">
      <select class="status-select" data-id="${report.id}">${options}</select>
      <button type="button" class="status-update-btn" data-id="${report.id}">Actualizar estado</button>
    </div>
  `;
}

function getMyVote(report){
  const name = getIdentity();
  if((report.confirms || []).includes(name)) return 'confirm';
  if((report.denies || []).includes(name)) return 'deny';
  return null;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Firestore listeners (arrancan solo cuando hay usuario aprobado) ----------
function startListeners(){
  if(unsubReports) return; // ya conectado

  const reportsQuery = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
  unsubReports = onSnapshot(reportsQuery, (snap) => {
    reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error('Error escuchando reportes:', err);
  });

  unsubScores = onSnapshot(collection(db, 'scores'), (snap) => {
    scores = {};
    snap.docs.forEach(d => { scores[d.id] = d.data().points || 0; });
    renderUserRep();
  }, (err) => {
    console.error('Error escuchando puntajes:', err);
  });
}

window.addEventListener('cangrejal:userReady', () => {
  startListeners();
  renderUserRep();
});

// ---------- Voting ----------
document.getElementById('feed').addEventListener('click', async (e) => {
  const btn = e.target.closest('.vote-btn');
  if(!btn) return;
  const id = btn.dataset.id;
  const vote = btn.dataset.vote;
  const name = getIdentity();
  const report = reports.find(r => r.id === id);
  if(!report) return;
  if(report.author === name){
    alert('No puedes votar en tu propio reporte.');
    return;
  }

  const confirms = report.confirms || [];
  const denies = report.denies || [];
  const wasVerified = (confirms.length - denies.length) >= VERIFY_THRESHOLD;
  const wasIncorrect = (denies.length - confirms.length) >= DENY_THRESHOLD;

  // Simula el nuevo estado localmente para decidir si hay que ajustar puntaje
  const newConfirms = confirms.filter(n => n !== name);
  const newDenies = denies.filter(n => n !== name);
  if(vote === 'confirm') newConfirms.push(name);
  if(vote === 'deny') newDenies.push(name);

  const nowVerified = (newConfirms.length - newDenies.length) >= VERIFY_THRESHOLD;
  const nowIncorrect = (newDenies.length - newConfirms.length) >= DENY_THRESHOLD;

  try{
    await updateDoc(doc(db, 'reports', id), {
      confirms: arrayRemove(name)
    });
    await updateDoc(doc(db, 'reports', id), {
      denies: arrayRemove(name)
    });
    if(vote === 'confirm'){
      await updateDoc(doc(db, 'reports', id), { confirms: arrayUnion(name), updatedAt: serverTimestamp() });
    }else{
      await updateDoc(doc(db, 'reports', id), { denies: arrayUnion(name), updatedAt: serverTimestamp() });
    }

    if(!wasVerified && nowVerified) adjustScore(report.author, 5);
    if(!wasIncorrect && nowIncorrect) adjustScore(report.author, -5);
  }catch(err){
    console.error('Error votando:', err);
    alert('No se pudo registrar tu voto. Intenta de nuevo.');
  }
});

// ---------- Manual operational status (admin o autor del reporte) ----------
document.getElementById('feed').addEventListener('click', async (e) => {
  const btn = e.target.closest('.status-update-btn');
  if(!btn) return;
  const id = btn.dataset.id;
  const select = document.querySelector(`.status-select[data-id="${id}"]`);
  if(!select) return;
  const report = reports.find(r => r.id === id);
  if(!report || !canChangeStatus(report)) return;

  btn.disabled = true;
  try{
    await updateDoc(doc(db, 'reports', id), {
      manualStatus: select.value,
      updatedAt: serverTimestamp()
    });
  }catch(err){
    console.error('Error actualizando estado:', err);
    alert('No se pudo actualizar el estado. Intenta de nuevo.');
  }finally{
    btn.disabled = false;
  }
});

// ---------- Filters ----------
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    render();
  });
});

// ---------- Modal open/close ----------
const formModal = document.getElementById('formModal');
document.getElementById('openFormBtn').addEventListener('click', () => {
  formModal.hidden = false;
});
document.getElementById('closeFormBtn').addEventListener('click', closeForm);
formModal.addEventListener('click', (e) => { if(e.target === formModal) closeForm(); });
function closeForm(){
  formModal.hidden = true;
  document.getElementById('reportForm').reset();
  pendingPhoto = null;
  pendingLocation = null;
  document.getElementById('photoPreviewWrap').hidden = true;
  document.getElementById('locationStatus').textContent = 'Sin ubicación todavía.';
  document.getElementById('locationStatus').classList.remove('ok');
  document.getElementById('formError').hidden = true;
}

// ---------- Photo upload (con redimensionado para no exceder el límite de Firestore) ----------
function resizeImage(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if(width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION){
          const scale = MAX_PHOTO_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file) return;
  try{
    pendingPhoto = await resizeImage(file);
    document.getElementById('photoPreview').src = pendingPhoto;
    document.getElementById('photoPreviewWrap').hidden = false;
  }catch(err){
    console.error('Error procesando la foto:', err);
    alert('No se pudo procesar la foto. Intenta con otra imagen.');
  }
});
document.getElementById('removePhotoBtn').addEventListener('click', () => {
  pendingPhoto = null;
  document.getElementById('photoInput').value = '';
  document.getElementById('photoPreviewWrap').hidden = true;
});

// ---------- Geolocation ----------
document.getElementById('locateBtn').addEventListener('click', () => {
  const status = document.getElementById('locationStatus');
  if(!navigator.geolocation){
    status.textContent = 'Tu navegador no soporta geolocalización.';
    return;
  }
  status.textContent = 'Buscando tu ubicación...';
  status.classList.remove('ok');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      pendingLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      status.textContent = `Ubicación: ${pendingLocation.lat.toFixed(5)}, ${pendingLocation.lng.toFixed(5)}`;
      status.classList.add('ok');
    },
    (err) => {
      status.textContent = 'No se pudo obtener la ubicación. Revisa los permisos del navegador.';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ---------- Submit report ----------
document.getElementById('reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  errorEl.hidden = true;

  if(!pendingPhoto && !pendingLocation){
    errorEl.textContent = 'Se requiere al menos una fotografía o la ubicación GPS para publicar.';
    errorEl.hidden = false;
    return;
  }

  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description').value.trim();
  const category = document.getElementById('category').value;
  const severity = document.querySelector('input[name="severity"]:checked').value;
  const isOfficial = ['isPatronato','isCopeco','isPolicia','isAlcaldia','isBomberos']
    .some(id => document.getElementById(id).checked);
  const anonymous = document.getElementById('isAnonimo').checked;
  const author = getIdentity();

  const submitBtn = e.target.querySelector('.submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Publicando...';

  try{
    await addDoc(collection(db, 'reports'), {
      title, description, category, severity,
      photo: pendingPhoto,
      location: pendingLocation,
      author,
      anonymous,
      isOfficial,
      manualStatus: 'activo',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      confirms: [],
      denies: []
    });
    closeForm();
    activeFilter = 'todos';
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    document.querySelector('.chip[data-filter="todos"]').classList.add('active');
  }catch(err){
    console.error('Error publicando reporte:', err);
    errorEl.textContent = 'No se pudo publicar el reporte. Intenta de nuevo.';
    errorEl.hidden = false;
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = 'Publicar reporte';
  }
});

// ---------- Refresh relative times periodically ----------
setInterval(render, 60000);

// ---------- Init ----------
render(); // pinta el estado vacío mientras se conectan los listeners
