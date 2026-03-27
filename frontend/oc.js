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
  'Extragrande': 4, 'Extra Grande': 4, 'XL': 4, 'EG': 4,
  'Extra Extra Grande': 5, 'XXL': 5, 'EEG': 5,
  'Extra Extra Extra Grande': 6, 'XXXL': 6, 'EEEG': 6
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
  document.getElementById('moc-proveedor').value = '';
  document.getElementById('moc-estado').value = 'borrador';
  document.getElementById('moc-notas').value = '';
  document.getElementById('moc-buscar').value = '';
  document.getElementById('moc-resultados').innerHTML = '';
  openModal('orden_compra');
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

    cont.innerHTML = '';
    sugeridos.forEach(p => {
      const { publico, genero, color, talla } = parsearVarianteOC(p);
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:0.85rem;';
      div.innerHTML = `
        <span style="flex:3;color:#374151;">${p.nombre}</span>
        <span style="flex:1;color:#6b7280;font-size:0.75rem;">Stock: ${p.qty}</span>
        <input type="number" min="1" value="1" style="width:55px;" class="oc-sug-qty" />
        <input type="number" min="0" step="0.01" placeholder="$Precio" style="width:75px;" class="oc-sug-precio" />
        <button class="btn btn-sm btn-primary" onclick="agregarSugeridoOC(${p.id}, '${esc(p.nombre)}', '${esc(publico)}', '${esc(genero)}', '${esc(color)}', '${esc(talla)}', this)" style="white-space:nowrap;">+ Agregar</button>
      `;
      cont.appendChild(div);
    });
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
window.buscarProductoOC = function() {
  const texto = (document.getElementById('moc-buscar').value || '').toLowerCase().trim();
  const cont = document.getElementById('moc-resultados');
  cont.innerHTML = '';
  if (!texto) return;

  const matches = productos.filter(p => {
    const cat = (p.categoria || '').toLowerCase();
    return (cat.startsWith('playera') || cat.startsWith('sudadera')) &&
      (p.nombre.toLowerCase().includes(texto) || (p.sku||'').toLowerCase().includes(texto) || cat.includes(texto));
  }).slice(0, 20);

  if (matches.length === 0) {
    cont.innerHTML = '<div style="padding:8px;color:#aaa;font-size:0.85rem;">Sin resultados</div>';
    return;
  }

  matches.forEach(p => {
    const { publico, genero, color, talla } = parsearVarianteOC(p);
    const div = document.createElement('div');
    div.style.cssText = 'padding:6px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;';
    div.innerHTML = `
      <span>${p.nombre} <small style="color:#94a3b8;">(Stock: ${p.qty})</small></span>
      <button class="btn btn-sm btn-primary" onclick="seleccionarProductoOC(${p.id},'${esc(p.nombre)}','${esc(publico)}','${esc(genero)}','${esc(color)}','${esc(talla)}')">Agregar</button>
    `;
    cont.appendChild(div);
  });
};

window.seleccionarProductoOC = function(id, nombre, publico, genero, color, talla) {
  agregarItemOC({ producto_id: id, producto_nombre: nombre, publico, genero, color, talla, qty: 1, precio_proveedor: 0 });
  document.getElementById('moc-buscar').value = '';
  document.getElementById('moc-resultados').innerHTML = '';
};

// ── Agregar item a la orden ─────────────────────────────────────────
function agregarItemOC(item) {
  // Si ya existe el mismo producto, solo incrementar qty
  const existing = ocItems.find(x => x.producto_id === item.producto_id);
  if (existing) {
    existing.qty += item.qty;
    existing.precio_proveedor = item.precio_proveedor || existing.precio_proveedor;
  } else {
    ocItems.push({ ...item });
  }
  renderItemsOC();
}

// ── Renderizar lista de items ────────────────────────────────────────
function renderItemsOC() {
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
    div.innerHTML = `
      <span style="flex:3;">${item.producto_nombre}</span>
      <input type="number" min="1" value="${item.qty}" style="width:55px;" onchange="ocUpdateItem(${idx},'qty',this.value)" title="Cantidad" />
      <input type="number" min="0" step="0.01" value="${item.precio_proveedor}" style="width:75px;" onchange="ocUpdateItem(${idx},'precio',this.value)" title="Precio proveedor" placeholder="$" />
      <span style="width:70px;text-align:right;color:#16a34a;font-weight:600;">${mxn(subtotal)}</span>
      <button class="btn btn-sm btn-danger" onclick="ocRemoveItem(${idx})" title="Quitar">✕</button>
    `;
    cont.appendChild(div);
  });

  recalcularTotalesOC();
}

window.ocUpdateItem = function(idx, campo, val) {
  if (campo === 'qty') ocItems[idx].qty = parseInt(val) || 1;
  if (campo === 'precio') ocItems[idx].precio_proveedor = parseFloat(val) || 0;
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
  // Color y talla del nombre del producto
  const { color, size: talla } = extractColorSize ? extractColorSize(p.nombre.split('>').slice(1).join('>').trim()) : { color: '', size: '' };
  return { publico, genero, color: color || 'Único', talla: talla || '' };
}

// ── Guardar orden en el backend ─────────────────────────────────────
window.guardarOrdenCompra = async function() {
  const proveedor = document.getElementById('moc-proveedor').value.trim();
  const notas = document.getElementById('moc-notas').value.trim();

  if (ocItems.length === 0) { toast('Agrega al menos un producto', false); return; }

  const payload = {
    proveedor,
    notas,
    items: ocItems.map(it => ({
      producto_id: it.producto_id || null,
      producto_nombre: it.producto_nombre || '',
      publico: it.publico || '',
      genero: it.genero || '',
      color: it.color || '',
      talla: it.talla || '',
      qty: it.qty,
      precio_proveedor: it.precio_proveedor || 0
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
    const ordenes = await req('GET', '/ordenes-compra');
    const lista = document.getElementById('oc-list');
    const empty = document.getElementById('oc-empty');

    if (!ordenes || ordenes.length === 0) {
      lista.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    lista.innerHTML = '';

    const estadoColor = { borrador: '#f59e0b', enviada: '#3b82f6', confirmada: '#16a34a' };
    const estadoLabel = { borrador: 'Borrador', enviada: 'Enviada', confirmada: 'Confirmada' };

    ordenes.forEach(orden => {
      const div = document.createElement('div');
      div.style.cssText = 'border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:10px;background:#fff;';
      const badge = `<span style="background:${estadoColor[orden.estado]||'#94a3b8'};color:white;padding:2px 8px;border-radius:12px;font-size:0.75rem;">${estadoLabel[orden.estado]||orden.estado}</span>`;
      const fecha = orden.creado ? new Date(orden.creado).toLocaleDateString('es-MX') : '—';
      const totalPzas = (orden.items||[]).reduce((s,i)=>s+(i.qty||0),0);

      const btnEditar = orden.estado !== 'confirmada' ?
        `<button class="btn btn-sm btn-warning" onclick="editarOrdenOC(${orden.id})">✏️ Editar</button>` : '';
      const btnEnviar = orden.estado === 'borrador' ?
        `<button class="btn btn-sm btn-primary" onclick="cambiarEstadoOC(${orden.id},'enviada')">📤 Marcar Enviada</button>` : '';
      const btnConfirmar = orden.estado === 'enviada' ?
        `<button class="btn btn-sm" style="background:#16a34a;color:white;" onclick="confirmarOrdenOC(${orden.id})">✅ Confirmar Llegada</button>` : '';
      const btnPDF = `<button class="btn btn-sm btn-outline" onclick="generarPDFOrden(${orden.id})">📄 PDF</button>`;

      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
          <div>
            <strong>${orden.folio}</strong> ${badge}
            <div style="color:#6b7280;font-size:0.82rem;margin-top:3px;">
              Proveedor: ${orden.proveedor||'—'} &nbsp;·&nbsp;
              ${totalPzas} pzas &nbsp;·&nbsp;
              Est. ${mxn(orden.total_estimado)} &nbsp;·&nbsp;
              ${fecha}
            </div>
            ${orden.notas ? `<div style="color:#94a3b8;font-size:0.78rem;">${orden.notas}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${btnEditar}${btnEnviar}${btnConfirmar}${btnPDF}
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
    openModal('orden_compra');
    await cargarSugeridosOC();
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

  // ── Agrupar items: género → color → tallas ───────────────────────
  const grupos = {};  // { generoKey: { colorKey: [items] } }
  (orden.items || []).forEach(it => {
    const gen = it.genero || it.publico || 'General';
    const col = it.color || 'Único';
    if (!grupos[gen]) grupos[gen] = {};
    if (!grupos[gen][col]) grupos[gen][col] = [];
    grupos[gen][col].push(it);
  });

  // Ordenar géneros según OC_GENERO_ORDER
  const generosOrdenados = Object.keys(grupos).sort((a,b) => {
    const ia = OC_GENERO_ORDER.indexOf(a);
    const ib = OC_GENERO_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  let totalPzas = 0;

  generosOrdenados.forEach(gen => {
    // Verificar espacio en página
    if (y > 250) { doc.addPage(); y = 20; }

    // Encabezado de género (negrita, grande)
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.setFillColor(240, 240, 240);
    doc.rect(ML, y - 4, PW, 7, 'F');
    doc.text(gen.toUpperCase(), ML + 2, y + 1); y += 9;

    const colores = Object.keys(grupos[gen]).sort();
    colores.forEach(col => {
      if (y > 255) { doc.addPage(); y = 20; }

      // Color en negrita
      doc.setFontSize(9.5); doc.setFont('helvetica','bold');
      doc.text(`  ${col}`, ML + 2, y); y += 5;

      // Tallas ordenadas en la misma línea o renglones
      const itemsOrdenados = grupos[gen][col].sort((a,b) => ocTallaWeight(a.talla) - ocTallaWeight(b.talla));
      doc.setFont('helvetica','normal'); doc.setFontSize(9);

      // Construir texto de tallas en una sola línea
      const tallasTexto = itemsOrdenados.map(it => {
        totalPzas += it.qty || 0;
        const tallaLabel = it.talla || 'Única';
        return `${tallaLabel}: ${it.qty}`;
      }).join('   ');

      // Calcular subtotal del color
      const subtotalColor = itemsOrdenados.reduce((s,it)=>s+((it.qty||0)*(it.precio_proveedor||0)),0);

      // Si la línea es muy larga, dividir
      const lineas = doc.splitTextToSize(`    ${tallasTexto}`, PW - 40);
      lineas.forEach(l => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(l, ML + 4, y); y += 4.5;
      });

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

// ── Exponer showPage hook para cargar órdenes al cambiar de pestaña ──
const _showPageOriginal = window.showPage;
window.showPage = async function(id, btn) {
  await _showPageOriginal(id, btn);
  if (id === 'ordenes_compra') await renderOrdenesCompra();
};
