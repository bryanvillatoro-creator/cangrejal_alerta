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
const VERIFY_THRESHOLD = 3;   // net confirmations to mark as verified
const DENY_THRESHOLD = 3;     // net denials to mark as incorrect
const REPORTS_KEY = 'cangrejal_reports_v1';
const SCORES_KEY = 'cangrejal_scores_v1';

// ---------- State ----------
let reports = loadReports();
let scores = loadScores();
let activeFilter = 'todos';
let pendingPhoto = null;   // base64 string
let pendingLocation = null; // {lat, lng}

// ---------- Storage helpers ----------
function loadReports(){
  try{ return JSON.parse(localStorage.getItem(REPORTS_KEY)) || []; }
  catch(e){ return []; }
}
function saveReports(){
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
}
function loadScores(){
  try{ return JSON.parse(localStorage.getItem(SCORES_KEY)) || {}; }
  catch(e){ return {}; }
}
function saveScores(){
  localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
}
function getUsername(){
  const v = document.getElementById('username').value.trim();
  return v || 'Anónimo';
}

// ---------- Reputation ----------
function scoreFor(name){ return scores[name] || 0; }
function adjustScore(name, delta){
  scores[name] = (scores[name] || 0) + delta;
  saveScores();
  renderUserRep();
}
function starsFor(score){
  const filled = Math.max(0, Math.min(5, Math.round(score / 10)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}
function renderUserRep(){
  const name = getUsername();
  const s = scoreFor(name);
  document.getElementById('repStars').textContent = starsFor(s);
  document.getElementById('repScore').textContent = `${s} pts`;
}

// ---------- Time formatting ----------
function timeAgo(ts){
  const diffMs = Date.now() - ts;
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
  let list = [...reports];
  if(activeFilter !== 'todos') list = list.filter(r => r.category === activeFilter);
  list.sort((a,b) => b.createdAt - a.createdAt);

  feed.innerHTML = '';
  if(list.length === 0){
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.forEach(r => {
    const net = r.confirms.length - r.denies.length;
    const verified = net >= VERIFY_THRESHOLD;
    const incorrect = net <= -DENY_THRESHOLD;
    const myVote = getMyVote(r);

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
        <span>👤 ${escapeHtml(r.author)}</span>
        <span>🕒 ${timeAgo(r.updatedAt)}</span>
        ${r.location ? `<span>📍 ${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)}</span>` : ''}
        <span>${incorrect ? '⚠️ Estado: no confirmado' : '🟡 Estado: activo'}</span>
      </div>
      ${verified ? '<div class="verified-badge">🟢 Información verificada por la comunidad</div>' : ''}
      ${incorrect ? '<div class="verified-badge" style="color:var(--coral); border-color:rgba(216,86,74,0.4); background:rgba(216,86,74,0.1);">❌ Marcado como información incorrecta</div>' : ''}
      <div class="vote-row">
        <div class="vote-btns">
          <button class="vote-btn confirm ${myVote === 'confirm' ? 'voted' : ''}" data-id="${r.id}" data-vote="confirm">✅ Confirmado (${r.confirms.length})</button>
          <button class="vote-btn deny ${myVote === 'deny' ? 'voted' : ''}" data-id="${r.id}" data-vote="deny">❌ Incorrecto (${r.denies.length})</button>
        </div>
        <span class="reported-count">Reportado por ${r.confirms.length + 1} persona(s)</span>
      </div>
    `;
    feed.appendChild(card);
  });
}

function getMyVote(report){
  const name = getUsername();
  if(report.confirms.includes(name)) return 'confirm';
  if(report.denies.includes(name)) return 'deny';
  return null;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Voting ----------
document.getElementById('feed').addEventListener('click', (e) => {
  const btn = e.target.closest('.vote-btn');
  if(!btn) return;
  const id = btn.dataset.id;
  const vote = btn.dataset.vote;
  const name = getUsername();
  const report = reports.find(r => r.id === id);
  if(!report) return;
  if(report.author === name){
    alert('No puedes votar en tu propio reporte.');
    return;
  }

  // remove any previous vote by this user
  report.confirms = report.confirms.filter(n => n !== name);
  report.denies = report.denies.filter(n => n !== name);

  const wasVerified = (report.confirms.length - report.denies.length) >= VERIFY_THRESHOLD;
  const wasIncorrect = (report.denies.length - report.confirms.length) >= DENY_THRESHOLD;

  if(vote === 'confirm') report.confirms.push(name);
  if(vote === 'deny') report.denies.push(name);
  report.updatedAt = Date.now();

  const nowVerified = (report.confirms.length - report.denies.length) >= VERIFY_THRESHOLD;
  const nowIncorrect = (report.denies.length - report.confirms.length) >= DENY_THRESHOLD;

  if(!wasVerified && nowVerified) adjustScore(report.author, 5);
  if(!wasIncorrect && nowIncorrect) adjustScore(report.author, -5);

  saveReports();
  render();
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

// ---------- Photo upload ----------
document.getElementById('photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingPhoto = reader.result;
    document.getElementById('photoPreview').src = pendingPhoto;
    document.getElementById('photoPreviewWrap').hidden = false;
  };
  reader.readAsDataURL(file);
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
document.getElementById('reportForm').addEventListener('submit', (e) => {
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
  const isOfficial = document.getElementById('isModerator').checked;
  const author = getUsername();
  const now = Date.now();

  const report = {
    id: 'r_' + now + '_' + Math.random().toString(36).slice(2,7),
    title, description, category, severity,
    photo: pendingPhoto,
    location: pendingLocation,
    author,
    isOfficial,
    createdAt: now,
    updatedAt: now,
    confirms: [],
    denies: []
  };
  reports.unshift(report);
  saveReports();
  closeForm();
  activeFilter = 'todos';
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  document.querySelector('.chip[data-filter="todos"]').classList.add('active');
  render();
});

// ---------- Username persistence ----------
const savedName = localStorage.getItem('cangrejal_username');
if(savedName) document.getElementById('username').value = savedName;
document.getElementById('username').addEventListener('input', () => {
  localStorage.setItem('cangrejal_username', document.getElementById('username').value);
  renderUserRep();
  render();
});

// ---------- Refresh relative times periodically ----------
setInterval(render, 60000);

// ---------- Seed example data on first run ----------
function seedIfEmpty(){
  if(reports.length > 0) return;
  const now = Date.now();
  reports = [
    {
      id: 'seed1', title: 'Derrumbe bloquea acceso a Las Mangas',
      description: 'Grandes rocas y lodo cubren la vía después de la lluvia de anoche. No es posible pasar en vehículo.',
      category: 'derrumbe', severity: 'grave', photo: null,
      location: { lat: 15.75684, lng: -86.76582 },
      author: 'Pedro López', isOfficial: false,
      createdAt: now - 25*60000, updatedAt: now - 5*60000,
      confirms: ['María', 'Juan', 'Carlos'], denies: []
    },
    {
      id: 'seed2', title: 'Río Cangrejal con nivel alto cerca del puente colgante',
      description: 'El caudal subió notablemente, se recomienda no cruzar a pie por ahora.',
      category: 'inundacion', severity: 'moderado', photo: null,
      location: { lat: 15.76920, lng: -86.78120 },
      author: 'COPECO La Ceiba', isOfficial: true,
      createdAt: now - 90*60000, updatedAt: now - 30*60000,
      confirms: ['Ana'], denies: []
    }
  ];
  saveReports();
}

// ---------- Init ----------
seedIfEmpty();
renderUserRep();
render();
