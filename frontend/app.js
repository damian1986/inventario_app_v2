const API = window.location.port === '3000' ? `${window.location.protocol}//${window.location.hostname}:8000` : `${window.location.protocol}//${window.location.hostname}:8000`;
let productos = [], editingId = null, ajusteId = null;
window.collapsedGroups = new Set();

// Parámetros de paginación simples
let skipMovimientos = 0;
let limitMovimientos = 200;

// ── BÚSQUEDA FLEXIBLE (compartida con oc.js) ─────────────────────────
// TODAS las palabras del texto deben aparecer (en cualquier orden), sin
// distinguir mayúsculas ni acentos, tolerando plural y género
// (blanca→blanco, playeras→playera). Ej.: "Playera Blanca Dama" encuentra
// "Playera Dama Peso D0200 - Blanco Chica". Si el texto no deja palabras
// útiles (vacío o solo conectores), no se filtra nada.
const BUSQUEDA_STOPWORDS = new Set(['de','del','la','el','los','las','un','una','unos','unas','y','o','con','para','por','en','al']);

function normalizarBusqueda(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function variantesBusqueda(palabra) {
  const vars = new Set([palabra]);
  // Plural: playeras→playera, colores→color
  if (palabra.length > 2 && palabra.endsWith('s')) {
    const sinS = palabra.slice(0, -1);
    vars.add(sinS);
    if (sinS.length > 2 && sinS.endsWith('e')) vars.add(sinS.slice(0, -1));
  }
  // Género: blanca→blanco, negro→negra
  for (const v of [...vars]) {
    if (v.length > 2) {
      if (v.endsWith('a')) vars.add(v.slice(0, -1) + 'o');
      else if (v.endsWith('o')) vars.add(v.slice(0, -1) + 'a');
    }
  }
  return [...vars];
}

function coincideBusqueda(campos, query) {
  const palabras = normalizarBusqueda(query).trim().split(/\s+/)
    .filter(w => w.length >= 2 && !BUSQUEDA_STOPWORDS.has(w));
  if (palabras.length === 0) return true;
  const textos = (campos || []).map(c => normalizarBusqueda(c)).filter(Boolean);
  return palabras.every(w => variantesBusqueda(w).some(v => textos.some(t => t.includes(v))));
}

// ── ESCAPE HTML (compartido con oc.js/dashboard.js/conteo.js/contabilidad.js) ──
// escapeHtml: para TEXTO y atributos HTML normales. Evita XSS al interpolar
// datos de la BD o del usuario en innerHTML.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// escapeJsAttr: para argumentos de cadena DENTRO de atributos onclick="f('...')".
// Primero escapa la cadena JS (barra invertida, comilla simple, saltos de línea)
// y después el atributo HTML (el navegador decodifica entidades ANTES de que JS
// parsee el atributo, así que ambos niveles deben quedar seguros).
function escapeJsAttr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── AUTENTICACIÓN ────────────────────────────────────────────────────

function getToken() { return localStorage.getItem('inv_token'); }
function getSessionRol() { return localStorage.getItem('inv_rol') || ''; }
function getSessionUser() { return localStorage.getItem('inv_user') || ''; }
function getSessionNombre() { return localStorage.getItem('inv_nombre') || getSessionUser(); }

async function req(method, path, body){
  const opts = { method, headers: {'Content-Type':'application/json'} };
  const token = getToken();
  if(token) opts.headers['Authorization'] = 'Bearer ' + token;
  if(body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if(r.status === 401) {
    const sesionActiva = !!token;
    doLogout();
    if(sesionActiva) {
      const errBox = document.getElementById('login-error');
      if(errBox) { errBox.textContent = '⏰ Tu sesión expiró. Inicia sesión de nuevo.'; errBox.style.display = 'block'; }
    }
    const err = new Error('Sesión expirada'); err.status = 401; throw err;
  }
  if(!r.ok){ const e = await r.json().catch(()=>({detail:'Error'})); throw new Error(e.detail||'Error'); }
  if(r.status===204) return null;
  return r.json();
}

window.doLogin = async function() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errBox = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');
  if(!username || !password) { errBox.textContent='Ingresa usuario y contraseña'; errBox.style.display='block'; return; }
  btn.disabled = true;
  btn.textContent = 'Iniciando sesión...';
  errBox.style.display = 'none';
  try {
    const data = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({username, password})
    });
    if(!data.ok) {
      const e = await data.json().catch(()=>({detail:'Error de red'}));
      throw new Error(e.detail || e.error || 'Credenciales incorrectas');
    }
    const resp = await data.json();

    if(resp.requires_2fa) {
      // Mostrar pantalla 2FA (passkey y/o TOTP según los métodos del usuario)
      localStorage.setItem('inv_temp_token', resp.temp_token);
      localStorage.setItem('inv_temp_user', resp.username);
      document.getElementById('page-login').style.display = 'none';
      document.getElementById('page-2fa').style.display = 'flex';
      prepararPantalla2FA(resp.metodos_2fa || ['totp']);
      return;
    }

    guardarSesion(resp);
    showApp(resp.rol, resp.username);
  } catch(e) {
    errBox.textContent = e.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Iniciar Sesión';
  }
};

window.doVerify2FA = async function() {
  const code = document.getElementById('login-2fa-code').value.replace(/\s/g, '');
  const tempToken = localStorage.getItem('inv_temp_token');
  const errBox = document.getElementById('2fa-error');
  if(!code || code.length < 6) return;

  errBox.style.display = 'none';
  try {
    const r = await fetch(API + '/auth/2fa/verify', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({code, temp_token: tempToken})
    });
    if(!r.ok) {
        const e = await r.json().catch(()=>({detail:'Código incorrecto'}));
        throw new Error(e.detail || e.error || 'Código incorrecto');
    }
    const resp = await r.json();
    guardarSesion(resp);
    document.getElementById('page-2fa').style.display = 'none';
    showApp(resp.rol, resp.username);
  } catch(e) {
    errBox.textContent = e.message;
    errBox.style.display = 'block';
  }
};

window.cancel2FA = function() {
  localStorage.removeItem('inv_temp_token');
  localStorage.removeItem('inv_temp_user');
  document.getElementById('page-2fa').style.display = 'none';
  document.getElementById('page-login').style.display = 'flex';
};

// ── PASSKEYS (WEBAUTHN) EN EL LOGIN ──────────────────────────────────

// ¿Este navegador/contexto puede usar WebAuthn? Requiere contexto seguro:
// https o localhost. Por IP pelada en la LAN el navegador lo bloquea.
function passkeysDisponibles() {
  return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials);
}

// base64url (sin relleno) -> ArrayBuffer, para retos e IDs que van al navegador
function b64urlToBuf(s) {
  const b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ArrayBuffer -> base64url (sin relleno), para respuestas que van a la API
function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Convierte una PublicKeyCredential a JSON plano (formato que espera py_webauthn)
function credToJSON(cred) {
  const r = cred.response;
  const json = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  };
  if (r.attestationObject) {           // registro (create)
    json.response = {
      attestationObject: bufToB64url(r.attestationObject),
      clientDataJSON: bufToB64url(r.clientDataJSON),
    };
    const t = r.getTransports ? r.getTransports() : [];
    if (t && t.length) json.response.transports = t;
  } else {                             // autenticación (get)
    json.response = {
      authenticatorData: bufToB64url(r.authenticatorData),
      clientDataJSON: bufToB64url(r.clientDataJSON),
      signature: bufToB64url(r.signature),
      userHandle: r.userHandle ? bufToB64url(r.userHandle) : null,
    };
  }
  return json;
}

// Guarda la sesión autenticada (mismo esquema en login directo, TOTP y passkey)
function guardarSesion(resp) {
  localStorage.setItem('inv_token', resp.access_token);
  localStorage.setItem('inv_rol', resp.rol);
  localStorage.setItem('inv_user', resp.username);
  localStorage.setItem('inv_nombre', resp.nombre || resp.username);
  localStorage.setItem('inv_user_id', resp.id || '');
  localStorage.removeItem('inv_temp_token');
  localStorage.removeItem('inv_temp_user');
}

// Ajusta la pantalla 2FA a los métodos del usuario: passkey, TOTP o ambos
function prepararPantalla2FA(metodos) {
  const passkeyOk = metodos.includes('passkey') && passkeysDisponibles();
  const totpOk = metodos.includes('totp');
  const blockPasskey = document.getElementById('2fa-passkey-block');
  const blockTotp = document.getElementById('2fa-totp-block');
  const divider = document.getElementById('2fa-divider');
  const sub = document.getElementById('2fa-sub');
  const errBox = document.getElementById('2fa-error');

  if (blockPasskey) blockPasskey.style.display = passkeyOk ? '' : 'none';
  if (blockTotp) blockTotp.style.display = totpOk ? '' : 'none';
  if (divider) divider.style.display = (passkeyOk && totpOk) ? '' : 'none';
  if (sub) {
    sub.textContent = (passkeyOk && totpOk)
      ? 'Elige cómo verificar tu identidad en este dispositivo.'
      : (passkeyOk ? 'Verifica con la huella o el PIN de este dispositivo.'
                   : 'Ingresa el código de tu aplicación autenticadora.');
  }
  if (errBox) {
    // Caso límite: solo passkeys, pero este navegador no las soporta (p. ej. IP en LAN)
    if (!passkeyOk && !totpOk) {
      errBox.textContent = '🔒 Este navegador no puede usar passkeys aquí (necesita HTTPS o localhost). Abre la app desde un dispositivo compatible o pide al administrador un código TOTP.';
      errBox.style.display = 'block';
    } else {
      errBox.style.display = 'none';
    }
  }
  setTimeout(() => {
    if (totpOk) {
      const inp = document.getElementById('login-2fa-code');
      if (inp) { inp.focus(); inp.select(); }
    } else if (passkeyOk) {
      const pb = document.getElementById('btn-2fa-passkey');
      if (pb) pb.focus();
    }
  }, 100);
}

// Botón «Usar huella / PIN»: segundo factor con passkey (navigator.credentials.get)
window.doVerifyPasskey = async function() {
  const errBox = document.getElementById('2fa-error');
  const btn = document.getElementById('btn-2fa-passkey');
  errBox.style.display = 'none';
  const tempToken = localStorage.getItem('inv_temp_token');
  if (!tempToken) {
    errBox.textContent = '⏰ La verificación expiró. Regresa e inicia sesión de nuevo.';
    errBox.style.display = 'block';
    return;
  }
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Esperando al dispositivo…'; }
  try {
    const opts = await fetch(API + '/auth/webauthn/login/options', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({temp_token: tempToken})
    });
    if (!opts.ok) {
      const e = await opts.json().catch(()=>({detail:'No se pudo iniciar la verificación'}));
      throw new Error(e.detail || 'No se pudo iniciar la verificación');
    }
    const publicKey = await opts.json();
    publicKey.challenge = b64urlToBuf(publicKey.challenge);
    if (publicKey.allowCredentials) {
      publicKey.allowCredentials = publicKey.allowCredentials.map(c => ({...c, id: b64urlToBuf(c.id)}));
    }
    const cred = await navigator.credentials.get({publicKey});
    const r = await fetch(API + '/auth/webauthn/login/verify', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({temp_token: tempToken, credential: credToJSON(cred)})
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({detail:'Verificación fallida'}));
      throw new Error(e.detail || 'Verificación fallida');
    }
    const resp = await r.json();
    guardarSesion(resp);
    document.getElementById('page-2fa').style.display = 'none';
    showApp(resp.rol, resp.username);
  } catch(e) {
    // NotAllowedError = el usuario canceló la ventana o el dispositivo no respondió
    if (e && e.name === 'NotAllowedError') {
      errBox.textContent = '❌ Cancelaste la verificación o el dispositivo no respondió. Puedes intentarlo de nuevo.';
    } else {
      errBox.textContent = e.message || 'No se pudo verificar la passkey.';
    }
    errBox.style.display = 'block';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
};

window.doLogout = function() {
  localStorage.removeItem('inv_token');
  localStorage.removeItem('inv_rol');
  localStorage.removeItem('inv_user');
  localStorage.removeItem('inv_nombre');
  localStorage.removeItem('inv_user_id');
  // Detener el polling de notificaciones (si no, seguiría pidiendo cada 15 s con 401)
  if (window.notificacionesCheckInterval) { clearInterval(window.notificacionesCheckInterval); window.notificacionesCheckInterval = null; }
  // Limpiar estado
  productos = [];
  window.cart = [];
  // Mostrar login
  document.getElementById('page-login').style.display = 'flex';
  document.getElementById('app-header').style.display = 'none';
  document.getElementById('app-nav').style.display = 'none';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  // El recuadro de error se limpia al intentar iniciar sesión (doLogin), no aquí:
  // así el aviso "Tu sesión expiró" sobrevive a los 401 en paralelo del arranque
};

window.applyRoleUI = function(rol) {
  const isAdmin = rol === 'admin';
  const isVendedor = rol === 'vendedor';
  const isBodeguero = rol === 'bodeguero';

  // Ocultar/Mostrar según rol
  const navItems = {
    'nav-reporte': isAdmin,
    'nav-ordenes': isAdmin,
    'nav-conteo': isAdmin || isBodeguero,
    'nav-logs': isAdmin,
    'nav-descuentos': isAdmin,
    'nav-usuarios': isAdmin,
    'nav-contabilidad': isAdmin,
    'nav-gestion_ventas': isAdmin || isVendedor
  };

  for (const [id, visible] of Object.entries(navItems)) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  }
};

function showApp(rol, username) {
  document.getElementById('page-login').style.display = 'none';
  document.getElementById('app-header').style.display = '';
  document.getElementById('app-nav').style.display = '';

  // Mostrar nombre de sesión en la barra lateral
  const nombreUI = getSessionNombre();
  const sideName = document.getElementById('sidebar-name');
  const sideRole = document.getElementById('sidebar-role');
  const sideAvatar = document.getElementById('sidebar-avatar');
  
  const primerNombre = nombreUI ? nombreUI.trim().split(' ')[0] : username;
  const rolLabels = { admin: '🔑 Admin', vendedor: '💰 Vendedor', bodeguero: '📦 Bodeguero' };
  
  if(sideName) sideName.textContent = primerNombre;
  if(sideRole) sideRole.textContent = rolLabels[rol] || rol;
  if(sideAvatar) sideAvatar.textContent = primerNombre.charAt(0).toUpperCase();

  // Botón de gestión de passkeys: solo si el navegador puede usarlas aquí
  const btnPasskey = document.getElementById('btn-passkey-manage');
  if (btnPasskey) btnPasskey.style.display = passkeysDisponibles() ? '' : 'none';

  applyRoleUI(rol);
  showPage('dashboard', document.querySelector('#app-nav button'));
  
  loadNotificaciones();
  if (window.notificacionesCheckInterval) clearInterval(window.notificacionesCheckInterval);
  window.notificacionesCheckInterval = setInterval(loadNotificaciones, 15000);
  
  loadProductos();
}

// ─────────────────────────────────────────────────────────────────────

function toast(msg, ok=true){
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast-item ' + (ok ? 'toast-ok' : 'toast-err');
  t.innerHTML = `
    <div>${(ok?'✅ ':'❌ ') + escapeHtml(msg)}</div>
    <button class="toast-close" onclick="this.parentElement.remove()" title="Cerrar">✖</button>
  `;
  container.appendChild(t);
  if (ok) {
    setTimeout(() => { if (t.parentElement) t.remove(); }, 12000); // Exitosas cierran a los 12 seg
  }
}

async function loadProductos(){
  try{
    productos=await req('GET','/productos');
    const rep = await req('GET', '/reporte');
    window.globalSalesMap = {};
    if (rep && rep.top_productos) {
       rep.top_productos.forEach(p => {
          window.globalSalesMap[p.nombre] = p.ingresos;
       });
    }
    updateFilterParentList();
    renderInventario();
    renderVentasRecientes();
  }catch(err){toast(err.message,false);}
}

function updateFilterParentList() {
  const sel = document.getElementById('filter-parent');
  if(!sel) return;
  const currentVal = sel.value;
  const parents = new Set();
  productos.forEach(p => {
    const parts = p.categoria.split(' › ');
    if(parts[0]) parents.add(parts[0]);
  });
  sel.innerHTML = '<option value="">Todas las categorías</option>';
  [...parents].sort().forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
  sel.value = currentVal;
}

function updateFilterSubcats() {
  const parent = document.getElementById('filter-parent').value;
  const container = document.getElementById('filter-subcats-container');
  if (!parent) {
    container.classList.add('d-none');
    container.innerHTML = '';
    renderInventario();
    return;
  }
  const subcats = new Set();
  productos.forEach(p => {
    if (p.categoria.startsWith(parent)) {
       const parts = p.categoria.split(' › ').slice(1);
       parts.forEach(s => subcats.add(s));
    }
  });
  if (subcats.size === 0) {
    container.classList.add('d-none');
    container.innerHTML = '';
  } else {
    container.classList.remove('d-none');
    container.innerHTML = '<strong style="display:block;margin-bottom:5px;font-size:0.75rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Subcategorías</strong>' +
      [...subcats].sort().map(s => `
        <label class="subcat-item">
          <input type="checkbox" value="${escapeHtml(s)}" onchange="renderInventario()"> ${escapeHtml(s)}
        </label>
      `).join('');
  }
  renderInventario();
}

function getStatus(qty,min){ return qty<=0?'out':qty<=min?'low':'ok'; }

function statusBadge(qty,min){
  const s=getStatus(qty,min);
  if(s==='out') return '<span class="badge badge-out">Sin stock</span>';
  if(s==='low') return '<span class="badge badge-low">Stock bajo</span>';
  return '<span class="badge badge-ok">En stock</span>';
}

function mxn(v){ return '$'+Number(v).toLocaleString('es-MX',{minimumFractionDigits:2, maximumFractionDigits:2}); }

const TZ_MX = { timeZone: 'America/Mexico_City', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };

const sizeOrderMap = {
  'XXX-Grande': 6, 'Extra Extra Extra Grande': 6, 'XXXL': 6, 'EEEG': 6,
  'XX-Grande': 5, 'Extra Extra Grande': 5, 'XXL': 5, 'EEG': 5,
  'X-Grande': 4, 'Extra Grande': 4, 'Extragrande': 4, 'XL': 4, 'EG': 4,
  'Grande': 3, 'L': 3, 'G': 3,
  'Mediana': 2, 'M': 2,
  'Chica': 1, 'S': 1, 'Ch': 1,
  'Extra Chica': 0, 'XS': 0
};

function getSizeWeight(name) {
  const keys = Object.keys(sizeOrderMap).sort((a,b) => b.length - a.length);
  for (const key of keys) {
    if (name.includes(key)) return sizeOrderMap[key];
  }
  return 99;
}

function extractColorSize(namePart) {
  if (!namePart) return { color: 'Único', size: '' };
  const sortedSizes = Object.keys(sizeOrderMap).sort((a,b) => b.length - a.length);
  let color = namePart.trim();
  let size = '';
  for (const s of sortedSizes) {
    const escapedS = s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`[\\s>\\-\\|]${escapedS}$`, 'i');
    if (regex.test(namePart)) {
      size = s;
      color = namePart.substring(0, namePart.lastIndexOf(s)).replace(/[>\-\|]+$/, '').trim();
      break;
    }
  }
  if (!size) {
    const parts = namePart.split(' ');
    if (parts.length > 1) { size = parts.pop(); color = parts.join(' ').trim(); }
    else { color = namePart.trim(); }
  }
  const modifiers = ['Claro', 'Bosque', 'Marino', 'Jaspe', 'Neon', 'Oscuro'];
  for (const mod of modifiers) {
    const lowSize = size.toLowerCase();
    const lowMod = mod.toLowerCase();
    if (lowSize === lowMod || lowSize.startsWith(lowMod + ' ')) {
      color = (color + ' ' + mod).trim();
      size = size.substring(mod.length).trim();
      break;
    }
  }
  ['Extra Extra Extra', 'Extra Extra', 'Extra'].forEach(frag => {
    if (color.endsWith(' ' + frag)) color = color.replace(' ' + frag, '').trim();
  });
  color = color.replace(/^Peso\s+\S+\s*-\s*/i, '').trim();
  return { color, size };
}

function renderBreadcrumb(name, cat) {
  if (!cat || !cat.includes(' › ')) {
     return `<div class="breadcrumb-container"><span class="bc-item bc-0">${escapeHtml(name)}</span></div>`;
  }
  const levels = cat.split(' › ');
  const parts = [];
  levels.forEach((l, i) => { parts.push(`<span class="bc-item bc-${Math.min(i, 4)}">${escapeHtml(l)}</span>`); });
  let variantPart = name;
  levels.forEach(l => { variantPart = variantPart.replace(l, '').trim(); });
  variantPart = variantPart.replace(/^[-\s▸>]+/, '').trim();
  if (variantPart && variantPart !== 'Estándar') {
    if (variantPart.includes('>')) {
      const segs = variantPart.split('>').map(s => s.trim()).filter(Boolean);
      const cssClasses = ['bc-peso', 'bc-color', 'bc-talla'];
      segs.forEach((seg, idx) => { const cls = cssClasses[idx] || 'bc-v'; parts.push(`<span class="bc-item ${cls}">${escapeHtml(seg)}</span>`); });
    } else {
      const partsArr = variantPart.split(' - ').map(s=>s.trim());
      if (partsArr.length === 2) {
         parts.push(`<span class="bc-item bc-peso">${escapeHtml(partsArr[0])}</span>`);
         const res = extractColorSize(partsArr[1]);
         if (res.color) parts.push(`<span class="bc-item bc-color">${escapeHtml(res.color)}</span>`);
         if (res.size) parts.push(`<span class="bc-item bc-talla">${escapeHtml(res.size)}</span>`);
      } else {
         const res = extractColorSize(variantPart);
         if (res.color) parts.push(`<span class="bc-item bc-color">${escapeHtml(res.color)}</span>`);
         if (res.size) parts.push(`<span class="bc-item bc-talla">${escapeHtml(res.size)}</span>`);
      }
    }
  }
  const sep = '<span class="bc-sep">▸</span>';
  return `<div class="breadcrumb-container">${parts.join(sep)}</div>`;
}

function renderInventario(){
  const search=document.getElementById('search').value.toLowerCase();
  const parent=document.getElementById('filter-parent').value;
  const status=document.getElementById('filter-status').value;
  const minQty=parseInt(document.getElementById('filter-qty-min').value);
  const maxQty=parseInt(document.getElementById('filter-qty-max').value);
  const checkedSubcats = [...document.querySelectorAll('#filter-subcats-container input:checked')].map(i=>i.value);
  let filtered=productos.filter(p=>{
    const ms = coincideBusqueda([p.nombre, p.sku, p.notas_internas, p.proveedores_alternativos], search);
    if(!ms) return false;
    if(parent && !p.categoria.startsWith(parent)) return false;
    if(checkedSubcats.length > 0) {
      const parts = p.categoria.split(' › ');
      const matchSub = checkedSubcats.some(s => parts.includes(s));
      if(!matchSub) return false;
    }
    if(!isNaN(minQty) && p.qty < minQty) return false;
    if(!isNaN(maxQty) && p.qty > maxQty) return false;
    if(status && getStatus(p.qty,p.min_stock)!==status) return false;
    return true;
  });
  const groups = {};
  filtered.forEach(p => {
    const isNewFormat = p.nombre.includes('>');
    const baseName = isNewFormat ? p.nombre.split('>')[0].trim() : p.nombre.split(' - ')[0].trim();
    const key = `${baseName}||${p.categoria}`;
    let color = 'Único';
    const sep = isNewFormat ? '>' : ' - ';
    const variantPart = p.nombre.includes(sep) ? p.nombre.substring(p.nombre.indexOf(sep) + sep.length).trim() : '';
    if (variantPart) { color = extractColorSize(variantPart).color; }
    if (!groups[key]) {
      groups[key] = { baseName, categoria: p.categoria, totalQty: 0, totalCosto: 0, totalVendido: 0, minStock: 0, lowCount: 0, outCount: 0, colors: {} };
    }
    if (!groups[key].colors[color]) { groups[key].colors[color] = { items: [], totalQty: 0 }; }
    const g = groups[key];
    const cg = g.colors[color];
    cg.items.push(p);
    cg.totalQty += p.qty;
    g.totalQty += p.qty;
    g.totalCosto += (p.costo || 0) * p.qty;
    g.totalVendido += (window.globalSalesMap[p.nombre] || 0);
    const s = getStatus(p.qty, p.min_stock);
    if(s === 'low') g.lowCount++;
    if(s === 'out') g.outCount++;
    g.minStock = Math.max(g.minStock, p.min_stock);
  });
  const tbody=document.getElementById('inv-body');
  tbody.innerHTML='';
  const groupKeys = Object.keys(groups).sort((a, b) => groups[b].totalQty - groups[a].totalQty);
  if(groupKeys.length===0){
    document.getElementById('inv-empty').style.display='block';
    document.getElementById('inv-table').style.display='none';
  } else {
    document.getElementById('inv-empty').style.display='none';
    document.getElementById('inv-table').style.display='';
    groupKeys.forEach(key => {
      const g = groups[key];
      const hasMultiple = Object.keys(g.colors).length > 1 || Object.values(g.colors)[0].items.length > 1;
      if (hasMultiple && !window.collapsedGroups.has(key) && !window.expandedByUser.has(key)) { window.collapsedGroups.add(key); }
      const isCollapsed = window.collapsedGroups.has(key);
      const tr = document.createElement('tr');
      tr.className = 'row-parent';
      tr.innerHTML = `
        <td>
          <div class="indent-content">
            <span class="toggle-btn ${isCollapsed ? 'collapsed' : ''}" onclick="toggleGroup('${escapeJsAttr(key)}')">
              ${isCollapsed ? '▶' : '▼'}
            </span>
            <div class="parent-name" onclick="toggleGroup('${escapeJsAttr(key)}')" style="cursor:pointer">
              ${renderBreadcrumb(g.baseName, g.categoria)}
            </div>
          </div>
        </td>
        <td>${escapeHtml(g.categoria)}</td>
        <td><span class="chip">${Object.keys(g.colors).length} colores</span></td>
        <td>
          <span class="aggregate-qty">${g.totalQty}</span>
          ${g.lowCount > 0 ? `<span class="mini-badge badge-low" title="${g.lowCount} variantes con stock bajo">⚠️${g.lowCount}</span>` : ''}
          ${g.outCount > 0 ? `<span class="mini-badge badge-out" title="${g.outCount} variantes sin stock">❌${g.outCount}</span>` : ''}
        </td>
        <td><span class="aggregate-cost" title="Costo total de stock actual">${mxn(g.totalCosto)}</span></td>
        <td><span class="aggregate-venta" title="Total vendido históricamente">${mxn(g.totalVendido)}</span></td>
        <td>${statusBadge(g.totalQty, g.minStock)}</td>
        <td>
          <button class="btn btn-sm btn-success" style="font-size:0.78rem; padding:3px 8px; white-space:nowrap;" onclick="abrirModalVariante('${escapeJsAttr(g.baseName)}', '${escapeJsAttr(g.categoria)}', 'color')" title="Agregar nuevo color a este producto">🎨 + Color</button>
        </td>
      `;
      tbody.appendChild(tr);
      if (!isCollapsed) {
        const coloresOrdenados = Object.keys(g.colors).sort((a, b) => {
          const diff = g.colors[b].totalQty - g.colors[a].totalQty;
          if (diff !== 0) return diff;
          return a.localeCompare(b, 'es');
        });
        coloresOrdenados.forEach(colorName => {
          const cg = g.colors[colorName];
          const colorKey = `${key}||${colorName}`;
          if (Object.keys(g.colors).length > 1 && !window.collapsedGroups.has(colorKey) && !window.expandedByUser.has(colorKey)) { window.collapsedGroups.add(colorKey); }
          const isColorCollapsed = window.collapsedGroups.has(colorKey);
          if (Object.keys(g.colors).length > 1 || colorName !== 'Único') {
            const trColor = document.createElement('tr');
            trColor.className = 'row-subgroup';
            const cgCosto = cg.items.reduce((a, x) => a + (x.costo * x.qty), 0);
            const cgVendido = cg.items.reduce((a, x) => a + (window.globalSalesMap[x.nombre] || 0), 0);
            trColor.innerHTML = `
              <td style="padding-left: 30px;">
                <span class="toggle-btn ${isColorCollapsed ? 'collapsed' : ''}" onclick="toggleGroup('${escapeJsAttr(colorKey)}')">
                  ${isColorCollapsed ? '▶' : '▼'}
                </span>
                <span class="bc-item bc-color" style="cursor:pointer" onclick="toggleGroup('${escapeJsAttr(colorKey)}')">${escapeHtml(colorName)}</span>
              </td>
              <td>—</td>
              <td><span style="font-size:0.8rem; color:#888;">${cg.items.length} tallas</span></td>
              <td style="font-weight:600;">${cg.totalQty}</td>
              <td class="aggregate-cost" title="Costo stock este color">${mxn(cgCosto)}</td>
              <td class="aggregate-venta" title="Vendido este color">${mxn(cgVendido)}</td>
              <td>—</td><td>
                <button class="btn btn-sm btn-info" style="font-size:0.78rem; padding:3px 8px; white-space:nowrap; color:white;" onclick="abrirModalVariante('${escapeJsAttr(key.split('||')[0])}', '${escapeJsAttr(g.categoria)}', 'talla', '${escapeJsAttr(colorName)}')">📐 + Talla</button>
              </td>
            `;
            tbody.appendChild(trColor);
          }
          if (!isColorCollapsed || (Object.keys(g.colors).length === 1 && colorName === 'Único')) {
            cg.items.sort((a,b) => getSizeWeight(a.nombre) - getSizeWeight(b.nombre));
            cg.items.forEach(p => {
              let variantName = p.nombre.replace(g.baseName, '').replace(/^[>\-\s▸]+/, '').trim() || 'Estándar';
              variantName = variantName.replace(/^Peso\s+\S+\s*-\s*/i, '').trim();
              if (colorName !== 'Único' && variantName.toLowerCase().includes(colorName.toLowerCase())) {
                const regex = new RegExp(colorName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
                variantName = variantName.replace(regex, '').replace(/^[>\-\s▸]+/, '').trim() || 'Único';
              }
              const trChild = document.createElement('tr');
              trChild.className = 'row-child';
              trChild.innerHTML = `
                <td style="padding-left: 50px;">
                  ${renderBreadcrumb(p.nombre, p.categoria)}
                  ${p.sku ? `<small style="color:#aaa; display:block; margin-left:15px; margin-top:2px;">SKU: ${escapeHtml(p.sku)}</small>` : ''}
                  <div class="product-info-extra">
                    ${p.proveedores_alternativos ? `<span class="extra-supplier" title="Proveedores Alternativos: ${escapeHtml(p.proveedores_alternativos)}">🏭 ${escapeHtml(p.proveedores_alternativos)}</span>` : ''}
                    ${p.notas_internas ? `<span class="extra-notes" title="Notas Internas: ${escapeHtml(p.notas_internas)}">📝 Ver notas</span>` : ''}
                  </div>
                </td>
                <td>${escapeHtml(p.categoria)}</td>
                <td>—</td>
                <td><div class="qty-controls">
                  <button onclick="quickQty(${p.id},-1)">−</button>
                  <span>${p.qty}</span>
                  <button onclick="quickQty(${p.id},1)">+</button>
                </div></td>
                <td>${mxn(p.costo)}</td><td>${mxn(p.venta)}</td>
                <td>${statusBadge(p.qty, p.min_stock)}</td>
                <td>
                  <button class="btn btn-sm btn-outline" style="border-color:#e2e8f0; color:#475569; margin-right:4px;" onclick="imprimirEtiqueta(${p.id})" title="Imprimir Código de Barras">🏷️</button>
                  <button class="btn btn-sm btn-primary" onclick="editProducto(${p.id})">✏️</button>
                  <button class="btn btn-sm btn-info" style="color:white" onclick="verHistorialPrecios(${p.id}, '${escapeJsAttr(p.nombre)}')" title="Ver Historial de Precios">🕒</button>
                  <button class="btn btn-sm btn-warning" onclick="openAjuste(${p.id})" title="Ajuste">📥</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteProducto(${p.id})">🗑️</button>
                </td>
              `;
              tbody.appendChild(trChild);
            });
          }
        });
      }
    });
  }
  document.getElementById('s-total').textContent = productos.length;
  document.getElementById('s-stock').textContent = productos.filter(p => p.qty > 0).length;
  document.getElementById('s-unidades').textContent = productos.reduce((a, p) => a + p.qty, 0);
  const lowCount = productos.filter(p => getStatus(p.qty, p.min_stock) !== 'ok').length;
  document.getElementById('s-low').textContent = lowCount;
  const val = productos.reduce((a, p) => a + (p.qty * p.costo), 0);
  document.getElementById('s-valor').textContent = mxn(val);

  // Burbuja de Notificaciones
  updateNotifBadge();
}

async function updateNotifBadge() {
  const badge = document.getElementById('bell-badge');
  if (!badge) return;
  try {
    const data = await req('GET', '/notificaciones');
    const unread = data.filter(n => !n.leida).length;
    if (unread > 0) {
      badge.style.display = 'block';
      badge.textContent = unread;
    } else {
      badge.style.display = 'none';
    }
  } catch (e) { console.error('Error notificaciones:', e); }
}

window.expandedByUser = new Set();

window.toggleGroup = function(key) {
  if (window.collapsedGroups.has(key)) {
    window.collapsedGroups.delete(key);
    window.expandedByUser.add(key);
  } else {
    window.collapsedGroups.add(key);
    window.expandedByUser.delete(key);
  }
  renderInventario();
};

async function quickQty(id,delta){
  try{
    const p=await req('PATCH',`/productos/${id}/qty?delta=${delta}`);
    const idx=productos.findIndex(x=>x.id===id);
    if(idx>=0) productos[idx]=p;
    renderInventario();
  }
  catch(e){ toast(e.message,false); }
}

let confirmCallback = null;
window.showConfirm = function(msg, onOk) {
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = onOk;
  document.getElementById('overlay-confirm').classList.add('active');
  document.getElementById('btn-confirm-ok').onclick = () => { closeConfirm(true); };
};

window.closeConfirm = function(ok) {
  document.getElementById('overlay-confirm').classList.remove('active');
  if (ok && confirmCallback) confirmCallback();
  confirmCallback = null;
};

function openModal(type){
  document.getElementById('overlay-'+type).classList.add('active');
  if(type==='producto' && !editingId) {
    const c=document.getElementById('mp-cat');
    if(c){ c.value=''; if(window.verificarAsistenteRopa) verificarAsistenteRopa(); }
  }
  if(type==='descuento' && !editingId) {
    document.getElementById('md-title').textContent = 'Nuevo Cupón';
    document.getElementById('md-id').value = '';
    document.getElementById('md-codigo').value = '';
    document.getElementById('md-tipo').value = 'porcentaje';
    document.getElementById('md-valor').value = '';
    document.getElementById('md-min-items').value = 1;
    document.getElementById('md-activo').value = '1';
    document.getElementById('md-barcode').value = '';
  }
  if(type==='producto' && !editingId) {
    document.getElementById('mp-notas-internas').value = '';
    document.getElementById('mp-proveedores-alt').value = '';
  }
}
function closeModal(type){ document.getElementById('overlay-'+type).classList.remove('active'); editingId=null; }

function addVariantField(val='', sku=''){
  const div=document.createElement('div');div.className='variant-row';
  div.innerHTML=`
    <input type="text" placeholder="Ej: M - Rojo" value="${escapeHtml(val)}" style="flex:2"/>
    <input type="text" placeholder="SKU" value="${escapeHtml(sku)}" style="flex:1"/>
    <button onclick="this.parentNode.remove()">×</button>
  `;
  document.getElementById('variants-list').appendChild(div);
}

async function saveProducto(){
  const nombreBase=document.getElementById('mp-nombre').value.trim();
  if(!nombreBase){toast('El nombre es obligatorio',false);return;}
  const variantsRows = [...document.querySelectorAll('#variants-list .variant-row')];
  const variantsData = variantsRows.map(row => {
    const inputs = row.querySelectorAll('input');
    return { val: inputs[0].value.trim(), sku: inputs[1].value.trim() };
  }).filter(v => v.val);
  const commonData = {
    categoria:document.getElementById('mp-cat').value,
    qty:parseInt(document.getElementById('mp-qty').value)||0,
    min_stock:parseInt(document.getElementById('mp-min').value)||0,
    costo: parseFloat(document.getElementById('mp-costo').value)||0,
    costo_menudeo: parseFloat(document.getElementById('mp-costo-menudeo').value)||0,
    venta: parseFloat(document.getElementById('mp-venta').value)||0,
    notas_internas: document.getElementById('mp-notas-internas').value.trim(),
    proveedores_alternativos: document.getElementById('mp-proveedores-alt').value.trim(),
    variantes: variantsData
  };
  try {
    if (variantsData.length > 0) {
      toast(`Generando ${variantsData.length} productos...`);
      for (const v of variantsData) {
        // Al generar hijos, no les incrustamos el array de variantes completo
        const fullData = { ...commonData, nombre: `${nombreBase} - ${v.val}`, sku: v.sku, variantes: [] };
        const p = await req('POST', '/productos', fullData);
        productos.push(p);
      }
      toast('✅ Variantes creadas correctamente');
    } else {
      const data = { ...commonData, nombre: nombreBase, sku: document.getElementById('mp-sku').value.trim() };
      if (editingId) {
        const p = await req('PUT', `/productos/${editingId}`, data);
        const idx = productos.findIndex(x => x.id === editingId);
        if (idx >= 0) productos[idx] = p;
        toast('✅ Producto actualizado');
      } else {
        const p = await req('POST', '/productos', data);
        productos.push(p);
        toast('✅ Producto guardado');
      }
    }
    
    // Si estábamos editando y además generamos variantes, asegurarnos de actualizar el producto base
    if (editingId && variantsData.length > 0) {
      const data = { ...commonData, nombre: nombreBase, sku: document.getElementById('mp-sku').value.trim() };
      const p = await req('PUT', `/productos/${editingId}`, data);
      const idx = productos.findIndex(x => x.id === editingId);
      if (idx >= 0) productos[idx] = p;
      toast('✅ Producto base actualizado y variantes generadas');
    }

    closeModal('producto');
    renderInventario();
  } catch (err) {
    toast(`❌ Error al guardar: ${err.message}`, false);
  }
}

function editProducto(id){
  const p=productos.find(x=>x.id===id);if(!p)return;
  editingId=id;
  document.getElementById('mp-title').textContent='Editar Producto';
  document.getElementById('mp-nombre').value=p.nombre;
  document.getElementById('mp-sku').value=p.sku||'';
  document.getElementById('mp-cat').value=p.categoria;
  if(window.verificarAsistenteRopa) verificarAsistenteRopa();
  document.getElementById('mp-qty').value=p.qty;
  document.getElementById('mp-min').value=p.min_stock;
  document.getElementById('mp-costo').value = p.costo;
  document.getElementById('mp-costo-menudeo').value = p.costo_menudeo || 0;
  document.getElementById('mp-venta').value = p.venta;
  document.getElementById('mp-notas-internas').value = p.notas_internas || '';
  document.getElementById('mp-proveedores-alt').value = p.proveedores_alternativos || '';
  document.getElementById('variants-list').innerHTML = '';
  (p.variantes||[]).forEach(v => {
    if (typeof v === 'object' && v !== null) {
      addVariantField(v.val || '', v.sku || '');
    } else {
      addVariantField(v, '');
    }
  });
  openModal('producto');
}

async function deleteProducto(id){
  showConfirm('¿Seguro que deseas eliminar este producto?', async () => {
    try{
      await req('DELETE',`/productos/${id}`);
      productos=productos.filter(p=>p.id!==id);
      renderInventario();
      toast('✅ Producto eliminado');
    }
    catch(e){toast(e.message,false);}
  });
}

function openAjuste(id){
  const p=productos.find(x=>x.id===id);if(!p)return;
  ajusteId=id;
  document.getElementById('aj-nombre').value=p.nombre;
  document.getElementById('aj-actual').value=p.qty;
  document.getElementById('aj-nueva').value=p.qty;
  document.getElementById('aj-notas').value='';
  openModal('ajuste');
}

async function saveAjuste(){
  try{
    const p=await req('POST',`/productos/${ajusteId}/ajuste`,{
      nueva_qty:parseInt(document.getElementById('aj-nueva').value)||0,
      motivo:document.getElementById('aj-motivo').value,
      notas:document.getElementById('aj-notas').value
    });
    const idx=productos.findIndex(x=>x.id===ajusteId);
    if(idx>=0)productos[idx].qty=parseInt(document.getElementById('aj-nueva').value)||0;
    closeModal('ajuste');renderInventario();toast('Ajuste aplicado');
  }catch(e){toast(e.message,false);}
}

async function renderVentas(){
  const hoy=new Date().toDateString();
  const mes=new Date().getMonth();
  try{
    const movs=await req('GET',`/movimientos?tipo=venta&skip=0&limit=1000`);
    const ventasHoy=movs.filter(h=>new Date(h.fecha).toDateString()===hoy);
    const ventasMes=movs.filter(h=>new Date(h.fecha).getMonth()===mes);
    document.getElementById('v-hoy').textContent=ventasHoy.reduce((a,h)=>a+h.qty,0);
    document.getElementById('v-ing-hoy').textContent=mxn(ventasHoy.reduce((a,h)=>a+(h.precio*h.qty),0));
    document.getElementById('v-mes').textContent=ventasMes.reduce((a,h)=>a+h.qty,0);
    document.getElementById('v-ing-mes').textContent=mxn(ventasMes.reduce((a,h)=>a+(h.precio*h.qty),0));
  }catch(e){}
  if (window.onFiltrarCategoria) {
      onFiltrarCategoria();
  } else {
      const sel=document.getElementById('v-producto');
      sel.innerHTML='<option value="">-- Selecciona --</option>';
      productos.forEach(p=>{
        const o=document.createElement('option');
        o.value=p.id;
        o.textContent=p.nombre+' (Stock: '+p.qty+')';
        sel.appendChild(o);
      });
  }
}

window.onBuscarSKU = function(val) {
   const sku = val.trim().toLowerCase();
   if (!sku) { onFiltrarCategoria(); return; }
   const p = productos.find(x => (x.sku||'').toLowerCase() === sku);
   if (p) { document.getElementById('v-producto').value = p.id; onProductoVenta(); }
   else { onFiltrarCategoria(); }
};

window.onFiltrarCategoria = function() {
   const text = (document.getElementById('v-filtro-cat')?.value || '').trim().toLowerCase();
   const skuText = (document.getElementById('v-scan-sku')?.value || '').trim().toLowerCase();
   const sel = document.getElementById('v-producto');
   const oldVal = sel.value;
   sel.innerHTML = '<option value="">-- Selecciona --</option>';
   let matches = productos;
   if(text) matches = matches.filter(p => coincideBusqueda([p.nombre, p.categoria], text));
   if(skuText) matches = matches.filter(p => coincideBusqueda([p.sku], skuText));
   matches.forEach(p => {
       const o=document.createElement('option');
       o.value=p.id;
       o.textContent=p.nombre + ' (' + (p.sku||'Sin SKU') + ') - Stock: ' + p.qty;
       sel.appendChild(o);
   });
   if (oldVal && matches.find(p => p.id == oldVal)) sel.value = oldVal;
};

function onProductoVenta(){
  const id=parseInt(document.getElementById('v-producto').value);
  const p=productos.find(x=>x.id===id);
  const vg=document.getElementById('v-variante-group');
  if(p&&p.variantes&&p.variantes.length>0){
    const vsel=document.getElementById('v-variante');
    vsel.innerHTML='<option value="">Sin especificar</option>';
    p.variantes.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;vsel.appendChild(o);});
    vg.style.display='block';
  } else {vg.style.display='none';}
}

window.cuponAplicado = null;

window.onScannerEnter = async function(val) {
   const sku = val.trim().toLowerCase();
   if (!sku) return;
   const p = productos.find(x => (x.sku||'').toLowerCase() === sku);
   if (p) {
       document.getElementById('v-producto').value = p.id;
       onProductoVenta(); 
       document.getElementById('v-qty').value = 1; 
       agregarAlCarrito();
       toast(`✅ Escaneado: ${p.nombre}`);
   } else {
       await aplicarDescuentoPOS(val);
   }
};

window.aplicarDescuentoPOS = async function(codigoInput) {
  const codigo = (codigoInput || document.getElementById('v-cupon').value).trim().toUpperCase();
  if (!codigo) return;
  
  if (!codigoInput) document.getElementById('v-cupon').value = '';

  const totalItems = window.cart.reduce((a, x) => a + x.qty, 0);
  if (totalItems === 0) {
    toast('Agrega productos al carrito antes de aplicar un cupón', false);
    return;
  }

  try {
    const res = await req('GET', `/descuentos/validar/${codigo}?total_items=${totalItems}`);
    if (res.valido) {
      window.cuponAplicado = res;
      toast(`✅ Cupón ${codigo} aplicado: -${res.tipo === 'porcentaje' ? res.valor + '%' : mxn(res.valor)}`);
      renderCarritoUI();
    } else {
      toast(`❌ ${res.mensaje}`, false);
    }
  } catch (e) {
    toast(`❌ Error validando cupón: ${e.message}`, false);
  }
};

window.removerCupon = function() {
  window.cuponAplicado = null;
  renderCarritoUI();
  toast('Cupón removido');
};

window.cart = [];

window.agregarAlCarrito = function() {
  const id=parseInt(document.getElementById('v-producto').value);
  if(!id){toast('Selecciona un producto',false);return;}
  const p=productos.find(x=>x.id===id);
  const qty=parseInt(document.getElementById('v-qty').value)||1;
  const precio=parseFloat(document.getElementById('v-precio').value)||0;
  window.cart.push({ producto_id: p.id, nombre: p.nombre, sku: p.sku || '', qty, precio });
  renderCarritoUI();
  document.getElementById('v-scan-sku').value = '';
  document.getElementById('v-qty').value = 1;
  document.getElementById('v-precio').value = 0;
  document.getElementById('v-producto').value = '';
  const f = document.getElementById('v-filtro-cat');
  if(f) f.value = '';
  if(window.onFiltrarCategoria) onFiltrarCategoria();
};

window.eliminarDelCarrito = function(index) {
  window.cart.splice(index, 1);
  renderCarritoUI();
};

window.renderCarritoUI = function() {
  const list = document.getElementById('cart-list');
  const subtotalEl = document.getElementById('cart-subtotal');
  const totalEl = document.getElementById('cart-total');
  const cuponDiv = document.getElementById('cupon-aplicado');
  
  if(!list) return;
  list.innerHTML = '';
  
  if(window.cart.length === 0) {
    list.innerHTML = '<div style="color:#aaa; text-align:center; padding: 20px;">Carrito vacío</div>';
    subtotalEl.textContent = '$0.00';
    totalEl.textContent = '$0.00';
    cuponDiv.style.display = 'none';
    window.cuponAplicado = null;
    return;
  }

  let subtotal = 0;
  window.cart.forEach((c, i) => {
    subtotal += (c.qty * c.precio);
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';
    div.style.padding = '8px 0';
    div.style.borderBottom = '1px dashed #eee';
    div.innerHTML = `
      <div style="flex:1">
         <div style="font-size:0.9rem; font-weight:600">${escapeHtml(c.nombre)} <small>(${escapeHtml(c.sku)})</small></div>
         <div style="font-size:0.8rem; color:#666">${c.qty}x ${mxn(c.precio)} = <strong>${mxn(c.qty*c.precio)}</strong></div>
      </div>
      <button class="btn btn-sm btn-outline" style="padding: 2px 6px; border-color: red; color: red;" onclick="eliminarDelCarrito(${i})">🗑️</button>
    `;
    list.appendChild(div);
  });

  subtotalEl.textContent = mxn(subtotal);
  
  let total = subtotal;
  if (window.cuponAplicado) {
    let descVal = 0;
    if (window.cuponAplicado.tipo === 'porcentaje') {
      descVal = subtotal * (window.cuponAplicado.valor / 100);
    } else {
      descVal = window.cuponAplicado.valor;
    }
    total = Math.max(0, subtotal - descVal);
    
    cuponDiv.style.display = 'flex';
    cuponDiv.innerHTML = `
      <span>🏷️ Cupón: <strong>${escapeHtml(window.cuponAplicado.codigo)}</strong> (-${mxn(descVal)})</span>
      <span class="remove-cupon" onclick="removerCupon()" title="Remover cupón">×</span>
    `;
  } else {
    cuponDiv.style.display = 'none';
  }

  totalEl.textContent = mxn(total);
};

window.procesarCobro = async function() {
  if(window.cart.length === 0){toast('El carrito está vacío',false);return;}
  const canal=document.getElementById('v-canal').value;
  const userNotas=document.getElementById('v-notas').value.trim();
  
  const now = new Date();
  const pad = (n, l=2) => String(n).padStart(l, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const canalFolio = canal.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ticketId = `${datePart}-${canalFolio}-${timePart}`;
  
  let cuponInfo = '';
  if (window.cuponAplicado) {
    const descStr = window.cuponAplicado.tipo === 'porcentaje' ? window.cuponAplicado.valor + '%' : mxn(window.cuponAplicado.valor);
    cuponInfo = ` [CUPÓN: ${window.cuponAplicado.codigo} (${descStr} DESC)]`;
  }
  const finalNotas = ticketId + cuponInfo + (userNotas ? ' | ' + userNotas : '');
  toast('Procesando cobro...');
  try {
    for (const c of window.cart) {
       const data={ producto_id: c.producto_id, variante: '', qty: c.qty, precio: c.precio, canal, notas: finalNotas };
       await req('POST','/ventas',data);
    }
    const ticketData = { fecha: now.toISOString(), canal, folio: ticketId, notas: finalNotas, detalles: window.cart.map(c => ({ producto_nombre: c.nombre, sku: c.sku, qty: c.qty, precio: c.precio })) };
    generarTicketMulti(ticketData);
    await loadProductos();
    renderVentas();
    renderVentasRecientes();
    renderInventario();
    document.getElementById('v-notas').value='';
    window.cart = [];
    renderCarritoUI();
    toast('Venta múltiple registrada con éxito', true);
  } catch(e) {
    toast('Error en cobro: ' + e.message, false);
  }
};

window.descargarTicketMulti = function(h_json) {
  const h = JSON.parse(decodeURIComponent(h_json));
  generarTicketMulti(h);
};

window.generarTicketMulti = function(h) {
  if (!window.jspdf) { toast('Error: librería jsPDF no cargada. Recarga la página.', false); return; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 250] });
    const buildPDF = (hasLogo, imgElement) => {
      try {
        let currentY = 15;
        if (hasLogo && imgElement) { doc.addImage(imgElement, 'PNG', 20, 5, 40, 40); currentY = 50; }
        else { doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Kromo Pinceles', 40, currentY, { align: 'center' }); currentY += 7; }
        doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text('TICKET DE COMPRA', 40, currentY, { align: 'center' }); currentY += 6;
        
        const folio = h.folio || (h.notas ? h.notas.split(' ')[0] : '');
        if (folio) { doc.setFontSize(7); doc.text('Folio: ' + folio, 40, currentY, { align: 'center' }); currentY += 4; }
        
        const fechaStr = h.fecha ? new Date(h.fecha).toLocaleString('es-MX') : new Date().toLocaleString('es-MX');
        doc.setFontSize(8); doc.text('Fecha: ' + fechaStr, 40, currentY, { align: 'center' }); currentY += 4;
        doc.line(5, currentY, 75, currentY); currentY += 6;
        doc.setFont('helvetica', 'bold'); doc.text('Detalle de la compra:', 5, currentY); doc.setFont('helvetica', 'normal'); currentY += 6;
        let totalGrid = 0;
        (h.detalles || h.cart || []).forEach(d => {
           const prodName = d.producto_nombre || 'Producto';
           const splitName = doc.splitTextToSize('Prod: ' + prodName, 70);
           doc.text(splitName, 5, currentY); currentY += splitName.length * 4;
           if (d.sku) { doc.text('SKU: ' + d.sku, 5, currentY); currentY += 4; }
           if (d.variante) { doc.text('Variante: ' + d.variante, 5, currentY); currentY += 4; }
           const subtotal = d.qty * d.precio; totalGrid += subtotal;
           doc.text(`${d.qty}x ${mxn(d.precio)} = ${mxn(subtotal)}`, 5, currentY); currentY += 6;
           doc.setLineDashPattern([1, 1], 0); doc.line(5, currentY, 75, currentY); doc.setLineDashPattern([], 0); currentY += 4;
        });
        currentY += 2; doc.setFont('helvetica', 'bold'); doc.text('TOTAL: ' + mxn(totalGrid), 75, currentY, { align: 'right' });
        if (h.notas) { currentY += 8; doc.setFont('helvetica', 'italic'); doc.setFontSize(7); const splitNotas = doc.splitTextToSize('Notas: ' + h.notas, 70); doc.text(splitNotas, 5, currentY); currentY += splitNotas.length * 4; }
        currentY += 10; doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('¡Gracias por su compra!', 40, currentY, { align: 'center' });
        const timestamp = h.fecha ? new Date(h.fecha).getTime() : new Date().getTime();
        const filename = 'Ticket_Venta_' + timestamp + '.pdf';
        try { const blob = doc.output('blob'); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        catch(dlErr) { doc.save(filename); }
        toast('Ticket PDF generado ✅');
      } catch(buildErr) { console.error('Error generando PDF:', buildErr); toast('Error al generar PDF: ' + buildErr.message, false); }
    };
    let pdfGenerated = false;
    const safeBuild = (hasLogo, img) => { if (!pdfGenerated) { pdfGenerated = true; buildPDF(hasLogo, img); } };
    const logo = new Image(); logo.onload = () => safeBuild(true, logo); logo.onerror = () => safeBuild(false, null); logo.src = 'logo.png';
    setTimeout(() => safeBuild(false, null), 500);
  } catch(e) { console.error('Error inicializando PDF:', e); toast('Error al inicializar PDF: ' + e.message, false); }
};

async function renderHistorial(){
  const tipo=document.getElementById('h-tipo').value;
  const search=document.getElementById('h-search').value.toLowerCase();
  const query = `/movimientos?skip=${skipMovimientos}&limit=${limitMovimientos}` + (tipo ? `&tipo=${tipo}` : '');
  try{
    let items=await req('GET', query);
    if(search) items=items.filter(h=>coincideBusqueda([h.producto_nombre, h.notas], search));
    const ticketsG = {}; const finalItems = [];
    items.forEach(h=>{
       if (h.tipo === 'venta' && h.notas && h.notas.startsWith('TICKET-')) {
          const tid = h.notas.split(' | ')[0];
          if(!ticketsG[tid]) { ticketsG[tid] = { ...h, isGroup: true, detalles: [], totalPrecio: 0, producto_nombre: 'Múltiples Artículos' }; finalItems.push(ticketsG[tid]); }
          ticketsG[tid].detalles.push({ producto_nombre: h.producto_nombre, sku: (productos.find(x=>x.id===h.producto_id)||{}).sku, qty: h.qty, precio: h.precio, variante: h.variante });
          ticketsG[tid].totalPrecio += (h.precio * h.qty);
       } else { finalItems.push(h); }
    });
    const list=document.getElementById('hist-list'); list.innerHTML='';
    if(finalItems.length===0){document.getElementById('hist-empty').style.display='block';return;}
    document.getElementById('hist-empty').style.display='none';
    finalItems.forEach(h=>{
      const icon=h.tipo==='venta'?'💰':h.tipo==='entrada'?'📦':'🔧';
      const badge=h.tipo==='venta'?'badge-sale':h.tipo==='entrada'?'badge-in':'badge-adj';
      const label=h.tipo==='venta'?'Venta':h.tipo==='entrada'?'Entrada':'Ajuste';
      const fecha=new Date(h.fecha).toLocaleString('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const div=document.createElement('div');div.className='hist-item';
      let p_name = h.isGroup ? `Folio: ${(h.notas || '').split(' | ')[0]} (${h.detalles.length} acts)` : `${h.producto_nombre}${h.variante?' — '+h.variante:''}`;
      let p_val = h.isGroup ? mxn(h.totalPrecio) : (h.precio>0?mxn(h.precio*h.qty):'');
      let t_btn = '';
      if (h.tipo === 'venta') {
         if (h.isGroup) { t_btn = `<button class="btn btn-sm btn-outline" style="margin-top:5px; font-size:0.7rem; padding: 3px 6px;" onclick="descargarTicketMulti('${escapeJsAttr(encodeURIComponent(JSON.stringify(h)))}')">📄 Ticket Múltiple</button>`; }
         else { h.detalles = [{ producto_nombre: h.producto_nombre, sku: (productos.find(x=>x.id===h.producto_id)||{}).sku, qty: h.qty, precio: h.precio, variante: h.variante }]; t_btn = `<button class="btn btn-sm btn-outline" style="margin-top:5px; font-size:0.7rem; padding: 3px 6px;" onclick="descargarTicketMulti('${escapeJsAttr(encodeURIComponent(JSON.stringify(h)))}')">📄 Ticket</button>`; }
      }
      div.innerHTML=`<div class="hist-icon">${icon}</div>
        <div class="hist-info"><strong>${escapeHtml(p_name)}</strong>
        <small>${escapeHtml(h.canal)}${h.notas?' · '+escapeHtml(h.notas):''}</small></div>
        <div class="hist-meta"><span class="badge ${badge}">${label}</span><br>
        <span style="font-weight:600">${h.tipo==='venta'?'-':'+'}${h.isGroup ? '' : h.qty + ' unidades'}</span><br>
        ${p_val}<br>
        <small style="color:#bbb">${fecha}</small><br>
        ${t_btn}
        </div>`;
      list.appendChild(div);
    });
  }catch(e){toast(e.message,false);}
}

async function renderReporte(){
  const desde = document.getElementById('r-desde').value;
  const hasta = document.getElementById('r-hasta').value;
  if (desde && hasta && desde > hasta) { toast('La fecha inicial no puede ser mayor que la final', false); return; }
  let url = '/reporte';
  const params = [];
  if(desde) params.push(`desde=${desde}`);
  if(hasta) params.push(`hasta=${hasta}`);
  if(params.length > 0) url += '?' + params.join('&');
  try{
    const r=await req('GET', url);
    document.getElementById('r-ingresos').textContent=mxn(r.ingresos);
    document.getElementById('r-costo').textContent=mxn(r.costo_vendido);
    document.getElementById('r-ganancia').textContent=mxn(r.ganancia);
    document.getElementById('r-unidades').textContent=r.unidades;
    const tbody=document.getElementById('r-body');tbody.innerHTML='';
    if(r.top_productos.length===0){document.getElementById('r-empty').style.display='block';document.getElementById('r-table').style.display='none';return;}
    document.getElementById('r-empty').style.display='none';document.getElementById('r-table').style.display='';
    r.top_productos.forEach(p=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td><strong>${escapeHtml(p.nombre)}</strong></td><td>${p.qty}</td><td>${mxn(p.ingresos)}</td><td style="color:#16a34a;font-weight:600">${mxn(p.ingresos-p.costo)}</td>`; tbody.appendChild(tr); });
  }catch(e){toast(e.message,false);}
}

window.resetReportDates = function() { document.getElementById('r-desde').value = ''; document.getElementById('r-hasta').value = ''; renderReporte(); };

/**
 * ── SISTEMA DE NAVEGACIÓN CONSOLIDADO ────────────────────────────────
 * Maneja el cambio de páginas, actualización del sidebar y carga de datos.
 * Actualizado: 2026-03-31 (Consolidación de funciones duplicadas)
 */
window.showPage = async function(id, btn) {
  // Respaldos es ahora una pestaña dentro de Auditoría
  if (id === 'backups') {
    await window.showPage('logs', btn);
    const tabBtn = document.querySelector('.audit-tab[data-tab="backups"]');
    if (tabBtn) window.switchAuditTab('backups', tabBtn);
    return;
  }

  // Ocultar todas las páginas
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  
  // Mostrar la página seleccionada
  const pg = document.getElementById('page-' + id);
  if (pg) pg.classList.add('active');
  
  // Actualizar estado activo en el sidebar
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const navBtn = document.getElementById('nav-' + id);
    if (navBtn) navBtn.classList.add('active');
  }
  
  // Cargar datos específicos
  try {
    if (id === 'dashboard') {
      if (window.renderDashboard) await window.renderDashboard();
    } else if (id === 'usuarios') {
      if (window.loadUsuarios) await window.loadUsuarios();
    } else if (id === 'inventario') {
      await loadProductos();
      renderInventario();
    } else if (id === 'reporte') {
      await renderReporte();
    } else if (id === 'historial') {
      await renderHistorial();
    } else if (id === 'descuentos') {
      await loadDescuentos();
    } else if (id === 'ordenes_compra') {
      if (window.renderOrdenesCompra) await window.renderOrdenesCompra();
    } else if (id === 'ventas') {
      await renderVentas();
      await renderVentasRecientes();
    } else if (id === 'gestion_ventas') {
      gvSkip = 0;
      await loadVentasAgrupadas();
    } else if (id === 'logs') {
       if(window.loadAuditLogs) await window.loadAuditLogs();
       if(window.loadUserListForLogs) await window.loadUserListForLogs();
       if(window.loadAuditStats) await window.loadAuditStats();
    } else if (id === 'contabilidad') {
       if(window.renderContabilidad) await window.renderContabilidad();
    }
  } catch (err) {
    console.error('Error al cargar página:', id, err);
  }
  
  // Cerrar sidebar móvil
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
};

// ===== VARIANTE RÁPIDA =====
// Estado interno del modal de variante rápida
let _vrState = {
  modo: 'color',        // 'color' | 'talla'
  baseName: '',         // Nombre del grupo padre (ej: "Mandil Parrillero")
  colorBase: '',        // Color base si modo==='talla' (ej: "Negro")
  categoriaBase: '',
  padreRef: null        // Objeto producto de referencia para heredar datos
};

/**
 * Abre el modal de variante rápida.
 * @param {string} baseName   - Nombre base del grupo padre
 * @param {string} categoria  - Categoría del grupo
 * @param {'color'|'talla'} modo - Qué se va a agregar
 * @param {string} [colorBase] - Si modo==='talla', el color padre
 */
window.abrirModalVariante = function(baseName, categoria, modo, colorBase) {
  _vrState.modo = modo;
  _vrState.baseName = baseName;
  _vrState.colorBase = colorBase || '';
  _vrState.categoriaBase = categoria;

  // Buscar un producto de referencia para heredar datos
  const refProd = productos.find(p => {
    const nombre = p.nombre;
    if (modo === 'talla' && colorBase) {
      return nombre.startsWith(baseName) && nombre.toLowerCase().includes(colorBase.toLowerCase());
    }
    return nombre.startsWith(baseName);
  });
  _vrState.padreRef = refProd || null;

  // Rellenar encabezado del modal
  const titleEl = document.getElementById('vr-title');
  const labelEl = document.getElementById('vr-label-nombre');
  const parentNameEl = document.getElementById('vr-parent-name');
  const parentDescEl = document.getElementById('vr-parent-desc');

  if (modo === 'color') {
    titleEl.textContent = '🎨 Agregar Color';
    labelEl.textContent = 'Color';
    parentNameEl.textContent = baseName;
    parentDescEl.textContent = ' — Nuevo color para este producto';
  } else {
    titleEl.textContent = '📐 Agregar Talla';
    labelEl.textContent = 'Talla';
    parentNameEl.textContent = `${baseName} › ${colorBase}`;
    parentDescEl.textContent = ' — Nueva talla para este color';
  }

  // Heredar datos del producto referencia
  document.getElementById('vr-nombre').value = '';
  document.getElementById('vr-sku').value = '';
  document.getElementById('vr-qty').value = '0';
  document.getElementById('vr-categoria').value = categoria;

  if (refProd) {
    document.getElementById('vr-min').value = refProd.min_stock || 2;
    document.getElementById('vr-costo').value = refProd.costo || 0;
    document.getElementById('vr-venta').value = refProd.venta || 0;
  } else {
    document.getElementById('vr-min').value = 2;
    document.getElementById('vr-costo').value = 0;
    document.getElementById('vr-venta').value = 0;
  }

  // Ocultar preview
  document.getElementById('vr-preview-box').style.display = 'none';

  // Preview en tiempo real
  const vrNombreInput = document.getElementById('vr-nombre');
  vrNombreInput.oninput = function() {
    const val = this.value.trim();
    const previewBox = document.getElementById('vr-preview-box');
    const previewNombre = document.getElementById('vr-preview-nombre');
    if (!val) { previewBox.style.display = 'none'; return; }
    let nombreFinal = '';
    if (modo === 'color') {
      nombreFinal = `${baseName} - ${val}`;
    } else {
      nombreFinal = `${baseName} > ${colorBase} > ${val}`;
    }
    previewNombre.textContent = nombreFinal;
    previewBox.style.display = 'block';
  };

  openModal('variante-rapida');
  setTimeout(() => document.getElementById('vr-nombre').focus(), 100);
};

/**
 * Guarda la nueva variante.
 */
window.guardarVarianteRapida = async function() {
  const varNombre = document.getElementById('vr-nombre').value.trim();
  const varSku = document.getElementById('vr-sku').value.trim();
  const qty = parseInt(document.getElementById('vr-qty').value) || 0;
  const venta = parseFloat(document.getElementById('vr-venta').value) || 0;
  const costo = parseFloat(document.getElementById('vr-costo').value) || 0;
  const minStock = parseInt(document.getElementById('vr-min').value) || 0;
  const categoria = document.getElementById('vr-categoria').value;

  if (!varNombre) {
    toast('❌ Debes ingresar el nombre del ' + (_vrState.modo === 'color' ? 'color' : 'talla'), false);
    document.getElementById('vr-nombre').focus();
    return;
  }
  if (venta <= 0) {
    toast('❌ El precio de venta es obligatorio', false);
    document.getElementById('vr-venta').focus();
    return;
  }

  // Construir nombre del producto final
  let nombreFinal = '';
  if (_vrState.modo === 'color') {
    nombreFinal = `${_vrState.baseName} - ${varNombre}`;
  } else {
    nombreFinal = `${_vrState.baseName} > ${_vrState.colorBase} > ${varNombre}`;
  }

  // Generar SKU sugerido si está vacío
  let skuFinal = varSku;
  if (!skuFinal) {
    const ref = _vrState.padreRef;
    if (ref && ref.sku) {
      const baseSku = ref.sku.replace(/-[^-]+$/, '');
      const suffix = varNombre.substring(0, 3).toUpperCase().replace(/\s/g, '');
      skuFinal = `${baseSku}-${suffix}`;
    } else {
      skuFinal = '';
    }
  }

  const btn = document.getElementById('vr-btn-guardar');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const data = {
      nombre: nombreFinal,
      sku: skuFinal,
      categoria: categoria,
      qty: qty,
      min_stock: minStock,
      costo: costo,
      venta: venta,
      notas_internas: _vrState.padreRef ? (_vrState.padreRef.notas_internas || '') : '',
      proveedores_alternativos: _vrState.padreRef ? (_vrState.padreRef.proveedores_alternativos || '') : '',
      variantes: []
    };

    const p = await req('POST', '/productos', data);
    productos.push(p);
    closeModal('variante-rapida');
    renderInventario();
    toast(`✅ Variante "${nombreFinal}" creada correctamente`);
  } catch (err) {
    toast(`❌ Error al crear variante: ${err.message}`, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ Crear Variante';
  }
};


function verificarAsistenteRopa() {
  const cat = document.getElementById('mp-cat').value.trim();
  const ropaFields = document.getElementById('mp-ropa-fields');
  if (cat.startsWith('Playera') || cat.startsWith('Sudadera')) {
    ropaFields.style.display = 'block';
    if (cat === 'Playera' || cat === 'Sudadera') updateRopaForms(cat);
  } else { ropaFields.style.display = 'none'; }
}

function updateRopaForms(forcePadre) {
  const catInput = document.getElementById('mp-cat').value.trim();
  const padre = forcePadre || (catInput.startsWith('Sudadera') ? 'Sudadera' : 'Playera');
  if (padre === 'Sudadera') {
     document.getElementById('mp-publico').value = 'Adulto'; document.getElementById('mp-publico').disabled = true;
     document.getElementById('mp-genero').value = 'Unisex'; document.getElementById('mp-genero').disabled = true;
     document.getElementById('mp-manga').value = 'Manga Larga'; document.getElementById('mp-manga').disabled = true;
  } else {
     document.getElementById('mp-publico').disabled = false;
     const pub = document.getElementById('mp-publico').value;
     if (pub !== 'Adulto') { document.getElementById('mp-genero').value = 'Unisex'; document.getElementById('mp-genero').disabled = true; }
     else { document.getElementById('mp-genero').disabled = false; if(document.getElementById('mp-genero').value === 'Unisex') { document.getElementById('mp-genero').value = 'Caballero'; } }
     document.getElementById('mp-manga').disabled = false;
  }
}

function aplicarRopa(e) {
  if (e) e.preventDefault();
  const catInput = document.getElementById('mp-cat').value.trim();
  const padre = catInput.startsWith('Sudadera') ? 'Sudadera' : 'Playera';
  const pub = document.getElementById('mp-publico').value;
  const gen = document.getElementById('mp-genero').value;
  const peso = document.getElementById('mp-peso').value;
  const man = document.getElementById('mp-manga').value;
  const col = document.getElementById('mp-color').value.trim();
  let tallas = [];
  if (padre === 'Sudadera') { tallas = ['S', 'M', 'L', 'XL', 'XXL']; }
  else if (padre === 'Playera') {
    if (pub === 'Adulto' && (gen === 'Caballero' || gen === 'Unisex')) { tallas = (man === 'Manga Corta') ? ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'] : ['S', 'M', 'L', 'XL', 'XXL']; }
    else { tallas = ['S', 'M', 'L', 'XL']; }
  }
  if (padre === 'Playera') { document.getElementById('mp-min').value = 2; }
  const genderCode = { 'Caballero': 'C', 'Dama': 'D', 'Juvenil': 'J', 'Niño': 'N', 'Bebé': 'B', 'Unisex': 'U' };
  const skuPrefix = `P${genderCode[gen] || 'X'}${peso}`;
  const colorSKU = col.toUpperCase().replace(/\s+/g, '');
  const sizeNames = { 'XS':'Extra Chica','S':'Chica','M':'Mediana','L':'Grande','XL':'X-Grande','XXL':'XX-Grande','XXXL':'XXX-Grande' };
  document.getElementById('variants-list').innerHTML = '';
  tallas.forEach(t => { const sizeFull = sizeNames[t] || t; const vName = col ? `${col}>${sizeFull}` : sizeFull; const vSKU = `${skuPrefix}${colorSKU}-${t}`; addVariantField(vName, vSKU); });
  let catStr = padre;
  if (padre === 'Playera') { catStr += ` › ${pub} › ${gen} › ${man}`; } else { catStr += ` › Unisex`; }
  document.getElementById('mp-cat').value = catStr;
  const nameInput = document.getElementById('mp-nombre');
  if (!nameInput.value || nameInput.value.startsWith('Playera') || nameInput.value.startsWith('Sudadera')) {
     const nParts = [padre];
     if(padre==='Playera') nParts.push(pub, gen==='Unisex'?'':gen, man);
     nParts.push('Peso C' + peso);
     nameInput.value = nParts.filter(Boolean).join(' ').replace(/\s+/g, ' ');
  }
  toast('Tallas aplicadas con éxito', true);
}

function descargarPlantillaCSV() {
  const headers = ['CategoriaPadre', 'Publico', 'Genero', 'Manga', 'Peso', 'Color', 'Nombre', 'SKU', 'Variantes', 'Cantidad', 'StockMin', 'Costo', 'PrecioVenta', 'Notas', 'Proveedores'];
  const csv = headers.join(',') + '\n'
    + '"Playera","Adulto","Caballero","Manga Corta","C0300","Aqua","","SKU-AUTO-1","",10,1,150.00,250.00,"",""\n'
    + '"Playera","Adulto","Dama","Manga Corta","C0200","Negro","","SKU-AUTO-2","",5,1,120.00,200.00,"",""\n'
    + '"","","","","","","Taza Custom","SKU-TZ-1","Variante Unica",20,5,50.00,100.00,"Notas internas","Proveedor A"\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Plantilla_Inventario.csv'; a.click();
}

async function procesarImportacionCSV() {
  const fileInput = document.getElementById('csv-file');
  if(!fileInput.files.length) { toast('Selecciona un archivo CSV', false); return; }
  const file = fileInput.files[0];
  if (!window.Papa) { toast('Error cargando PapaParse', false); return; }
  toast('Procesando... no cierres la ventana');
  document.getElementById('overlay-importar').classList.remove('active');
  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: async function(results) {
      const data = results.data;
      if (data.length === 0) { toast('El CSV está vacío', false); return; }
      let creados = 0, actualizados = 0, errores = 0;
      for (const row of data) {
        let nombre = row['Nombre'] ? row['Nombre'].trim() : '';
        const padre = row['CategoriaPadre'] || row['Categoria'] || '';
        const pub = row['Publico'] ? row['Publico'].trim() : '';
        const gen = row['Genero'] ? row['Genero'].trim() : '';
        const man = row['Manga'] ? row['Manga'].trim() : '';
        const col = row['Color'] ? row['Color'].trim() : '';
        const peso = row['Peso'] ? row['Peso'].trim() : '';
        if (!nombre && (padre === 'Playera' || padre === 'Sudadera')) {
           const nParts = [padre]; if(padre==='Playera') nParts.push(pub, gen==='Unisex'?'':gen, man); if(peso) nParts.push('Peso ' + peso);
           nombre = nParts.filter(Boolean).join(' ').replace(/\s+/g, ' ');
        }
        if (!nombre) continue;
        const sku = row['SKU'] ? row['SKU'].trim() : '';
        const qty = parseInt(row['Cantidad']) || 0;
        let p = null;
        if (sku) p = productos.find(x => x.sku === sku);
        if (!p) p = productos.find(x => x.nombre.toLowerCase() === nombre.toLowerCase());
        try {
          if (p) { if (qty > 0) { await req('PATCH', `/productos/${p.id}/qty?delta=${qty}`); } actualizados++; }
          else {
            let variantes = row['Variantes'] ? row['Variantes'].split('|').map(v=>v.trim()).filter(Boolean) : [];
            let rCat = padre || 'Otro';
            if (variantes.length === 0 && (padre === 'Playera' || padre === 'Sudadera')) {
               const sizeNames = { 'XS':'Extra Chica','S':'Chica','M':'Mediana','L':'Grande','XL':'X-Grande','XXL':'XX-Grande','XXXL':'XXX-Grande' };
               let tallas = [];
               if (padre === 'Sudadera') tallas = ['S', 'M', 'L', 'XL', 'XXL'];
               else if (pub === 'Adulto' && (gen === 'Caballero' || gen === 'Unisex')) tallas = (man === 'Manga Corta') ? ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'] : ['S', 'M', 'L', 'XL', 'XXL'];
               else if (pub === 'Adulto' && gen === 'Dama') tallas = ['S', 'M', 'L', 'XL'];
               else tallas = ['S', 'M', 'L', 'XL'];
               variantes = tallas.map(t => `${col || 'Blanco'}>${sizeNames[t] || t}`);
               if (padre === 'Playera') rCat = `${padre} › ${pub} › ${gen === 'Unisex' ? 'Unisex' : gen} › ${man}`;
               else rCat = `${padre} › Unisex`;
            }
            const nuevoData = { 
               nombre, 
               sku: sku || '', 
               categoria: rCat, 
               qty, 
               min_stock: parseInt(row['StockMin']) || 0, 
               costo: parseFloat(row['Costo']) || 0, 
               venta: parseFloat(row['PrecioVenta']) || 0, 
               notas_internas: row['Notas'] || '',
               proveedores_alternativos: row['Proveedores'] || '',
               variantes: [] 
             };
             if (variantes.length > 0) { 
               for (const v of variantes) { 
                 const vSku = sku ? sku + '-' + v.split('>')[0].trim().replace(/[^a-zA-Z0-9]/g, '') : ''; 
                 const vName = nombre + '>' + v; 
                 await req('POST', '/productos', { ...nuevoData, nombre: vName, sku: vSku }); 
                 creados++; 
               } 
             }
             else { await req('POST', '/productos', nuevoData); creados++; }
          }
        } catch (err) { console.error('Error fila:', row, err); errores++; }
      }
      await loadProductos(); renderInventario(); renderVentas();
      fileInput.value = '';
      toast(`Completado. Creados: ${creados}, Actualizados: ${actualizados}${errores > 0 ? `, Errores: ${errores}` : ''}`, errores === 0);
    },
    error: function(error) { toast('Error al leer el CSV: ' + error.message, false); }
  });
}

function exportCSV(){
  const headers=['Nombre','SKU','Categoría','Variantes','Cantidad','StockMin','Costo','Venta','Notas','Proveedores'];
  const rows=productos.map(p=>[
    p.nombre,
    p.sku||'',
    p.categoria||'',
    (p.variantes||[]).join(' | '),
    p.qty,
    p.min_stock,
    p.costo,
    p.venta,
    p.notas_internas||'',
    p.proveedores_alternativos||''
  ].map(v=>`"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv=[headers.join(','),...rows].join('\n');
  const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='inventario.csv';a.click();
}

async function exportExcel() {
  if (!window.ExcelJS) { toast('Error: librería ExcelJS no cargada.', false); return; }
  try {
    toast('Generando archivo Excel...');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Inventario');
    
    // Headers
    sheet.columns = [
      { header: 'Producto', key: 'nombre', width: 40 },
      { header: 'SKU', key: 'sku', width: 20 },
      { header: 'Categoría', key: 'categoria', width: 30 },
      { header: 'Variantes', key: 'variantes', width: 30 },
      { header: 'Stock Actual', key: 'qty', width: 15 },
      { header: 'Min Stock', key: 'min', width: 15 },
      { header: 'Costo', key: 'costo', width: 15 },
      { header: 'Venta', key: 'venta', width: 15 },
      { header: 'Alerta', key: 'alerta', width: 15 },
      { header: 'Notas Internas', key: 'notas', width: 40 },
      { header: 'Proveedores Alternativos', key: 'proveedores', width: 30 }
    ];
    
    // Format headers
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    
    // Se usa el arreglo global de productos, ordenando los que tienen stock al principio
    const productosParaExportar = [...productos].sort((a, b) => {
      if (a.qty > 0 && b.qty <= 0) return -1;
      if (a.qty <= 0 && b.qty > 0) return 1;
      return 0;
    });

    productosParaExportar.forEach(p => {
      const isLow = p.qty <= p.min_stock;
      const row = sheet.addRow({
        nombre: p.nombre,
        sku: p.sku || '',
        categoria: p.categoria || '',
        variantes: (p.variantes || []).join(', '),
        qty: p.qty,
        min: p.min_stock,
        costo: p.costo,
        venta: p.venta,
        alerta: isLow ? (p.qty <= 0 ? 'AGOTADO' : 'BAJO') : 'OK',
        notas: p.notas_internas || '',
        proveedores: p.proveedores_alternativos || ''
      });
      // Color coding cell
      const stockCell = row.getCell('alerta');
      if (p.qty <= 0) {
        stockCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        stockCell.font = { color: { argb: 'FFDC2626' }, bold: true };
      } else if (p.qty <= p.min_stock) {
        stockCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        stockCell.font = { color: { argb: 'FFD97706' }, bold: true };
      } else {
        stockCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
        stockCell.font = { color: { argb: 'FF16A34A' }, bold: true };
      }
      row.getCell('costo').numFmt = '"$"#,##0.00';
      row.getCell('venta').numFmt = '"$"#,##0.00';
    });
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Inventario_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    toast('✅ Excel exportado correctamente', true);
  } catch (err) {
    console.error(err);
    toast('Error exportando Excel', false);
  }
}

['overlay-producto','overlay-ajuste','overlay-importar'].forEach(id=>{
  const el = document.getElementById(id);
  if (el) el.addEventListener('click',function(e){if(e.target===this)this.classList.remove('active');});
});

// (ShowPage consolidado al inicio para evitar duplicados)

window.addEventListener('DOMContentLoaded', async () => {
  const token = getToken();
  if (!token) return; // No intentar cargar datos si no hay token

  try{ 
    await req('GET','/health'); 
    const statusEl = document.getElementById('api-status');
    if(statusEl) statusEl.textContent='🟢 API conectada'; 
  } catch(e){ 
    const statusEl = document.getElementById('api-status');
    if(statusEl) statusEl.textContent='🔴 API desconectada'; 
  }
  
  await loadProductos();
  renderInventario();
  renderVentasRecientes();
  
  // Cargar dashboard si estamos en esa vista
  if(window.renderDashboard) await renderDashboard();
  
  const mpTitle = document.getElementById('mp-title');
  if(mpTitle) mpTitle.textContent='Agregar Producto';

  // Listener para Búsqueda Global (Fix)
  const gsInput = document.getElementById('gs-input');
  if (gsInput) {
    gsInput.addEventListener('input', (e) => renderGsResults(e.target.value.toLowerCase()));
  }

  // Inicializar Reloj CDMX
  const clockEl = document.getElementById('dash-clock');
  if (clockEl) {
    const updateClock = () => {
      const formatter = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true
      });
      clockEl.textContent = formatter.format(new Date());
    };
    updateClock();
    setInterval(updateClock, 1000);
  }
});

async function renderVentasRecientes() {
  try {
    const vent = await req('GET', '/movimientos?tipo=venta&limit=50');
    const container = document.getElementById('recent-sales-list');
    if (!container) return;
    container.innerHTML = '';
    
    const groups = {};
    const finalItems = [];
    window._recentSalesCache = window._recentSalesCache || {};
    
    vent.forEach(h => {
      let folio = h.id.toString();
      if (h.notas) {
        const parts = h.notas.split(' | ');
        const potentialFolio = parts[0].split(' ')[0];
        if (/^\d{8}-/.test(potentialFolio) || potentialFolio.startsWith('TICKET-')) {
          folio = potentialFolio;
        }
      }
      
      if(!groups[folio]) {
        groups[folio] = { ...h, isGroup: true, ids: [], detalles: [], totalPrecio: 0, folio: folio };
        finalItems.push(groups[folio]);
      }
      groups[folio].ids.push(h.id);
      groups[folio].detalles.push({ producto_nombre: h.producto_nombre, sku: h.sku, qty: h.qty, precio: h.precio, variante: h.variante });
      groups[folio].totalPrecio += (h.precio * h.qty);
    });

    const displayItems = finalItems.slice(0, 10);
    
    if (displayItems.length === 0) { container.innerHTML = '<div class="cart-empty">Sin ventas recientes</div>'; return; }
    
    displayItems.forEach(v => {
      let hash = 0;
      for (let i = 0; i < v.folio.length; i++) hash = v.folio.charCodeAt(i) + ((hash << 5) - hash);
      const hue = Math.abs(hash) % 360;
      const bgColor = `hsl(${hue}, 85%, 96%)`;
      const borderColor = `hsl(${hue}, 70%, 80%)`;
      const titleColor = `hsl(${hue}, 80%, 35%)`;

      const div = document.createElement('div');
      div.className = 'recent-sale-item';
      div.style.backgroundColor = bgColor;
      div.style.border = `1px solid ${borderColor}`;
      div.style.borderRadius = '8px';
      div.style.padding = '10px';
      div.style.marginBottom = '10px';
      div.style.display = 'block'; 
      
      const dateStr = new Date(v.fecha).toLocaleString('es-MX', TZ_MX);
      
      let d_html = '<div style="margin-top:8px; margin-bottom:8px; font-size:0.75rem; color:#475569; line-height:1.5;">';
      v.detalles.forEach(d => {
         d_html += `<div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            <span style="font-weight:600; color:${titleColor};">${d.qty}x</span> ${escapeHtml(d.producto_nombre)} ${d.variante ? `(${escapeHtml(d.variante)})` : ''}
         </div>`;
      });
      d_html += `</div>`;
      
      let displayFolio = v.folio.length > 8 ? v.folio : `Folio #${v.folio}`;
      
      window._recentSalesCache[v.folio] = v;
      
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
           <div style="font-weight:bold; color:${titleColor}; font-size:0.8rem; font-family:monospace;">📦 ${escapeHtml(displayFolio)}</div>
        </div>
        <div style="font-size:0.65rem; color:#64748b; margin-top:2px;">${dateStr} ${v.canal ? `· ${escapeHtml(v.canal)}` : ''}</div>
        ${d_html}
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid ${borderColor}; padding-top:8px;">
           <div style="font-weight:bold; color:#1e293b; font-size:0.9rem;">Total: ${mxn(v.totalPrecio)}</div>
           <div style="display:flex; gap: 5px;">
             <button class="btn btn-sm btn-outline" style="color:#0ea5e9; border-color:#0ea5e9; background:white; font-size:0.7rem; padding:4px 8px;" onclick="descargarTicketReciente('${escapeJsAttr(v.folio)}')" title="Descargar Ticket PDF">📥 Ticket</button>
             <button class="btn btn-sm btn-outline" style="color:#ef4444; border-color:#ef4444; background:white; font-size:0.7rem; padding:4px 8px;" onclick="cancelarVenta([${v.ids.join(',')}])" title="Cancelar Venta Completa">🗑️ Eliminar</button>
           </div>
        </div>
      `;
      container.appendChild(div);
    });
  } catch (e) { console.error(e); }
}

window.descargarTicketReciente = function(folio) {
  const v = window._recentSalesCache[folio];
  if (!v) return;
  
  const fechaStr = new Date(v.fecha).toLocaleString('es-MX', TZ_MX);
  
  const ticketData = {
    fechaStr,
    folio: v.folio,
    cart: v.detalles,
    detalles: v.detalles,
    canal: v.canal || '',
    subtotal: v.totalPrecio,
    descuento: 0,
    total: v.totalPrecio
  };
  
  if (typeof generarTicketMulti === 'function') {
    generarTicketMulti(ticketData);
  } else {
    showToast('Función de ticket no disponible.', 'err');
  }
};

window.cancelarVenta = async function(id) {
  showConfirm('¿Seguro que deseas cancelar esta venta? El inventario se restaurará.', async () => {
    try { 
      let ids = Array.isArray(id) ? id : [id];
      for (const x of ids) {
         await req('DELETE', `/movimientos/${x}`); 
      }
      toast('✅ Venta cancelada e inventario restaurado', true); 
      await loadProductos(); 
      renderVentasRecientes(); 
      if(typeof renderVentas === 'function') renderVentas();
    }
    catch (e) { toast(e.message, false); }
  });
};

let editingVentaId = null;
window.modificarVenta = async function(id) {
  try {
    const movs = await req('GET', '/movimientos?limit=50');
    const v = movs.find(x => x.id === id);
    if (!v) { toast('No se encontró el detalle de la venta', false); return; }
    editingVentaId = id;
    document.getElementById('ev-product').textContent = v.producto_nombre;
    document.getElementById('ev-qty').value = v.qty;
    document.getElementById('ev-precio').value = v.precio;
    openModal('edit-venta');
  } catch (e) { toast(e.message, false); }
};

window.confirmUpdateVenta = async function() {
  const qty = parseInt(document.getElementById('ev-qty').value);
  const precio = parseFloat(document.getElementById('ev-precio').value);
  if (!qty || qty < 1) { toast('Cantidad inválida', false); return; }
  try {
    await req('PUT', `/movimientos/${editingVentaId}`, { qty, precio });
    toast('Venta actualizada correctamente', true);
    closeModal('edit-venta');
    await loadProductos();
    renderVentasRecientes();
    if(typeof renderVentas === 'function') renderVentas();
  } catch (e) { toast(e.message, false); }
};


// === GESTIÓN DE VENTAS Y AUDITORÍA ===

let gvSkip = 0;
const gvLimit = 25;
let currentGroupedSales = [];
let activeExpandedFolio = null;
let activeDevolucionFolio = null;

window.buscarVentasAgrupadas = async function() {
  gvSkip = 0;
  await loadVentasAgrupadas();
};

window.limpiarFiltrosVentasAgrupadas = async function() {
  const searchEl = document.getElementById('gv-search');
  const canalEl = document.getElementById('gv-canal');
  const desdeEl = document.getElementById('gv-desde');
  const hastaEl = document.getElementById('gv-hasta');
  if (searchEl) searchEl.value = '';
  if (canalEl) canalEl.value = '';
  if (desdeEl) desdeEl.value = '';
  if (hastaEl) hastaEl.value = '';
  gvSkip = 0;
  await loadVentasAgrupadas();
};

window.cambiarPaginaVentas = async function(delta) {
  const newSkip = gvSkip + (delta * gvLimit);
  if (newSkip < 0) return;
  gvSkip = newSkip;
  await loadVentasAgrupadas();
};

window.loadVentasAgrupadas = async function() {
  try {
    const searchEl = document.getElementById('gv-search');
    const canalEl = document.getElementById('gv-canal');
    const desdeEl = document.getElementById('gv-desde');
    const hastaEl = document.getElementById('gv-hasta');
    
    const search = searchEl ? searchEl.value.trim() : '';
    const canal = canalEl ? canalEl.value : '';
    const desde = desdeEl ? desdeEl.value : '';
    const hasta = hastaEl ? hastaEl.value : '';

    let queryParams = `skip=${gvSkip}&limit=${gvLimit}`;
    if (search) queryParams += `&query=${encodeURIComponent(search)}`;
    if (canal && canal !== 'Todos') queryParams += `&canal=${encodeURIComponent(canal)}`;
    if (desde) queryParams += `&desde=${desde}`;
    if (hasta) queryParams += `&hasta=${hasta}`;

    const data = await req('GET', `/ventas-agrupadas?${queryParams}`);
    currentGroupedSales = data;
    renderVentasAgrupadasTable(data);
  } catch (e) {
    toast('Error cargando ventas: ' + e.message, false);
  }
};

function renderVentasAgrupadasTable(sales) {
  const tbody = document.getElementById('gv-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let totalFacturado = 0;
  let totalVentasCount = sales.length;
  sales.forEach(s => {
    totalFacturado += s.total_estimado;
  });
  const avgTicket = totalVentasCount > 0 ? (totalFacturado / totalVentasCount) : 0;

  const countEl = document.getElementById('gv-kpi-count');
  const totalEl = document.getElementById('gv-kpi-total');
  const avgEl = document.getElementById('gv-kpi-avg');
  
  if (countEl) countEl.textContent = totalVentasCount;
  if (totalEl) totalEl.textContent = mxn(totalFacturado);
  if (avgEl) avgEl.textContent = mxn(avgTicket);

  const pagInfoEl = document.getElementById('gv-pagination-info');
  const btnPrevEl = document.getElementById('btn-gv-prev');
  const btnNextEl = document.getElementById('btn-gv-next');
  
  if (pagInfoEl) pagInfoEl.textContent = `Pág. ${Math.floor(gvSkip / gvLimit) + 1}`;
  if (btnPrevEl) btnPrevEl.disabled = gvSkip === 0;
  if (btnNextEl) btnNextEl.disabled = sales.length < gvLimit;

  if (sales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#64748b;">No se encontraron ventas con los filtros seleccionados</td></tr>`;
    return;
  }

  const rol = getSessionRol();
  const isAdmin = rol === 'admin';

  sales.forEach(v => {
    const channelClass = (v.canal || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
    const cleanChannel = v.canal || 'Venta directa';
    
    const dateStr = new Date(v.fecha).toLocaleString('es-MX', TZ_MX);

    const isExpanded = activeExpandedFolio === v.folio;

    const tr = document.createElement('tr');
    tr.className = `gv-row-expandable ${isExpanded ? 'expanded' : ''}`;
    tr.style.borderBottom = '1px solid #f1f5f9';
    
    tr.innerHTML = `
      <td style="padding:12px; text-align:center;" onclick="toggleVentaDetails('${escapeJsAttr(v.folio)}')">
        <span class="gv-expand-chevron">▶</span>
      </td>
      <td style="padding:12px; font-family:monospace; font-weight:600;" onclick="toggleVentaDetails('${escapeJsAttr(v.folio)}')">${escapeHtml(v.folio)}</td>
      <td style="padding:12px;" onclick="toggleVentaDetails('${escapeJsAttr(v.folio)}')">${dateStr}</td>
      <td style="padding:12px;" onclick="toggleVentaDetails('${escapeJsAttr(v.folio)}')">
        <span class="channel-badge ${channelClass}">${escapeHtml(cleanChannel)}</span>
      </td>
      <td style="padding:12px; text-align:center;" onclick="toggleVentaDetails('${escapeJsAttr(v.folio)}')">${v.total_items} uds</td>
      <td style="padding:12px; text-align:right; font-weight:bold; color:#0f172a;" onclick="toggleVentaDetails('${escapeJsAttr(v.folio)}')">${mxn(v.total_estimado)}</td>
      <td style="padding:12px; text-align:right; display:flex; gap:6px; justify-content:flex-end; align-items:center;">
        <button class="btn btn-sm btn-outline" style="color:#0ea5e9; border-color:#0ea5e9; background:white; font-size:0.75rem; padding:4px 10px;" onclick="reimprimirTicketFolio('${escapeJsAttr(v.folio)}')">📥 Ticket</button>
        <button class="btn btn-sm btn-outline" style="color:#f59e0b; border-color:#f59e0b; background:white; font-size:0.75rem; padding:4px 10px; ${isAdmin ? '' : 'display:none;'}" onclick="abrirModalDevolucion('${escapeJsAttr(v.folio)}')">↩️ Devolver</button>
        <button class="btn btn-sm btn-outline" style="color:#ef4444; border-color:#ef4444; background:white; font-size:0.75rem; padding:4px 10px; ${isAdmin ? '' : 'display:none;'}" onclick="eliminarVentaCompleta('${escapeJsAttr(v.folio)}')">🗑️ Cancelar</button>
      </td>
    `;
    tbody.appendChild(tr);

    const detailTr = document.createElement('tr');
    detailTr.style.display = isExpanded ? 'table-row' : 'none';
    detailTr.id = `gv-detail-${v.folio}`;
    
    let detailsHtml = '';
    v.detalles.forEach(d => {
      detailsHtml += `
        <tr>
          <td style="padding:6px 12px; font-family:monospace; font-size:0.75rem;">${escapeHtml(d.sku)}</td>
          <td style="padding:6px 12px; font-weight:600;">${escapeHtml(d.producto_nombre)}</td>
          <td style="padding:6px 12px; color:#64748b;">${escapeHtml(d.variante) || '—'}</td>
          <td style="padding:6px 12px; text-align:center;">${d.qty} uds</td>
          <td style="padding:6px 12px; text-align:right;">${mxn(d.precio)}</td>
          <td style="padding:6px 12px; text-align:right; font-weight:bold;">${mxn(d.precio * d.qty)}</td>
        </tr>
      `;
    });

    detailTr.innerHTML = `
      <td colspan="7" style="padding:0; background:#f8fafc;">
        <div class="gv-detail-container">
          <div style="font-weight:700; color:#475569; font-size:0.75rem; text-transform:uppercase; margin-bottom:8px;">Detalles de la Transacción</div>
          <table class="gv-detail-table">
            <thead>
              <tr style="text-align:left;">
                <th>SKU</th>
                <th>Producto</th>
                <th>Variante</th>
                <th style="text-align:center;">Cantidad</th>
                <th style="text-align:right;">Precio Unitario</th>
                <th style="text-align:right;">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${detailsHtml}
            </tbody>
          </table>
        </div>
      </td>
    `;
    tbody.appendChild(detailTr);
  });
}

window.toggleVentaDetails = function(folio) {
  const targetTr = document.getElementById(`gv-detail-${folio}`);
  if (!targetTr) return;
  const parentTr = targetTr.previousElementSibling;

  if (activeExpandedFolio === folio) {
    targetTr.style.display = 'none';
    parentTr.classList.remove('expanded');
    activeExpandedFolio = null;
  } else {
    if (activeExpandedFolio) {
      const prevTr = document.getElementById(`gv-detail-${activeExpandedFolio}`);
      if (prevTr) {
        prevTr.style.display = 'none';
        prevTr.previousElementSibling.classList.remove('expanded');
      }
    }
    targetTr.style.display = 'table-row';
    parentTr.classList.add('expanded');
    activeExpandedFolio = folio;
  }
};

window.reimprimirTicketFolio = function(folio) {
  const sale = currentGroupedSales.find(s => s.folio === folio);
  if (!sale) return;

  const fechaStr = new Date(sale.fecha).toLocaleString('es-MX', TZ_MX);

  const ticketData = {
    fechaStr,
    folio: sale.folio,
    cart: sale.detalles,
    detalles: sale.detalles,
    canal: sale.canal || '',
    subtotal: sale.total_estimado,
    descuento: 0,
    total: sale.total_estimado
  };

  if (typeof generarTicketMulti === 'function') {
    generarTicketMulti(ticketData);
  } else {
    toast('Función de ticket no disponible.', false);
  }
};

window.eliminarVentaCompleta = function(folio) {
  showConfirm(`¿Seguro que deseas cancelar por completo la venta con folio ${folio}? Se regresará el stock correspondiente al inventario.`, async () => {
    try {
      await req('POST', `/ventas/cancelar-completo/${folio}`);
      toast(`✅ Venta ${folio} cancelada e inventario restaurado`, true);
      await loadProductos();
      await loadVentasAgrupadas();
    } catch (e) {
      toast('Error al cancelar: ' + e.message, false);
    }
  });
};

window.abrirModalDevolucion = function(folio) {
  const sale = currentGroupedSales.find(s => s.folio === folio);
  if (!sale) return;

  activeDevolucionFolio = folio;
  const subTitleEl = document.getElementById('dp-subtitle');
  if (subTitleEl) subTitleEl.textContent = `Folio: ${folio} (${sale.canal})`;
  
  const tbody = document.getElementById('dp-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  sale.detalles.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:8px 12px; font-weight:600; font-size:0.8rem;">
        ${escapeHtml(d.producto_nombre)} ${d.variante ? `<div style="font-size:0.7rem; color:#64748b; font-weight:normal;">${escapeHtml(d.variante)}</div>` : ''}
      </td>
      <td style="padding:8px 12px; text-align:center; font-weight:bold; font-size:0.8rem;">${d.qty}</td>
      <td style="padding:8px 12px; text-align:center;">
        <input type="number" class="devolucion-qty-input" data-mov-id="${escapeHtml(d.movimiento_id)}" min="0" max="${escapeHtml(d.qty)}" value="0" style="width:70px; text-align:center; padding:4px; font-size:0.8rem; border-radius:4px; border:1px solid #cbd5e1;">
      </td>
    `;
    tbody.appendChild(tr);
  });

  openModal('devolucion-parcial');
};

window.cerrarModalDevolucion = function() {
  closeModal('devolucion-parcial');
  activeDevolucionFolio = null;
};

window.confirmarDevolucionParcial = async function() {
  if (!activeDevolucionFolio) return;

  const items = [];
  const inputs = document.querySelectorAll('.devolucion-qty-input');
  let hasSelection = false;
  let hasError = false;

  inputs.forEach(input => {
    const movId = parseInt(input.getAttribute('data-mov-id'));
    const qty = parseInt(input.value) || 0;
    const maxQty = parseInt(input.getAttribute('max'));

    if (qty > 0) {
      hasSelection = true;
      if (qty > maxQty) {
        toast('La cantidad a devolver excede el límite disponible.', false);
        hasError = true;
        return;
      }
      items.push({ movimiento_id: movId, qty_a_devolver: qty });
    }
  });

  if (hasError) return;

  if (!hasSelection) {
    toast('Por favor, ingresa al menos 1 cantidad a devolver.', false);
    return;
  }

  showConfirm('¿Proceder con la devolución parcial? El inventario de los artículos indicados será restaurado.', async () => {
    try {
      await req('POST', '/ventas/devolver', { folio: activeDevolucionFolio, items });
      toast('✅ Devolución parcial procesada e inventario restaurado', true);
      cerrarModalDevolucion();
      await loadProductos();
      await loadVentasAgrupadas();
    } catch (e) {
      toast('Error en la devolución: ' + e.message, false);
    }
  });
};

// OC logic moved to oc.js

window.imprimirEtiqueta = function(id) {
  const p = productos.find(x => x.id === id);
  if (!p || !p.sku) { toast('El producto no tiene SKU válido', false); return; }
  if (!window.JsBarcode) { toast('Librería de código de barras cargando, inténtalo de nuevo', false); return; }
  
  try {
    // 1. Dibujar el código de barras básico en el canvas oculto
    const hiddenCanvas = document.getElementById('hidden-barcode');
    JsBarcode(hiddenCanvas, p.sku, { format: "CODE128", displayValue: false, margin: 10, width: 4, height: 120 });
    const barcodeDataUrl = hiddenCanvas.toDataURL("image/png");
    
    // 2. Crear nuestro Canvas Maestro de 5x4 cm (300 DPI = 591x472 px)
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = 591;
    finalCanvas.height = 472;
    const ctx = finalCanvas.getContext('2d');
    
    // Fondo Blanco Fijo
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    
    // Nombre del Producto (Centrado Arriba)
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 38px Arial';
    ctx.textAlign = 'center';
    let nombreCorto = p.nombre.length > 30 ? p.nombre.substring(0, 28) + '...' : p.nombre;
    ctx.fillText(nombreCorto, finalCanvas.width / 2, 70);
    
    // Dibujar la imagen del código de barras
    const img = new Image();
    img.onload = () => {
       // Ancho ~460, Alto ~190 => Centrado
       const bw = 480;
       const bh = 190;
       const bx = (finalCanvas.width - bw) / 2;
       const by = 130;
       ctx.drawImage(img, bx, by, bw, bh);
       
       // SKU Texto
       ctx.font = 'normal 48px Arial';
       ctx.fillText(p.sku, finalCanvas.width / 2, 385);
       
       // Categoría
       ctx.font = 'normal 32px Arial';
       ctx.fillStyle = '#444444';
       const catArr = p.categoria.split("›");
       const subCat = catArr[catArr.length-1].trim();
       ctx.fillText(subCat, finalCanvas.width / 2, 445);
       
       // Forzar Descarga del PNG
       const finalData = finalCanvas.toDataURL("image/png");
       const a = document.createElement('a');
       a.href = finalData;
       a.download = `Etiqueta_${p.sku}.png`;
       a.click();
       toast('Imagen Código de Barras '.concat(p.sku).concat(' descargada.'));
    };
    img.onerror = () => { toast('Error al renderizar la imagen del código.', false); };
    img.src = barcodeDataUrl;
    
  } catch (err) { toast('Error al generar código: ' + err.message, false); }
};

/* ── BÚSQUEDA GLOBAL OMNIPRESENTE (CTRL+K) ───────────────────────── */
let gsSelectedIndex = -1;
let gsItems = [];

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if(typeof openGlobalSearch === 'function') openGlobalSearch();
  }
  const gsOverlay = document.getElementById('overlay-global-search');
  if (gsOverlay && gsOverlay.classList.contains('active')) {
    const listCont = document.getElementById('gs-results');
    const itemsNodes = listCont.querySelectorAll('.gs-item');
    if (e.key === 'Escape') {
      closeGlobalSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (gsSelectedIndex < itemsNodes.length - 1) {
        gsSelectedIndex++;
        updateGsSelection(itemsNodes);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (gsSelectedIndex > 0) {
        gsSelectedIndex--;
        updateGsSelection(itemsNodes);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (gsSelectedIndex >= 0 && gsSelectedIndex < gsItems.length) {
        executeGsAction(gsItems[gsSelectedIndex]);
      }
    }
  }
});

function openGlobalSearch() {
  document.getElementById('overlay-global-search').classList.add('active');
  const inp = document.getElementById('gs-input');
  inp.value = '';
  inp.focus();
  renderGsResults('');
}

function closeGlobalSearch() {
  document.getElementById('overlay-global-search').classList.remove('active');
}

function renderGsResults(query) {
  const container = document.getElementById('gs-results');
  container.innerHTML = '';
  gsItems = [];
  gsSelectedIndex = -1;

  if (!query) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">Empieza a escribir para buscar...</div>';
    return;
  }

  // Búsqueda inteligente
  const matches = productos.filter(p =>
    coincideBusqueda([p.nombre, p.sku, p.categoria], query)
  ).slice(0, 15);

  if (matches.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No hay resultados</div>';
    return;
  }

  matches.forEach((p, idx) => {
    // Definimos acciones contextualmente (dónde está el usuario)
    const activePageNode = document.querySelector('.page.active');
    let actionBadge = 'Ir a Inventario';
    let type = 'inventario';
    
    if (activePageNode && activePageNode.id === 'page-ventas') {
      actionBadge = 'Añadir a Venta';
      type = 'venta';
    } else if (activePageNode && activePageNode.id === 'page-ordenes_compra') {
      actionBadge = 'Buscar en OC';
      type = 'oc';
    }

    gsItems.push({ ...p, actionType: type });

    const div = document.createElement('div');
    div.className = 'gs-item';
    div.onclick = () => { gsSelectedIndex = idx; executeGsAction(gsItems[idx]); };
    div.onmouseenter = () => { gsSelectedIndex = idx; updateGsSelection(container.querySelectorAll('.gs-item')); };
    
    div.innerHTML = `
      <div>
        <div class="gs-item-title">${escapeHtml(p.nombre)}</div>
        <div class="gs-item-sub">SKU: ${escapeHtml(p.sku || 'N/A')} &bull; Stock: ${p.qty}</div>
      </div>
      <div class="gs-item-badge">${actionBadge}</div>
    `;
    container.appendChild(div);
  });
  
  if (gsItems.length > 0) {
    gsSelectedIndex = 0;
    updateGsSelection(container.querySelectorAll('.gs-item'));
  }
}

function updateGsSelection(nodes) {
  nodes.forEach((n, i) => {
    if (i === gsSelectedIndex) {
      n.classList.add('selected');
      if (n.scrollIntoViewIfNeeded) {
         n.scrollIntoViewIfNeeded();
      } else {
         n.scrollIntoView({ block: 'nearest' });
      }
    } else {
      n.classList.remove('selected');
    }
  });
}

function executeGsAction(item) {
  closeGlobalSearch();
  if (item.actionType === 'venta') {
    const scanInput = document.getElementById('v-scan-sku');
    if (item.sku && window.onScannerEnter) {
      scanInput.value = item.sku;
      window.onScannerEnter(item.sku);
    } else {
      setTimeout(() => {
        document.getElementById('v-filtro-cat').value = item.nombre;
        if(window.onFiltrarCategoria) window.onFiltrarCategoria();
      }, 300);
    }
  } else if (item.actionType === 'oc') {
    setTimeout(() => {
      const ocBusq = document.getElementById('moc-buscar');
      if (ocBusq) {
        ocBusq.value = item.nombre;
        if(window.buscarProductoOC) window.buscarProductoOC();
      }
    }, 400);
  } else {
    showPage('inventario', document.querySelector('nav button:nth-child(2)'));
    const searchParams = document.getElementById('search');
    if (searchParams) {
      searchParams.value = item.nombre;
      renderInventario();
    }
  }
}

// HISTORIAL DE PRECIOS
async function verHistorialPrecios(productoId, nombreProducto) {
  document.getElementById('hp-title').textContent = 'Historial: ' + nombreProducto;
  document.getElementById('hp-body').innerHTML = '<tr><td colspan="5" style="text-align:center;">Cargando historial...</td></tr>';
  document.getElementById('overlay-historial-precio').classList.add('active');
  
  try {
    const data = await req('GET', `/productos/${productoId}/historial-precios`);
    
    const tbody = document.getElementById('hp-body');
    tbody.innerHTML = '';
    
    if(data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No hay cambios registrados en el historial para este producto.</td></tr>';
      return;
    }
    
    data.forEach(h => {
      const tr = document.createElement('tr');
      // format date
      const f = new Date(h.fecha).toLocaleString('es-MX', {dateStyle:'short', timeStyle:'short'});
      tr.innerHTML = `
        <td>${f}</td>
        <td style="${h.costo_anterior !== h.costo_nuevo ? 'color:red; font-weight:bold;' : ''}">${mxn(h.costo_anterior)}</td>
        <td style="${h.costo_anterior !== h.costo_nuevo ? 'color:green; font-weight:bold;' : ''}">${mxn(h.costo_nuevo)}</td>
        <td style="${h.venta_anterior !== h.venta_nuevo ? 'color:red; font-weight:bold;' : ''}">${mxn(h.venta_anterior)}</td>
        <td style="${h.venta_anterior !== h.venta_nuevo ? 'color:green; font-weight:bold;' : ''}">${mxn(h.venta_nuevo)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    document.getElementById('hp-body').innerHTML = '<tr><td colspan="5" style="color:red; text-align:center;">Error de red</td></tr>';
    toast(e.message, false);
  }
}
window.verHistorialPrecios = verHistorialPrecios;

// ── INICIALIZACIÓN CON AUTH ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Limpiar estado de carga inicial (si existe)
  document.body.classList.remove('loading');

  const token = getToken();
  const rol = getSessionRol();
  const user = getSessionUser();

  if(token && rol && user) {
    showApp(rol, user);
  } else {
    // Asegurar que el login sea visible y el resto oculto
    document.getElementById('page-login').style.display = 'flex';
    document.getElementById('page-2fa').style.display = 'none';
    const header = document.getElementById('app-header');
    const nav = document.getElementById('app-nav');
    const layout = document.getElementById('app-layout');
    if(header) header.style.display = 'none';
    if(nav) nav.style.display = 'none';
    // Ocultar layout si el login no está dentro de él
    // if(layout) layout.style.display = 'none'; 
  }
});


// ── AUDITORÍA (PREMIUM) ──────────────────────────────────────────────

let auditCurrentPage = 0;
const AUDIT_PAGE_SIZE = 50;
let _cachedAuditLogs = [];

const ACTION_META = {
  LOGIN:              { icon: '🔓', label: 'Login',             css: 'login'    },
  CREAR_PRODUCTO:     { icon: '📦', label: 'Crear Producto',    css: 'crear'    },
  EDITAR_PRODUCTO:    { icon: '✏️', label: 'Editar Producto',   css: 'editar'   },
  ELIMINAR_PRODUCTO:  { icon: '🗑️', label: 'Eliminar Producto', css: 'eliminar' },
  CAMBIAR_QTY:        { icon: '📥', label: 'Cambiar Cantidad',  css: 'ajuste'   },
  REGISTRAR_VENTA:    { icon: '💰', label: 'Registrar Venta',   css: 'venta'    },
  AJUSTAR_INVENTARIO: { icon: '🔧', label: 'Ajustar Inventario',css: 'ajuste'   },
  CREAR_USUARIO:      { icon: '👤', label: 'Crear Usuario',     css: 'crear'    },
  EDITAR_USUARIO:     { icon: '👤', label: 'Editar Usuario',    css: 'editar'   },
  ELIMINAR_USUARIO:   { icon: '🗑️', label: 'Eliminar Usuario', css: 'eliminar' },
  CAMBIO_PASSWORD_AJENO: { icon: '🔑', label: 'Cambio de Contraseña', css: 'password' },
  CREAR_BACKUP:       { icon: '💾', label: 'Crear Respaldo',    css: 'backup'   },
  ELIMINAR_BACKUP:    { icon: '🗑️', label: 'Eliminar Respaldo', css: 'eliminar' },
  RESTAURAR_BACKUP:   { icon: '♻️', label: 'Restaurar Respaldo',css: 'backup'   },
};

function getActionBadge(accion) {
  const meta = ACTION_META[accion] || { icon: '📝', label: accion, css: 'default' };
  return `<span class="action-badge ${meta.css}">${meta.icon} ${escapeHtml(meta.label)}</span>`;
}

function formatDetalles(detalles) {
  if (!detalles || typeof detalles !== 'object') return '';
  const entries = Object.entries(detalles);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => {
    const key = k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const val = typeof v === 'object' ? JSON.stringify(v) : v;
    return `<span class="log-detail-chip"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(val)}</span>`;
  }).join(' ');
}

window.loadAuditLogs = async function() {
  const user_id = document.getElementById('log-filter-user').value;
  const accion = document.getElementById('log-filter-accion').value;
  const desde = document.getElementById('log-filter-desde').value;
  const hasta = document.getElementById('log-filter-hasta').value;
  
  let path = `/audit-logs?skip=${auditCurrentPage * AUDIT_PAGE_SIZE}&limit=${AUDIT_PAGE_SIZE}`;
  if(user_id) path += `&usuario_id=${user_id}`;
  if(accion) path += `&accion=${accion}`;
  if(desde) path += `&desde=${desde}`;
  if(hasta) path += `&hasta=${hasta}`;
  
  try {
    const logs = await req('GET', path);
    _cachedAuditLogs = logs;
    renderAuditLogs(logs);
    updateAuditPagination(logs.length);
  } catch(e) { toast(e.message, false); }
};

window.loadAuditStats = async function() {
  try {
    const stats = await req('GET', '/audit-logs/stats');
    document.getElementById('ak-total').textContent = stats.total.toLocaleString();
    document.getElementById('ak-logins').textContent = stats.logins_hoy;
    document.getElementById('ak-acciones').textContent = stats.acciones_hoy;
    document.getElementById('ak-ediciones').textContent = stats.cambios_precio_semana;
    document.getElementById('ak-usuarios').textContent = stats.usuarios_activos_hoy;
  } catch(e) { console.error('Error cargando stats:', e); }
};

window.renderAuditLogs = function(logs) {
  const tbody = document.getElementById('log-body');
  const empty = document.getElementById('log-empty');
  tbody.innerHTML = '';
  
  if(!logs || logs.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  
  logs.forEach(log => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #f1f5f9';
    tr.style.transition = 'background 0.15s ease';
    tr.onmouseenter = () => { tr.style.background = 'rgba(112, 42, 225, 0.03)'; };
    tr.onmouseleave = () => { tr.style.background = ''; };
    
    const fecha = new Date(log.fecha).toLocaleString('es-MX', {
      dateStyle: 'short', timeStyle: 'short'
    });

    tr.innerHTML = `
      <td style="padding:10px 12px; font-size:0.82rem; color:#64748b; white-space:nowrap;">${fecha}</td>
      <td style="padding:10px 12px;">
        <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.78rem;">
          ${escapeHtml(log.username || 'Sistema')}
        </span>
      </td>
      <td style="padding:10px 12px;">${getActionBadge(log.accion)}</td>
      <td style="padding:10px 12px; color:#475569; font-size:0.85rem;">
        ${escapeHtml(log.recurso || '—')} ${log.recurso_id ? `<small style="color:#94a3b8;">#${escapeHtml(log.recurso_id)}</small>` : ''}
      </td>
      <td style="padding:10px 12px; max-width:300px; overflow:hidden;">${formatDetalles(log.detalles)}</td>
    `;
    tbody.appendChild(tr);
  });
};

function updateAuditPagination(count) {
  const pagination = document.getElementById('log-pagination');
  const info = document.getElementById('log-page-info');
  const prevBtn = pagination.querySelector('button:first-child');
  const nextBtn = pagination.querySelector('button:last-child');
  
  pagination.style.display = 'flex';
  info.textContent = `Página ${auditCurrentPage + 1}`;
  prevBtn.disabled = auditCurrentPage === 0;
  nextBtn.disabled = count < AUDIT_PAGE_SIZE;
}

window.auditPagPrev = function() {
  if (auditCurrentPage > 0) {
    auditCurrentPage--;
    loadAuditLogs();
  }
};

window.auditPagNext = function() {
  if (_cachedAuditLogs.length >= AUDIT_PAGE_SIZE) {
    auditCurrentPage++;
    loadAuditLogs();
  }
};

window.applyLogFilters = function() {
  auditCurrentPage = 0;
  loadAuditLogs();
};

window.resetLogFilters = function() {
  document.getElementById('log-filter-user').value = '';
  document.getElementById('log-filter-accion').value = '';
  document.getElementById('log-filter-desde').value = '';
  document.getElementById('log-filter-hasta').value = '';
  auditCurrentPage = 0;
  loadAuditLogs();
};

window.exportAuditCSV = function() {
  if (!_cachedAuditLogs || _cachedAuditLogs.length === 0) {
    toast('No hay datos para exportar', false);
    return;
  }
  const header = 'Fecha,Usuario,Acción,Recurso,ID Recurso,Detalles';
  const rows = _cachedAuditLogs.map(log => {
    const fecha = new Date(log.fecha).toLocaleString('es-MX');
    const detalles = log.detalles ? JSON.stringify(log.detalles).replace(/"/g, '""') : '';
    return `"${fecha}","${log.username || 'Sistema'}","${log.accion}","${log.recurso || ''}","${log.recurso_id || ''}","${detalles}"`;
  });
  const csv = header + '\n' + rows.join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AuditLog_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('CSV exportado ✅');
};

async function loadUserListForLogs() {
  const sel = document.getElementById('log-filter-user');
  if(!sel) return;
  try {
    const users = await req('GET', '/admin/usuarios');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">Todos</option>';
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.username;
      sel.appendChild(opt);
    });
    sel.value = currentVal;
  } catch(e) { console.error('Error cargando usuarios para logs:', e); }
}

// ── TABS AUDITORÍA / RESPALDOS ──────────────────────────────────────

window.switchAuditTab = function(tab, btn) {
  document.querySelectorAll('.audit-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  
  document.getElementById('audit-tab-logs').style.display = tab === 'logs' ? '' : 'none';
  document.getElementById('audit-tab-backups').style.display = tab === 'backups' ? '' : 'none';
  
  if (tab === 'backups') loadBackups();
};

// ── RESPALDOS DE BD ─────────────────────────────────────────────────

window.generarBackup = async function() {
  const btn = event ? event.target : null;
  const oldText = btn ? btn.textContent : 'Generar Respaldo Ahora';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Creando...';
  }
  try {
    const result = await req('POST', '/admin/backup');
    toast(`✅ ${result.mensaje}`, true);
    loadBackups();
  } catch(e) {
    toast('Error al crear respaldo: ' + e.message, false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }
};

window.loadBackups = async function() {
  const container = document.getElementById('backups-list');
  const empty = document.getElementById('backups-empty');
  try {
    const backups = await req('GET', '/admin/backups');
    if (!backups || backups.length === 0) {
      if (container) container.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (container) container.innerHTML = backups.map(b => `
      <div class="backup-card">
        <div class="backup-info">
          <div class="backup-name">📁 ${escapeHtml(b.nombre)}</div>
          <div class="backup-meta">📅 ${escapeHtml(b.fecha)} &nbsp;·&nbsp; 📊 ${escapeHtml(b.tamano)}</div>
        </div>
        <div class="backup-actions">
          <button class="btn btn-sm btn-primary" onclick="downloadBackup('${escapeJsAttr(b.nombre)}')" title="Descargar">⬇ Descargar</button>
          <button class="btn btn-sm btn-danger" onclick="restoreBackup('${escapeJsAttr(b.nombre)}')" title="Restaurar">♻️ Restaurar</button>
          <button class="btn btn-sm btn-outline" onclick="deleteBackup('${escapeJsAttr(b.nombre)}')" title="Eliminar" style="color:#ef4444; border-color:#fca5a5;">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch(e) {
    container.innerHTML = `<div style="color:red;">Error: ${escapeHtml(e.message)}</div>`;
  }
};

window.restoreBackup = async function(nombre) {
  if (!confirm(`⚠️ ¡ATENCIÓN! ⚠️\n\nEstás a punto de RESTAURAR la base de datos desde el archivo:\n${nombre}\n\nEsto borrará todos los datos actuales y los reemplazará con los de este respaldo.\n\nSe creará un backup de seguridad automático antes de proceder, pero esta acción es destructiva.\n\n¿Estás completamente seguro de continuar?`)) return;

  // Encontrar el botón clickeado
  let btn = null;
  if (event && event.target && event.target.tagName === 'BUTTON') {
      btn = event.target;
  }
  
  const oldText = btn ? btn.textContent : 'Restaurar';
  if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Restaurando...';
  }
  
  toast('⏳ Restaurando BD... Por favor espera, esto puede tardar.', false);
  
  try {
    const result = await req('POST', `/admin/restore/${nombre}`);
    alert(`✅ ÉXITO: ${result.mensaje}`);
    window.location.reload();
  } catch(e) {
    alert(`❌ ERROR CRÍTICO:\n\nNo se pudo restaurar la base de datos.\nMotivo: ${e.message}`);
    if (btn) {
        btn.disabled = false;
        btn.textContent = oldText;
    }
  }
};

window.downloadBackup = function(nombre) {
  const token = getToken();
  const url = `${API}/admin/backups/${nombre}`;
  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(resp => {
      if (!resp.ok) throw new Error('Error al descargar');
      return resp.blob();
    })
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('Descarga iniciada ✅');
    })
    .catch(e => toast(e.message, false));
};

window.deleteBackup = async function(nombre) {
  if (!confirm(`🗑️ ¿Estás seguro de que deseas ELIMINAR el respaldo:\n${nombre}?\n\nEsta acción no se puede deshacer.`)) return;
  try {
    await req('DELETE', `/admin/backups/${nombre}`);
    toast('✅ Respaldo eliminado correctamente');
    loadBackups();
  } catch(e) {
    toast('Error al eliminar: ' + e.message, false);
  }
};

// ── EXTENSIONES DE NAVEGACIÓN ────────────────────────────────────────

// ── GESTIÓN DE USUARIOS ──────────────────────────────────────────────
// Funciones para listar, crear, editar y eliminar usuarios.
// Soporta validación de contraseña (mínimo 8 caracteres).

window.loadUsuarios = async function() {
  try {
    const users = await req('GET', '/admin/usuarios');
    renderUsuarios(users);
  } catch(e) { toast(e.message, false); }
};

window.renderUsuarios = function(users) {
  const tbody = document.getElementById('users-body');
  if(!tbody) return;
  tbody.innerHTML = '';
  
  const currentUser = getSessionUser();
  
  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #f1f5f9';
    
    const fecha = u.creado ? new Date(u.creado).toLocaleDateString() : 'N/A';
    const isSelf = u.username === currentUser;
    
    const is2fa = u.totp_enabled ? '<span class="badge" style="background:#dcfce7; color:#166534;">SÍ</span>' : '<span class="badge" style="background:#f1f5f9; color:#64748b;">NO</span>';
    
    tr.innerHTML = `
      <td style="padding:12px; color:#64748b; font-weight:500;">${escapeHtml(u.nombre) || '-'}</td>
      <td style="padding:12px;"><strong>${escapeHtml(u.username)}</strong> ${isSelf ? '<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.7rem;">Tú</span>' : ''}</td>
      <td style="padding:12px; color:#64748b; font-size:0.9rem;">${escapeHtml(u.email) || '-'}</td>
      <td style="padding:12px;"><span class="badge" style="background:${u.rol === 'admin' ? '#f1f5f9' : '#fff'}; color:#475569; border:1px solid #e2e8f0;">${escapeHtml((u.rol || '').toUpperCase())}</span></td>
      <td style="padding:12px;">
        <span class="status-indicator ${u.activo ? 'status-active' : 'status-inactive'}"></span>
        ${u.activo ? 'Activo' : 'Inactivo'}
      </td>
      <td style="padding:12px; text-align:center;">${is2fa}</td>
      <td style="padding:12px;">
        <button class="btn btn-sm btn-outline" onclick="openModalUsuario(${u.id}, '${escapeJsAttr(u.username)}', '${escapeJsAttr(u.rol)}', ${u.activo}, '${escapeJsAttr(u.email || '')}', '${escapeJsAttr(u.nombre || '')}')" title="Editar">✏️</button>
        ${!isSelf ? `
          <button class="btn btn-sm btn-outline btn-danger" onclick="deleteUsuario(${u.id}, '${escapeJsAttr(u.username)}')" title="Eliminar" style="margin-left:5px;">🗑️</button>
        ` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
};

window.openModalUsuario = function(id = null, username = '', rol = 'vendedor', activo = 1, email = '', nombre = '') {
  document.getElementById('mu-id').value = id || '';
  document.getElementById('mu-username').value = username;
  document.getElementById('mu-nombre').value = nombre || '';
  document.getElementById('mu-username').readOnly = !!id;
  document.getElementById('mu-email').value = email;
  document.getElementById('mu-password').value = '';
  document.getElementById('mu-password-confirm').value = '';
  document.getElementById('mu-rol').value = rol;
  document.getElementById('mu-activo').value = activo;
  
  document.getElementById('mu-title').innerText = id ? 'Editar Usuario' : 'Nuevo Usuario';
  document.getElementById('pwd-help').style.display = id ? 'inline' : 'none';
  
  window.openModal('usuario');
};

window.saveUsuario = async function() {
  const id = document.getElementById('mu-id').value;
  const username = document.getElementById('mu-username').value.trim();
  const nombre = document.getElementById('mu-nombre').value.trim();
  const email = document.getElementById('mu-email').value.trim();
  const password = document.getElementById('mu-password').value;
  const confirm = document.getElementById('mu-password-confirm').value;
  const rol = document.getElementById('mu-rol').value;
  const activo = parseInt(document.getElementById('mu-activo').value);

  // Validaciones
  if (!username || !nombre || !email) {
    toast("Nombre usuario, Nombre real y Correo son obligatorios", false);
    return;
  }
  
  if (!email.includes('@')) {
    toast("El correo electrónico no es válido", false);
    return;
  }

  if (!id && !password) {
    toast("La contraseña es obligatoria para nuevos usuarios", false);
    return;
  }

  if (password !== confirm) {
    toast("Las contraseñas no coinciden", false);
    return;
  }

  if (password) {
    if (password.length < 8) {
      toast("La contraseña debe tener al menos 8 caracteres", false);
      return;
    }
  }

  const payload = { email, nombre, rol, activo };
  if (password) payload.password = password;
  if (!id) payload.username = username;

  try {
    const method = id ? 'PUT' : 'POST';
    const path = id ? `/admin/usuarios/${id}` : `/admin/usuarios`;
    await req(method, path, payload);
    toast(id ? "Usuario actualizado" : "Usuario creado", true);
    
    // Si editamos nuestro propio perfil, refrescar sesión
    if (id && id.toString() === localStorage.getItem('inv_user_id')) {
        localStorage.setItem('inv_nombre', nombre);
        showApp(localStorage.getItem('inv_rol'), localStorage.getItem('inv_user'));
    }

    window.closeModal('usuario');
    window.loadUsuarios();
  } catch (err) {
    toast(err.message, false);
  }
};

window.deleteUsuario = function(id, username) {
  if(window.showConfirm) {
    window.showConfirm(
      `¿Estás seguro de que deseas eliminar permanentemente al usuario ${username}? Esta acción no se puede deshacer.`,
      async () => {
        try {
          await req('DELETE', `/admin/usuarios/${id}`);
          toast("Usuario eliminado", true);
          window.loadUsuarios();
        } catch (err) {
          toast(err.message, false);
        }
      }
    );
  } else {
    if(confirm(`¿Estás seguro de que deseas eliminar a ${username}?`)) {
       req('DELETE', `/admin/usuarios/${id}`).then(() => {
          toast("Usuario eliminado", true);
          window.loadUsuarios();
       }).catch(e => toast(e.message, false));
    }
  }
};

// (Wrappers de navegación movidos a la función consolidada)

// ── NOTIFICACIONES DEL SISTEMA ──────────────────────────────────────────

window.loadNotificaciones = async function() {
  const token = getToken();
  if (!token) return;
  try {
    const list = await req('GET', '/notificaciones');
    if (list) renderNotificacionesList(list);
  } catch (e) {
    console.warn('Error al cargar notificaciones', e);
  }
}

window.renderNotificacionesList = function(list) {
  const panelList = document.getElementById('notifications-list');
  const badge = document.getElementById('bell-badge');
  if (!panelList || !badge) return;
  
  const pendientes = list.filter(n => !n.leida);
  if (pendientes.length > 0) {
    badge.textContent = pendientes.length;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
  
  if (list.length === 0) {
    panelList.innerHTML = '<div class="notif-empty">No tienes notificaciones pendientes.</div>';
    return;
  }
  
  // Mostrar las pendientes primero, luego leídas
  list.sort((a,b) => {
    if (a.leida === b.leida) return new Date(b.fecha) - new Date(a.fecha);
    return a.leida ? 1 : -1;
  });

  panelList.innerHTML = list.map(n => `
    <div class="notif-item ${n.leida ? 'leida' : 'unread'}" onclick="marcarUnaleida(${n.id})">
      <span class="notif-msg">${escapeHtml(n.mensaje)}</span>
      <span class="notif-time">${new Date(n.fecha).toLocaleString('es-MX')}</span>
    </div>
  `).join('');
}

window.toggleNotifications = function() {
  const panel = document.getElementById('notifications-panel');
  if (panel.style.display === 'none' || !panel.classList.contains('active')) {
    panel.style.display = 'flex';
    // timeout para animación CSS
    setTimeout(() => panel.classList.add('active'), 10);
    window.loadNotificaciones();
  } else {
    panel.classList.remove('active');
    setTimeout(() => panel.style.display = 'none', 200);
  }
};

window.marcarUnaleida = async function(id) {
  try {
    await req('PUT', `/notificaciones/${id}/leer`);
    window.loadNotificaciones();
  } catch (e) {
    console.error('Error al marcar notificacion leida', e);
  }
};

window.marcarTodasLeidas = async function() {
  try {
    const list = await req('GET', '/notificaciones');
    const pendientes = list.filter(n => !n.leida);
    for (const p of pendientes) {
      // Idealmente el backend tendría un endpoint batch, por ahora bucle:
      await req('PUT', `/notificaciones/${p.id}/leer`);
    }
    window.loadNotificaciones();
  } catch (e) {
    toast('Error al limpiar todo', false);
  }
};

// Cerrar panel al hacer click fuera
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifications-panel');
  const bell = document.querySelector('.nav-bell');
  if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
     if(panel.classList.contains('active')) {
       panel.classList.remove('active');
       setTimeout(() => panel.style.display = 'none', 200);
     }
  }
});

/* ── GESTIÓN DE DESCUENTOS ────────────────────────────────────────── */

let descuentos = [];

async function loadDescuentos() {
  try {
    descuentos = await req('GET', '/descuentos');
    renderDescuentos();
  } catch (e) { toast(e.message, false); }
}

function renderDescuentos() {
  const search = (document.getElementById('d-search')?.value || '').toLowerCase();
  const tbody = document.getElementById('d-body');
  if (!tbody) return;
  
  const filtered = descuentos.filter(d =>
    coincideBusqueda([d.codigo, d.barcode], search)
  );

  tbody.innerHTML = '';
  if (filtered.length === 0) {
    document.getElementById('d-empty').style.display = 'block';
    return;
  }
  document.getElementById('d-empty').style.display = 'none';

  filtered.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(d.codigo)}</strong></td>
      <td>${d.tipo === 'porcentaje' ? 'Porcentaje' : 'Monto Fijo'}</td>
      <td>${d.tipo === 'porcentaje' ? escapeHtml(d.valor) + '%' : mxn(d.valor)}</td>
      <td>${d.min_items}</td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <small>${escapeHtml(d.barcode) || '—'}</small>
          <button class="btn btn-sm btn-outline" onclick="descargarBarcode('${escapeJsAttr(d.barcode || d.codigo)}', '${escapeJsAttr(d.codigo)}')" title="Descargar Código de Barras" style="padding: 2px 5px; font-size: 0.8rem;">📥</button>
        </div>
      </td>
      <td><span class="badge ${d.activo ? 'badge-ok' : 'badge-out'}">${d.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="editDescuento(${d.id})">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deleteDescuento(${d.id})">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById('d-total').textContent = descuentos.filter(x => x.activo).length;
}

window.saveDescuento = async function() {
  const data = {
    codigo: document.getElementById('md-codigo').value.trim().toUpperCase(),
    tipo: document.getElementById('md-tipo').value,
    valor: parseFloat(document.getElementById('md-valor').value) || 0,
    min_items: parseInt(document.getElementById('md-min-items').value) || 1,
    activo: document.getElementById('md-activo').value === '1',
    barcode: document.getElementById('md-barcode').value.trim() || null
  };

  if (!data.codigo || data.valor <= 0) {
    toast('El código y el valor son obligatorios', false);
    return;
  }

  try {
    if (editingId) {
      await req('PUT', `/descuentos/${editingId}`, data);
      toast('✅ Cupón actualizado');
    } else {
      await req('POST', '/descuentos', data);
      toast('✅ Cupón creado');
    }
    closeModal('descuento');
    loadDescuentos();
  } catch (e) { toast(e.message, false); }
};

window.editDescuento = function(id) {
  const d = descuentos.find(x => x.id === id);
  if (!d) return;
  editingId = id;
  document.getElementById('md-title').textContent = 'Editar Cupón';
  document.getElementById('md-id').value = d.id;
  document.getElementById('md-codigo').value = d.codigo;
  document.getElementById('md-tipo').value = d.tipo;
  document.getElementById('md-valor').value = d.valor;
  document.getElementById('md-min-items').value = d.min_items;
  document.getElementById('md-activo').value = d.activo ? '1' : '0';
  document.getElementById('md-barcode').value = d.barcode || '';
  openModal('descuento');
};

window.deleteDescuento = function(id) {
  showConfirm('¿Seguro que deseas eliminar este código de descuento?', async () => {
    try {
      await req('DELETE', `/descuentos/${id}`);
      toast('✅ Cupón eliminado');
      loadDescuentos();
    } catch (e) { toast(e.message, false); }
  });
};
 
window.descargarBarcode = function(barcode, codigo) {
  try {
    const canvas = document.getElementById('barcode-canvas');
    if (!canvas) return;
    
    // Generar el código de barras en el canvas oculto
    JsBarcode(canvas, barcode, {
      format: "CODE128",
      lineColor: "#000",
      width: 2,
      height: 100,
      displayValue: true,
      fontSize: 20
    });
    
    // Convertir a imagen y descargar
    const url = canvas.toDataURL("image/png");
    const link = document.createElement('a');
    link.href = url;
    link.download = `barcode_${codigo}_${barcode}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast('✅ Código de barras descargado');
  } catch (e) {
    console.error('Error al generar barcode', e);
    toast('❌ Error al generar el código de barras', false);
  }
};

window.renderDescuentos = renderDescuentos;



/**
 * ── CONFIGURACIÓN DE 2FA (TOTP) ──────────────────────────────────────
 * Inicia el flujo de configuración generando un QR y mostrando el secreto.
 * Requiere la librería QRCode.js en el index.html.
 */
window.open2FASetup = async function() {
    try {
        const setup = await req('POST', '/auth/2fa/setup');
        const container = document.getElementById('2fa-qr-container');
        container.innerHTML = '';
        // Usar la librería QRCode (asegúrate de que esté cargada en index.html)
        new QRCode(container, {
            text: setup.provisioning_uri,
            width: 180,
            height: 180
        });
        document.getElementById('2fa-secret-text').textContent = "Secreto: " + setup.secret;
        document.getElementById('setup-2fa-code').value = '';
        openModal('2fa-setup');
    } catch(e) {
        alert("Error al iniciar 2FA: " + e.message);
    }
}

window.confirm2FASetup = async function() {
    const code = document.getElementById('setup-2fa-code').value.replace(/\s/g, '');
    if(!code) return alert("Ingresa el código");
    try {
        await req('POST', '/auth/2fa/enable', {code});
        alert("¡Autenticación 2FA activada con éxito!");
        closeModal('2fa-setup');
    } catch(e) {
        alert("Código inválido: " + e.message);
    }
}

/**
 * ── PASSKEYS (WEBAUTHN): GESTIÓN ─────────────────────────────────────
 * Modal overlay-passkey-setup (index.html): lista, registra y elimina
 * las passkeys del usuario en sesión. La llave privada nunca sale del
 * dispositivo; el servidor solo guarda la llave pública.
 */

// Aviso dentro del modal de passkeys (verde éxito / rojo error)
function passkeyMsg(texto, esError) {
    const box = document.getElementById('passkey-msg');
    if (!box) return;
    box.textContent = texto;
    box.style.display = 'block';
    box.style.background = esError ? '#fef2f2' : '#f0fdf4';
    box.style.color = esError ? '#b91c1c' : '#15803d';
    box.style.border = esError ? '1px solid #fecaca' : '1px solid #bbf7d0';
}

// Nombre automático según sistema/navegador (el usuario puede escribir otro)
function nombrePasskey() {
    const ua = navigator.userAgent;
    const so = /Windows/i.test(ua) ? 'Windows'
        : /Android/i.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
        : /Mac OS X/i.test(ua) ? 'Mac'
        : /Linux/i.test(ua) ? 'Linux' : 'Dispositivo';
    const nav = /Edg\//.test(ua) ? 'Edge'
        : /OPR\//.test(ua) ? 'Opera'
        : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
    return so + ' · ' + nav;
}

window.openPasskeySetup = function() {
    if (!passkeysDisponibles()) {
        alert('Este navegador no puede usar passkeys aquí (requiere HTTPS o localhost).');
        return;
    }
    const box = document.getElementById('passkey-msg');
    if (box) box.style.display = 'none';
    openModal('passkey-setup');
    loadPasskeys();
};

async function loadPasskeys() {
    const lista = document.getElementById('passkey-list');
    if (!lista) return;
    lista.innerHTML = '<p style="padding:12px; color:#999; font-size:0.85rem;">Cargando…</p>';
    try {
        const creds = await req('GET', '/auth/webauthn/credenciales');
        if (!creds.length) {
            lista.innerHTML = '<p style="padding:12px; color:#999; font-size:0.85rem;">Aún no tienes passkeys registradas. La primera que registres será tu segundo factor en este dispositivo.</p>';
            return;
        }
        lista.innerHTML = creds.map(c => {
            const creado = c.creado ? new Date(c.creado).toLocaleDateString() : '—';
            const ultimo = c.ultimo_uso ? new Date(c.ultimo_uso).toLocaleDateString() : 'sin uso';
            return `
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid #f3f4f6;">
                <div style="min-width:0;">
                  <p style="margin:0; font-weight:600; font-size:0.9rem;">🔑 ${escapeHtml(c.nombre || 'Passkey')}</p>
                  <p style="margin:2px 0 0; color:#9ca3af; font-size:0.75rem;">Creada: ${creado} · Último uso: ${ultimo}</p>
                </div>
                <button class="btn btn-sm btn-outline" style="color:#ef4444; border-color:#fca5a5; flex-shrink:0;" onclick="eliminarPasskey(${c.id})" title="Eliminar">Eliminar</button>
              </div>`;
        }).join('');
    } catch(e) {
        lista.innerHTML = '';
        passkeyMsg('No se pudieron cargar tus passkeys: ' + e.message, true);
    }
}

window.registrarPasskey = async function() {
    const btn = document.getElementById('btn-passkey-add');
    const original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Esperando al dispositivo…'; }
    try {
        const opts = await req('POST', '/auth/webauthn/register/options');
        opts.challenge = b64urlToBuf(opts.challenge);
        opts.user.id = b64urlToBuf(opts.user.id);
        if (opts.excludeCredentials) {
            opts.excludeCredentials = opts.excludeCredentials.map(c => ({...c, id: b64urlToBuf(c.id)}));
        }
        const cred = await navigator.credentials.create({publicKey: opts});
        let nombre = (document.getElementById('passkey-name').value || '').trim();
        if (!nombre) nombre = nombrePasskey();
        await req('POST', '/auth/webauthn/register/verify', {credential: credToJSON(cred), nombre});
        document.getElementById('passkey-name').value = '';
        passkeyMsg('✅ Passkey registrada. Desde ahora podrás usarla como segundo factor.', false);
        loadPasskeys();
    } catch(e) {
        if (e && e.name === 'NotAllowedError') {
            passkeyMsg('❌ El registro fue cancelado o el dispositivo no respondió.', true);
        } else if (e && e.name === 'InvalidStateError') {
            passkeyMsg('Este dispositivo ya tiene registrada una passkey para la app.', true);
        } else {
            passkeyMsg('No se pudo registrar la passkey: ' + (e.message || 'error inesperado'), true);
        }
        console.error('registrarPasskey', e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
    }
};

window.eliminarPasskey = function(id) {
    showConfirm('¿Eliminar esta passkey? Ya no podrás usarla como segundo factor en ese dispositivo.', async () => {
        try {
            await req('DELETE', '/auth/webauthn/credenciales/' + id);
            passkeyMsg('Passkey eliminada.', false);
            loadPasskeys();
        } catch(e) {
            passkeyMsg('No se pudo eliminar: ' + e.message, true);
        }
    });
};

// ── Sidebar Toggle Logic (Lumina Glass Layout) ──
window.toggleSidebarCollapse = function() {
    const layout = document.getElementById('app-layout');
    if (layout) layout.classList.toggle('sidebar-collapsed');
};

window.toggleSidebarMenu = function() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    // Si la pantalla es móvil o la ocultó (la clase 'active' lo mostrará)
    if (sidebar) sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active');
};

// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE ATAJOS DE TECLADO (SHORTCUTS)
// ═══════════════════════════════════════════════════════════════════

window.toggleShortcutsPanel = function() {
    const overlay = document.getElementById('overlay-shortcuts');
    if (!overlay) return;
    if (overlay.classList.contains('active')) {
        closeModal('shortcuts');
    } else {
        openModal('shortcuts');
    }
};

// ── Mapa de navegación Alt+N ─────────────────────────────────────
const NAV_SHORTCUTS = {
    '1': 'dashboard',
    '2': 'inventario',
    '3': 'ventas',
    '4': 'conteo',
    '5': 'ordenes_compra',
    '6': 'historial',
    '7': 'reporte'
};

document.addEventListener('keydown', function(e) {
    // No capturar si estamos en un input/textarea/select
    const tag = (e.target.tagName || '').toLowerCase();
    const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';
    
    // No capturar si no estamos logueados
    if (!getToken()) return;

    // ── Esc → Cerrar modales ──
    if (e.key === 'Escape') {
        const overlays = document.querySelectorAll('.overlay.active');
        if (overlays.length > 0) {
            overlays.forEach(o => {
                const id = o.id.replace('overlay-', '');
                closeModal(id);
            });
            e.preventDefault();
            return;
        }
        // Cerrar panel de notificaciones
        const notifPanel = document.getElementById('notifications-panel');
        if (notifPanel && notifPanel.style.display !== 'none' && notifPanel.style.display !== '') {
            notifPanel.style.display = 'none';
            e.preventDefault();
            return;
        }
    }

    // ── ? → Mostrar shortcuts (solo si no está en input) ──
    if (e.key === '?' && !isInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        toggleShortcutsPanel();
        return;
    }

    // ── Ctrl+K → Búsqueda global (focus en search) ──
    if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById('search');
        if (searchInput) {
            showPage('inventario');
            setTimeout(() => {
                searchInput.focus();
                searchInput.select();
            }, 100);
        }
        return;
    }

    // ── Alt+N → Nuevo producto ──
    if (e.altKey && !e.shiftKey && e.key === 'n') {
        e.preventDefault();
        editingId = null;
        document.getElementById('mp-title').textContent = 'Agregar Producto';
        document.getElementById('mp-nombre').value = '';
        document.getElementById('mp-sku').value = '';
        document.getElementById('mp-cat').value = '';
        document.getElementById('mp-qty').value = '0';
        document.getElementById('mp-min').value = '2';
        document.getElementById('mp-costo').value = '0';
        document.getElementById('mp-venta').value = '0';
        document.getElementById('mp-notas-internas').value = '';
        document.getElementById('mp-proveedores-alt').value = '';
        document.getElementById('variants-list').innerHTML = '';
        openModal('producto');
        setTimeout(() => document.getElementById('mp-nombre').focus(), 100);
        return;
    }

    // ── Alt+Shift+N → Nueva orden de compra ──
    if (e.altKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
        e.preventDefault();
        if (window.openNuevaOrden) openNuevaOrden();
        return;
    }

    // ── Alt+1..7 → Navegación rápida ──
    if (e.altKey && NAV_SHORTCUTS[e.key]) {
        e.preventDefault();
        const pageId = NAV_SHORTCUTS[e.key];
        showPage(pageId);
        return;
    }
});

// Mostrar/ocultar botón de atajos según estado de login
function updateShortcutsFabVisibility() {
    const btn = document.getElementById('shortcuts-fab');
    if (btn) {
        btn.style.display = getToken() ? 'flex' : 'none';
    }
}

// Hook into showApp to show FAB
const _originalShowApp = showApp;
if (typeof _originalShowApp === 'function') {
    // Override showApp is not needed since it's a declared function
    // Instead we attach to DOMContentLoaded
}

// Inicializar FAB visibility
// Inicializar FAB visibility y restaurar sesión
document.addEventListener('DOMContentLoaded', async function() {
    updateShortcutsFabVisibility();
    
    // Restaurar sesión si hay token
    const token = getToken();
    if (token) {
        try {
            // Obtener perfil actualizado desde el servidor
            const me = await req('GET', '/auth/me');
            if (me) {
                localStorage.setItem('inv_nombre', me.nombre || me.username);
                localStorage.setItem('inv_user', me.username);
                localStorage.setItem('inv_rol', me.rol);
                localStorage.setItem('inv_user_id', me.id || '');
                showApp(me.rol, me.username);
            }
        } catch (e) {
            if (e && e.status === 401) return; // req() ya hizo doLogout() y mostró el aviso
            console.error('Error restaurando sesión:', e);
            showApp(getSessionRol(), getSessionUser());
        }
    }
    
    setTimeout(updateShortcutsFabVisibility, 500);
});

// Also update when showApp is called - patch the original
const _origShowAppRef = window.showApp || showApp;
// Actualizar visibilidad del botón cada 2s (el login puede restaurarse desde localStorage)
setInterval(() => {
    const btn = document.getElementById('shortcuts-fab');
    if (btn) btn.style.display = getToken() ? 'flex' : 'none';
}, 2000);
