// ═══════════════════════════════════════════════════════════════════
// MÓDULO: CONTABILIDAD & CATÁLOGO DE INSUMOS
// ═══════════════════════════════════════════════════════════════════

// ── Inicializar fecha por defecto al mes actual ──────────────────────
(function initContabilidad() {
  const mesInput = document.getElementById('conta-mes');
  if (mesInput && !mesInput.value) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    mesInput.value = `${y}-${m}`;
  }
})();

// ── Renderizar reporte de contabilidad ──────────────────────────────
window.renderContabilidad = async function() {
  const mesInput = document.getElementById('conta-mes');
  if (!mesInput) return;

  // Extraer mes y año del input
  let mes, anio;
  if (mesInput.value) {
    const [y, m] = mesInput.value.split('-');
    anio = parseInt(y);
    mes = parseInt(m);
  } else {
    const now = new Date();
    mes = now.getMonth() + 1;
    anio = now.getFullYear();
  }

  try {
    const data = await req('GET', `/contabilidad/reporte?mes=${mes}&anio=${anio}`);

    // Actualizar tarjetas de resumen
    document.getElementById('conta-ingresos').textContent = mxn(data.ingresos || 0);
    document.getElementById('conta-egresos').textContent = mxn(data.egresos || 0);
    document.getElementById('conta-balance').textContent = mxn(data.balance || 0);

    // Color dinámico del balance
    const balanceEl = document.getElementById('conta-balance');
    if (data.balance >= 0) {
      balanceEl.style.color = '#16a34a';
    } else {
      balanceEl.style.color = '#ef4444';
    }

    const body = document.getElementById('conta-body');
    const emptyState = document.getElementById('conta-empty');
    const table = document.getElementById('conta-table');

    if (!data.transacciones || data.transacciones.length === 0) {
      body.innerHTML = '';
      table.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    table.style.display = '';
    emptyState.style.display = 'none';

    body.innerHTML = data.transacciones.map(tx => {
      const fecha = tx.fecha ? new Date(tx.fecha).toLocaleDateString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric'
      }) : '—';
      const esIngreso = tx.tipo === 'ingreso';
      const tipoBadge = esIngreso
        ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;">Ingreso</span>'
        : '<span style="background:#fee2e2;color:#ef4444;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;">Egreso</span>';
      const montoColor = esIngreso ? '#16a34a' : '#ef4444';
      const montoSign = esIngreso ? '+' : '-';

      return `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:10px 12px;">${fecha}</td>
          <td style="padding:10px 12px;">${tipoBadge}</td>
          <td style="padding:10px 12px;">${escapeHtml(tx.concepto || '—')}</td>
          <td style="padding:10px 12px;">${escapeHtml(tx.procedencia_destino || '—')}</td>
          <td style="padding:10px 12px;">${tx.referencia_id ? `OC-${escapeHtml(tx.referencia_id)}` : '—'}</td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${montoColor};">${montoSign}${mxn(tx.monto)}</td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    console.error('Error cargando contabilidad:', e);
    toast('Error cargando contabilidad: ' + e.message, false);
  }
};

// ── Abrir modal de registro de transacción ──────────────────────────
window.openModalContabilidad = function(tipo) {
  const title = document.getElementById('mtx-title');
  const tipoInput = document.getElementById('mtx-tipo');
  const labelProc = document.getElementById('mtx-procedencia-label');
  
  if (tipo === 'ingreso') {
    title.textContent = '💰 Registrar Ingreso';
    labelProc.textContent = 'Procedencia *';
    document.getElementById('mtx-procedencia').placeholder = 'Ej: Amazon, Efectivo, Transferencia...';
  } else {
    title.textContent = '💸 Registrar Gasto Manual';
    labelProc.textContent = 'Destino del Gasto *';
    document.getElementById('mtx-procedencia').placeholder = 'Ej: Proveedor, Servicio, Renta...';
  }
  
  tipoInput.value = tipo;
  document.getElementById('mtx-monto').value = '';
  document.getElementById('mtx-concepto').value = '';
  document.getElementById('mtx-procedencia').value = '';
  document.getElementById('mtx-ref').value = '';
  
  // Fecha por defecto = hoy
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('mtx-fecha').value = hoy;
  
  document.getElementById('overlay-tx-conta').classList.add('active');
};

// ── Guardar transacción contable ────────────────────────────────────
window.guardarTransaccionContable = async function() {
  const tipo = document.getElementById('mtx-tipo').value;
  const monto = parseFloat(document.getElementById('mtx-monto').value);
  const fecha = document.getElementById('mtx-fecha').value;
  const concepto = document.getElementById('mtx-concepto').value.trim();
  const procedencia = document.getElementById('mtx-procedencia').value.trim();
  const ref = document.getElementById('mtx-ref').value.trim();

  if (!monto || monto <= 0) return toast('Ingresa un monto válido', false);
  if (!fecha) return toast('Selecciona una fecha', false);
  if (!concepto) return toast('Escribe un concepto', false);
  if (!procedencia) return toast('Indica la procedencia o destino', false);

  const payload = {
    tipo,
    monto,
    fecha: new Date(fecha).toISOString(),
    concepto,
    procedencia_destino: procedencia,
    referencia_id: null
  };

  try {
    await req('POST', '/contabilidad/transaccion', payload);
    toast(`✅ ${tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} registrado correctamente`);
    closeModal('tx-conta');
    await renderContabilidad();
  } catch (e) {
    toast('❌ Error al guardar: ' + e.message, false);
  }
};

// ═══════════════════════════════════════════════════════════════════
// CATÁLOGO DE INSUMOS CRUD
// ═══════════════════════════════════════════════════════════════════

window.openModalInsumos = async function() {
  document.getElementById('overlay-catalogo-insumos').classList.add('active');
  document.getElementById('min-nombre').value = '';
  document.getElementById('min-desc').value = '';
  await cargarListaInsumos();
};

async function cargarListaInsumos() {
  const body = document.getElementById('min-body');
  body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#aaa;padding:15px;">Cargando...</td></tr>';
  try {
    const insumos = await req('GET', '/insumos');
    if (!insumos || insumos.length === 0) {
      body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#aaa;padding:15px;">No hay insumos registrados aún</td></tr>';
      return;
    }
    body.innerHTML = insumos.map(i => `
      <tr>
        <td style="padding:8px 10px; font-weight:500;">${escapeHtml(i.nombre)}</td>
        <td style="padding:8px 10px; color:#6b7280;">${escapeHtml(i.descripcion || '—')}</td>
        <td style="padding:8px 10px; text-align:center;">
          <button class="btn btn-sm btn-danger" onclick="eliminarInsumo(${i.id})" title="Eliminar">🗑️</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="3" style="color:red; padding:10px;">Error: ${escapeHtml(e.message)}</td></tr>`;
  }
}

window.guardarInsumo = async function() {
  const nombre = document.getElementById('min-nombre').value.trim();
  const descripcion = document.getElementById('min-desc').value.trim();
  
  if (!nombre) return toast('El nombre del insumo es obligatorio', false);

  try {
    await req('POST', '/insumos', { nombre, descripcion });
    toast('✅ Insumo agregado al catálogo');
    document.getElementById('min-nombre').value = '';
    document.getElementById('min-desc').value = '';
    await cargarListaInsumos();
  } catch (e) {
    toast('❌ Error al guardar insumo: ' + e.message, false);
  }
};

window.eliminarInsumo = async function(id) {
  if (!confirm('¿Eliminar este insumo del catálogo?')) return;
  try {
    await req('DELETE', `/insumos/${id}`);
    toast('✅ Insumo eliminado');
    await cargarListaInsumos();
  } catch (e) {
    toast('❌ Error: ' + e.message, false);
  }
};
