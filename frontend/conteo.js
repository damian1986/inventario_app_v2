// conteo.js - Módulo de Conteo Físico

let conteoItems = []; // Array de { producto, countQty, diff }

function renderConteo() {
  const tbody = document.getElementById('conteo-list');
  const dTotal = document.getElementById('c-total-qty');
  const dDiff = document.getElementById('c-diferencias');

  if (conteoItems.length === 0) {
    tbody.innerHTML = '<div class="cart-empty">Aún no has escaneado ningún producto</div>';
    dTotal.textContent = "0";
    dDiff.textContent = "0";
    return;
  }

  tbody.innerHTML = '';
  let qtyTotal = 0;
  let diffCount = 0;

  conteoItems.forEach((c, idx) => {
    const diff = c.countQty - c.producto.qty;
    c.diff = diff;
    qtyTotal += c.countQty;
    if (diff !== 0) diffCount++;

    const row = document.createElement('div');
    row.className = 'cart-item';
    let iconStatus = diff === 0 ? '✅' : '⚠️';
    let diffText = diff > 0 ? `+${diff}` : `${diff}`;
    
    let bg = diff === 0 ? '#dcfce7' : (diff > 0 ? '#dbeafe' : '#fee2e2');
    let textC = diff === 0 ? '#166534' : (diff > 0 ? '#1e40af' : '#991b1b');
    let borderColor = diff === 0 ? '#bbf7d0' : (diff > 0 ? '#bfdbfe' : '#fecaca');

    row.innerHTML = `
      <div class="cart-item-details" style="flex:2">
        <strong>${escapeHtml(c.producto.nombre)}</strong><br>
        <span style="font-size:0.8rem; color:#666">Cod. Referencia: ${escapeHtml(c.producto.sku || 'N/A')}</span>
      </div>
      <div style="flex:1; text-align:center;">
        Sist: ${c.producto.qty} | Fís: <strong>${c.countQty}</strong>
        <br>
        <div style="margin-top:5px;">
          <span style="display:inline-block; padding:3px 8px; border-radius:6px; font-weight:600; font-size:0.75rem; background:${bg}; color:${textC}; border:1px solid ${borderColor};">
            ${iconStatus} Dif: ${diff !== 0 ? diffText : 'OK'}
          </span>
        </div>
      </div>
      <div>
        <button class="btn btn-sm btn-outline btn-danger" onclick="eliminarDelConteo(${idx})">❌</button>
      </div>
    `;
    tbody.appendChild(row);
  });

  dTotal.textContent = qtyTotal.toString();
  dDiff.textContent = diffCount.toString();
}

function _findProductBySKUConteo(term) {
  if (!term) return null;
  term = term.trim().toLowerCase();
  for (let p of productos) {
    if (p.sku && p.sku.toLowerCase() === term) return p;
    // Si queremos habilitar busqueda por exactMatch de codigo de barras u ID, añadir aqui
  }
  return null;
}

// Handler llamado por el <input> de SKU
window.onScannerEnterConteo = function(val) {
  if (!val) return;
  const p = _findProductBySKUConteo(val);
  const qty = parseInt(document.getElementById('c-qty').value) || 1;
  
  if (!p) {
    toast(`Código no reconocido: ${val}`, false);
  } else {
    // Si ya existe
    const ex = conteoItems.find(x => x.producto.id === p.id);
    if (ex) {
      ex.countQty += qty;
    } else {
      conteoItems.push({ producto: p, countQty: qty, diff: 0 });
    }
  }
  
  document.getElementById('c-scan-sku').value = '';
  document.getElementById('c-qty').value = 1;
  renderConteo();
  document.getElementById('c-scan-sku').focus();
};

function sumarConteoManual() {
  const val = document.getElementById('c-scan-sku').value;
  if(val) {
      window.onScannerEnterConteo(val);
  } else {
      toast("Ingresa un SKU válido", false);
  }
}

function eliminarDelConteo(idx) {
  conteoItems.splice(idx, 1);
  renderConteo();
}

function limpiarConteo() {
  if (!confirm("¿Seguro que deseas reiniciar tu sesión de conteo? Todo el avance se borrará.")) return;
  conteoItems = [];
  _mostrarAvisosConteo([]);
  renderConteo();
}

async function procesarConteoFisico() {
  if (conteoItems.length === 0) {
    toast("El listado está vacío", false);
    return;
  }
  
  // Extraemos las que tienen diferencia
  const aAjustar = conteoItems.filter(c => c.diff !== 0);
  
  if (aAjustar.length === 0) {
    toast("No hay diferencias con el sistema. ¡El inventario está cuadrado!", true);
    return;
  }

  if (!confirm(`Se detectaron diferencias en ${aAjustar.length} productos.\nAl confirmar, el sistema generará movimientos de ajuste automático. ¿Continuar?`)) {
    return;
  }

  let successCount = 0;
  let failCount = 0;
  
  document.body.style.cursor = 'wait';
  
  for (let c of aAjustar) {
    try {
      const res = await req('POST', `/productos/${c.producto.id}/ajuste`, {
        nueva_qty: c.countQty,
        motivo: "Ajuste por Conteo Físico",
        notas: `Ajuste global Físico. Dif orig: ${c.diff}`
      });
      if(res) successCount++;
      else failCount++;
    } catch(e) {
      failCount++;
    }
  }
  
  document.body.style.cursor = 'default';
  
  if (failCount === 0) {
    toast(`¡Conteo guardado! ${successCount} ajustes registrados OK.`, true);
    conteoItems = [];
    _mostrarAvisosConteo([]);
    renderConteo();
    // Refrescar el inventario base
    loadProductos();
    showPage('inventario');
  } else {
    toast(`Operación parcial. OK: ${successCount}, Errores: ${failCount}`, false);
    loadProductos();
  }
}

// ============ Conteo por Plantilla Excel ============

function _descomponerProductoConteo(p) {
  const isNewFormat = p.nombre.includes('>');
  const baseName = isNewFormat ? p.nombre.split('>')[0].trim() : p.nombre.split(' - ')[0].trim();
  const sep = isNewFormat ? '>' : ' - ';
  const idx = p.nombre.indexOf(sep);
  const variantPart = idx >= 0 ? p.nombre.substring(idx + sep.length).trim() : '';
  let color = 'Único';
  let talla = 'Estándar';
  if (variantPart) {
    const res = extractColorSize(variantPart);
    color = res.color || 'Único';
    talla = res.size || 'Estándar';
  }
  return { baseName, color, talla, key: `${baseName}||${p.categoria}` };
}

// Bloques = grupos padre-color con al menos 1 unidad (todas sus tallas, aunque estén en cero)
function _obtenerBloquesConteo() {
  const groups = {};
  (productos || []).forEach(p => {
    const d = _descomponerProductoConteo(p);
    if (!groups[d.key]) groups[d.key] = { baseName: d.baseName, totalQty: 0, colors: {} };
    const g = groups[d.key];
    if (!g.colors[d.color]) g.colors[d.color] = { color: d.color, totalQty: 0, items: [] };
    const cg = g.colors[d.color];
    cg.items.push(p);
    cg.totalQty += p.qty;
    g.totalQty += p.qty;
  });
  const bloques = [];
  Object.keys(groups)
    .sort((a, b) => groups[b].totalQty - groups[a].totalQty)
    .forEach(k => {
      const g = groups[k];
      Object.keys(g.colors)
        .sort((a, b) => (g.colors[b].totalQty - g.colors[a].totalQty) || a.localeCompare(b, 'es'))
        .forEach(cName => {
          const cg = g.colors[cName];
          if (cg.totalQty < 1) return;
          cg.items.sort((a, b) => getSizeWeight(a.nombre) - getSizeWeight(b.nombre));
          bloques.push({ baseName: g.baseName, color: cName, items: cg.items });
        });
    });
  return bloques;
}

async function descargarPlantillaConteo() {
  if (!window.ExcelJS) { toast('Error: librería ExcelJS no cargada.', false); return; }
  toast('Generando plantilla con datos actualizados...');
  try { await loadProductos(); } catch (e) { console.warn('No se pudo refrescar el inventario; se usan los datos actuales.', e); }
  if (!productos || productos.length === 0) { toast('No hay productos cargados para generar la plantilla.', false); return; }

  const bloques = _obtenerBloquesConteo();
  const totalFilas = bloques.reduce((a, b) => a + b.items.length, 0);
  if (totalFilas === 0) { toast('No hay productos con stock para generar la plantilla.', false); return; }

  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Conteo');
    sheet.columns = [
      { header: 'Grupo', key: 'grupo', width: 34 },
      { header: 'Color', key: 'color', width: 16 },
      { header: 'Talla', key: 'talla', width: 14 },
      { header: 'SKU', key: 'sku', width: 24 },
      { header: 'Conteo', key: 'conteo', width: 12 }
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const fillSeparador = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    const fillConteo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };

    bloques.forEach(b => {
      const sep = sheet.addRow({ grupo: b.baseName, color: b.color, talla: '—', sku: '—', conteo: null });
      sep.font = { bold: true, color: { argb: 'FF334155' } };
      for (let c = 1; c <= 5; c++) sep.getCell(c).fill = fillSeparador;

      b.items.forEach(p => {
        const row = sheet.addRow({
          grupo: b.baseName,
          color: b.color,
          talla: _descomponerProductoConteo(p).talla,
          sku: p.sku || '',
          conteo: null
        });
        const celda = row.getCell('conteo');
        celda.fill = fillConteo;
        celda.numFmt = '0';
      });
    });

    const colLetra = sheet.getColumn(5).letter;
    sheet.dataValidations.add(`${colLetra}2:${colLetra}${sheet.lastRow.number}`, {
      type: 'whole',
      operator: 'greaterThanOrEqual',
      formulae: [0],
      showErrorMessage: true,
      errorTitle: 'Cantidad inválida',
      error: 'Escribe un número entero (0 o mayor). Deja la celda vacía si no contaste este producto.'
    });

    const info = workbook.addWorksheet('Instrucciones');
    info.getColumn(1).width = 115;
    [
      '📋 PLANTILLA DE CONTEO FÍSICO — INSTRUCCIONES',
      '',
      '1. Llena ÚNICAMENTE la columna "Conteo" (celdas amarillas) de la hoja "Conteo".',
      '2. Escribe la cantidad física contada en cada talla. Deja la celda VACÍA si no contaste ese producto (no se ajustará).',
      '3. Si un producto ya no existe físicamente, escribe 0 (el sistema lo ajustará a cero).',
      '4. No modifiques las columnas Grupo, Color, Talla ni SKU. Puedes agregar filas nuevas: escribe el SKU en la columna D y la cantidad en "Conteo".',
      '5. Las filas con fondo gris separan cada color/grupo y no se llenan.',
      '6. Al terminar, guarda el archivo y usa el botón "📤 Importar conteo" en la página de Conteo Físico.',
      '7. La app mostrará las diferencias contra el sistema antes de aplicar los ajustes.',
      '',
      'Nota: esta plantilla es "ciega": no muestra el stock del sistema para no sesgar el conteo.',
      'Incluye solo los grupos/colores con al menos 1 unidad en el sistema, con todas sus tallas (aunque estén en cero).'
    ].forEach((t, i) => {
      const r = info.addRow([t]);
      if (i === 0) r.font = { bold: true, size: 13 };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Plantilla_Conteo_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Plantilla descargada: ${bloques.length} grupos de color, ${totalFilas} tallas.`, true);
  } catch (err) {
    console.error(err);
    toast('Error generando la plantilla Excel.', false);
  }
}

function _celdaTexto(cell) {
  const v = cell ? cell.value : null;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if (v.text !== undefined && v.text !== null) return String(v.text);
    if (v.result !== undefined && v.result !== null) return String(v.result);
    return '';
  }
  return String(v);
}

function _parsearConteoDesdeHoja(sheet, catalogo) {
  // Columnas SKU/Conteo localizadas por encabezado (primeras 10 filas); si no hay, posición 4 y 5
  let filaEncabezado = 0;
  let colSku = 4;
  let colConteo = 5;
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    let s = null, c = null;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const t = String(_celdaTexto(cell)).trim().toLowerCase();
      if (t === 'sku') s = colNumber;
      if (t === 'conteo') c = colNumber;
    });
    if (s && c) { filaEncabezado = r; colSku = s; colConteo = c; break; }
  }

  const skuMap = new Map();
  (catalogo || []).forEach(p => { if (p.sku) skuMap.set(String(p.sku).trim().toLowerCase(), p); });

  const nuevos = [];
  const avisos = [];
  const vistos = new Set();

  for (let r = 1; r <= sheet.rowCount; r++) {
    if (r === filaEncabezado) continue;
    const row = sheet.getRow(r);
    const celdaConteo = row.getCell(colConteo);
    const conteoVal = celdaConteo.value;
    if (conteoVal === null || conteoVal === undefined) continue;
    const conteoStr = typeof conteoVal === 'object' ? String(_celdaTexto(celdaConteo)).trim() : String(conteoVal).trim();
    if (!conteoStr) continue;
    const n = Number(conteoStr);
    if (!Number.isInteger(n) || n < 0) {
      avisos.push(`Fila ${r}: cantidad inválida "${conteoStr}" — se omitió.`);
      continue;
    }
    const skuTxt = _celdaTexto(row.getCell(colSku)).trim();
    if (!skuTxt) {
      avisos.push(`Fila ${r}: hay cantidad (${n}) sin SKU — se omitió.`);
      continue;
    }
    const prod = skuMap.get(skuTxt.toLowerCase());
    if (!prod) {
      avisos.push(`Fila ${r}: SKU desconocido "${skuTxt}" — se omitió.`);
      continue;
    }
    if (vistos.has(prod.id)) {
      avisos.push(`Fila ${r}: SKU duplicado "${skuTxt}" — se usó el primer valor.`);
      continue;
    }
    vistos.add(prod.id);
    nuevos.push({ producto: prod, countQty: n, diff: n - prod.qty });
  }
  return { nuevos, avisos };
}

function _mostrarAvisosConteo(avisos) {
  const box = document.getElementById('c-import-avisos');
  if (!box) return;
  if (!avisos || avisos.length === 0) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const MAX = 15;
  const lista = avisos.slice(0, MAX).map(a => `<li>${escapeHtml(a)}</li>`).join('');
  const resto = avisos.length > MAX ? `<li>… y ${avisos.length - MAX} aviso(s) más</li>` : '';
  box.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
      <strong>⚠️ Avisos de importación (${avisos.length})</strong>
      <button class="btn btn-sm btn-outline" onclick="document.getElementById('c-import-avisos').style.display='none'">✖</button>
    </div>
    <ul style="margin:8px 0 0 18px; font-size:0.85rem; color:#92400e;">${lista}${resto}</ul>
  `;
  box.style.display = 'block';
}

async function importarConteoFisico(input) {
  const file = input && input.files ? input.files[0] : null;
  if (input) input.value = '';
  if (!file) return;
  if (!window.ExcelJS) { toast('Error: librería ExcelJS no cargada.', false); return; }
  if (!productos || productos.length === 0) {
    try { await loadProductos(); } catch (e) {}
  }
  if (!productos || productos.length === 0) { toast('No se pudo cargar el catálogo de productos.', false); return; }

  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch (e) {
    console.error(e);
    toast('No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) válido.', false);
    return;
  }
  const sheet = workbook.getWorksheet('Conteo') || workbook.worksheets[0];
  if (!sheet) { toast('El archivo no contiene hojas de cálculo.', false); return; }

  const { nuevos, avisos } = _parsearConteoDesdeHoja(sheet, productos);

  if (nuevos.length === 0) {
    _mostrarAvisosConteo(avisos);
    toast('El archivo no tiene conteos válidos. Llena la columna "Conteo" y vuelve a intentar.', false);
    return;
  }
  if (conteoItems.length > 0 && !confirm(`Ya hay un conteo en curso (${conteoItems.length} productos).\n¿Reemplazarlo con lo importado del archivo (${nuevos.length} productos)?`)) {
    return;
  }

  conteoItems = nuevos;
  renderConteo();
  _mostrarAvisosConteo(avisos);
  const conDif = nuevos.filter(x => x.diff !== 0).length;
  toast(`Importados ${nuevos.length} productos (${conDif} con diferencias)${avisos.length ? ` · ${avisos.length} aviso(s)` : ''}`, true);
  const lista = document.getElementById('conteo-list');
  if (lista) lista.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Register global functions for UI hooks
window.sumarConteoManual = sumarConteoManual;
window.eliminarDelConteo = eliminarDelConteo;
window.limpiarConteo = limpiarConteo;
window.procesarConteoFisico = procesarConteoFisico;
window.descargarPlantillaConteo = descargarPlantillaConteo;
window.importarConteoFisico = importarConteoFisico;
