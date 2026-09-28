// ═══════════════════════════════════════════════════════════════════
// MÓDULO: DASHBOARD — KPIs Visuales
// ═══════════════════════════════════════════════════════════════════

let chartVentas = null;
let chartTop = null;
let chartInventario = null;

// ── Renderizar Dashboard completo ───────────────────────────────────
window.renderDashboard = async function() {
  try {
    // Cargar datos en paralelo con fallback a vacíos
    const [rawMovs, rawReporte, rawProds, rawAlertasInt] = await Promise.all([
      req('GET', '/movimientos?tipo=venta&limit=2000').catch(e => { console.warn('Dash: movs failed', e); return []; }),
      req('GET', '/reporte').catch(e => { console.warn('Dash: reporte failed', e); return null; }),
      Promise.resolve(typeof productos !== 'undefined' ? productos : []),
      req('GET', '/dashboard/alertas-inteligentes').catch(e => { console.warn('Dash: alertas int failed', e); return null; })
    ]);

    // Asegurar estructura de datos antes de pasar a renderers
    const movimientos = Array.isArray(rawMovs) ? rawMovs : [];
    const reporte = rawReporte || { ingresos: 0, ganancia: 0, unidades: 0, top_productos: [] };
    const prods = Array.isArray(rawProds) ? rawProds : [];
    window.alertasInteligentes = rawAlertasInt || { stock_bajo_prioritario: [], sin_stock_prioritario: [], sin_movimiento: [] };

    renderKPICards(movimientos, reporte, prods, window.alertasInteligentes);
    renderChartVentas(movimientos);
    renderChartTopProductos(reporte);
    renderChartInventario(prods);
  } catch(e) {
    console.error('Error renderizando dashboard:', e);
    toast('Error cargando dashboard: ' + e.message, false);
  }
};

// ── Tarjetas KPI ────────────────────────────────────────────────────
function renderKPICards(movimientos, reporte, prods, alertasInt) {
  const movArray = Array.isArray(movimientos) ? movimientos : [];
  const reportObj = reporte || { ingresos: 0, ganancia: 0, unidades: 0, top_productos: [] };
  const prodArray = Array.isArray(prods) ? prods : [];

  const hoy = new Date();
  const hoyStr = hoy.toDateString();
  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();

  // Ventas del día
  const ventasHoy = movArray.filter(m => new Date(m.fecha).toDateString() === hoyStr);
  const montoHoy = ventasHoy.reduce((s, v) => s + (v.precio * v.qty), 0);
  const udsHoy = ventasHoy.reduce((s, v) => s + v.qty, 0);

  // Ventas del mes
  const ventasMes = movArray.filter(m => {
    const f = new Date(m.fecha);
    return f.getMonth() === mesActual && f.getFullYear() === anioActual;
  });
  const montoMes = ventasMes.reduce((s, v) => s + (v.precio * v.qty), 0);

  // Margen promedio
  const margen = reportObj.ingresos > 0
    ? ((reportObj.ganancia / reportObj.ingresos) * 100).toFixed(1)
    : 0;

  // Productos en alerta (usando inteligencia)
  const alertas = alertasInt ? alertasInt.stock_bajo_prioritario.length : 0;
  const sinStock = alertasInt ? alertasInt.sin_stock_prioritario.length : 0;

  document.getElementById('kpi-ventas-hoy').textContent = mxn(montoHoy);
  document.getElementById('kpi-ventas-hoy-uds').textContent = `${udsHoy} unidades`;
  document.getElementById('kpi-ventas-mes').textContent = mxn(montoMes);
  document.getElementById('kpi-ventas-mes-uds').textContent = `${ventasMes.reduce((s,v) => s + v.qty, 0)} unidades`;
  document.getElementById('kpi-margen').textContent = margen + '%';
  document.getElementById('kpi-margen-detalle').textContent = `${mxn(reportObj.ganancia)} neto`;
  document.getElementById('kpi-alertas').textContent = alertas;
  document.getElementById('kpi-alertas-detalle').textContent = `${sinStock} sin stock`;
}

// ── Gráfica de Ventas por Período ───────────────────────────────────
window.dashPeriodo = '7d';

window.cambiarPeriodoDash = function(periodo) {
  window.dashPeriodo = periodo;
  document.querySelectorAll('.dash-periodo-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-periodo="${periodo}"]`).classList.add('active');
  // Re-render solo la gráfica de ventas
  req('GET', '/movimientos?tipo=venta&limit=2000').then(movs => renderChartVentas(movs)).catch(console.error);
};

function renderChartVentas(movimientos) {
  const movArray = Array.isArray(movimientos) ? movimientos : [];
  const hoy = new Date();
  let dias;
  switch(window.dashPeriodo) {
    case '30d': dias = 30; break;
    case '90d': dias = 90; break;
    default: dias = 7;
  }

  // Crear mapa de días
  const ventasPorDia = {};
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    ventasPorDia[key] = { monto: 0, uds: 0 };
  }

  // Llenar con datos reales
  movArray.forEach(m => {
    const key = new Date(m.fecha).toISOString().slice(0, 10);
    if (ventasPorDia[key]) {
      ventasPorDia[key].monto += (m.precio * m.qty);
      ventasPorDia[key].uds += m.qty;
    }
  });

  const labels = Object.keys(ventasPorDia).map(k => {
    const d = new Date(k + 'T12:00:00');
    return dias <= 7
      ? d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })
      : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  });
  const dataMontos = Object.values(ventasPorDia).map(v => v.monto);
  const dataUds = Object.values(ventasPorDia).map(v => v.uds);

  const ctx = document.getElementById('chart-ventas').getContext('2d');
  if (chartVentas) chartVentas.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(168, 85, 247, 0.35)');
  gradient.addColorStop(1, 'rgba(168, 85, 247, 0.02)');

  chartVentas = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Ingresos (MXN)',
          data: dataMontos,
          backgroundColor: 'rgba(168, 85, 247, 0.7)',
          borderColor: '#a855f7',
          borderWidth: 1,
          borderRadius: 6,
          order: 2,
          yAxisID: 'y'
        },
        {
          label: 'Unidades',
          data: dataUds,
          type: 'line',
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          borderWidth: 2.5,
          pointBackgroundColor: '#22c55e',
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.35,
          fill: true,
          order: 1,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, padding: 15, font: { size: 12 } } },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          titleFont: { size: 13 },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(ctx) {
              if (ctx.dataset.yAxisID === 'y') return ' Ingresos: ' + mxn(ctx.raw) + ' MXN';
              return ' Unidades: ' + ctx.raw;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          position: 'left',
          ticks: { callback: v => (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v) + ' MXN', font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          ticks: { font: { size: 11 }, color: '#22c55e' },
          grid: { display: false }
        },
        x: {
          ticks: { font: { size: 11 } },
          grid: { display: false }
        }
      }
    }
  });
}

// ── Top 10 Productos ────────────────────────────────────────────────
function renderChartTopProductos(reporte) {
  const top = (reporte.top_productos || []).slice(0, 10);
  if (top.length === 0) {
    document.getElementById('chart-top-empty').style.display = 'block';
    document.getElementById('chart-top').style.display = 'none';
    return;
  }
  document.getElementById('chart-top-empty').style.display = 'none';
  document.getElementById('chart-top').style.display = 'block';

  // Truncar nombres largos
  const labels = top.map(p => {
    let n = p.nombre;
    if (n.includes('>')) n = n.split('>').slice(-2).join(' › ');
    return n.length > 30 ? n.substring(0, 28) + '…' : n;
  });
  const dataQty = top.map(p => p.qty);
  const dataIngresos = top.map(p => p.ingresos);

  // Colores basados en categoría
  const colors = top.map((_, i) => {
    const palette = [
      '#a855f7', '#8b5cf6', '#7c3aed', '#6d28d9',
      '#22c55e', '#16a34a', '#15803d',
      '#3b82f6', '#2563eb', '#1d4ed8'
    ];
    return palette[i % palette.length];
  });

  const ctx = document.getElementById('chart-top').getContext('2d');
  if (chartTop) chartTop.destroy();

  chartTop = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Unidades vendidas',
        data: dataQty,
        backgroundColor: colors.map(c => c + 'CC'),
        borderColor: colors,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            afterLabel: function(ctx) {
              const ing = dataIngresos[ctx.dataIndex];
              return 'Ingresos: ' + mxn(ing);
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        y: {
          ticks: { font: { size: 11 }, autoSkip: false },
          grid: { display: false }
        }
      }
    }
  });
}

// ── Gráfica de Distribución de Inventario ───────────────────────────
function renderChartInventario(prods) {
  const prodArray = Array.isArray(prods) ? prods : [];
  const enStock = prodArray.filter(p => p.qty > p.min_stock).length;
  const stockBajo = prodArray.filter(p => p.qty > 0 && p.qty <= p.min_stock).length;
  const sinStock = prodArray.filter(p => p.qty <= 0).length;

  const ctx = document.getElementById('chart-inventario').getContext('2d');
  if (chartInventario) chartInventario.destroy();

  // Plugin para texto central
  const centerTextPlugin = {
    id: 'centerText',
    afterDraw(chart) {
      const { ctx, width, height } = chart;
      ctx.save();
      ctx.font = 'bold 28px "Segoe UI", sans-serif';
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(prodArray.length, width / 2, height / 2 - 10);
      ctx.font = '12px "Segoe UI", sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('productos', width / 2, height / 2 + 14);
      ctx.restore();
    }
  };

  chartInventario = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['En Stock', 'Stock Bajo', 'Sin Stock'],
      datasets: [{
        data: [enStock, stockBajo, sinStock],
        backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'],
        borderColor: ['#16a34a', '#d97706', '#dc2626'],
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, padding: 18, font: { size: 12 } }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(ctx) {
              const pct = ((ctx.raw / prods.length) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
            }
          }
        }
      }
    },
    plugins: [centerTextPlugin]
  });
}

window.alertasSeleccionadas = [];

// ── Lógica del Modal Alertas Inteligentes ───────────────────────────
window.abrirModalAlertas = function() {
  if (!window.alertasInteligentes) return;
  const d = window.alertasInteligentes;
  
  // Reset selection
  window.alertasSeleccionadas = [];
  document.getElementById('alertas-seleccionadas-count').textContent = '0 seleccionados';
  
  // Render Stock Bajo
  const tBajo = document.getElementById('tbody-alertas-bajo');
  tBajo.innerHTML = '';
  d.stock_bajo_prioritario.forEach(p => {
    tBajo.innerHTML += `
      <tr>
        <td><strong>${p.nombre}</strong><br><small>${p.sku}</small></td>
        <td style="color:var(--tertiary); font-weight:bold;">${p.qty}</td>
        <td>${p.min_stock}</td>
        <td>${p.ventas_historicas} uds</td>
        <td><button class="btn-add-oc" id="btn-alerta-${p.id}" onclick="toggleAlertaSeleccion(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', this)"><span class="icon">+</span> Seleccionar</button></td>
      </tr>
    `;
  });
  if(d.stock_bajo_prioritario.length === 0) tBajo.innerHTML = '<tr><td colspan="5" class="empty-state">No hay productos prioritarios con stock bajo.</td></tr>';

  // Render Agotados
  const tAgotado = document.getElementById('tbody-alertas-agotados');
  tAgotado.innerHTML = '';
  d.sin_stock_prioritario.forEach(p => {
    tAgotado.innerHTML += `
      <tr>
        <td><strong>${p.nombre}</strong><br><small>${p.sku}</small></td>
        <td style="color:var(--error); font-weight:bold;">${p.qty}</td>
        <td>${p.min_stock}</td>
        <td>${p.ventas_historicas} uds</td>
        <td><button class="btn-add-oc" id="btn-alerta-${p.id}" onclick="toggleAlertaSeleccion(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', this)"><span class="icon">+</span> Seleccionar</button></td>
      </tr>
    `;
  });
  if(d.sin_stock_prioritario.length === 0) tAgotado.innerHTML = '<tr><td colspan="5" class="empty-state">No hay productos prioritarios agotados.</td></tr>';

  document.getElementById('overlay-alertas-inteligentes').classList.add('active');
  switchAlertTab('stock_bajo');
};

window.switchAlertTab = function(tabId) {
  document.querySelectorAll('#overlay-alertas-inteligentes .modal-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('#overlay-alertas-inteligentes .modal-tab-content').forEach(tab => tab.classList.remove('active'));
  
  // Activar botón correspondiente
  let idx = 0;
  if(tabId === 'agotados') idx = 1;
  document.querySelectorAll('#overlay-alertas-inteligentes .modal-tab-btn')[idx].classList.add('active');
  
  // Mostrar contenido
  document.getElementById('tab-' + tabId).classList.add('active');
};

window.toggleAlertaSeleccion = function(prodId, prodNombre, btn) {
  const index = window.alertasSeleccionadas.findIndex(x => x.id === prodId);
  if (index === -1) {
    window.alertasSeleccionadas.push({ id: prodId, nombre: prodNombre });
    btn.innerHTML = `<span class="icon">✔</span> Seleccionado`;
    btn.style.backgroundColor = 'var(--secondary)';
    btn.style.color = '#fff';
    btn.style.borderColor = 'var(--secondary)';
  } else {
    window.alertasSeleccionadas.splice(index, 1);
    btn.innerHTML = `<span class="icon">+</span> Seleccionar`;
    btn.style.backgroundColor = '';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
  document.getElementById('alertas-seleccionadas-count').textContent = `${window.alertasSeleccionadas.length} seleccionados`;
};

window.crearOCConSeleccion = async function() {
  if (window.alertasSeleccionadas.length === 0) {
    toast('Selecciona al menos un producto para generar la orden', false);
    return;
  }
  
  closeModal('alertas-inteligentes');
  document.getElementById('nav-ordenes').click();
  
  if(typeof window.openNuevaOrden === 'function') {
    await window.openNuevaOrden(); // Esto limpia ocItems y abre el modal

    for (const item of window.alertasSeleccionadas) {
      const p = (typeof productos !== 'undefined' ? productos : []).find(x => x.id === item.id);
      if(p) {
        if(typeof window.onScannerEnterOC === 'function' && p.sku) {
          window.onScannerEnterOC(p.sku); // Simula el escaneo
        } else if(typeof window.seleccionarProductoOC === 'function') {
          window.seleccionarProductoOC(p.id, p.nombre, '', '', '', '', p.costo || 0);
        }
      }
    }
    toast(`Agregaste ${window.alertasSeleccionadas.length} productos a la nueva OC`);
  }
};
