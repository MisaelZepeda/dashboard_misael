// 1. CONFIGURACIÓN E INICIALIZACIÓN
const firebaseConfig = {
    apiKey: "AIzaSyD86xvnjFFHkdMhvHPOkYUn8_PdHgNOEK0",
    authDomain: "misuperappfinanciera.firebaseapp.com",
    databaseURL: "https://misuperappfinanciera-default-rtdb.firebaseio.com",
    projectId: "misuperappfinanciera",
    storageBucket: "misuperappfinanciera.firebasestorage.app",
    messagingSenderId: "320368053330",
    appId: "1:320368053330:web:c85ec9a1108be81617a38b"
};
firebase.initializeApp(firebaseConfig); const auth = firebase.auth(); const db = firebase.database();
let state = { cuentas: [], transacciones: [], currentBase64: "", selectedColor: "#3b82f6" };
let chartInstance = null; let currentEditId = null; let currentMovMode = 'pago'; 

// 2. SEGURIDAD DE SESIÓN
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
let inactivityTimer;
function resetTimer() {
    clearTimeout(inactivityTimer);
    if(auth.currentUser) inactivityTimer = setTimeout(() => { auth.signOut().then(() => window.location.reload()); }, 15 * 60 * 1000);
}
window.onload = resetTimer; document.onmousemove = resetTimer; document.onkeypress = resetTimer; document.ontouchstart = resetTimer;

// 3. AUTH LOGIC
let regBase64 = "";
if(document.getElementById('regFoto')) document.getElementById('regFoto').addEventListener('change', function(e) { const r = new FileReader(); r.onload = function() { regBase64 = r.result; }; if(e.target.files[0]) r.readAsDataURL(e.target.files[0]); });

function toggleAuthForm(type) { document.getElementById('loginForm').style.display = type === 'login' ? 'block' : 'none'; document.getElementById('registerForm').style.display = type === 'register' ? 'block' : 'none'; document.getElementById('resetForm').style.display = type === 'reset' ? 'block' : 'none'; }
function handleLogin() { auth.signInWithEmailAndPassword(document.getElementById('logEmail').value, document.getElementById('logPass').value).catch(e => alert(e.message)); }
function handleRegistro() { 
    const email = document.getElementById('regEmail').value, pass = document.getElementById('regPass').value, nombre = document.getElementById('regNombre').value;
    if(!nombre) { alert("El nombre es obligatorio"); return; }
    auth.createUserWithEmailAndPassword(email, pass).then((cred) => {
        const defaultPic = `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=3b82f6&color=fff&size=128`;
        db.ref(`Usuarios/${cred.user.uid}/perfil`).set({ nombre: nombre, foto: regBase64 || defaultPic, color: "#3b82f6" }).then(() => alert("¡Bienvenido " + nombre + "!"));
    }).catch(e => alert(e.message)); 
}
function handleResetPassword() { auth.sendPasswordResetEmail(document.getElementById('resetEmail').value).then(() => { alert("Enviado"); toggleAuthForm('login'); }).catch(e => alert(e.message)); }
function handleLogout() { auth.signOut().then(() => window.location.reload()); }

// 4. ESTADO EN TIEMPO REAL CON PANTALLA DE CARGA
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appDashboard').style.display = 'block'; 
        if(document.getElementById('loader')) document.getElementById('loader').style.display = 'flex';
        resetTimer();
        db.ref('Usuarios/' + user.uid).on('value', snap => {
            const data = snap.val() || {}; state.cuentas = data.cuentas ? Object.values(data.cuentas) : []; state.transacciones = data.transacciones ? Object.entries(data.transacciones).map(([id, val]) => ({...val, firebaseId: id})) : [];
            const p = data.perfil || { nombre: "Usuario", foto: "https://via.placeholder.com/100", color: "#3b82f6" };
            state.selectedColor = p.color; document.documentElement.style.setProperty('--primary', p.color);
            document.getElementById('headerGreeting').innerText = `Hola ${p.nombre} :)`; document.getElementById('headerFoto').src = p.foto; document.getElementById('perfDisplayNombre').innerText = p.nombre; document.getElementById('perfDisplayFoto').src = p.foto;
            if(document.getElementById('perfNombre')) document.getElementById('perfNombre').value = p.nombre;
            renderAll();
            if(document.getElementById('loader')) document.getElementById('loader').style.display = 'none';
        });
    } else { 
        document.getElementById('loginScreen').style.display = 'block'; document.getElementById('appDashboard').style.display = 'none'; 
        if(document.getElementById('loader')) document.getElementById('loader').style.display = 'none';
        clearTimeout(inactivityTimer); 
    }
});

// 5. NAVEGACIÓN Y UI
function toggleUserMenu(e) { e.stopPropagation(); document.getElementById('userMenu').classList.toggle('show'); }
function closeDropdowns() { document.getElementById('userMenu').classList.remove('show'); }
function cambiarTab(id, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active')); document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active'); if(btn) btn.classList.add('active'); closeDropdowns(); window.scrollTo(0,0);
    currentEditId = null; 
    document.querySelectorAll('form').forEach(f => { if(!f.closest('#tab-perfil')) f.reset(); });
    ['inCuenta', 'gaFuente', 'movOrigen', 'movDestino'].forEach(eid => { if(document.getElementById(eid)) document.getElementById(eid).disabled = false; });
    if(document.getElementById('ingresoFormTitle')) document.getElementById('ingresoFormTitle').innerText = "Nuevo Ingreso"; 
    if(document.getElementById('gastoFormTitle')) document.getElementById('gastoFormTitle').innerText = "Nuevo Gasto"; 
    if(document.getElementById('movTitle')) document.getElementById('movTitle').innerText = "Nuevo Movimiento";
}
// 6. LOGICA TRANSACCIONAL ROBUSTA
function revertirTransaccion(fid) {
    const t = state.transacciones.find(x => x.firebaseId === fid); if (!t) return {}; let updates = {};
    if (t.tipo === 'ingreso') { const c = state.cuentas.find(x => x.id == t.cuentaId); if(c) updates[`cuentas/${c.id}/saldo`] = c.saldo - t.monto; } 
    else if (t.tipo === 'gasto') { const c = state.cuentas.find(x => x.id == t.cuentaId); if(c) updates[`cuentas/${c.id}/saldo`] = c.tipo === 'debito' ? c.saldo + t.monto : c.saldo - t.monto; } 
    else if (t.tipo === 'movimiento') { const or = state.cuentas.find(x => x.id == t.origenId), des = state.cuentas.find(x => x.id == t.destinoId); if(or) updates[`cuentas/${or.id}/saldo`] = or.saldo + t.monto; if(des) updates[`cuentas/${des.id}/saldo`] = des.tipo === 'debito' ? des.saldo - t.monto : des.saldo + t.monto; }
    return updates;
}
function eliminarTransaccion(fid) { if(!confirm("¿Borrar y devolver saldos?")) return; let updates = revertirTransaccion(fid); updates[`transacciones/${fid}`] = null; db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates); }

function editIngreso(fid) { const t = state.transacciones.find(x => x.firebaseId === fid); cambiarTab('ingresos'); document.getElementById('inDesc').value = t.desc; document.getElementById('inMonto').value = t.monto; document.getElementById('inCuenta').value = t.cuentaId; document.getElementById('inCuenta').disabled = true; currentEditId = fid; document.getElementById('ingresoFormTitle').innerText = "Editando Ingreso (Cuenta Fija)"; }
function handleIngreso(e) {
    e.preventDefault(); const m = parseFloat(document.getElementById('inMonto').value); let updates = currentEditId ? revertirTransaccion(currentEditId) : {};
    const cId = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).cuentaId : document.getElementById('inCuenta').value; const c = state.cuentas.find(x => x.id == cId);
    let currentSaldo = updates[`cuentas/${c.id}/saldo`] !== undefined ? updates[`cuentas/${c.id}/saldo`] : c.saldo;
    const id = currentEditId || db.ref(`Usuarios/${auth.currentUser.uid}/transacciones`).push().key; const oldFecha = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).fecha : new Date().toISOString().split('T')[0];
    updates[`transacciones/${id}`] = { desc: document.getElementById('inDesc').value, monto: m, tipo: 'ingreso', cuentaId: c.id, fecha: oldFecha }; updates[`cuentas/${c.id}/saldo`] = currentSaldo + m;
    db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates).then(() => { e.target.reset(); currentEditId = null; document.getElementById('inCuenta').disabled = false; document.getElementById('ingresoFormTitle').innerText = "Nuevo Ingreso"; });
}

function editGasto(fid) { const t = state.transacciones.find(x => x.firebaseId === fid); cambiarTab('gastos'); document.getElementById('gaDesc').value = t.desc; document.getElementById('gaMonto').value = t.monto; document.getElementById('gaCat').value = t.cat; document.getElementById('gaFuente').value = t.cuentaId; document.getElementById('gaFuente').disabled = true; currentEditId = fid; document.getElementById('gastoFormTitle').innerText = "Editando Gasto (Cuenta Fija)"; }
function handleGasto(e) {
    e.preventDefault(); const m = parseFloat(document.getElementById('gaMonto').value); let updates = currentEditId ? revertirTransaccion(currentEditId) : {};
    const cId = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).cuentaId : document.getElementById('gaFuente').value; const c = state.cuentas.find(x => x.id == cId);
    let currentSaldo = updates[`cuentas/${c.id}/saldo`] !== undefined ? updates[`cuentas/${c.id}/saldo`] : c.saldo;
    const id = currentEditId || db.ref(`Usuarios/${auth.currentUser.uid}/transacciones`).push().key; const oldFecha = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).fecha : new Date().toISOString().split('T')[0];
    updates[`transacciones/${id}`] = { desc: document.getElementById('gaDesc').value, cat: document.getElementById('gaCat').value, monto: m, tipo: 'gasto', cuentaId: c.id, fecha: oldFecha }; updates[`cuentas/${c.id}/saldo`] = c.tipo === 'debito' ? currentSaldo - m : currentSaldo + m;
    db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates).then(() => { e.target.reset(); currentEditId = null; document.getElementById('gaFuente').disabled = false; document.getElementById('gastoFormTitle').innerText = "Nuevo Gasto"; });
}

function setMovMode(mode) { currentMovMode = mode; document.getElementById('btnModoPago').style.background = mode === 'pago' ? 'var(--primary)' : 'var(--muted)'; document.getElementById('btnModoTras').style.background = mode === 'traspaso' ? 'var(--primary)' : 'var(--muted)'; document.getElementById('lblDestino').innerText = mode === 'pago' ? 'Destino (Crédito):' : 'Destino (Débito):'; actualizarSelects(); }
function editMovimiento(fid) { const t = state.transacciones.find(x => x.firebaseId === fid); cambiarTab('traspasos'); setMovMode(t.subtipo || 'traspaso'); document.getElementById('movOrigen').value = t.origenId; document.getElementById('movDestino').value = t.destinoId; document.getElementById('movMonto').value = t.monto; document.getElementById('movOrigen').disabled = true; document.getElementById('movDestino').disabled = true; currentEditId = fid; document.getElementById('movTitle').innerText = "Editando Movimiento"; }
function handleMovimiento(e) {
    e.preventDefault(); const m = parseFloat(document.getElementById('movMonto').value); let updates = currentEditId ? revertirTransaccion(currentEditId) : {};
    const orId = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).origenId : document.getElementById('movOrigen').value, desId = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).destinoId : document.getElementById('movDestino').value;
    const or = state.cuentas.find(x => x.id == orId), des = state.cuentas.find(x => x.id == desId);
    let sOr = updates[`cuentas/${or.id}/saldo`] !== undefined ? updates[`cuentas/${or.id}/saldo`] : or.saldo, sDes = updates[`cuentas/${des.id}/saldo`] !== undefined ? updates[`cuentas/${des.id}/saldo`] : des.saldo;
    updates[`cuentas/${or.id}/saldo`] = sOr - m; updates[`cuentas/${des.id}/saldo`] = des.tipo === 'debito' ? sDes + m : sDes - m;
    const id = currentEditId || db.ref(`Usuarios/${auth.currentUser.uid}/transacciones`).push().key, oldFecha = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).fecha : new Date().toISOString().split('T')[0];
    updates[`transacciones/${id}`] = { tipo: 'movimiento', subtipo: currentMovMode, monto: m, desc: currentMovMode === 'pago' ? `Pago a ${des.nombre}` : `Traspaso a ${des.nombre}`, origenId: or.id, destinoId: des.id, fecha: oldFecha };
    db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates).then(() => { e.target.reset(); currentEditId = null; document.getElementById('movOrigen').disabled = false; document.getElementById('movDestino').disabled = false; document.getElementById('movTitle').innerText = "Nuevo Movimiento"; alert("Movimiento procesado."); });
}

function sumarInteres(id) {
    const m = parseFloat(prompt("Interés generado hoy ($):")); if (!m || isNaN(m) || m <= 0) return;
    const c = state.cuentas.find(x => x.id == id); if (!c) return;
    const transId = db.ref(`Usuarios/${auth.currentUser.uid}/transacciones`).push().key;
    let updates = {}; updates[`transacciones/${transId}`] = { desc: `Rendimiento`, monto: m, tipo: 'ingreso', cuentaId: c.id, fecha: new Date().toISOString().split('T')[0] }; updates[`cuentas/${c.id}/saldo`] = c.saldo + m;
    db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates);
}
// 7. ZONA DE PELIGRO Y BACKUPS
function resetearCuenta() { if(!confirm("⚠️ ¿Borrar historial y dejar saldos en $0?")) return; let updates = {}; updates['transacciones'] = null; state.cuentas.forEach(c => { updates[`cuentas/${c.id}/saldo`] = 0; updates[`cuentas/${c.id}/mesPagado`] = null; }); db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates).then(() => alert("Restablecido a $0.")); }
function eliminarUsuario() {
    if(!confirm("🚨 ¡PELIGRO! Esto borrará tu cuenta de la BD permanentemente. ¿Continuar?")) return;
    const user = auth.currentUser;
    db.ref(`Usuarios/${user.uid}`).remove().then(() => { user.delete().then(() => { alert("Cuenta eliminada."); window.location.reload(); }).catch(e => { if(e.code === 'auth/requires-recent-login') { alert("Por seguridad, vuelve a iniciar sesión y repite este proceso."); auth.signOut().then(() => window.location.reload()); } else alert(e.message); }); });
}

function exportarBackup() {
    db.ref(`Usuarios/${auth.currentUser.uid}`).once('value').then(snap => {
        const data = snap.val(); if(!data) { alert("No hay datos."); return; }
        const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}));
        a.href = url; a.download = `Respaldo_DashboardPro_${new Date().toISOString().split('T')[0]}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    }).catch(e => alert("Error: " + e.message));
}
function importarBackup(e) {
    const file = e.target.files[0]; if (!file) return;
    if(!confirm("⚠️ ADVERTENCIA: Esto sobrescribirá todos tus datos actuales. ¿Continuar?")) { e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = function(ev) { try { const data = JSON.parse(ev.target.result); db.ref(`Usuarios/${auth.currentUser.uid}`).set(data).then(() => { alert("✅ Restaurado."); window.location.reload(); }); } catch(err) { alert("❌ Archivo inválido."); } e.target.value = ''; };
    reader.readAsText(file);
}

// 8. RENDERIZADO VISUAL
function renderAll() {
    let tengo = 0, debo = 0, gT = 0, iT = 0; const hoy = new Date(); const diaHoy = hoy.getDate(); const mesAct = hoy.getMonth(); let hDeb = "", hCre = "", hMae = "";
    state.cuentas.forEach(c => {
        let aviso = "";
        if(c.diaPago) { const ya = c.mesPagado === mesAct; const vence = c.diaPago - diaHoy; if(ya && vence >= -5) aviso = `<br><small style="color:var(--success)">✓ Pagado</small> <span onclick="db.ref('Usuarios/${auth.currentUser.uid}/cuentas/${c.id}/mesPagado').remove()" style="font-size:8px; cursor:pointer;">(Quitar)</span>`; else aviso = `<br><small style="color:${vence < 0 || vence <= 3 ? 'var(--danger)' : 'var(--muted)'}">${vence < 0 ? 'Atrasado' : 'Faltan: '+vence+'d'}</small><br><button class="btn-check-pago" onclick="db.ref('Usuarios/${auth.currentUser.uid}/cuentas/${c.id}/mesPagado').set(${mesAct})">Pagar</button>`; }
        const item = `<div class="bank-item"><div class="bank-info"><img src="${c.icon}" class="bank-icon"><div class="bank-details"><b>${c.nombre}</b>${aviso}</div></div><b>$${c.saldo.toLocaleString()}</b></div>`;
        if(c.tipo==='debito'){ tengo+=c.saldo; hDeb+=item; } else { debo+=c.saldo; hCre+=item; }
        hMae += `<div class="bank-item"><div class="bank-info"><img src="${c.icon}" class="bank-icon"><b>${c.nombre}</b></div><div style="text-align:right"><b>$${c.saldo.toLocaleString()}</b><br><span class="action-link" style="color:var(--success)" onclick="sumarInteres('${c.id}')">+ Interés</span><span class="action-link" onclick="const d=prompt('Dominio:'); if(d) db.ref('Usuarios/${auth.currentUser.uid}/cuentas/${c.id}/icon').set('https://www.google.com/s2/favicons?domain='+d+'&sz=64')">Logo</span><span class="action-link danger" onclick="if(confirm('¿Borrar cuenta?')) db.ref('Usuarios/${auth.currentUser.uid}/cuentas/${c.id}').remove()">Borrar</span></div></div>`;
    });
    document.getElementById('widgetDebitos').innerHTML = hDeb || "<small>Vacío</small>"; document.getElementById('widgetCreditos').innerHTML = hCre || "<small>Vacío</small>"; document.getElementById('listaMaestraCuentas').innerHTML = hMae;
    document.getElementById('valTengo').innerText = `$${tengo.toLocaleString()}`; document.getElementById('valDebo').innerText = `$${debo.toLocaleString()}`; document.getElementById('valPatrimonio').innerText = `$${(tengo - debo).toLocaleString()}`;
    gT = state.transacciones.filter(t => t.tipo==='gasto').reduce((a, b) => a + b.monto, 0); iT = state.transacciones.filter(t => t.tipo==='ingreso').reduce((a, b) => a + b.monto, 0);
    document.getElementById('homeIngresos').innerText = `$${iT.toLocaleString()}`; document.getElementById('homeGastos').innerText = `$${gT.toLocaleString()}`;

    let hG = "", hI = "", hM = "";
    state.transacciones.slice().reverse().forEach(t => {
        let actionStr = t.tipo === 'movimiento' ? `editMovimiento('${t.firebaseId}')` : (t.tipo === 'gasto' ? `editGasto('${t.firebaseId}')` : `editIngreso('${t.firebaseId}')`);
        const item = `<div class="bank-item"><div>${t.desc}<br><small>${t.fecha}</small></div><div style="display:flex; align-items:center;"><button class="del-btn" onclick="eliminarTransaccion('${t.firebaseId}')">🗑️</button><button class="edit-btn" onclick="${actionStr}">✎</button><b>$${t.monto.toLocaleString()}</b></div></div>`;
        if(t.tipo === 'gasto') hG += item; else if (t.tipo === 'ingreso') hI += item; else hM += item;
    });
    document.getElementById('listaGastos').innerHTML = hG; document.getElementById('listaIngresos').innerHTML = hI; document.getElementById('listaMovimientos').innerHTML = hM;
    actualizarSelects(); renderChart(gT);
}

function actualizarSelects() {
    const optDeb = state.cuentas.filter(c => c.tipo==='debito').map(c => `<option value="${c.id}">${c.nombre}</option>`).join(''), optCre = state.cuentas.filter(c => c.tipo==='credito').map(c => `<option value="${c.id}">${c.nombre}</option>`).join(''), optAll = state.cuentas.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    if(document.getElementById('inCuenta')) document.getElementById('inCuenta').innerHTML = optDeb; if(document.getElementById('gaFuente')) document.getElementById('gaFuente').innerHTML = optAll; if(document.getElementById('movOrigen')) document.getElementById('movOrigen').innerHTML = optDeb; if(document.getElementById('movDestino')) document.getElementById('movDestino').innerHTML = currentMovMode === 'pago' ? optCre : optDeb;
}

// 9. CONFIGURACIÓN FINAL Y PERFIL
function getBankLogo(banco) { const map = { "bbva": "bbva.mx", "nu": "nu.com.mx", "santander": "santander.com.mx" }; const dom = map[banco.toLowerCase().trim()] || `${banco.toLowerCase().replace(/\s/g, '')}.com`; return `https://www.google.com/s2/favicons?domain=${dom}&sz=64`; }
function selectColor(hex, el) { state.selectedColor = hex; document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active')); el.classList.add('active'); document.documentElement.style.setProperty('--primary', hex); }
function handleNuevaCuenta(e) { e.preventDefault(); const id=Date.now(), b=document.getElementById('cuBanco').value; db.ref(`Usuarios/${auth.currentUser.uid}/cuentas/${id}`).set({id, nombre:document.getElementById('cuNombre').value, banco:b, tipo:document.getElementById('cuTipo').value, saldo:parseFloat(document.getElementById('cuSaldo').value), icon:getBankLogo(b), diaPago:parseInt(document.getElementById('cuPago').value)||0}); e.target.reset(); }
function handleGuardarPerfil(e) { e.preventDefault(); db.ref(`Usuarios/${auth.currentUser.uid}/perfil`).set({ nombre: document.getElementById('perfNombre').value, foto: state.currentBase64 || document.getElementById('perfDisplayFoto').src, color: state.selectedColor }).then(() => { alert("Perfil actualizado"); cambiarTab('resumen'); }); }
function toggleTheme() { const t = document.body.getAttribute('data-theme')==='dark'?'light':'dark'; document.body.setAttribute('data-theme', t); }
if(document.getElementById('perfFile')) document.getElementById('perfFile').addEventListener('change', function(e) { const r = new FileReader(); r.onload = function() { state.currentBase64 = r.result; document.getElementById('perfDisplayFoto').src = r.result; }; if(e.target.files[0]) r.readAsDataURL(e.target.files[0]); });
function renderChart(total) { const ctx = document.getElementById('chartGastos').getContext('2d'); const cats = {}; state.transacciones.filter(t => t.tipo === 'gasto').forEach(t => cats[t.cat] = (cats[t.cat] || 0) + t.monto); if(chartInstance) chartInstance.destroy(); chartInstance = new Chart(ctx, { type:'doughnut', data:{ labels:Object.keys(cats), datasets:[{data:Object.values(cats), backgroundColor:['#3b82f6','#10b981','#ef4444','#8b5cf6'], borderWidth:0}] }, options:{ maintainAspectRatio:false, plugins:{legend:{display:false}}, cutout:'75%' } }); }
// 11. GENERADOR DE PDF MENSUAL ESTILIZADO PRO
async function generarPDFMes() {
    if (!window.jspdf) { alert("Cargando librerías..."); return; }
    
    // Mostrar loader interno para PDFs largos
    if(document.getElementById('loader')) document.getElementById('loader').style.display = 'flex';

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ putOnlyUsedFonts: true, orientation: "portrait" });
    
    // --- DATOS Y CONFIGURACIÓN ---
    const hoy = new Date();
    const year = hoy.getFullYear();
    const nombreMes = hoy.toLocaleString('es-ES', { month: 'long' }).toUpperCase();
    const prefijoMes = `${year}-${(hoy.getMonth() + 1).toString().padStart(2, '0')}`;
    
    // User data
    const userName = document.getElementById('perfDisplayNombre').innerText;
    const userPhotoBase64 = document.getElementById('perfDisplayFoto').src; // DataURL base64
    
    // Colores del Perfil (obtenidos de las variables CSS)
    const estiloBody = getComputedStyle(document.body);
    const colorPrimarioHex = estiloBody.getPropertyValue('--primary').trim();
    
    // Convertidor HEX a RGB para jsPDF
    const hexToRgb = (hex) => {
        var c = hex.substring(1).split('');
        if(c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        c = '0x' + c.join('');
        return [(c>>16)&255, (c>>8)&255, c&255];
    };
    const rgbPrimario = hexToRgb(colorPrimarioHex);

    // Filtrar transacciones del mes
    const txMes = state.transacciones.filter(t => t.fecha.startsWith(prefijoMes));
    let ingMes = 0, gasMes = 0;
    txMes.forEach(t => { if (t.tipo === 'ingreso') ingMes += t.monto; else gasMes += t.monto; });

    // --- HELPER: CARGAR IMÁGENES ASÍNCRONAS ---
    const cargarImagen = (url) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = url;
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null); // Manejo de error sutil
        });
    };

    // --- DISEÑO DE PÁGINA (HEADER Y FOOTER) ---
    const totalPagesExp = "{total_pages_count}";
    
    const agregarEstiloPagina = (doc, colorRGB, nombre, foto) => {
        // BANNER ENCABEZADO FIJO
        doc.setFillColor(colorRGB[0], colorRGB[1], colorRGB[2]);
        doc.rect(0, 0, 210, 40, 'F'); // Franja de 40mm alto
        
        // Foto de perfil redonda (requiere truco de recorte o imagen pre-redondeada)
        // jsPDF no recorta nativamente en círculo fácil, asumimos DataURL cuadrado/redondo.
        try {
            if(foto && foto.startsWith('data:image')) {
                doc.addImage(foto, 'PNG', 15, 8, 24, 24); // x, y, w, h
            }
        } catch(e) { console.log("Error añadiendo foto:", e); }

        // Texto Encabezado
        doc.setTextColor(255, 255, 255); // Blanco
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text("ESTADO DE CUENTA MÓVIL", 45, 15);
        
        doc.setFontSize(20);
        doc.setFont(undefined, 'bold');
        doc.text(nombre.toUpperCase(), 45, 23);
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(`Período reportado: ${nombreMes} ${year}`, 45, 30);

        // PIE DE PÁGINA FIJO
        const pageHeight = doc.internal.pageSize.height;
        doc.setFillColor(colorRGB[0], colorRGB[1], colorRGB[2]);
        doc.rect(0, pageHeight - 15, 210, 15, 'F'); // Franja 15mm alto
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.text(`Generado por Dashboard Pro el ${hoy.toLocaleDateString()} a las ${hoy.toLocaleTimeString()}`, 15, pageHeight - 6);
        
        // Numeración de página (se actualizará al final)
        let pageStr = `Página ${doc.internal.getNumberOfPages()}`;
        doc.text(pageStr, 195, pageHeight - 6, { align: 'right' });
    };

    // --- INICIAR DIBUJO ---
    // Agregamos estilo a la primera página manualmente
    agregarEstiloPagina(doc, rgbPrimario, userName, userPhotoBase64);

    // 1. Sección Resumen Financiero
    let yPos = 55;
    doc.setTextColor(0);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text("RESUMEN GENERAL DEL MES", 15, yPos);
    
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    
    // Caja de Ingresos
    doc.setFillColor(240, 253, 244); // Fondo verde muy tenue
    doc.roundedRect(15, yPos + 5, 85, 20, 3, 3, 'F');
    doc.setTextColor(16, 185, 129); // Texto Verde
    doc.setFont(undefined, 'bold');
    doc.text("TOTAL INGRESOS", 20, yPos + 12);
    doc.setFontSize(16);
    doc.text(`$${ingMes.toLocaleString('es-MX', {minimumFractionDigits: 2})}`, 20, yPos + 20);

    // Caja de Gastos
    doc.setFillColor(254, 242, 242); // Fondo rojo muy tenue
    doc.roundedRect(110, yPos + 5, 85, 20, 3, 3, 'F');
    doc.setTextColor(239, 68, 68); // Texto Rojo
    doc.setFontSize(11);
    doc.text("TOTAL GASTOS Y MOVS", 115, yPos + 12);
    doc.setFontSize(16);
    doc.text(`$${gasMes.toLocaleString('es-MX', {minimumFractionDigits: 2})}`, 115, yPos + 20);

    // 2. Tabla de Cuentas (CON LOGOS)
    yPos = yPos + 40;
    doc.setTextColor(0);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text("SALDOS ACTUALES POR INSTITUCIÓN", 15, yPos);
    yPos += 5;

    // Preparar datos de cuentas cargando los logos
    const bodyCuentas = [];
    for (const c of state.cuentas) {
        // Intentamos cargar el logo (asumimos que c.icon es una URL DataURL o externa accesible)
        let imgData = null;
        try {
            if(c.icon && c.icon.startsWith('data:image')) {
                imgData = c.icon; // Ya es base64
            }
        } catch(e){}

        bodyCuentas.push([
            { content: '', image: imgData }, // Celda vacía para la imagen (se dibuja en hook)
            c.nombre,
            c.banco.toUpperCase(),
            c.tipo.toUpperCase(),
            `$${c.saldo.toLocaleString('es-MX', {minimumFractionDigits: 2})}`
        ]);
    }

    doc.autoTable({
        startY: yPos,
        head: [[ {content: 'Logo', styles: {halign: 'center'}}, 'Cuenta', 'Banco', 'Tipo', 'Saldo']],
        body: bodyCuentas,
        theme: 'striped',
        headStyles: { fillColor: rgbPrimario, textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { valign: 'middle', fontSize: 9 },
        columnStyles: { 
            0: { cellWidth: 15, halign: 'center' }, // Columna logo
            4: { halign: 'right', fontStyle: 'bold' } // Columna Saldo
        },
        // Hook para dibujar los logos de los bancos dentro de las celdas
        didDrawCell: (data) => {
            if (data.section === 'body' && data.column.index === 0 && data.cell.raw.image) {
                try {
                    doc.addImage(data.cell.raw.image, 'PNG', data.cell.x + 2.5, data.cell.y + 2.5, 10, 10);
                } catch(e){}
            }
        },
        margin: { top: 45, bottom: 20 } // Márgenes para respetar header/footer en saltos
    });

    // 3. Tabla Detalle de Movimientos del Mes
    yPos = doc.lastAutoTable.finalY + 15;
    
    // Verificar si cabe el título en la página actual
    if(yPos > doc.internal.pageSize.height - 40) { doc.addPage(); yPos = 55; }

    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(`DETALLE DE MOVIMIENTOS - ${nombreMes}`, 15, yPos);
    yPos += 5;

    const bodyMovs = txMes.map(t => {
        let catDisplay = t.cat || 'Ingreso';
        if(t.tipo === 'movimiento') catDisplay = t.subtipo === 'pago' ? 'PAGO TDC' : 'TRASPASO';
        
        const esIngreso = t.tipo === 'ingreso';

        return [
            t.fecha,
            catDisplay.toUpperCase(),
            t.desc,
            { 
                content: `${esIngreso ? '+' : '-'} $${t.monto.toLocaleString('es-MX', {minimumFractionDigits: 2})}`,
                styles: { textColor: esIngreso ? [16, 185, 129] : [239, 68, 68], fontStyle: 'bold' }
            }
        ];
    });

    doc.autoTable({
        startY: yPos,
        head: [['Fecha', 'Categoría', 'Concepto', 'Monto']],
        body: bodyMovs,
        theme: 'grid',
        headStyles: { fillColor: rgbPrimario, textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { valign: 'middle', fontSize: 8 },
        columnStyles: { 3: { halign: 'right' } },
        margin: { top: 45, bottom: 20 },
        // Hook para agregar header/footer en páginas nuevas automáticamente
        addPageContent: (data) => {
             agregarEstiloPagina(doc, rgbPrimario, userName, userPhotoBase64);
        }
    });

    // Re-aplicar estilos a TODAS las páginas (necesario por cómo funciona AutoTable)
    const pageCount = doc.internal.getNumberOfPages();
    for(let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        agregarEstiloPagina(doc, rgbPrimario, userName, userPhotoBase64);
    }

    // --- GUARDAR ---
    const nombreArchivo = `EstadoCuenta_${userName.replace(/\s+/g, '_')}_${nombreMes}_${year}.pdf`;
    doc.save(nombreArchivo);
    
    // Ocultar loader
    if(document.getElementById('loader')) document.getElementById('loader').style.display = 'none';
}


if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }
