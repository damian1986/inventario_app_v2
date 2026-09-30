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
    renderConteo();
    // Refrescar el inventario base
    loadProductos();
    showPage('inventario');
  } else {
    toast(`Operación parcial. OK: ${successCount}, Errores: ${failCount}`, false);
    loadProductos();
  }
}

// Register global functions for UI hooks
window.sumarConteoManual = sumarConteoManual;
window.eliminarDelConteo = eliminarDelConteo;
window.limpiarConteo = limpiarConteo;
window.procesarConteoFisico = procesarConteoFisico;
