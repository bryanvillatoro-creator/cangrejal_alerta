import { db, auth, storage } from './firebase-config.js';
import { currentUserData } from './auth.js';
import {
  collection, doc, addDoc, updateDoc, onSnapshot,
  query, orderBy, serverTimestamp, arrayUnion, arrayRemove,
  setDoc, getDoc, increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

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
const MAX_VIDEO_SECONDS = 15;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // 25 MB, límite práctico de subida
const DUPLICATE_RADIUS_M = 300;          // metros de cercanía para considerarlo posible duplicado
const DUPLICATE_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 horas de ventana de tiempo
const EARTH_RADIUS_M = 6371000;

// ---------- State ----------
let reports = [];
let scores = {};
let activeFilter = 'todos';
let activeTab = 'recent'; // 'recent' = últimas 24h, 'older' = historial
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let pendingMedia = null;   // { type: 'image'|'video', file: File, previewUrl: string }
let pendingLocation = null; // {lat, lng}
let unsubReports = null;
let unsubScores = null;

// ---------- Geografía: distancia y detección de duplicados ----------
function distanceMeters(a, b){
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Reportes activos de la misma categoría, cerca en espacio y tiempo de una referencia dada.
function findNearbyReports(category, location, referenceMs, excludeId){
  if(!location) return [];
  return reports.filter(r => {
    if(r.id === excludeId) return false;
    if(r.category !== category) return false;
    if(!r.location) return false;
    if(r.manualStatus === 'resuelto' || r.manualStatus === 'descartado') return false;
    const dist = distanceMeters(location, r.location);
    const timeDiff = Math.abs(referenceMs - toMillis(r.createdAt));
    return dist <= DUPLICATE_RADIUS_M && timeDiff <= DUPLICATE_WINDOW_MS;
  });
}

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

function dateHeaderFor(ts){
  const d = new Date(toMillis(ts));
  const now = new Date();
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / ONE_DAY_MS);
  if(diffDays === 0) return 'Hoy';
  if(diffDays === 1) return 'Ayer';
  const opts = { day: 'numeric', month: 'long' };
  if(d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('es-HN', opts);
}

// ---------- Rendering ----------
function render(){
  const feed = document.getElementById('feed');
  const empty = document.getElementById('emptyState');
  if(!feed) return;

  let list = [...reports];
  if(activeFilter !== 'todos') list = list.filter(r => r.category === activeFilter);

  const cutoff = Date.now() - ONE_DAY_MS;
  list = list.filter(r => {
    const isRecent = toMillis(r.createdAt) >= cutoff;
    return activeTab === 'recent' ? isRecent : !isRecent;
  });

  list.sort((a,b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  feed.innerHTML = '';
  if(list.length === 0){
    empty.hidden = false;
    empty.querySelector('h2').textContent = activeTab === 'recent'
      ? 'Aún no hay reportes recientes en esta categoría'
      : 'No hay reportes anteriores en esta categoría';
    return;
  }
  empty.hidden = true;

  let lastHeader = null;
  list.forEach(r => {
    const confirms = r.confirms || [];
    const denies = r.denies || [];
    const net = confirms.length - denies.length;
    const verified = net >= VERIFY_THRESHOLD;
    const incorrect = net <= -DENY_THRESHOLD;
    const myVote = getMyVote(r);
    const displayAuthor = r.anonymous ? 'Anónimo' : r.author;
    const statusInfo = OPERATIONAL_STATUS[r.manualStatus || 'activo'];
    const nearbyCount = findNearbyReports(r.category, r.location, toMillis(r.createdAt), r.id).length;

    const header = dateHeaderFor(r.createdAt);
    if(header !== lastHeader){
      const headerEl = document.createElement('div');
      headerEl.className = 'date-header';
      headerEl.textContent = header;
      feed.appendChild(headerEl);
      lastHeader = header;
    }

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-top">
        <span class="card-cat">${CATEGORY_LABELS[r.category] || r.category}</span>
        ${r.isOfficial ? '<span class="card-official">✔ Información oficial</span>' : ''}
      </div>
      <h3>${escapeHtml(r.title)}</h3>
      <p class="desc">${escapeHtml(r.description)}</p>
      ${nearbyCount > 0 ? `<div class="duplicate-note">🔁 ${nearbyCount} reporte${nearbyCount > 1 ? 's' : ''} similar${nearbyCount > 1 ? 'es' : ''} cerca, en tiempo y ubicación parecidos</div>` : ''}
      ${r.media && r.media.type === 'image' ? `<img class="evidence" src="${r.media.url}" alt="Foto del incidente">` : ''}
      ${r.media && r.media.type === 'video' ? `<video class="evidence" src="${r.media.url}" controls playsinline preload="metadata"></video>` : ''}
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

// ---------- Time period tabs ----------
document.querySelectorAll('.tab-btn').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    activeTab = tab.dataset.tab;
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
  clearPendingMedia();
  pendingLocation = null;
  document.getElementById('locationStatus').textContent = 'Sin ubicación todavía.';
  document.getElementById('locationStatus').classList.remove('ok');
  document.getElementById('formError').hidden = true;
}

// ---------- Evidencia multimedia (foto o video, desde cámara o galería) ----------
function resizeImageToBlob(file){
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
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen')), 'image/jpeg', 0.72);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getVideoDuration(file){
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('No se pudo leer el video'));
    };
    video.src = URL.createObjectURL(file);
  });
}

function clearPendingMedia(){
  if(pendingMedia && pendingMedia.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
  pendingMedia = null;
  ['photoCameraInput','photoGalleryInput','videoCameraInput','videoGalleryInput'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('mediaPreviewWrap').hidden = true;
  document.getElementById('photoPreview').hidden = true;
  document.getElementById('videoPreview').hidden = true;
  document.getElementById('videoPreview').removeAttribute('src');
  hideMediaError();
}

function showMediaError(msg){
  const el = document.getElementById('mediaError');
  el.textContent = msg;
  el.hidden = false;
}
function hideMediaError(){
  document.getElementById('mediaError').hidden = true;
}

async function handleMediaFile(file, kind){
  hideMediaError();
  if(!file) return;

  if(kind === 'image' && !file.type.startsWith('image/')){
    showMediaError('El archivo seleccionado no es una imagen.');
    return;
  }
  if(kind === 'video' && !file.type.startsWith('video/')){
    showMediaError('El archivo seleccionado no es un video.');
    return;
  }

  if(kind === 'video'){
    if(file.size > MAX_VIDEO_BYTES){
      showMediaError('El video es demasiado pesado (máx. 25 MB). Graba uno más corto o con menor calidad.');
      return;
    }
    let duration;
    try{
      duration = await getVideoDuration(file);
    }catch(err){
      showMediaError('No se pudo leer el video. Intenta con otro archivo.');
      return;
    }
    if(duration > MAX_VIDEO_SECONDS + 0.5){
      showMediaError(`El video dura ${duration.toFixed(1)}s. El máximo permitido es ${MAX_VIDEO_SECONDS} segundos.`);
      return;
    }
  }

  if(pendingMedia && pendingMedia.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
  const previewUrl = URL.createObjectURL(file);
  pendingMedia = { type: kind, file, previewUrl };

  const wrap = document.getElementById('mediaPreviewWrap');
  const imgEl = document.getElementById('photoPreview');
  const videoEl = document.getElementById('videoPreview');
  wrap.hidden = false;
  if(kind === 'image'){
    imgEl.src = previewUrl;
    imgEl.hidden = false;
    videoEl.hidden = true;
    videoEl.removeAttribute('src');
  }else{
    videoEl.src = previewUrl;
    videoEl.hidden = false;
    imgEl.hidden = true;
    imgEl.removeAttribute('src');
  }
}

document.getElementById('photoCameraInput').addEventListener('change', (e) => handleMediaFile(e.target.files[0], 'image'));
document.getElementById('photoGalleryInput').addEventListener('change', (e) => handleMediaFile(e.target.files[0], 'image'));
document.getElementById('videoCameraInput').addEventListener('change', (e) => handleMediaFile(e.target.files[0], 'video'));
document.getElementById('videoGalleryInput').addEventListener('change', (e) => handleMediaFile(e.target.files[0], 'video'));

document.getElementById('removeMediaBtn').addEventListener('click', clearPendingMedia);

// Sube la evidencia pendiente (foto comprimida o video) a Firebase Storage y devuelve { type, url }
async function uploadPendingMedia(){
  if(!pendingMedia || !auth.currentUser) return null;
  const uid = auth.currentUser.uid;
  const statusEl = document.getElementById('mediaUploadStatus');
  statusEl.hidden = false;

  let blobToUpload = pendingMedia.file;
  let extension = pendingMedia.type === 'image' ? 'jpg' : (pendingMedia.file.name.split('.').pop() || 'mp4');
  let contentType = pendingMedia.type === 'image' ? 'image/jpeg' : pendingMedia.file.type;

  if(pendingMedia.type === 'image'){
    statusEl.textContent = 'Comprimiendo foto...';
    blobToUpload = await resizeImageToBlob(pendingMedia.file);
  }

  statusEl.textContent = pendingMedia.type === 'image' ? 'Subiendo foto...' : 'Subiendo video...';
  const path = `reports/${uid}/${Date.now()}_${Math.random().toString(36).slice(2,7)}.${extension}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, blobToUpload, { contentType });
  const url = await getDownloadURL(fileRef);
  statusEl.hidden = true;
  return { type: pendingMedia.type, url };
}

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
// Añade el voto "confirmado" del usuario actual a un reporte existente,
// en vez de crear uno nuevo (se usa cuando el usuario acepta que es un duplicado).
async function confirmExistingInsteadOfDuplicate(existingReport, author){
  const confirms = existingReport.confirms || [];
  const denies = existingReport.denies || [];
  const wasVerified = (confirms.length - denies.length) >= VERIFY_THRESHOLD;

  await updateDoc(doc(db, 'reports', existingReport.id), { confirms: arrayRemove(author) });
  await updateDoc(doc(db, 'reports', existingReport.id), { denies: arrayRemove(author) });
  await updateDoc(doc(db, 'reports', existingReport.id), {
    confirms: arrayUnion(author),
    updatedAt: serverTimestamp()
  });

  const newConfirms = confirms.filter(n => n !== author).concat(author);
  const nowVerified = (newConfirms.length - denies.filter(n => n !== author).length) >= VERIFY_THRESHOLD;
  if(!wasVerified && nowVerified) adjustScore(existingReport.author, 5);
}

document.getElementById('reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  errorEl.hidden = true;

  if(!pendingMedia && !pendingLocation){
    errorEl.textContent = 'Se requiere al menos una fotografía, un video o la ubicación GPS para publicar.';
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

  // ---- Chequeo de posible duplicado por cercanía geográfica y tiempo ----
  if(pendingLocation){
    const duplicate = findNearbyReports(category, pendingLocation, Date.now(), null)[0];
    if(duplicate){
      const distM = Math.round(distanceMeters(pendingLocation, duplicate.location));
      const minsAgo = Math.max(0, Math.round((Date.now() - toMillis(duplicate.createdAt)) / 60000));
      const dupAuthor = duplicate.anonymous ? 'un usuario anónimo' : duplicate.author;
      const useExisting = confirm(
        `Ya hay un reporte de "${CATEGORY_LABELS[category]}" publicado hace ${minsAgo} min, ` +
        `a ${distM} m de tu ubicación (por ${dupAuthor}).\n\n` +
        `Aceptar = confirmar ese reporte existente (recomendado, evita duplicados).\n` +
        `Cancelar = publicar el tuyo como un reporte nuevo y distinto.`
      );
      if(useExisting){
        try{
          await confirmExistingInsteadOfDuplicate(duplicate, author);
          closeForm();
        }catch(err){
          console.error('Error confirmando reporte existente:', err);
          errorEl.textContent = 'No se pudo confirmar el reporte existente. Intenta de nuevo.';
          errorEl.hidden = false;
        }
        return;
      }
    }
  }

  const submitBtn = e.target.querySelector('.submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Publicando...';

  try{
    const media = await uploadPendingMedia();
    await addDoc(collection(db, 'reports'), {
      title, description, category, severity,
      media, // { type: 'image'|'video', url } o null
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
    activeTab = 'recent';
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    document.querySelector('.chip[data-filter="todos"]').classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    const recentTab = document.querySelector('.tab-btn[data-tab="recent"]');
    recentTab.classList.add('active');
    recentTab.setAttribute('aria-selected', 'true');
  }catch(err){
    console.error('Error publicando reporte:', err);
    document.getElementById('mediaUploadStatus').hidden = true;
    errorEl.textContent = 'No se pudo publicar el reporte. Revisa tu conexión e intenta de nuevo.';
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
