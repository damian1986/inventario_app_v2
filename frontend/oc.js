// ═══════════════════════════════════════════════════════════════════
// MÓDULO: ÓRDENES DE COMPRA
// ═══════════════════════════════════════════════════════════════════

// Estado interno del formulario
let ocItems = [];         // [{producto_id, producto_nombre, publico, genero, color, talla, qty, precio_proveedor}]
let ocOrdenId = null;     // null = nueva orden, número = editando existente

// Orden de géneros/públicos para el PDF
const OC_GENERO_ORDER = ['Dama', 'Caballero', 'Unisex', 'Juvenil', 'Niño', 'Bebé', 'Adulto', ''];
const OC_TALLA_ORDER = {
  'Extra Chica': 0, 'XS': 0,
  'Chica': 1, 'S': 1, 'Ch': 1,
  'Mediana': 2, 'M': 2,
  'Grande': 3, 'L': 3, 'G': 3,
  'X-Grande': 4, 'Extragrande': 4, 'Extra Grande': 4, 'XL': 4, 'EG': 4,
  'XX-Grande': 5, 'Extra Extra Grande': 5, 'XXL': 5, 'EEG': 5,
  'XXX-Grande': 6, 'Extra Extra Extra Grande': 6, 'XXXL': 6, 'EEEG': 6
};

function ocTallaWeight(talla) {
  const keys = Object.keys(OC_TALLA_ORDER).sort((a,b) => b.length - a.length);
  for (const k of keys) {
    if ((talla||'').includes(k)) return OC_TALLA_ORDER[k];
  }
  return 99;
}

// ── Abrir modal nueva orden ─────────────────────────────────────────
window.openNuevaOrden = async function() {
  ocItems = [];
  ocOrdenId = null;
  document.getElementById('moc-title').textContent = 'Nueva Orden de Compra';
  document.getElementById('moc-proveedor').value = 'Yasbek';
  document.getElementById('moc-estado').value = 'borrador';
  document.getElementById('moc-notas').value = '';
  document.getElementById('moc-buscar').value = '';
  document.getElementById('moc-resultados').innerHTML = '';
  document.getElementById('moc-tipo-compra').value = 'ropa';
  document.getElementById('moc-meses-msi').value = '1';
  document.getElementById('moc-marca').value = '';
  document.getElementById('moc-canal').value = '';

  
  if (window.onChangeTipoCompraOC) window.onChangeTipoCompraOC();

  // Abrir modal manualmente para evitar recursión
  document.getElementById('overlay-orden_compra').classList.add('active');
  
  await cargarSugeridosOC();
  renderItemsOC();
};

// ── Cargar sugeridos (qty === 1, categoría Playera o Sudadera) ──────
async function cargarSugeridosOC() {
  const cont = document.getElementById('moc-sugeridos-lista');
  cont.innerHTML = '<div style="color:#aaa;font-size:0.85rem;">Cargando...</div>';
  try {
    const todos = await req('GET', '/productos');
    const sugeridos = todos.filter(p => {
      const cat = (p.categoria || '').toLowerCase();
      return (cat.startsWith('playera') || cat.startsWith('sudadera')) && p.qty === 1;
    });

    if (sugeridos.length === 0) {
      cont.innerHTML = '<div style="color:#aaa;font-size:0.85rem;">No hay productos con stock bajo en Playeras/Sudaderas.</div>';
      return;
    }

    // Identificar costos base por categoría si algún producto tiene costo 0
    function obtenerCostoDefault(p) {
      if (p.costo && p.costo > 0) return p.costo;
      const baseName = p.nombre.includes('>') ? p.nombre.split('>')[0].trim() : p.nombre.split(' - ')[0].trim();
      const similar = todos.find(x => x.costo > 0 && 
        (x.nombre.includes('>') ? x.nombre.split('>')[0].trim() : x.nombre.split(' - ')[0].trim()) === baseName
      );
      if (similar) return similar.costo;
      const similarCat = todos.find(x => x.costo > 0 && x.categoria === p.categoria);
      return similarCat ? similarCat.costo : 0;
    }

    cont.innerHTML = '';
    sugeridos.forEach(p => {
      const { publico, genero, color, talla } = parsearVarianteOC(p);
      const costoReal = obtenerCostoDefault(p);
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:0.85rem;';
      div.innerHTML = `
        <span style="flex:3;color:#374151;">${p.nombre}</span>
        <span style="flex:1.5;color:#6b7280;font-size:0.75rem; white-space:nowrap;">Stock: ${p.qty} | Costo: ${mxn(costoReal)}</span>
        <input type="number" min="1" value="1" style="width:55px;" class="oc-sug-qty" />
        <input type="number" min="0" step="0.01" value="${costoReal}" placeholder="$Precio" style="width:75px;" class="oc-sug-precio" />
        <button class="btn btn-sm btn-primary" onclick="agregarSugeridoOC(${p.id}, '${esc(p.nombre)}', '${esc(publico)}', '${esc(genero)}', '${esc(color)}', '${esc(talla)}', this)" style="white-space:nowrap;">+ Agregar</button>
      `;
      cont.appendChild(div);
    });
    // Recordatorio de scroll
    if (sugeridos.length > 3) {
      const hint = document.createElement('div');
      hint.style.cssText = 'text-align:center;font-size:0.7rem;color:#aaa;padding:4px;';
      hint.textContent = '↓ Desliza para ver más sugerencias ↓';
      cont.appendChild(hint);
    }
  } catch(e) {
    cont.innerHTML = `<div style="color:red;font-size:0.85rem;">Error cargando sugeridos: ${e.message}</div>`;
  }
}

function esc(str) { return (str||'').replace(/'/g, "\\'"); }

window.agregarSugeridoOC = function(id, nombre, publico, genero, color, talla, btn) {
  const row = btn.closest('div');
  const qty = parseInt(row.querySelector('.oc-sug-qty').value) || 1;
  const precio = parseFloat(row.querySelector('.oc-sug-precio').value) || 0;
  agregarItemOC({ producto_id: id, producto_nombre: nombre, publico, genero, color, talla, qty, precio_proveedor: precio });
};

// ── Buscador manual ─────────────────────────────────────────────────
// Búsqueda flexible: TODAS las palabras del texto deben aparecer (en cualquier
// orden), sin distinguir mayúsculas ni acentos, tolerando plural y género
// (blanca→blanco, playeras→playera). Ej.: "Playera Blanca Dama" encuentra
// "Playera Dama Peso D0200 - Blanco Chica" (antes exigía el nombre literal).
const OC_STOPWORDS = new Set(['de','del','la','el','los','las','un','una','unos','unas','y','o','con','para','por','en','al']);

function ocNormalizarTexto(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function ocVariantesPalabra(palabra) {
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

window.buscarProductoOC = function() {
  const texto = ocNormalizarTexto(document.getElementById('moc-buscar').value).trim();
  const cont = document.getElementById('moc-resultados');
  cont.innerHTML = '';
  if (!texto) return 0;

  const palabras = texto.split(/\s+/).filter(w => w.length >= 2 && !OC_STOPWORDS.has(w));
  if (palabras.length === 0) return 0;

  const matches = productos.filter(p => {
    const haystack = ocNormalizarTexto(`${p.nombre || ''} ${p.sku || ''} ${p.categoria || ''}`);
    return palabras.every(w => ocVariantesPalabra(w).some(v => haystack.includes(v)));
  }).slice(0, 20);

  if (matches.length === 0) {
    cont.innerHTML = '<div style="padding:8px;color:#aaa;font-size:0.85rem;">Sin resultados</div>';
    return 0;
  }

  function obtenerCostoDefaultManual(p) {
    if (p.costo && p.costo > 0) return p.costo;
    const baseName = p.nombre.includes('>') ? p.nombre.split('>')[0].trim() : p.nombre.split(' - ')[0].trim();
    const similar = productos.find(x => x.costo > 0 && 
      (x.nombre.includes('>') ? x.nombre.split('>')[0].trim() : x.nombre.split(' - ')[0].trim()) === baseName
    );
    if (similar) return similar.costo;
    const similarCat = productos.find(x => x.costo > 0 && x.categoria === p.categoria);
    return similarCat ? similarCat.costo : 0;
  }

    matches.forEach(p => {
      const { publico, genero, color, talla } = parsearVarianteOC(p);
      const costoReal = obtenerCostoDefaultManual(p);
      const div = document.createElement('div');
      div.style.cssText = 'padding:6px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;';
      div.innerHTML = `
        <span>${p.nombre} <small style="color:#94a3b8;">(Stock: ${p.qty}, Costo: ${mxn(costoReal)})</small></span>
        <button class="btn btn-sm btn-primary" onclick="seleccionarProductoOC(${p.id},'${esc(p.nombre)}','${esc(publico)}','${esc(genero)}','${esc(color)}','${esc(talla)}', ${costoReal})">Agregar</button>
      `;
    cont.appendChild(div);
  });
  return matches.length;
};

window.seleccionarProductoOC = function(id, nombre, publico, genero, color, talla, costo = 0) {
  agregarItemOC({ producto_id: id, producto_nombre: nombre, publico, genero, color, talla, qty: 1, precio_proveedor: costo });
// Se comenta para mantener los resultados de la búsqueda activos
  // document.getElementById('moc-buscar').value = '';
  // document.getElementById('moc-resultados').innerHTML = '';
};

window.onScannerEnterOC = function(val) {
  const sku = val.trim().toLowerCase();
  if (!sku) { buscarProductoOC(); return; }
  const p = productos.find(x => (x.sku||'').toLowerCase() === sku);
  if (p) {
    const { publico, genero, color, talla } = parsearVarianteOC(p);
    let costoReal = 0;
    if (p.costo && p.costo > 0) {
      costoReal = p.costo;
    } else {
      const baseName = p.nombre.includes('>') ? p.nombre.split('>')[0].trim() : p.nombre.split(' - ')[0].trim();
      const similar = productos.find(x => x.costo > 0 && (x.nombre.includes('>') ? x.nombre.split('>')[0].trim() : x.nombre.split(' - ')[0].trim()) === baseName);
      if (similar) costoReal = similar.costo;
      else {
        const similarCat = productos.find(x => x.costo > 0 && x.categoria === p.categoria);
        if (similarCat) costoReal = similarCat.costo;
      }
    }
    seleccionarProductoOC(p.id, p.nombre, publico, genero, color, talla, costoReal);
    document.getElementById('moc-buscar').value = '';
    document.getElementById('moc-resultados').innerHTML = '';
  } else {
    // No es un SKU exacto del catálogo: tratarlo como búsqueda por texto.
    // Así, escribir "Playera Blanca Dama" + Enter muestra resultados en vez
    // de reportar "SKU no encontrado". Un escaneo inválido (texto que no
    // coincide con nada) sigue avisando y limpiando el campo.
    if (buscarProductoOC() === 0) {
      toast(`❌ SKU no encontrado en catálogo: ${val}`, false);
      document.getElementById('moc-buscar').value = '';
      document.getElementById('moc-resultados').innerHTML = '';
    }
  }
};

// ── Agregar item a la orden ─────────────────────────────────────────
function agregarItemOC(item) {
  // Si ya existe el mismo producto, solo incrementar qty
  const existing = ocItems.find(x => {
    if (item.producto_id) return x.producto_id === item.producto_id;
    return (x.producto_id == null || x.producto_id === '') && x.producto_nombre === item.producto_nombre;
  });
  if (existing) {
    existing.qty += item.qty;
    existing.precio_proveedor = item.precio_proveedor || existing.precio_proveedor;
    toast(`Cantidad actualizada: ${item.producto_nombre} (${existing.qty} pzas)`, true);
  } else {
    ocItems.push({ ...item });
    toast(`Agregado: ${item.producto_nombre}`, true);
  }
  renderItemsOC();
}

function isPlayera(item) {
  // Buscar en el array global de productos
  const p = productos.find(x => x.id === item.producto_id);
  if (p) {
    const cat = (p.categoria || '').toLowerCase();
    return cat.startsWith('playera') || cat.startsWith('sudadera');
  }
  // Fallback si no lo encuentra por ID (por ejemplo, si es una orden de compra cargada del backend)
  const nombre = (item.producto_nombre || '').toLowerCase();
  return nombre.includes('playera') || nombre.includes('sudadera');
}

function actualizarPreciosSegunCantidad() {
  // 1. Calcular total de playeras en la orden
  const totalPlayerasQty = ocItems.filter(isPlayera).reduce((sum, it) => sum + (it.qty || 0), 0);
  
  // 2. Determinar tipo de costo a aplicar: >= 12 es mayoreo, <= 11 es menudeo
  const usarMayoreo = totalPlayerasQty >= 12;
  
  // 3. Actualizar precio de proveedor para cada item de tipo playera
  ocItems.forEach(it => {
    if (isPlayera(it) && !it.precio_modificado) {
      const p = productos.find(x => x.id === it.producto_id);
      if (p) {
        // En la base de datos, el costo de mayoreo se guarda en `costo`
        // y el costo de menudeo se guarda en `costo_menudeo`.
        const precioMayoreo = p.costo || 0;
        const precioMenudeo = p.costo_menudeo || precioMayoreo; // fallback por si no tiene costo_menudeo
        
        it.precio_proveedor = usarMayoreo ? precioMayoreo : precioMenudeo;
      }
    }
  });
}

// ── Renderizar lista de items ────────────────────────────────────────
function renderItemsOC() {
  actualizarPreciosSegunCantidad();

  const cont = document.getElementById('moc-items-lista');
  cont.innerHTML = '';

  if (ocItems.length === 0) {
    cont.innerHTML = '<div style="color:#aaa;font-size:0.85rem;padding:8px;">Sin productos agregados aún.</div>';
    recalcularTotalesOC();
    return;
  }

  ocItems.forEach((item, idx) => {
    const subtotal = (item.qty || 0) * (item.precio_proveedor || 0);
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 4px;border-bottom:1px solid #f1f5f9;font-size:0.82rem;';
    const isObligatoria = item.es_obligatoria ? 'checked' : '';
    div.innerHTML = `
      <span style="flex:3;">${item.producto_nombre}</span>
      <input type="number" min="1" value="${item.qty}" style="width:55px;" onchange="ocUpdateItem(${idx},'qty',this.value)" title="Cantidad" />
      <input type="number" min="0" step="0.01" value="${item.precio_proveedor}" style="width:75px;" onchange="ocUpdateItem(${idx},'precio',this.value)" title="Precio proveedor" placeholder="$" />
      <span style="width:70px;text-align:right;color:#16a34a;font-weight:600;">${mxn(subtotal)}</span>
      <label style="font-size:0.75rem;display:flex;align-items:center;gap:3px;cursor:pointer;" title="Marcar como compra obligatoria">
        <input type="checkbox" onchange="ocUpdateItem(${idx},'obligatoria',this.checked)" ${isObligatoria}>
        <span style="color:#b91c1c;font-weight:bold;">Oblig.</span>
      </label>
      <button class="btn btn-sm btn-danger" onclick="ocRemoveItem(${idx})" title="Quitar">✕</button>
    `;
    cont.appendChild(div);
  });

  recalcularTotalesOC();
}

window.ocUpdateItem = function(idx, campo, val) {
  if (campo === 'qty') ocItems[idx].qty = parseInt(val) || 1;
  if (campo === 'precio') {
    ocItems[idx].precio_proveedor = parseFloat(val) || 0;
    ocItems[idx].precio_modificado = true;
  }
  if (campo === 'obligatoria') {
    ocItems[idx].es_obligatoria = val ? 1 : 0;
  }
  renderItemsOC();
};


window.ocRemoveItem = function(idx) {
  ocItems.splice(idx, 1);
  renderItemsOC();
};

function recalcularTotalesOC() {
  const totalQty = ocItems.reduce((s, x) => s + (x.qty || 0), 0);
  const totalPrecio = ocItems.reduce((s, x) => s + ((x.qty||0) * (x.precio_proveedor||0)), 0);
  document.getElementById('moc-total-qty').textContent = totalQty;
  document.getElementById('moc-total-precio').textContent = mxn(totalPrecio);
}

// ── Parsear variante de producto para extraer publico/genero/color/talla ─
function parsearVarianteOC(p) {
  const cat = p.categoria || '';
  const parts = cat.split(' › ');
  // Estructura: Playera › Adulto › Caballero › Manga Corta
  // o:         Sudadera › Unisex
  let publico = parts[1] || '';
  let genero = parts[2] || '';
  // Si es Sudadera, el género es Unisex (el nivel 1)
  if (parts[0] && parts[0].toLowerCase().startsWith('sudadera')) {
    genero = parts[1] || 'Unisex';
    publico = 'Adulto';
  }
  const n = p.nombre || '';
  const sep = n.includes('>') ? '>' : ' - ';
  const variantPart = n.includes(sep) ? n.substring(n.indexOf(sep) + sep.length).trim() : n.trim();
  let { color, size: talla } = extractColorSize ? extractColorSize(variantPart) : { color: '', size: '' };
  
  // Extraer "Modelo" (ej: C0300) del nombre original
  const modelMatch = n.match(/\b([A-Z]\d{3,5})\b/i);
  const modelo = modelMatch ? modelMatch[1].toUpperCase() : '';
  
  return { publico, genero, color: color || 'Único', talla: talla || '', modelo };
}

// ── Lógica de vistas y campos extra ──────────────────────────────────
window.onChangeTipoCompraOC = function() {
  const tipo = document.getElementById('moc-tipo-compra').value;
  const eqFields = document.querySelectorAll('.moc-equipo-fields');
  const secProd = document.getElementById('moc-seccion-productos');
  const secIns = document.getElementById('moc-seccion-insumos');
  const secEq = document.getElementById('moc-seccion-equipos');
  const msiWrapper = document.getElementById('moc-msi-wrapper');

  if (tipo === 'ropa') {
    eqFields.forEach(el => el.style.display = 'none');
    secProd.style.display = 'block';
    secIns.style.display = 'none';
    secEq.style.display = 'none';
    msiWrapper.style.display = 'none';
  } else if (tipo === 'insumos') {
    eqFields.forEach(el => el.style.display = 'none');
    secProd.style.display = 'none';
    secIns.style.display = 'block';
    secEq.style.display = 'none';
    msiWrapper.style.display = 'block';
    if (window.cargarInsumosOCSelect) window.cargarInsumosOCSelect();
  } else if (tipo === 'equipos') {
    eqFields.forEach(el => el.style.display = 'flex');
    secProd.style.display = 'none';
    secIns.style.display = 'none';
    secEq.style.display = 'block';
    msiWrapper.style.display = 'block';
  }
};

window.cargarInsumosOCSelect = async function() {
  const select = document.getElementById('moc-insumo-select');
  select.innerHTML = '<option value="">Cargando...</option>';
  try {
    const res = await req('GET', '/insumos');
    window.insumosCatalogo = res;
    if (res.length === 0) {
      select.innerHTML = '<option value="">No hay insumos registrados</option>';
    } else {
      select.innerHTML = '<option value="">-- Selecciona --</option>';
      res.forEach(i => {
        select.innerHTML += `<option value="${i.id}">${i.nombre}</option>`;
      });
    }
  } catch(e) {
    select.innerHTML = '<option value="">Error cargando insumos</option>';
  }
};

window.agregarInsumoOC = function() {
  const select = document.getElementById('moc-insumo-select');
  const id = select.value;
  if (!id) return toast('Selecciona un insumo', false);
  const qty = parseInt(document.getElementById('moc-insumo-qty').value) || 1;
  const precio = parseFloat(document.getElementById('moc-insumo-precio').value) || 0;
  
  const insumo = window.insumosCatalogo.find(x => x.id == id);
  if (insumo) {
    agregarItemOC({
      producto_id: null,
      producto_nombre: insumo.nombre,
      publico: '', genero: '', color: '', talla: '',
      qty, precio_proveedor: precio
    });
    document.getElementById('moc-insumo-qty').value = 1;
    document.getElementById('moc-insumo-precio').value = 0;
  }
};

window.agregarEquipoOC = function() {
  const nombre = document.getElementById('moc-equipo-nombre').value.trim();
  if (!nombre) return toast('Escribe el nombre del equipo', false);
  const qty = parseInt(document.getElementById('moc-equipo-qty').value) || 1;
  const precio = parseFloat(document.getElementById('moc-equipo-precio').value) || 0;
  
  agregarItemOC({
    producto_id: null,
    producto_nombre: nombre,
    publico: '', genero: '', color: '', talla: '',
    qty, precio_proveedor: precio
  });
  
  document.getElementById('moc-equipo-nombre').value = '';
  document.getElementById('moc-equipo-qty').value = 1;
  document.getElementById('moc-equipo-precio').value = 0;
};

// ── Guardar orden en el backend ─────────────────────────────────────
window.guardarOrdenCompra = async function() {
  const proveedor = document.getElementById('moc-proveedor').value.trim();
  const notas = document.getElementById('moc-notas').value.trim();
  const tipo_compra = document.getElementById('moc-tipo-compra').value;
  const meses_msi = parseInt(document.getElementById('moc-meses-msi').value) || 1;
  const pago_msi = meses_msi > 1 ? 1 : 0;
  const marca = document.getElementById('moc-marca').value.trim() || null;
  const canal_compra = document.getElementById('moc-canal').value.trim() || null;

  if (ocItems.length === 0) { toast('Agrega al menos un producto/item', false); return; }

  const payload = {
    proveedor,
    notas,
    tipo_compra,
    pago_msi,
    meses_msi,
    marca: tipo_compra === 'equipos' ? marca : "",
    canal_compra: tipo_compra === 'equipos' ? canal_compra : "",
    items: ocItems.map(it => ({
      producto_id: it.producto_id || null,
      producto_nombre: it.producto_nombre || '',
      publico: it.publico || '',
      genero: it.genero || '',
      color: it.color || '',
      talla: it.talla || '',
      qty: it.qty,
      precio_proveedor: it.precio_proveedor || 0,
      es_obligatoria: it.es_obligatoria ? 1 : 0
    }))
  };

  try {
    if (ocOrdenId) {
      await req('PUT', `/ordenes-compra/${ocOrdenId}`, payload);
      toast('✅ Orden actualizada');
    } else {
      await req('POST', '/ordenes-compra', payload);
      toast('✅ Orden de compra creada');
    }
    closeModal('orden_compra');
    await renderOrdenesCompra();
  } catch(e) {
    toast('❌ Error al guardar: ' + e.message, false);
  }
};

// ── Renderizar listado de órdenes ────────────────────────────────────
window.renderOrdenesCompra = async function() {
  try {
    const estadoFiltro = document.getElementById('oc-filter-estado') ? document.getElementById('oc-filter-estado').value : '';
    let url = '/ordenes-compra';
    if (estadoFiltro) url += `?estado=${estadoFiltro}`;
    const ordenes = await req('GET', url);
    const lista = document.getElementById('oc-list');
    const empty = document.getElementById('oc-empty');

    if (!ordenes || ordenes.length === 0) {
      lista.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    lista.innerHTML = '';

    const estadoColor = { borrador: '#f59e0b', enviada: '#3b82f6', confirmada: '#16a34a', cancelada: '#ef4444' };
    const estadoLabel = { borrador: 'Borrador', enviada: 'Enviada', confirmada: 'Confirmada', cancelada: 'Cancelada' };

    ordenes.forEach(orden => {
      const div = document.createElement('div');
      div.style.cssText = 'border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:10px;background:#fff;';
      const badge = `<span style="background:${estadoColor[orden.estado]||'#94a3b8'};color:white;padding:2px 8px;border-radius:12px;font-size:0.75rem;">${estadoLabel[orden.estado]||orden.estado}</span>`;
      const badgeTipo = `<span style="background:#e2e8f0;color:#475569;padding:2px 8px;border-radius:12px;font-size:0.70rem;margin-left:5px;">${(orden.tipo_compra || 'ropa').toUpperCase()}</span>`;
      const msiBadge = orden.pago_msi ? `<span style="color:#b45309;font-weight:bold;font-size:0.75rem;margin-left:5px;">(${orden.meses_msi} MSI)</span>` : '';
      const fecha = orden.creado ? new Date(orden.creado).toLocaleDateString('es-MX') : '—';
      const totalPzas = (orden.items||[]).reduce((s,i)=>s+(i.qty||0),0);

      const btnEditar = orden.estado === 'borrador' ?
        `<button class="btn btn-sm btn-warning" onclick="editarOrdenOC(${orden.id})">✏️ Editar</button>` : '';
      const btnEnviar = orden.estado === 'borrador' ?
        `<button class="btn btn-sm btn-primary" onclick="cambiarEstadoOC(${orden.id},'enviada')">📤 Marcar Enviada</button>` : '';
      const btnConfirmar = orden.estado === 'enviada' ?
        `<button class="btn btn-sm" style="background:#16a34a;color:white;" onclick="confirmarOrdenOC(${orden.id})">✅ Confirmar Llegada</button>` : '';
      const btnCancelar = (orden.estado === 'borrador' || orden.estado === 'enviada') ?
        `<button class="btn btn-sm btn-danger" onclick="cancelarOrdenOC(${orden.id})">❌ Cancelar</button>` : '';
      const btnPDF = `<button class="btn btn-sm btn-outline" onclick="generarPDFOrden(${orden.id})">📄 PDF</button>`;
      const btnDuplicar = `<button class="btn btn-sm" style="background:#7c3aed;color:white;" onclick="duplicarOrdenOC(${orden.id})" title="Duplicar como borrador">📋 Duplicar</button>`;

      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
          <div>
            <strong>${orden.folio}</strong> ${badge} ${badgeTipo} ${msiBadge}
            <div style="color:#6b7280;font-size:0.82rem;margin-top:3px;">
              Proveedor: ${orden.proveedor||'—'} &nbsp;·&nbsp;
              ${totalPzas} items &nbsp;·&nbsp;
              Est. ${mxn(orden.total_estimado)} &nbsp;·&nbsp;
              ${fecha}
            </div>
            ${orden.notas ? `<div style="color:#94a3b8;font-size:0.78rem;">${orden.notas}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${btnEditar}${btnEnviar}${btnConfirmar}${btnPDF}${btnDuplicar}${btnCancelar}
          </div>
        </div>
      `;
      lista.appendChild(div);
    });
  } catch(e) {
    toast('Error cargando órdenes: ' + e.message, false);
  }
};

// ── Editar orden existente ──────────────────────────────────────────
window.editarOrdenOC = async function(ordenId) {
  try {
    const orden = await req('GET', `/ordenes-compra/${ordenId}`);
    ocOrdenId = ordenId;
    ocItems = (orden.items || []).map(it => ({ ...it }));
    document.getElementById('moc-title').textContent = `Editar Orden ${orden.folio}`;
    document.getElementById('moc-proveedor').value = orden.proveedor || '';
    document.getElementById('moc-estado').value = orden.estado || 'borrador';
    document.getElementById('moc-notas').value = orden.notas || '';
    document.getElementById('moc-buscar').value = '';
    document.getElementById('moc-resultados').innerHTML = '';
    
    document.getElementById('moc-tipo-compra').value = orden.tipo_compra || 'ropa';
    document.getElementById('moc-meses-msi').value = orden.pago_msi ? (orden.meses_msi || 1) : 1;
    document.getElementById('moc-marca').value = orden.marca || '';
    document.getElementById('moc-canal').value = orden.canal_compra || '';
    
    if (window.onChangeTipoCompraOC) window.onChangeTipoCompraOC();

    // Abrir modal manualmente para evitar recursión
    document.getElementById('overlay-orden_compra').classList.add('active');
    
    if (orden.tipo_compra === 'ropa' || !orden.tipo_compra) {
      await cargarSugeridosOC();
    }
    renderItemsOC();
  } catch(e) {
    toast('Error al cargar orden: ' + e.message, false);
  }
};

// ── Cambiar estado (borrador → enviada) ─────────────────────────────
window.cambiarEstadoOC = async function(ordenId, estado) {
  try {
    await req('POST', `/ordenes-compra/${ordenId}/estado`, { estado });
    toast(`✅ Orden marcada como ${estado}`);
    await renderOrdenesCompra();
  } catch(e) {
    toast('Error: ' + e.message, false);
  }
};

// ── Confirmar llegada (enviada → confirmada) ─────────────────────────
window.confirmarOrdenOC = function(ordenId) {
  showConfirm(
    '¿Confirmar llegada de mercancía? Se sumarán las cantidades al inventario y se registrarán las entradas.',
    async () => {
      try {
        await req('POST', `/ordenes-compra/${ordenId}/estado`, { estado: 'confirmada' });
        toast('✅ Orden confirmada. Inventario actualizado.');
        await loadProductos();
        await renderOrdenesCompra();
      } catch(e) {
        toast('Error al confirmar: ' + e.message, false);
      }
    }
  );
};

// ── Cancelar orden ──────────────────────────────────────────────────
window.cancelarOrdenOC = function(ordenId) {
  showConfirm(
    '¿Estás seguro de que deseas cancelar esta orden de compra?',
    async () => {
      try {
        await req('POST', `/ordenes-compra/${ordenId}/estado`, { estado: 'cancelada' });
        toast('✅ Orden cancelada correctamente.');
        await renderOrdenesCompra();
      } catch(e) {
        toast('Error al cancelar: ' + e.message, false);
      }
    }
  );
};

// ── Duplicar orden (1-clic resurtir) ────────────────────────────────
window.duplicarOrdenOC = async function(ordenId) {
  showConfirm(
    '¿Deseas duplicar esta orden de compra como un nuevo borrador?',
    async () => {
      try {
        const nueva = await req('POST', `/ordenes-compra/${ordenId}/duplicar`);
        toast(`✅ Orden duplicada como ${nueva.folio} (borrador)`);
        await renderOrdenesCompra();
      } catch(e) {
        toast('Error al duplicar: ' + e.message, false);
      }
    }
  );
};

// ── Generar PDF de una orden guardada ───────────────────────────────
window.generarPDFOrden = async function(ordenId) {
  try {
    const orden = await req('GET', `/ordenes-compra/${ordenId}`);
    _buildPDFOrden(orden);
  } catch(e) {
    toast('Error al cargar orden para PDF: ' + e.message, false);
  }
};

// ── Generar PDF desde el formulario actual (sin guardar) ─────────────
window.generarPDFOrdenActual = function() {
  const orden = {
    folio: ocOrdenId ? `#${ocOrdenId}` : 'BORRADOR',
    proveedor: document.getElementById('moc-proveedor').value || '—',
    estado: document.getElementById('moc-estado').value || 'borrador',
    notas: document.getElementById('moc-notas').value || '',
    items: ocItems,
    total_estimado: ocItems.reduce((s,x)=>s+((x.qty||0)*(x.precio_proveedor||0)), 0)
  };
  if (orden.items.length === 0) { toast('No hay productos en la orden', false); return; }
  _buildPDFOrden(orden);
};

// ── Builder del PDF ──────────────────────────────────────────────────
function _buildPDFOrden(orden) {
  if (!window.jspdf) { toast('jsPDF no cargado', false); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  const ML = 18, MR = 192, PW = MR - ML;
  let y = 20;

  // ── Encabezado ──────────────────────────────────────────────────
  doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.text('ORDEN DE COMPRA', ML, y); y += 7;
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text(`Folio: ${orden.folio}`, ML, y);
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, MR, y, { align:'right' }); y += 5;
  doc.text(`Proveedor: ${orden.proveedor||'—'}`, ML, y);
  doc.text(`Estado: ${(orden.estado||'').toUpperCase()}`, MR, y, { align:'right' }); y += 5;
  if (orden.notas) { doc.setFontSize(8); doc.setTextColor(120); doc.text(`Notas: ${orden.notas}`, ML, y); doc.setTextColor(0); y += 5; }
  doc.setDrawColor(180); doc.line(ML, y, MR, y); y += 6;

  // ── Agrupar items: producto base → color → tallas ───────────────────────
  const grupos = {};  // { baseName: { colorKey: [items] } }
  (orden.items || []).forEach(it => {
    const n = it.producto_nombre || 'Producto';
    const isNewFormat = n.includes('>');
    const sep = isNewFormat ? '>' : ' - ';
    
    // Extraer baseName y variante
    const idxSep = n.indexOf(sep);
    const baseName = idxSep !== -1 ? n.substring(0, idxSep).trim() : n.trim();
    const variantPart = idxSep !== -1 ? n.substring(idxSep + sep.length).trim() : '';
    
    // Extraer color y talla reales
    let { color, size } = extractColorSize ? extractColorSize(variantPart) : { color: '', size: '' };
    if (!color) color = it.color && it.color !== 'Único' ? it.color : (variantPart || 'Único');
    if (!size) size = it.talla && it.talla !== 'Única' ? it.talla : 'Única';

    it._calcTalla = size;
    
    if (!grupos[baseName]) grupos[baseName] = {};
    if (!grupos[baseName][color]) grupos[baseName][color] = [];
    grupos[baseName][color].push(it);
  });

  const categoriasSort = Object.keys(grupos).sort();

  let totalPzas = 0;

  categoriasSort.forEach(catName => {
    // Verificar espacio en página
    if (y > 250) { doc.addPage(); y = 20; }

    // Encabezado principal (Base Name)
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.setFillColor(240, 240, 240);
    doc.rect(ML, y - 4, PW, 7, 'F');
    doc.text(catName.toUpperCase(), ML + 2, y + 1); y += 9;

    const colores = Object.keys(grupos[catName]).sort();
    colores.forEach(col => {
      if (y > 255) { doc.addPage(); y = 20; }

      // Color en negrita
      doc.setFontSize(9.5); doc.setFont('helvetica','bold');
      doc.text(`  ${col}`, ML + 2, y); y += 5;

      const itemsOrdenados = grupos[catName][col].sort((a,b) => ocTallaWeight(a._calcTalla) - ocTallaWeight(b._calcTalla));
      
      const subtotalColor = itemsOrdenados.reduce((s,it)=>s+((it.qty||0)*(it.precio_proveedor||0)),0);

      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      itemsOrdenados.forEach(it => {
        totalPzas += it.qty || 0;
        if (y > 270) { doc.addPage(); y = 20; }
        let suffix = "";
        if (it.es_obligatoria) {
          doc.setTextColor(220, 38, 38);
          doc.setFont('helvetica', 'bold');
          suffix = " [COMPRA OBLIGATORIA]";
        } else {
          doc.setTextColor(0);
          doc.setFont('helvetica', 'normal');
        }
        doc.text(`      ${it.qty} ${it._calcTalla}${suffix}`, ML + 2, y);
        doc.setTextColor(0); doc.setFont('helvetica', 'normal');
        y += 4.5;
      });
      y += 1.5;

      // Subtotal del color al lado derecho
      if (subtotalColor > 0) {
        doc.setTextColor(80,80,80); doc.setFontSize(8);
        doc.text(`Subtotal: ${mxn(subtotalColor)}`, MR, y - 4.5, { align:'right' });
        doc.setTextColor(0); doc.setFontSize(9);
      }
      y += 2;
    });
    y += 4;
  });

  // ── Totales finales ──────────────────────────────────────────────
  if (y > 255) { doc.addPage(); y = 20; }
  doc.setDrawColor(100); doc.line(ML, y, MR, y); y += 6;
  doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(`Total piezas: ${totalPzas}`, ML, y);
  doc.text(`Total estimado: ${mxn(orden.total_estimado||0)}`, MR, y, { align:'right' }); y += 7;

  // ── Pie de página ────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setFont('helvetica','italic'); doc.setTextColor(150);
    doc.text(`Kromo Pinceles — Orden ${orden.folio} — Página ${i} de ${totalPages}`, 105, 290, { align:'center' });
    doc.setTextColor(0);
  }

  // ── Descargar ────────────────────────────────────────────────────
  const filename = `OC_${orden.folio}_${new Date().toISOString().slice(0,10)}.pdf`;
  try {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('📄 PDF generado ✅');
  } catch(_) {
    doc.save(filename);
  }
}

// ── Reposición Automática (1-Clic) ───────────────────────────────────
window.crearOCReposicion = async function() {
  const alertCount = productos.filter(p => getStatus(p.qty, p.min_stock) !== 'ok').length;
  if (alertCount === 0) {
    toast('No hay productos con stock bajo para reponer.', true);
    return;
  }

  showConfirm(`¿Deseas generar una Orden de Compra para reponer los ${alertCount} productos en alerta?`, async () => {
    try {
      // Abrir el modal de nueva orden (limpia ocItems)
      await window.openNuevaOrden();
      
      // Sobrescribir datos específicos de reposición
      document.getElementById('moc-title').textContent = 'Orden de Reposición Automática';
      document.getElementById('moc-proveedor').value = 'REPOSICIÓN AUTOMÁTICA';
      document.getElementById('moc-notas').value = `Generada automáticamente para reponer ${alertCount} productos con stock bajo.`;

      const lowStockProducts = productos.filter(p => getStatus(p.qty, p.min_stock) !== 'ok');
      
      // Poblar ocItems
      ocItems = lowStockProducts.map(p => {
        const { publico, genero, color, talla } = parsearVarianteOC(p);
        
        // Sugerencia: Triplicar el stock mínimo o al menos llegar a una base segura
        // Cantidad = (MinStock * 3) - QtyActual. Aseguramos mínimo 1.
        let suggestedQty = (p.min_stock * 3) - p.qty;
        if (suggestedQty < 1) suggestedQty = p.min_stock || 1;

        // Intentar obtener costo
        let costoReal = p.costo || 0;
        if (costoReal <= 0) {
          const baseName = p.nombre.includes('>') ? p.nombre.split('>')[0].trim() : p.nombre.split(' - ')[0].trim();
          const similar = productos.find(x => x.costo > 0 && (x.nombre.includes('>') ? x.nombre.split('>')[0].trim() : x.nombre.split(' - ')[0].trim()) === baseName);
          if (similar) costoReal = similar.costo;
        }

        return {
          producto_id: p.id,
          producto_nombre: p.nombre,
          publico,
          genero,
          color,
          talla,
          qty: suggestedQty,
          precio_proveedor: costoReal,
          es_obligatoria: 0
        };
      });

      renderItemsOC();
      showPage('ordenes_compra', document.querySelector('nav button:nth-child(4)'));
      toast(`✅ Orden de reposición preparada con ${ocItems.length} items.`);
    } catch (err) {
      console.error(err);
      toast('Error al generar reposición: ' + err.message, false);
    }
  });
};

