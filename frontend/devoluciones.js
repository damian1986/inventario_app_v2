// ═══════════════════════════════════════════════════════════════════
// MÓDULO: PLAYERAS EN DEVOLUCIÓN (piezas devueltas por clientes)
// Piezas que regresan de una venta (o se registran a mano), con diseño
// y foto para distinguirlas aunque compartan talla y color.
// Roles: admin registra/edita/descarta; admin y vendedor venden; todos ven.
// ═══════════════════════════════════════════════════════════════════

let devPiezas = [];                 // Piezas de GET /devoluciones
let devFiltroEstado = 'todas';
let devTermino = '';
let devEditandoId = null;           // null = alta | id = edición
let devProductoSel = null;          // {id, nombre} seleccionado en el alta
let devVenderId = null;
let devFotoPendienteId = null;      // Pieza a la que se subirá foto desde una tarjeta
let devResumenTotal = 0;            // Unidades disponibles (GET /devoluciones/resumen)
window.devResumenDisponibles = {};  // producto_id -> unidades disponibles (columna «Devueltas»)
const _devImgCache = {};            // `${id}:${imagen}` -> objectURL

function _devEsAdmin() { return getSessionRol() === 'admin'; }
function _devPuedeVender() { const r = getSessionRol(); return r === 'admin' || r === 'vendedor'; }

// ── Carga y render ───────────────────────────────────────────────────
window.renderDevoluciones = async function() {
  const cont = document.getElementById('dev-lista');
  const btnNueva = document.getElementById('dev-btn-nueva');
  if (btnNueva) btnNueva.style.display = _devEsAdmin() ? '' : 'none';
  if (cont && !devPiezas.length) cont.innerHTML = '<div class="cart-empty">Cargando piezas devueltas…</div>';

  if (!productos.length) { try { await loadProductos(); } catch (e) { /* el alta pedirá productos de nuevo */ } }

  try {
    const [piezas, resumen] = await Promise.all([
      req('GET', '/devoluciones?limit=1000'),
      req('GET', '/devoluciones/resumen')
    ]);
    devPiezas = piezas || [];
    devResumenTotal = resumen.total || 0;
    window.devResumenDisponibles = {};
    (resumen.items || []).forEach(it => { window.devResumenDisponibles[it.producto_id] = it.disponibles; });
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="cart-empty">Error al cargar devoluciones: ${escapeHtml(e.message)}</div>`;
    return;
  }

  renderDevolucionesStats();
  renderDevolucionesLista();
};

function renderDevolucionesStats() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
  const activas = devPiezas.filter(d => d.estado === 'disponible');
  const sumaPor = est => devPiezas.filter(d => d.estado === est).reduce((a, d) => a + (d.qty || 0), 0);
  set('dev-stat-disp', devResumenTotal || activas.reduce((a, d) => a + (d.qty || 0), 0));
  set('dev-stat-activas', activas.length);
  set('dev-stat-vend', sumaPor('vendida'));
  set('dev-stat-desc', sumaPor('descartada'));
}

function _devFecha(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) +
         ' ' + dt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function devPiezasFiltradas() {
  return devPiezas.filter(d => {
    if (devFiltroEstado !== 'todas' && d.estado !== devFiltroEstado) return false;
    if (devTermino) {
      return coincideBusqueda(
        [d.producto_nombre, d.diseno, d.folio_origen, d.notas, d.motivo, d.color, d.talla, d.variante],
        devTermino
      );
    }
    return true;
  });
}

window.filtrarDevoluciones = function(val) {
  devTermino = val || '';
  renderDevolucionesLista();
};

window.filtrarDevolucionesEstado = function(estado, btn) {
  devFiltroEstado = estado;
  document.querySelectorAll('#dev-filtros .dev-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderDevolucionesLista();
};

function _devBadgeEstado(estado) {
  if (estado === 'disponible') return '<span class="badge badge-ok">Disponible</span>';
  if (estado === 'vendida') return '<span class="badge badge-sale">Vendida</span>';
  return '<span class="badge badge-out">Descartada</span>';
}

function renderDevolucionesLista() {
  const cont = document.getElementById('dev-lista');
  if (!cont) return;
  const lista = devPiezasFiltradas();

  if (!lista.length) {
    cont.innerHTML = `<div class="cart-empty">${devPiezas.length ? 'Ninguna pieza coincide con el filtro.' : 'Aún no hay playeras en devolución. Registra la primera con el botón de arriba.'}</div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'dev-grid';
  lista.forEach(d => grid.appendChild(_devCard(d)));
  cont.innerHTML = '';
  cont.appendChild(grid);
  hidratarFotosDevoluciones();
}

function _devCard(d) {
  const card = document.createElement('div');
  card.className = `dev-card dev-card-${d.estado}`;

  const chips = [
    d.color ? `<span class="chip">${escapeHtml(d.color)}</span>` : '',
    d.talla ? `<span class="chip">${escapeHtml(d.talla)}</span>` : ''
  ].join('');

  let acciones = '';
  if (d.estado === 'disponible') {
    if (_devPuedeVender()) acciones += `<button class="btn btn-sm btn-primary" onclick="abrirVenderDevolucion(${d.id})">💰 Vender</button>`;
    if (_devEsAdmin()) {
      acciones += `<button class="btn btn-sm btn-outline" onclick="abrirEditarDevolucion(${d.id})">✏️ Editar</button>`;
      acciones += `<button class="btn btn-sm btn-outline btn-danger" onclick="descartarDevolucion(${d.id})">🚫 Descartar</button>`;
    }
  } else {
    acciones += `<span style="font-size:0.78rem; color:#64748b;">Salida: ${escapeHtml(_devFecha(d.fecha_salida))}</span>`;
  }

  const botonFoto = (!d.imagen && _devEsAdmin())
    ? '<button class="btn btn-sm btn-outline" onclick="subirFotoAPieza(' + d.id + ')">📷 Subir foto</button>'
    : '';

  card.innerHTML = `
    <div class="dev-foto">
      <img class="dev-foto-img" style="display:none;" alt="Diseño de la pieza"
           data-foto-id="${d.id}" data-foto-clave="${escapeHtml(d.imagen || '')}">
      <div class="dev-foto-vacia">
        <div style="font-size:1.6rem;">📷</div>
        <div>${d.imagen ? 'Cargando foto…' : 'Sin foto'}</div>
        ${botonFoto}
      </div>
    </div>
    <div class="dev-cuerpo">
      <div class="dev-nombre">${escapeHtml(d.producto_nombre || 'Producto eliminado')}</div>
      ${chips ? `<div style="margin-bottom:6px;">${chips}</div>` : ''}
      <div class="dev-diseno">🎨 ${escapeHtml(d.diseno || 'Sin descripción de diseño')}</div>
      ${d.motivo ? `<div class="dev-motivo">↩️ ${escapeHtml(d.motivo)}</div>` : ''}
      ${d.notas ? `<div class="dev-notas">📝 ${escapeHtml(d.notas)}</div>` : ''}
      <div class="dev-datos">${d.qty} × ${mxn(d.precio)}</div>
      <div class="dev-meta">
        ${d.folio_origen ? `<span class="chip" title="Folio de origen">📄 ${escapeHtml(d.folio_origen)}</span>` : ''}
        <span>Ingreso: ${escapeHtml(_devFecha(d.fecha_ingreso))}</span>
      </div>
    </div>
    <div class="dev-acciones">
      ${_devBadgeEstado(d.estado)}
      ${acciones}
    </div>
  `;
  return card;
}

// ── Fotos (fetch con token → blob URL, cacheadas por id+archivo) ─────
function hidratarFotosDevoluciones() {
  document.querySelectorAll('#dev-lista img[data-foto-id]').forEach(img => {
    const id = img.getAttribute('data-foto-id');
    const clave = img.getAttribute('data-foto-clave') || '';
    if (!clave) return; // Sin imagen registrada: se queda el placeholder
    const key = id + ':' + clave;
    const mostrar = (url) => {
      img.src = url;
      img.style.display = '';
      const vacia = img.parentElement.querySelector('.dev-foto-vacia');
      if (vacia) vacia.style.display = 'none';
    };
    if (_devImgCache[key]) { mostrar(_devImgCache[key]); return; }
    fetch(API + `/devoluciones/${id}/imagen`, { headers: { 'Authorization': 'Bearer ' + getToken() } })
      .then(r => { if (!r.ok) throw new Error('sin imagen'); return r.blob(); })
      .then(blob => { _devImgCache[key] = URL.createObjectURL(blob); mostrar(_devImgCache[key]); })
      .catch(() => { /* el placeholder queda visible */ });
  });
}

// ── Compresión de imagen en canvas (máx 1000px, JPEG) ────────────────
function comprimirImagenDevolucion(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No se seleccionó ninguna imagen')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1000;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > max) {
        const escala = max / Math.max(w, h);
        w = Math.round(w * escala);
        h = Math.round(h * escala);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // PNG transparente → JPEG sin fondo negro
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('No se pudo procesar la imagen'));
      }, 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen (usa JPG, PNG o WEBP)')); };
    img.src = url;
  });
}

async function devMultipart(path, formData) {
  const opts = { method: 'POST', headers: {} };
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  opts.body = formData;
  const r = await fetch(API + path, opts);
  if (r.status === 401) { doLogout(); throw new Error('Sesión expirada'); }
  if (!r.ok) {
    let det = 'Error al subir la información';
    try { const e = await r.json(); det = e.detail || det; } catch (_) { /* respuesta sin JSON */ }
    throw new Error(typeof det === 'string' ? det : JSON.stringify(det));
  }
  return r.json();
}

// ── Alta / Edición ───────────────────────────────────────────────────
window.abrirAltaDevolucion = function() {
  devEditandoId = null;
  devProductoSel = null;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  document.getElementById('dev-alta-title').textContent = '↩️ Registrar pieza devuelta';
  const buscar = document.getElementById('dev-alta-producto-buscar');
  buscar.value = ''; buscar.disabled = false;
  set('dev-alta-producto-id', '');
  document.getElementById('dev-alta-producto-results').style.display = 'none';
  set('dev-alta-qty', 1);
  set('dev-alta-precio', '');
  document.getElementById('dev-alta-precio').placeholder = 'Auto (precio de lista)';
  set('dev-alta-diseno', '');
  set('dev-alta-motivo', '');
  set('dev-alta-notas', '');
  document.getElementById('dev-alta-contada').checked = false;
  document.getElementById('dev-alta-contada-wrap').style.display = '';
  document.getElementById('dev-alta-foto').value = '';
  document.getElementById('dev-alta-foto-hint').textContent = 'La foto del diseño es obligatoria.';
  limpiarPreviewFotoDevolucion();
  openModal('dev-alta');
};

window.abrirEditarDevolucion = function(id) {
  const d = devPiezas.find(x => x.id === id);
  if (!d) return;
  devEditandoId = id;
  devProductoSel = { id: d.producto_id, nombre: d.producto_nombre };
  document.getElementById('dev-alta-title').textContent = '✏️ Editar pieza devuelta';
  const buscar = document.getElementById('dev-alta-producto-buscar');
  buscar.value = d.producto_nombre || ''; buscar.disabled = true;
  document.getElementById('dev-alta-producto-id').value = d.producto_id || '';
  document.getElementById('dev-alta-producto-results').style.display = 'none';
  document.getElementById('dev-alta-qty').value = d.qty;
  document.getElementById('dev-alta-precio').value = (d.precio || d.precio === 0) ? d.precio : '';
  document.getElementById('dev-alta-diseno').value = d.diseno || '';
  document.getElementById('dev-alta-motivo').value = d.motivo || '';
  document.getElementById('dev-alta-notas').value = d.notas || '';
  document.getElementById('dev-alta-contada-wrap').style.display = 'none';
  document.getElementById('dev-alta-foto').value = '';
  document.getElementById('dev-alta-foto-hint').textContent = d.imagen
    ? 'Opcional: sube otra foto para reemplazar la actual.'
    : 'Esta pieza no tiene foto. Sube una (obligatoria para piezas nuevas).';
  limpiarPreviewFotoDevolucion();
  openModal('dev-alta');
};

window.buscarProductoDevolucion = function(val) {
  const box = document.getElementById('dev-alta-producto-results');
  if (!box) return;
  const term = (val || '').trim();
  if (term.length < 2 || devEditandoId) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const matches = productos.filter(p => coincideBusqueda([p.nombre, p.sku, p.categoria], term)).slice(0, 8);
  if (!matches.length) {
    box.innerHTML = '<div class="dev-result-item" style="color:#94a3b8; cursor:default;">Sin resultados</div>';
  } else {
    box.innerHTML = matches.map(p =>
      `<div class="dev-result-item" onclick="seleccionarProductoDevolucion(${p.id})">
         <strong>${escapeHtml(p.nombre)}</strong>
         <small>${escapeHtml(p.sku || 'Sin SKU')} · Stock: ${p.qty}</small>
       </div>`
    ).join('');
  }
  box.style.display = '';
};

window.seleccionarProductoDevolucion = function(pid) {
  const p = productos.find(x => x.id === pid);
  if (!p) return;
  devProductoSel = { id: p.id, nombre: p.nombre };
  document.getElementById('dev-alta-producto-id').value = p.id;
  document.getElementById('dev-alta-producto-buscar').value = p.nombre;
  document.getElementById('dev-alta-producto-results').style.display = 'none';
  const precioInp = document.getElementById('dev-alta-precio');
  if (precioInp && !precioInp.value) precioInp.placeholder = `Auto (${mxn(p.venta)})`;
};

function limpiarPreviewFotoDevolucion() {
  const prev = document.getElementById('dev-alta-foto-preview');
  if (!prev) return;
  if (prev.dataset.url) { URL.revokeObjectURL(prev.dataset.url); delete prev.dataset.url; }
  prev.style.display = 'none';
  prev.removeAttribute('src');
}

window.previsualizarFotoDevolucion = function(input) {
  const prev = document.getElementById('dev-alta-foto-preview');
  if (!prev) return;
  if (!input.files || !input.files.length) { limpiarPreviewFotoDevolucion(); return; }
  limpiarPreviewFotoDevolucion();
  const url = URL.createObjectURL(input.files[0]);
  prev.dataset.url = url;
  prev.src = url;
  prev.style.display = '';
};

window.guardarDevolucion = async function() {
  const btn = document.getElementById('dev-alta-guardar');
  const diseno = document.getElementById('dev-alta-diseno').value.trim();
  const qty = parseInt(document.getElementById('dev-alta-qty').value);
  const precioRaw = document.getElementById('dev-alta-precio').value;
  const motivo = document.getElementById('dev-alta-motivo').value.trim();
  const notas = document.getElementById('dev-alta-notas').value.trim();
  const fotoInput = document.getElementById('dev-alta-foto');

  if (!devEditandoId && (!devProductoSel || !devProductoSel.id)) { toast('Selecciona el producto devuelto', false); return; }
  if (!diseno) { toast('Describe el diseño de la pieza (así la distingues de otras iguales)', false); return; }
  if (!qty || qty < 1) { toast('La cantidad debe ser al menos 1', false); return; }
  if (precioRaw !== '' && (isNaN(parseFloat(precioRaw)) || parseFloat(precioRaw) < 0)) { toast('Precio inválido', false); return; }
  if (!devEditandoId && (!fotoInput.files || !fotoInput.files.length)) { toast('La foto del diseño es obligatoria', false); return; }

  btn.disabled = true;
  const txtOriginal = btn.textContent;
  btn.textContent = 'Guardando…';
  try {
    if (devEditandoId) {
      const body = { diseno, qty, motivo, notas };
      if (precioRaw !== '') body.precio = parseFloat(precioRaw);
      await req('PATCH', `/devoluciones/${devEditandoId}`, body);
      if (fotoInput.files && fotoInput.files.length) {
        await devSubirFotoPieza(devEditandoId, fotoInput.files[0]);
      }
      toast('✅ Pieza actualizada');
    } else {
      const blob = await comprimirImagenDevolucion(fotoInput.files[0]);
      const fd = new FormData();
      fd.append('producto_id', String(devProductoSel.id));
      fd.append('qty', String(qty));
      fd.append('diseno', diseno);
      fd.append('motivo', motivo);
      fd.append('notas', notas);
      if (precioRaw !== '') fd.append('precio', String(parseFloat(precioRaw)));
      fd.append('ya_contada', document.getElementById('dev-alta-contada').checked ? 'true' : 'false');
      fd.append('foto', blob, 'diseno.jpg');
      await devMultipart('/devoluciones', fd);
      toast('✅ Pieza devuelta registrada');
    }
    closeModal('dev-alta');
    devEditandoId = null;
    devProductoSel = null;
    await loadProductos();
    await renderDevoluciones();
  } catch (e) {
    toast('Error: ' + e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = txtOriginal;
  }
};

// ── Vender pieza devuelta ────────────────────────────────────────────
window.abrirVenderDevolucion = function(id) {
  const d = devPiezas.find(x => x.id === id);
  if (!d || d.estado !== 'disponible') return;
  devVenderId = id;
  document.getElementById('dev-vender-resumen').innerHTML = `
    <strong>${escapeHtml(d.producto_nombre || 'Producto eliminado')}</strong>
    ${d.color ? `<span class="chip" style="margin-left:6px;">${escapeHtml(d.color)}</span>` : ''}
    ${d.talla ? `<span class="chip">${escapeHtml(d.talla)}</span>` : ''}
    <div style="margin-top:6px; font-size:0.85rem; color:#666;">🎨 ${escapeHtml(d.diseno || 'Sin descripción de diseño')}</div>
    <div style="margin-top:4px; font-size:0.9rem;">${d.qty} × ${mxn(d.precio)} = <strong>${mxn(d.qty * d.precio)}</strong></div>
  `;
  document.getElementById('dev-vender-canal').value = 'Devolución';
  document.getElementById('dev-vender-notas').value = '';
  openModal('dev-vender');
};

window.confirmarVenderDevolucion = async function() {
  if (!devVenderId) return;
  const canal = document.getElementById('dev-vender-canal').value.trim() || 'Devolución';
  const notas = document.getElementById('dev-vender-notas').value.trim();
  try {
    const data = await req('POST', `/devoluciones/${devVenderId}/vender`, { canal, notas });
    toast(`✅ ${data.mensaje || 'Pieza vendida'}`);
    closeModal('dev-vender');
    devVenderId = null;
    await loadProductos();
    await renderDevoluciones();
  } catch (e) {
    toast('Error al vender: ' + e.message, false);
  }
};

// ── Descartar pieza ──────────────────────────────────────────────────
window.descartarDevolucion = function(id) {
  const d = devPiezas.find(x => x.id === id);
  if (!d) return;
  showConfirm(
    `¿Descartar esta pieza (${d.qty} unidad(es) de "${d.producto_nombre}")? Se descontará del stock y quedará registrada como descartada.`,
    async () => {
      try {
        await req('POST', `/devoluciones/${id}/descartar`, { motivo: 'Descarte manual' });
        toast('🗑️ Pieza descartada');
        await loadProductos();
        await renderDevoluciones();
      } catch (e) {
        toast('Error al descartar: ' + e.message, false);
      }
    }
  );
};

// ── Subir/reemplazar foto desde una tarjeta existente ────────────────
window.subirFotoAPieza = function(id) {
  devFotoPendienteId = id;
  const inp = document.getElementById('dev-foto-file');
  if (!inp) return;
  inp.value = '';
  inp.click();
};

// Comprime y sube la foto de una pieza. Reutilizable desde el alta, las
// tarjetas y la devolución parcial (sale de caja).
window.devSubirFotoPieza = async function(id, file) {
  const blob = await comprimirImagenDevolucion(file);
  const fd = new FormData();
  fd.append('foto', blob, 'diseno.jpg');
  return devMultipart(`/devoluciones/${id}/imagen`, fd);
};

window.onFotoDevolucionSeleccionada = async function(input) {
  if (!input.files || !input.files.length || !devFotoPendienteId) return;
  const id = devFotoPendienteId;
  devFotoPendienteId = null;
  try {
    await devSubirFotoPieza(id, input.files[0]);
    toast('✅ Foto actualizada');
    await renderDevoluciones();
  } catch (e) {
    toast('Error al subir la foto: ' + e.message, false);
  }
};
