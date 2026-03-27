const API = window.location.port === '3000' ? `${window.location.protocol}//${window.location.hostname}:8000` : `${window.location.protocol}//${window.location.hostname}:8000`;
let productos = [], editingId = null, ajusteId = null;
window.collapsedGroups = new Set();

// Parámetros de paginación simples
let skipMovimientos = 0;
let limitMovimientos = 200;

async function req(method, path, body){
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if(body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if(!r.ok){ const e = await r.json().catch(()=>({detail:'Error'})); throw new Error(e.detail||'Error'); }
  if(r.status===204) return null;
  return r.json();
}

function toast(msg, ok=true){
  const t = document.getElementById('toast');
  t.textContent = (ok?'✅ ':'❌ ') + msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 3000);
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
          <input type="checkbox" value="${s}" onchange="renderInventario()"> ${s}
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

function mxn(v){ return '$'+Number(v).toLocaleString('es-MX',{minimumFractionDigits:2}); }

const sizeOrderMap = {
  'Extra Extra Extra Grande': 6, 'XXXL': 6, 'EEEG': 6,
  'Extra Extra Grande': 5, 'XXL': 5, 'EEG': 5,
  'Extra Grande': 4, 'Extragrande': 4, 'XL': 4, 'EG': 4,
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
     return `<div class="breadcrumb-container"><span class="bc-item bc-0">${name}</span></div>`;
  }
  const levels = cat.split(' › ');
  const parts = [];
  levels.forEach((l, i) => { parts.push(`<span class="bc-item bc-${Math.min(i, 4)}">${l}</span>`); });
  let variantPart = name;
  levels.forEach(l => { variantPart = variantPart.replace(l, '').trim(); });
  variantPart = variantPart.replace(/^[-\s▸>]+/, '').trim();
  if (variantPart && variantPart !== 'Estándar') {
    if (variantPart.includes('>')) {
      const segs = variantPart.split('>').map(s => s.trim()).filter(Boolean);
      const cssClasses = ['bc-peso', 'bc-color', 'bc-talla'];
      segs.forEach((seg, idx) => { const cls = cssClasses[idx] || 'bc-v'; parts.push(`<span class="bc-item ${cls}">${seg}</span>`); });
    } else {
      const partsArr = variantPart.split(' - ').map(s=>s.trim());
      if (partsArr.length === 2) {
         parts.push(`<span class="bc-item bc-peso">${partsArr[0]}</span>`);
         const res = extractColorSize(partsArr[1]);
         if (res.color) parts.push(`<span class="bc-item bc-color">${res.color}</span>`);
         if (res.size) parts.push(`<span class="bc-item bc-talla">${res.size}</span>`);
      } else {
         const res = extractColorSize(variantPart);
         if (res.color) parts.push(`<span class="bc-item bc-color">${res.color}</span>`);
         if (res.size) parts.push(`<span class="bc-item bc-talla">${res.size}</span>`);
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
    const ms=p.nombre.toLowerCase().includes(search)||(p.sku||'').toLowerCase().includes(search);
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
  const groupKeys = Object.keys(groups).sort();
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
            <span class="toggle-btn ${isCollapsed ? 'collapsed' : ''}" onclick="toggleGroup('${key.replace(/'/g, "\\'")}')">
              ${isCollapsed ? '▶' : '▼'}
            </span>
            <div class="parent-name" onclick="toggleGroup('${key.replace(/'/g, "\\'")}')\" style="cursor:pointer">
              ${renderBreadcrumb(g.baseName, g.categoria)}
            </div>
          </div>
        </td>
        <td>${g.categoria}</td>
        <td><span class="chip">${Object.keys(g.colors).length} colores</span></td>
        <td>
          <span class="aggregate-qty">${g.totalQty}</span>
          ${g.lowCount > 0 ? `<span class="mini-badge badge-low" title="${g.lowCount} variantes con stock bajo">⚠️${g.lowCount}</span>` : ''}
          ${g.outCount > 0 ? `<span class="mini-badge badge-out" title="${g.outCount} variantes sin stock">❌${g.outCount}</span>` : ''}
        </td>
        <td><span class="aggregate-cost" title="Costo total de stock actual">${mxn(g.totalCosto)}</span></td>
        <td><span class="aggregate-venta" title="Total vendido históricamente">${mxn(g.totalVendido)}</span></td>
        <td>${statusBadge(g.totalQty, g.minStock)}</td>
        <td></td>
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
                <span class="toggle-btn ${isColorCollapsed ? 'collapsed' : ''}" onclick="toggleGroup('${colorKey.replace(/'/g, "\\'")}')">
                  ${isColorCollapsed ? '▶' : '▼'}
                </span>
                <span class="bc-item bc-color" style="cursor:pointer" onclick="toggleGroup('${colorKey.replace(/'/g, "\\'")}')\">${colorName}</span>
              </td>
              <td>—</td>
              <td><span style="font-size:0.8rem; color:#888;">${cg.items.length} tallas</span></td>
              <td style="font-weight:600;">${cg.totalQty}</td>
              <td class="aggregate-cost" title="Costo stock este color">${mxn(cgCosto)}</td>
              <td class="aggregate-venta" title="Vendido este color">${mxn(cgVendido)}</td>
              <td>—</td><td></td>
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
                <td style="padding-left: 50px;">${renderBreadcrumb(p.nombre, p.categoria)}${p.sku?'<br><small style="color:#aaa; margin-left:15px;">SKU: '+p.sku+'</small>':''}</td>
                <td>${p.categoria}</td>
                <td>—</td>
                <td><div class="qty-controls">
                  <button onclick="quickQty(${p.id},-1)">−</button>
                  <span>${p.qty}</span>
                  <button onclick="quickQty(${p.id},1)">+</button>
                </div></td>
                <td>${mxn(p.costo)}</td><td>${mxn(p.venta)}</td>
                <td>${statusBadge(p.qty, p.min_stock)}</td>
                <td>
                  <button class="btn btn-sm btn-primary" onclick="editProducto(${p.id})">✏️</button>
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
  document.getElementById('s-low').textContent = productos.filter(p => getStatus(p.qty, p.min_stock) !== 'ok').length;
  const val = productos.reduce((a, p) => a + (p.qty * p.costo), 0);
  document.getElementById('s-valor').textContent = mxn(val);
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
  if(type==='orden_compra') {
    iniciarModalOrdenCompra();
  }
}
function closeModal(type){ document.getElementById('overlay-'+type).classList.remove('active'); editingId=null; }

function addVariantField(val='', sku=''){
  const div=document.createElement('div');div.className='variant-row';
  div.innerHTML=`
    <input type="text" placeholder="Ej: M - Rojo" value="${val}" style="flex:2"/>
    <input type="text" placeholder="SKU" value="${sku}" style="flex:1"/>
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
    costo:parseFloat(document.getElementById('mp-costo').value)||0,
    venta:parseFloat(document.getElementById('mp-venta').value)||0,
    variantes: []
  };
  try {
    if (variantsData.length > 0) {
      toast(`Generando ${variantsData.length} productos...`);
      for (const v of variantsData) {
        const fullData = { ...commonData, nombre: `${nombreBase} - ${v.val}`, sku: v.sku };
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
  document.getElementById('mp-costo').value=p.costo;
  document.getElementById('mp-venta').value=p.venta;
  document.getElementById('variants-list').innerHTML='';
  (p.variantes||[]).forEach(v=>addVariantField(v));
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
   if(text) matches = matches.filter(p => p.nombre.toLowerCase().includes(text) || p.categoria.toLowerCase().includes(text));
   if(skuText) matches = matches.filter(p => (p.sku||'').toLowerCase().includes(skuText));
   matches.forEach(p => {
       const o = document.createElement('option');
       o.value = p.id;
       o.textContent = p.nombre + ' (' + (p.sku||'Sin SKU') + ') - Stock: ' + p.qty;
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
  if(p)document.getElementById('v-precio').value=p.venta > 0 ? p.venta : '';
}

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
  const totEl = document.getElementById('cart-total');
  if(!list) return;
  list.innerHTML = '';
  if(window.cart.length === 0) {
    list.innerHTML = '<div style="color:#aaa; text-align:center; padding: 20px;">Carrito vacío</div>';
    totEl.textContent = '$0.00';
    return;
  }
  let total = 0;
  window.cart.forEach((c, i) => {
    total += (c.qty * c.precio);
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';
    div.style.padding = '8px 0';
    div.style.borderBottom = '1px dashed #eee';
    div.innerHTML = `
      <div style="flex:1">
         <div style="font-size:0.9rem; font-weight:600">${c.nombre} <small>(${c.sku})</small></div>
         <div style="font-size:0.8rem; color:#666">${c.qty}x ${mxn(c.precio)} = <strong>${mxn(c.qty*c.precio)}</strong></div>
      </div>
      <button class="btn btn-sm btn-outline" style="padding: 2px 6px; border-color: red; color: red;" onclick="eliminarDelCarrito(${i})">🗑️</button>
    `;
    list.appendChild(div);
  });
  totEl.textContent = mxn(total);
};

window.procesarCobro = async function() {
  if(window.cart.length === 0){toast('El carrito está vacío',false);return;}
  const canal=document.getElementById('v-canal').value;
  const userNotas=document.getElementById('v-notas').value.trim();
  const ticketId = 'TICKET-' + Date.now().toString(36).toUpperCase();
  const finalNotas = ticketId + (userNotas ? ' | ' + userNotas : '');
  toast('Procesando cobro...');
  try {
    for (const c of window.cart) {
       const data={ producto_id: c.producto_id, variante: '', qty: c.qty, precio: c.precio, canal, notas: finalNotas };
       await req('POST','/ventas',data);
    }
    const ticketData = { fecha: new Date().toISOString(), canal, notas: finalNotas, detalles: window.cart.map(c => ({ producto_nombre: c.nombre, sku: c.sku, qty: c.qty, precio: c.precio })) };
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
        const fechaStr = h.fecha ? new Date(h.fecha).toLocaleString('es-MX') : new Date().toLocaleString('es-MX');
        doc.setFontSize(8); doc.text('Fecha: ' + fechaStr, 40, currentY, { align: 'center' }); currentY += 4;
        doc.line(5, currentY, 75, currentY); currentY += 6;
        doc.setFont('helvetica', 'bold'); doc.text('Detalle de la compra:', 5, currentY); doc.setFont('helvetica', 'normal'); currentY += 6;
        let totalGrid = 0;
        (h.detalles || []).forEach(d => {
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

window.descargarTicketListado = function(h_json) { const h = JSON.parse(decodeURIComponent(h_json)); generarTicketPDF(h); };

function generarTicketPDF(h) {
  if (!window.jspdf) { toast('Error: librería jsPDF no cargada. Recarga la página.', false); return; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 150] });
    const buildPDF = (hasLogo, imgElement) => {
      try {
        let currentY = 15;
        if (hasLogo && imgElement) { doc.addImage(imgElement, 'PNG', 20, 5, 40, 40); currentY = 50; }
        else { doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Kromo Pinceles', 40, currentY, { align: 'center' }); currentY += 7; }
        doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text('TICKET DE COMPRA', 40, currentY, { align: 'center' }); currentY += 6;
        const fechaStr = h.fecha ? new Date(h.fecha).toLocaleString('es-MX') : new Date().toLocaleString('es-MX');
        doc.setFontSize(8); doc.text('Fecha: ' + fechaStr, 40, currentY, { align: 'center' }); currentY += 4;
        doc.line(5, currentY, 75, currentY); currentY += 6;
        doc.setFont('helvetica', 'bold'); doc.text('Detalle de la compra:', 5, currentY); doc.setFont('helvetica', 'normal'); currentY += 6;
        const p = productos.find(x => x.nombre === h.producto_nombre) || {};
        doc.text('SKU: ' + (p.sku || 'N/A'), 5, currentY); currentY += 6;
        const prodName = h.producto_nombre || 'Producto desconocido';
        const splitName = doc.splitTextToSize('Producto: ' + prodName, 70); doc.text(splitName, 5, currentY); currentY += splitName.length * 4;
        if (h.variante) { doc.text('Variante: ' + h.variante, 5, currentY); currentY += 6; }
        const qty = h.qty || 1; const precio = h.precio || 0;
        doc.text('Cantidad: ' + qty, 5, currentY); currentY += 6;
        doc.text('Precio Unit: ' + mxn(precio), 5, currentY); currentY += 6;
        doc.line(5, currentY + 2, 75, currentY + 2); currentY += 8;
        const total = qty * precio; doc.setFont('helvetica', 'bold'); doc.text('TOTAL: ' + mxn(total), 75, currentY, { align: 'right' });
        if (h.notas) { currentY += 8; doc.setFont('helvetica', 'italic'); doc.setFontSize(7); const splitNotas = doc.splitTextToSize('Notas: ' + h.notas, 70); doc.text(splitNotas, 5, currentY); }
        currentY += 15; doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('¡Gracias por su compra!', 40, currentY, { align: 'center' });
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
}

async function renderHistorial(){
  const tipo=document.getElementById('h-tipo').value;
  const search=document.getElementById('h-search').value.toLowerCase();
  const query = `/movimientos?skip=${skipMovimientos}&limit=${limitMovimientos}` + (tipo ? `&tipo=${tipo}` : '');
  try{
    let items=await req('GET', query);
    if(search) items=items.filter(h=>h.producto_nombre.toLowerCase().includes(search)||(h.notas||'').toLowerCase().includes(search));
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
      let p_name = h.isGroup ? `Folio: ${h.notas.split(' | ')[0]} (${h.detalles.length} acts)` : `${h.producto_nombre}${h.variante?' — '+h.variante:''}`;
      let p_val = h.isGroup ? mxn(h.totalPrecio) : (h.precio>0?mxn(h.precio*h.qty):'');
      let t_btn = '';
      if (h.tipo === 'venta') {
         if (h.isGroup) { t_btn = `<button class="btn btn-sm btn-outline" style="margin-top:5px; font-size:0.7rem; padding: 3px 6px;" onclick="descargarTicketMulti('${encodeURIComponent(JSON.stringify(h))}')">📄 Ticket Múltiple</button>`; }
         else { h.detalles = [{ producto_nombre: h.producto_nombre, sku: (productos.find(x=>x.id===h.producto_id)||{}).sku, qty: h.qty, precio: h.precio, variante: h.variante }]; t_btn = `<button class="btn btn-sm btn-outline" style="margin-top:5px; font-size:0.7rem; padding: 3px 6px;" onclick="descargarTicketMulti('${encodeURIComponent(JSON.stringify(h))}')">📄 Ticket</button>`; }
      }
      div.innerHTML=`<div class="hist-icon">${icon}</div>
        <div class="hist-info"><strong>${p_name}</strong>
        <small>${h.canal}${h.notas?' · '+h.notas:''}</small></div>
        <div class="hist-meta"><span class="badge ${badge}">${label}</span><br>
        <span style="font-weight:600">${h.tipo==='venta'?'-':'+'}${h.isGroup ? '' : h.qty + ' uds'}</span><br>
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
    r.top_productos.forEach(p=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td><strong>${p.nombre}</strong></td><td>${p.qty}</td><td>${mxn(p.ingresos)}</td><td style="color:#16a34a;font-weight:600">${mxn(p.ingresos-p.costo)}</td>`; tbody.appendChild(tr); });
  }catch(e){toast(e.message,false);}
}

window.resetReportDates = function() { document.getElementById('r-desde').value = ''; document.getElementById('r-hasta').value = ''; renderReporte(); };

async function showPage(id,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  if(btn)btn.classList.add('active');
  if(id==='ventas') await renderVentas();
  if(id==='historial') await renderHistorial();
  if(id==='reporte') await renderReporte();
  if(id==='ordenes_compra') await renderOrdenesCompra();
}

window.showPage = showPage;
window.renderInventario = renderInventario;
window.exportCSV = exportCSV;
window.openModal = openModal;
window.closeModal = closeModal;
window.saveProducto = saveProducto;
window.quickQty = quickQty;
window.editProducto = editProducto;
window.deleteProducto = deleteProducto;
window.openAjuste = openAjuste;
window.saveAjuste = saveAjuste;
window.onProductoVenta = onProductoVenta;
window.renderHistorial = renderHistorial;
window.addVariantField = addVariantField;
window.descargarPlantillaCSV = descargarPlantillaCSV;
window.procesarImportacionCSV = procesarImportacionCSV;
window.verificarAsistenteRopa = verificarAsistenteRopa;
window.updateRopaForms = updateRopaForms;
window.aplicarRopa = aplicarRopa;

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
  const sizeNames = { 'XS':'Extra Chica','S':'Chica','M':'Mediana','L':'Grande','XL':'Extragrande','XXL':'Extra Extra Grande','XXXL':'Extra Extra Extra Grande' };
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
  const headers = ['CategoriaPadre', 'Publico', 'Genero', 'Manga', 'Peso', 'Color', 'Nombre', 'SKU', 'Variantes', 'Cantidad', 'StockMin', 'Costo', 'PrecioVenta'];
  const csv = headers.join(',') + '\n'
    + '"Playera","Adulto","Caballero","Manga Corta","C0300","Aqua","","SKU-AUTO-1","",10,1,150.00,250.00\n'
    + '"Playera","Adulto","Dama","Manga Corta","C0200","Negro","","SKU-AUTO-2","",5,1,120.00,200.00\n'
    + '"","","","","","","Taza Custom","SKU-TZ-1","Variante Unica",20,5,50.00,100.00\n';
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
               const sizeNames = { 'XS':'Extra Chica','S':'Chica','M':'Mediana','L':'Grande','XL':'Extragrande','XXL':'Extra Extra Grande','XXXL':'Extra Extra Extra Grande' };
               let tallas = [];
               if (padre === 'Sudadera') tallas = ['S', 'M', 'L', 'XL', 'XXL'];
               else if (pub === 'Adulto' && (gen === 'Caballero' || gen === 'Unisex')) tallas = (man === 'Manga Corta') ? ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'] : ['S', 'M', 'L', 'XL', 'XXL'];
               else if (pub === 'Adulto' && gen === 'Dama') tallas = ['S', 'M', 'L', 'XL'];
               else tallas = ['S', 'M', 'L', 'XL'];
               variantes = tallas.map(t => `${col || 'Blanco'}>${sizeNames[t] || t}`);
               if (padre === 'Playera') rCat = `${padre} › ${pub} › ${gen === 'Unisex' ? 'Unisex' : gen} › ${man}`;
               else rCat = `${padre} › Unisex`;
            }
            const nuevoData = { nombre, sku: sku || '', categoria: rCat, qty, min_stock: parseInt(row['StockMin']) || 0, costo: parseFloat(row['Costo']) || 0, venta: parseFloat(row['PrecioVenta']) || 0, variantes: [] };
            if (variantes.length > 0) { for (const v of variantes) { const vSku = sku ? sku + '-' + v.split('>')[0].trim().replace(/[^a-zA-Z0-9]/g, '') : ''; const vName = nombre + '>' + v; await req('POST', '/productos', { ...nuevoData, nombre: vName, sku: vSku }); creados++; } }
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
  const headers=['Nombre','SKU','Categoría','Variantes','Cantidad','StockMin','Costo','Venta'];
  const rows=productos.map(p=>[p.nombre,p.sku,p.categoria,(p.variantes||[]).join(' | '),p.qty,p.min_stock,p.costo,p.venta].map(v=>`"${v}"`).join(','));
  const csv=[headers.join(','),...rows].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='inventario.csv';a.click();
}

['overlay-producto','overlay-ajuste','overlay-importar'].forEach(id=>{
  document.getElementById(id).addEventListener('click',function(e){if(e.target===this)this.classList.remove('active');});
});

window.addEventListener('DOMContentLoaded', async () => {
  try{ await req('GET','/health'); document.getElementById('api-status').textContent='🟢 API conectada'; }
  catch(e){ document.getElementById('api-status').textContent='🔴 API desconectada'; }
  await loadProductos();
  renderInventario();
  renderVentasRecientes();
  document.getElementById('mp-title').textContent='Agregar Producto';
});

async function renderVentasRecientes() {
  try {
    const vent = await req('GET', '/movimientos?tipo=venta&limit=10');
    const container = document.getElementById('recent-sales-list');
    if (!container) return;
    container.innerHTML = '';
    if (vent.length === 0) { container.innerHTML = '<div class="cart-empty">Sin ventas recientes</div>'; return; }
    vent.forEach(v => {
      const div = document.createElement('div'); div.className = 'recent-sale-item';
      div.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:600; font-size:0.85rem;">${v.producto_nombre}</div>
          <div style="font-size:0.75rem; color:#666;">
            ${v.qty} x ${mxn(v.precio)} = <strong>${mxn(v.qty * v.precio)}</strong>
            <br><small>${new Date(v.fecha).toLocaleString('es-MX')}</small>
          </div>
        </div>
        <div class="actions" style="display:flex; gap:5px;">
          <button class="btn btn-sm btn-outline" onclick="modificarVenta(${v.id})" title="Modificar">✏️</button>
          <button class="btn btn-sm btn-outline" style="color:#ef4444; border-color:#ef4444" onclick="cancelarVenta(${v.id})" title="Cancelar">🗑️</button>
        </div>
      `;
      container.appendChild(div);
    });
  } catch (e) { console.error(e); }
}

window.cancelarVenta = async function(id) {
  showConfirm('¿Seguro que deseas cancelar esta venta? El inventario se restaurará.', async () => {
    try { await req('DELETE', `/movimientos/${id}`); toast('✅ Venta cancelada e inventario restaurado', true); await loadProductos(); renderVentasRecientes(); }
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
  } catch (e) { toast(e.message, false); }
};

// ─────────────────────────────────────────────
//  ÓRDENES DE COMPRA
// ─────────────────────────────────────────────

window.ocItems = [];

function iniciarModalOrdenCompra() {
  document.getElementById('moc-title').textContent = 'Nueva Orden de Compra';
  document.getElementById('moc-proveedor').value = '';
  document.getElementById('moc-estado').value = 'borrador';
  document.getElementById('moc-notas').value = '';
  document.getElementById('moc-buscar').value = '';
  document.getElementById('moc-resultados').innerHTML = '';
  window.ocItems = [];
  renderItemsOC();
  cargarSugeridosOC();
}

// ── Sugeridos: solo productos con qty === 1 (omite stock 0) ──
function cargarSugeridosOC() {
  const cont = document.getElementById('moc-sugeridos-lista');
  const sugeridos = productos.filter(p =>
    p.qty === 1 &&
    (p.categoria.startsWith('Playera') || p.categoria.startsWith('Sudadera'))
  );

  if (sugeridos.length === 0) {
    cont.innerHTML = '<div style="color:#aaa;font-size:0.85rem;">Sin productos con exactamente 1 pieza en Playera/Sudadera.</div>';
    return;
  }

  cont.innerHTML = '';
  sugeridos.forEach(p => {
    const res = extractColorSize(p.nombre.includes('>') ? p.nombre.split('>').slice(1).join('>') : (p.nombre.split(' - ')[1] || ''));
    const div = document.createElement('div');
    div.style = 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px dashed #f0f0f0;font-size:0.82rem;';
    div.innerHTML = `
      <span style="flex:2;color:#374151;">${p.nombre}</span>
      <span class="badge badge-low" style="font-size:0.7rem;">Stock: ${p.qty}</span>
      <input type="number" min="1" value="1" style="width:50px;" class="oc-sug-qty" data-id="${p.id}" data-nombre="${p.nombre}" data-color="${res.color}" data-talla="${res.size}">
      <input type="number" min="0" step="0.01" value="${p.costo > 0 ? p.costo : ''}" placeholder="$costo" style="width:70px;" class="oc-sug-precio" data-id="${p.id}">
      <button class="btn btn-sm btn-primary" style="padding:2px 8px;" onclick="agregarSugeridoOC(${p.id})">+</button>
    `;
    cont.appendChild(div);
  });
}

window.agregarSugeridoOC = function(productoId) {
  const qtyEl = document.querySelector(`.oc-sug-qty[data-id="${productoId}"]`);
  const precioEl = document.querySelector(`.oc-sug-precio[data-id="${productoId}"]`);
  const qty = parseInt(qtyEl.value) || 1;
  const precio = parseFloat(precioEl.value) || 0;
  const p = productos.find(x => x.id === productoId);
  if (!p) return;
  const existe = window.ocItems.find(i => i.producto_id === productoId);
  if (existe) {
    existe.qty += qty;
    existe.precio_proveedor = precio;
  } else {
    const res = extractColorSize(p.nombre.includes('>') ? p.nombre.split('>').slice(1).join('>') : (p.nombre.split(' - ')[1] || ''));
    window.ocItems.push({ producto_id: productoId, nombre: p.nombre, color: res.color || '', talla: res.size || '', qty, precio_proveedor: precio });
  }
  renderItemsOC();
  toast(`${p.nombre} agregado a la orden`, true);
};

// ── Buscador manual ──
window.buscarProductoOC = function() {
  const texto = document.getElementById('moc-buscar').value.trim().toLowerCase();
  const cont = document.getElementById('moc-resultados');
  cont.innerHTML = '';
  if (!texto) return;
  const matches = productos.filter(p =>
    p.nombre.toLowerCase().includes(texto) ||
    (p.sku || '').toLowerCase().includes(texto) ||
    p.categoria.toLowerCase().includes(texto)
  ).slice(0, 15);
  if (matches.length === 0) {
    cont.innerHTML = '<div style="padding:6px;color:#aaa;font-size:0.82rem;">Sin resultados.</div>';
    return;
  }
  matches.forEach(p => {
    const div = document.createElement('div');
    div.style = 'display:flex;align-items:center;justify-content:space-between;padding:5px 8px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid #f3f4f6;';
    div.innerHTML = `
      <span>${p.nombre} <small style="color:#888;">(Stock: ${p.qty})</small></span>
      <button class="btn btn-sm btn-primary" style="padding:2px 8px;" onclick="agregarManualOC(${p.id})">+</button>
    `;
    cont.appendChild(div);
  });
};

window.agregarManualOC = function(productoId) {
  const p = productos.find(x => x.id === productoId);
  if (!p) return;
  const existe = window.ocItems.find(i => i.producto_id === productoId);
  if (existe) { existe.qty += 1; }
  else {
    const res = extractColorSize(p.nombre.includes('>') ? p.nombre.split('>').slice(1).join('>') : (p.nombre.split(' - ')[1] || ''));
    window.ocItems.push({ producto_id: productoId, nombre: p.nombre, color: res.color || '', talla: res.size || '', qty: 1, precio_proveedor: p.costo || 0 });
  }
  renderItemsOC();
  document.getElementById('moc-buscar').value = '';
  document.getElementById('moc-resultados').innerHTML = '';
  toast(`${p.nombre} agregado`, true);
};

// ── Renderizar items de la orden ──
function renderItemsOC() {
  const cont = document.getElementById('moc-items-lista');
  cont.innerHTML = '';
  if (window.ocItems.length === 0) {
    cont.innerHTML = '<div style="color:#aaa;font-size:0.82rem;padding:8px;">Sin productos agregados aún.</div>';
    recalcularTotalesOC();
    return;
  }
  window.ocItems.forEach((item, idx) => {
    const div = document.createElement('div');
    div.style = 'display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px dashed #e2e8f0;font-size:0.82rem;';
    div.innerHTML = `
      <span style="flex:2;">${item.nombre}</span>
      <label style="font-size:0.75rem;">Qty</label>
      <input type="number" min="1" value="${item.qty}" style="width:55px;" onchange="updateOCItem(${idx},'qty',this.value)">
      <label style="font-size:0.75rem;">$</label>
      <input type="number" min="0" step="0.01" value="${item.precio_proveedor}" style="width:75px;" onchange="updateOCItem(${idx},'precio',this.value)">
      <span style="min-width:60px;text-align:right;font-weight:600;">${mxn(item.qty * item.precio_proveedor)}</span>
      <button class="btn btn-sm" style="padding:2px 6px;color:#ef4444;border-color:#ef4444;" onclick="eliminarItemOC(${idx})">✕</button>
    `;
    cont.appendChild(div);
  });
  recalcularTotalesOC();
}

window.updateOCItem = function(idx, campo, valor) {
  if (campo === 'qty') window.ocItems[idx].qty = parseInt(valor) || 1;
  if (campo === 'precio') window.ocItems[idx].precio_proveedor = parseFloat(valor) || 0;
  recalcularTotalesOC();
  const filas = document.querySelectorAll('#moc-items-lista > div');
  if (filas[idx]) {
    const spans = filas[idx].querySelectorAll('span');
    spans[spans.length - 1].textContent = mxn(window.ocItems[idx].qty * window.ocItems[idx].precio_proveedor);
  }
};

window.eliminarItemOC = function(idx) {
  window.ocItems.splice(idx, 1);
  renderItemsOC();
};

function recalcularTotalesOC() {
  let totalQty = 0, totalPrecio = 0;
  window.ocItems.forEach(i => { totalQty += i.qty; totalPrecio += i.qty * i.precio_proveedor; });
  document.getElementById('moc-total-qty').textContent = totalQty;
  document.getElementById('moc-total-precio').textContent = mxn(totalPrecio);
}

window.guardarOrdenCompra = async function() {
  const proveedor = document.getElementById('moc-proveedor').value.trim();
  const estado = document.getElementById('moc-estado').value;
  const notas = document.getElementById('moc-notas').value.trim();
  if (!proveedor) { toast('El nombre del proveedor es obligatorio', false); return; }
  if (window.ocItems.length === 0) { toast('Agrega al menos un producto a la orden', false); return; }
  const body = { proveedor, estado, notas, items: window.ocItems.map(i => ({ producto_id: i.producto_id, nombre: i.nombre, color: i.color, talla: i.talla, qty: i.qty, precio_proveedor: i.precio_proveedor })) };
  try {
    const orden = await req('POST', '/ordenes-compra', body);
    toast(`✅ Orden ${orden.folio} guardada`, true);
    closeModal('orden_compra');
    renderOrdenesCompra();
  } catch (e) {
    toast('Error al guardar la orden: ' + e.message, false);
  }
};

async function renderOrdenesCompra() {
  try {
    const ordenes = await req('GET', '/ordenes-compra');
    const list = document.getElementById('oc-list');
    const empty = document.getElementById('oc-empty');
    if (!ordenes || ordenes.length === 0) { list.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    list.innerHTML = '';
    const colores = { borrador: '#fbbf24', enviada: '#2563eb', confirmada: '#16a34a' };
    ordenes.forEach(orden => {
      const div = document.createElement('div');
      div.style = 'margin:10px 0;padding:12px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;';
      const bg = colores[orden.estado] || '#fbbf24';
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${orden.folio}</strong>
            <span style="background:${bg};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.75rem;margin-left:6px;">${orden.estado}</span>
            <span style="margin-left:8px;color:#666;">${orden.proveedor}</span>
          </div>
          <div style="display:flex;gap:6px;">
            ${orden.estado !== 'confirmada' ? `<button class="btn btn-sm btn-warning" onclick="confirmarOrdenCompra(${orden.id})">✅ Confirmar</button>` : ''}
            <button class="btn btn-sm btn-outline" onclick="verOrdenCompra(${orden.id})">👁 Ver</button>
          </div>
        </div>
        <div style="margin-top:5px;font-size:0.82rem;color:#666;">
          Total estimado: <strong>${mxn(orden.total_estimado)}</strong> ·
          ${orden.items ? orden.items.length : 0} producto(s)
          ${orden.notas ? ' · ' + orden.notas : ''}
        </div>
      `;
      list.appendChild(div);
    });
  } catch (e) {
    toast('Error cargando órdenes: ' + e.message, false);
  }
}

window.confirmarOrdenCompra = async function(ordenId) {
  showConfirm('¿Confirmar esta orden? Se actualizará el inventario con las entradas correspondientes.', async () => {
    try {
      const updated = await req('POST', `/ordenes-compra/${ordenId}/estado`, { estado: 'confirmada' });
      toast(`✅ Orden ${updated.folio} confirmada. Inventario actualizado.`, true);
      await loadProductos();
      renderOrdenesCompra();
    } catch (e) { toast('Error al confirmar: ' + e.message, false); }
  });
};

window.verOrdenCompra = async function(ordenId) {
  try {
    const orden = await req('GET', `/ordenes-compra/${ordenId}`);
    const colores = { borrador: '#fbbf24', enviada: '#2563eb', confirmada: '#16a34a' };
    const bg = colores[orden.estado] || '#fbbf24';
    let html = `<strong>Folio:</strong> ${orden.folio}<br>
      <strong>Proveedor:</strong> ${orden.proveedor}<br>
      <strong>Estado:</strong> <span style="background:${bg};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.75rem;">${orden.estado}</span><br>
      ${orden.notas ? `<strong>Notas:</strong> ${orden.notas}<br>` : ''}
      <br><strong>Productos:</strong><br>`;
    (orden.items || []).forEach(i => {
      html += `<div style="padding:3px 0;font-size:0.82rem;">• ${i.nombre} — Qty: ${i.qty} — ${mxn(i.precio_proveedor)} c/u — Subtotal: ${mxn(i.qty * i.precio_proveedor)}</div>`;
    });
    html += `<br><strong>Total estimado: ${mxn(orden.total_estimado)}</strong>`;
    document.getElementById('confirm-title').innerHTML = '📋 Detalle de Orden';
    document.getElementById('confirm-msg').innerHTML = html;
    document.getElementById('btn-confirm-ok').style.display = 'none';
    document.getElementById('overlay-confirm').classList.add('active');
    document.getElementById('btn-confirm-ok').onclick = () => closeConfirm(false);
  } catch (e) { toast('Error al cargar la orden: ' + e.message, false); }
};

window.generarPDFOrdenActual = function() {
  if (window.ocItems.length === 0) { toast('Agrega productos a la orden primero', false); return; }
  if (!window.jspdf) { toast('Error: jsPDF no cargada', false); return; }
  const proveedor = document.getElementById('moc-proveedor').value.trim() || 'Sin proveedor';
  const estado = document.getElementById('moc-estado').value;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 250] });
  let y = 10;
  const line = () => { doc.line(5, y, 75, y); y += 5; };
  doc.setFontSize(12); doc.setFont('helvetica', 'bold');
  doc.text('Kromo Pinceles', 40, y, { align: 'center' }); y += 7;
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text('Orden de Compra', 40, y, { align: 'center' }); y += 5;
  doc.setFontSize(8);
  doc.text(`Proveedor: ${proveedor}`, 5, y); y += 5;
  doc.text(`Estado: ${estado}`, 5, y); y += 5;
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, 5, y); y += 5;
  line();
  const grupos = {};
  window.ocItems.forEach(item => {
    const key = item.color || 'Sin color';
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(item);
  });
  Object.keys(grupos).forEach(color => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(color, 5, y); y += 5;
    doc.setFont('helvetica', 'normal');
    grupos[color].sort((a, b) => (sizeOrderMap[a.talla] || 99) - (sizeOrderMap[b.talla] || 99));
    grupos[color].forEach(item => {
      const talla = item.talla || 'Única';
      doc.text(`  ${talla}: ${item.qty} pza(s)  ${mxn(item.precio_proveedor)} c/u`, 5, y); y += 4;
    });
    y += 2;
  });
  line();
  const totalQty = window.ocItems.reduce((a, i) => a + i.qty, 0);
  const totalPrecio = window.ocItems.reduce((a, i) => a + (i.qty * i.precio_proveedor), 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text(`Total piezas: ${totalQty}`, 5, y); y += 5;
  doc.text(`Total estimado: ${mxn(totalPrecio)}`, 5, y);
  const filename = `OC_${Date.now()}.pdf`;
  try {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch(e) { doc.save(filename); }
  toast('PDF de Orden generado ✅', true);
};

window.renderOrdenesCompra = renderOrdenesCompra;
window.buscarProductoOC = buscarProductoOC;
