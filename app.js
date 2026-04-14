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
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

let state = { cuentas: [], transacciones: [], currentBase64: "", selectedColor: "#3b82f6" };
let chartInstance = null;
let currentEditId = null;
let currentMovMode = 'pago'; 

// 2. SEGURIDAD DE SESIÓN
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
let inactivityTimer;
function resetTimer() {
    clearTimeout(inactivityTimer);
    if(auth.currentUser) {
        inactivityTimer = setTimeout(() => {
            auth.signOut().then(() => window.location.reload());
        }, 15 * 60 * 1000);
    }
}
window.onload = resetTimer; document.onmousemove = resetTimer; document.onkeypress = resetTimer; document.ontouchstart = resetTimer;

// 3. AUTH & REGISTRO LOGIC
let regBase64 = "";
if(document.getElementById('regFoto')) {
    document.getElementById('regFoto').addEventListener('change', function(e) {
        const reader = new FileReader();
        reader.onload = function() { regBase64 = reader.result; };
        if(e.target.files[0]) reader.readAsDataURL(e.target.files[0]);
    });
}

function toggleAuthForm(type) {
    document.getElementById('loginForm').style.display = type === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = type === 'register' ? 'block' : 'none';
    document.getElementById('resetForm').style.display = type === 'reset' ? 'block' : 'none';
}

function handleLogin() { 
    auth.signInWithEmailAndPassword(document.getElementById('logEmail').value, document.getElementById('logPass').value).catch(e => alert(e.message)); 
}

function handleRegistro() { 
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPass').value;
    const nombre = document.getElementById('regNombre').value;
    
    if(!nombre) { alert("El nombre es obligatorio"); return; }
    
    auth.createUserWithEmailAndPassword(email, pass).then((cred) => {
        // Ícono por defecto usando iniciales si no sube foto
        const defaultPic = `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=3b82f6&color=fff&size=128`;
        
        db.ref(`Usuarios/${cred.user.uid}/perfil`).set({
            nombre: nombre,
            foto: regBase64 || defaultPic,
            color: "#3b82f6"
        }).then(() => {
            alert("¡Bienvenido " + nombre + "!");
        });
    }).catch(e => alert(e.message)); 
}

function handleResetPassword() { auth.sendPasswordResetEmail(document.getElementById('resetEmail').value).then(() => { alert("Enviado"); toggleAuthForm('login'); }).catch(e => alert(e.message)); }
function handleLogout() { auth.signOut().then(() => window.location.reload()); }

// 4. ESTADO EN TIEMPO REAL
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('appDashboard').style.display = 'block';
        resetTimer();
        
        db.ref('Usuarios/' + user.uid).on('value', snap => {
            const data = snap.val() || {};
            state.cuentas = data.cuentas ? Object.values(data.cuentas) : [];
            state.transacciones = data.transacciones ? Object.entries(data.transacciones).map(([id, val]) => ({...val, firebaseId: id})) : [];
            const p = data.perfil || { nombre: "Usuario", foto: "https://via.placeholder.com/100", color: "#3b82f6" };
            
            // CORRECCIÓN DEL COLOR
            state.selectedColor = p.color; 
            document.documentElement.style.setProperty('--primary', p.color);

            document.getElementById('headerGreeting').innerText = `Hola ${p.nombre} :)`;
            document.getElementById('headerFoto').src = p.foto;
            document.getElementById('perfDisplayNombre').innerText = p.nombre;
            document.getElementById('perfDisplayFoto').src = p.foto;
            if(document.getElementById('perfNombre')) document.getElementById('perfNombre').value = p.nombre;
            renderAll();
        });
    } else {
        document.getElementById('loginScreen').style.display = 'block';
        document.getElementById('appDashboard').style.display = 'none';
        clearTimeout(inactivityTimer);
    }
});

// 5. NAVEGACIÓN Y UI
function toggleUserMenu(e) { e.stopPropagation(); document.getElementById('userMenu').classList.toggle('show'); }
function closeDropdowns() { document.getElementById('userMenu').classList.remove('show'); }
function cambiarTab(id, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active');
    if(btn) btn.classList.add('active');
    closeDropdowns(); window.scrollTo(0,0);
    
    currentEditId = null;
    document.querySelectorAll('form').forEach(f => f.reset());
    ['inCuenta', 'gaFuente', 'movOrigen', 'movDestino'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).disabled = false; });
    document.getElementById('ingresoFormTitle').innerText = "Nuevo Ingreso";
    document.getElementById('gastoFormTitle').innerText = "Nuevo Gasto";
    document.getElementById('movTitle').innerText = "Nuevo Movimiento";
}

// 6. LOGICA TRANSACCIONAL ROBUSTA
function revertirTransaccion(fid) {
    const t = state.transacciones.find(x => x.firebaseId === fid);
    if (!t) return {};
    let updates = {};
    if (t.tipo === 'ingreso') {
        const c = state.cuentas.find(x => x.id == t.cuentaId);
        if(c) updates[`cuentas/${c.id}/saldo`] = c.saldo - t.monto;
    } else if (t.tipo === 'gasto') {
        const c = state.cuentas.find(x => x.id == t.cuentaId);
        if(c) updates[`cuentas/${c.id}/saldo`] = c.tipo === 'debito' ? c.saldo + t.monto : c.saldo - t.monto;
    } else if (t.tipo === 'movimiento') {
        const or = state.cuentas.find(x => x.id == t.origenId);
        const des = state.cuentas.find(x => x.id == t.destinoId);
        if(or) updates[`cuentas/${or.id}/saldo`] = or.saldo + t.monto;
        if(des) updates[`cuentas/${des.id}/saldo`] = des.tipo === 'debito' ? des.saldo - t.monto : des.saldo + t.monto;
    }
    return updates;
}
function eliminarTransaccion(fid) {
    if(!confirm("¿Borrar este registro y devolver los saldos a las cuentas vinculadas?")) return;
    let updates = revertirTransaccion(fid);
    updates[`transacciones/${fid}`] = null;
    db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates);
}
// INGRESOS
function editIngreso(fid) { 
    const t = state.transacciones.find(x => x.firebaseId === fid); 
    cambiarTab('ingresos'); 
    document.getElementById('inDesc').value = t.desc; document.getElementById('inMonto').value = t.monto; 
    document.getElementById('inCuenta').value = t.cuentaId; document.getElementById('inCuenta').disabled = true; 
    currentEditId = fid; document.getElementById('ingresoFormTitle').innerText = "Editando Ingreso (Cuenta Fija)"; 
}

function handleIngreso(e) {
    e.preventDefault(); 
    const m = parseFloat(document.getElementById('inMonto').value); 
    let updates = currentEditId ? revertirTransaccion(currentEditId) : {};
    
    const cId = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).cuentaId : document.getElementById('inCuenta').value;
    const c = state.cuentas.find(x => x.id == cId);
    let currentSaldo = updates[`cuentas/${c.id}/saldo`] !== undefined ? updates[`cuentas/${c.id}/saldo`] : c.saldo;
    
    const id = currentEditId || db.ref(`Usuarios/${auth.currentUser.uid}/transacciones`).push().key;
    const oldFecha = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).fecha : new Date().toISOString().split('T')[0];

    updates[`transacciones/${id}`] = { desc: document.getElementById('inDesc').value, monto: m, tipo: 'ingreso', cuentaId: c.id, fecha: oldFecha };
    updates[`cuentas/${c.id}/saldo`] = currentSaldo + m;

    db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates).then(() => { e.target.reset(); currentEditId = null; document.getElementById('inCuenta').disabled = false; document.getElementById('ingresoFormTitle').innerText = "Nuevo Ingreso"; });
}

// GASTOS
function editGasto(fid) { 
    const t = state.transacciones.find(x => x.firebaseId === fid); 
    cambiarTab('gastos'); 
    document.getElementById('gaDesc').value = t.desc; document.getElementById('gaMonto').value = t.monto; 
    document.getElementById('gaCat').value = t.cat; document.getElementById('gaFuente').value = t.cuentaId; 
    document.getElementById('gaFuente').disabled = true; currentEditId = fid; document.getElementById('gastoFormTitle').innerText = "Editando Gasto (Cuenta Fija)"; 
}

function handleGasto(e) {
    e.preventDefault(); 
    const m = parseFloat(document.getElementById('gaMonto').value); 
    let updates = currentEditId ? revertirTransaccion(currentEditId) : {};
    
    const cId = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).cuentaId : document.getElementById('gaFuente').value;
    const c = state.cuentas.find(x => x.id == cId);
    let currentSaldo = updates[`cuentas/${c.id}/saldo`] !== undefined ? updates[`cuentas/${c.id}/saldo`] : c.saldo;
    
    const id = currentEditId || db.ref(`Usuarios/${auth.currentUser.uid}/transacciones`).push().key;
    const oldFecha = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).fecha : new Date().toISOString().split('T')[0];

    updates[`transacciones/${id}`] = { desc: document.getElementById('gaDesc').value, cat: document.getElementById('gaCat').value, monto: m, tipo: 'gasto', cuentaId: c.id, fecha: oldFecha };
    updates[`cuentas/${c.id}/saldo`] = c.tipo === 'debito' ? currentSaldo - m : currentSaldo + m;

    db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates).then(() => { e.target.reset(); currentEditId = null; document.getElementById('gaFuente').disabled = false; document.getElementById('gastoFormTitle').innerText = "Nuevo Gasto"; });
}

// MOVIMIENTOS VINCULADOS
function setMovMode(mode) {
    currentMovMode = mode;
    document.getElementById('btnModoPago').style.background = mode === 'pago' ? 'var(--primary)' : 'var(--muted)';
    document.getElementById('btnModoTras').style.background = mode === 'traspaso' ? 'var(--primary)' : 'var(--muted)';
    document.getElementById('lblDestino').innerText = mode === 'pago' ? 'Destino (Crédito):' : 'Destino (Débito):';
    actualizarSelects();
}

function editMovimiento(fid) {
    const t = state.transacciones.find(x => x.firebaseId === fid);
    cambiarTab('traspasos');
    setMovMode(t.subtipo || 'traspaso');
    document.getElementById('movOrigen').value = t.origenId; document.getElementById('movDestino').value = t.destinoId; document.getElementById('movMonto').value = t.monto;
    document.getElementById('movOrigen').disabled = true; document.getElementById('movDestino').disabled = true;
    currentEditId = fid; document.getElementById('movTitle').innerText = "Editando Movimiento (Cuentas Fijas)";
}

function handleMovimiento(e) {
    e.preventDefault();
    const m = parseFloat(document.getElementById('movMonto').value);
    let updates = currentEditId ? revertirTransaccion(currentEditId) : {};

    const orId = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).origenId : document.getElementById('movOrigen').value;
    const desId = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).destinoId : document.getElementById('movDestino').value;
    const or = state.cuentas.find(x => x.id == orId); const des = state.cuentas.find(x => x.id == desId);

    let sOr = updates[`cuentas/${or.id}/saldo`] !== undefined ? updates[`cuentas/${or.id}/saldo`] : or.saldo;
    let sDes = updates[`cuentas/${des.id}/saldo`] !== undefined ? updates[`cuentas/${des.id}/saldo`] : des.saldo;

    updates[`cuentas/${or.id}/saldo`] = sOr - m;
    updates[`cuentas/${des.id}/saldo`] = des.tipo === 'debito' ? sDes + m : sDes - m;

    const id = currentEditId || db.ref(`Usuarios/${auth.currentUser.uid}/transacciones`).push().key;
    const oldFecha = currentEditId ? state.transacciones.find(x => x.firebaseId === currentEditId).fecha : new Date().toISOString().split('T')[0];
    const desc = currentMovMode === 'pago' ? `Pago a ${des.nombre}` : `Traspaso a ${des.nombre}`;

    updates[`transacciones/${id}`] = { tipo: 'movimiento', subtipo: currentMovMode, monto: m, desc: desc, origenId: or.id, destinoId: des.id, fecha: oldFecha };

    db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates).then(() => { 
        e.target.reset(); currentEditId = null; 
        document.getElementById('movOrigen').disabled = false; document.getElementById('movDestino').disabled = false;
        document.getElementById('movTitle').innerText = "Nuevo Movimiento";
        alert("Movimiento procesado correctamente.");
    });
}

// 7. ZONA DE PELIGRO
function resetearCuenta() {
    if(!confirm("⚠️ ¿Estás seguro? Se borrarán todos tus ingresos, gastos y traspasos. Tus cuentas quedarán en $0.")) return;
    let updates = {}; updates['transacciones'] = null; 
    state.cuentas.forEach(c => { updates[`cuentas/${c.id}/saldo`] = 0; updates[`cuentas/${c.id}/mesPagado`] = null; });
    db.ref(`Usuarios/${auth.currentUser.uid}`).update(updates).then(() => alert("Cuenta restablecida a $0."));
}

function eliminarUsuario() {
    if(!confirm("🚨 ¡PELIGRO! Esto borrará tu cuenta de Firebase permanentemente. No se puede recuperar. ¿Continuar?")) return;
    const user = auth.currentUser;
    
    // Eliminación real y total
    db.ref(`Usuarios/${user.uid}`).remove().then(() => {
        user.delete().then(() => {
            alert("Cuenta eliminada correctamente.");
            window.location.reload(); // Recarga y limpia la sesión en pantalla
        }).catch(e => {
            if(e.code === 'auth/requires-recent-login') {
                alert("Por seguridad, debes volver a iniciar sesión para confirmar la eliminación.");
                auth.signOut().then(() => window.location.reload());
            } else alert(e.message);
        });
    });
}

// 8. RENDERIZADO VISUAL
function renderAll() {
    let tengo = 0, debo = 0, gT = 0, iT = 0; 
    const hoy = new Date(); const diaHoy = hoy.getDate(); const mesAct = hoy.getMonth(); 
    let hDeb = "", hCre = "", hMae = "";

    state.cuentas.forEach(c => {
        let aviso = "";
        if(c.diaPago) {
            const ya = c.mesPagado === mesAct; const vence = c.diaPago - diaHoy;
            if(ya && vence >= -5) { aviso = `<br><small style="color:var(--success)">✓ Pagado</small> <span onclick="db.ref('Usuarios/${auth.currentUser.uid}/cuentas/${c.id}/mesPagado').remove()" style="font-size:8px; cursor:pointer;">(Quitar)</span>`; } 
            else { const col = vence < 0 || vence <= 3 ? 'var(--danger)' : 'var(--muted)'; aviso = `<br><small style="color:${col}">${vence < 0 ? 'Atrasado' : 'Faltan: '+vence+'d'}</small><br><button class="btn-check-pago" onclick="db.ref('Usuarios/${auth.currentUser.uid}/cuentas/${c.id}/mesPagado').set(${mesAct})">Pagar</button>`; }
        }
        const item = `<div class="bank-item"><div class="bank-info"><img src="${c.icon}" class="bank-icon"><div class="bank-details"><b>${c.nombre}</b>${aviso}</div></div><b>$${c.saldo.toLocaleString()}</b></div>`;
        if(c.tipo==='debito'){ tengo+=c.saldo; hDeb+=item; } else { debo+=c.saldo; hCre+=item; }
        hMae += `<div class="bank-item"><div class="bank-info"><img src="${c.icon}" class="bank-icon"><b>${c.nombre}</b></div><div style="text-align:right"><b>$${c.saldo.toLocaleString()}</b><br><span class="action-link" onclick="const d=prompt('Dominio:'); if(d) db.ref('Usuarios/${auth.currentUser.uid}/cuentas/${c.id}/icon').set('https://www.google.com/s2/favicons?domain='+d+'&sz=64')">Logo</span><span class="action-link danger" onclick="if(confirm('¿Borrar cuenta?')) db.ref('Usuarios/${auth.currentUser.uid}/cuentas/${c.id}').remove()">Borrar</span></div></div>`;
    });

    document.getElementById('widgetDebitos').innerHTML = hDeb || "<small>Vacío</small>"; document.getElementById('widgetCreditos').innerHTML = hCre || "<small>Vacío</small>"; document.getElementById('listaMaestraCuentas').innerHTML = hMae;
    document.getElementById('valTengo').innerText = `$${tengo.toLocaleString()}`; document.getElementById('valDebo').innerText = `$${debo.toLocaleString()}`; document.getElementById('valPatrimonio').innerText = `$${(tengo - debo).toLocaleString()}`;
    
    gT = state.transacciones.filter(t => t.tipo==='gasto').reduce((a, b) => a + b.monto, 0); iT = state.transacciones.filter(t => t.tipo==='ingreso').reduce((a, b) => a + b.monto, 0);
    document.getElementById('homeIngresos').innerText = `$${iT.toLocaleString()}`; document.getElementById('homeGastos').innerText = `$${gT.toLocaleString()}`;

    let hG = "", hI = "", hM = "";
    state.transacciones.slice().reverse().forEach(t => {
        let actionStr = t.tipo === 'movimiento' ? `editMovimiento('${t.firebaseId}')` : (t.tipo === 'gasto' ? `editGasto('${t.firebaseId}')` : `editIngreso('${t.firebaseId}')`);
        const btns = `<button class="del-btn" onclick="eliminarTransaccion('${t.firebaseId}')">🗑️</button><button class="edit-btn" onclick="${actionStr}">✎</button>`;
        const item = `<div class="bank-item"><div>${t.desc}<br><small>${t.fecha}</small></div><div style="display:flex; align-items:center;">${btns}<b>$${t.monto.toLocaleString()}</b></div></div>`;
        
        if(t.tipo === 'gasto') hG += item; else if (t.tipo === 'ingreso') hI += item; else hM += item;
    });
    
    document.getElementById('listaGastos').innerHTML = hG; document.getElementById('listaIngresos').innerHTML = hI; document.getElementById('listaMovimientos').innerHTML = hM;
    actualizarSelects(); renderChart(gT);
}

function actualizarSelects() {
    const optDeb = state.cuentas.filter(c => c.tipo==='debito').map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    const optCre = state.cuentas.filter(c => c.tipo==='credito').map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    const optAll = state.cuentas.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    
    if(document.getElementById('inCuenta')) document.getElementById('inCuenta').innerHTML = optDeb; 
    if(document.getElementById('gaFuente')) document.getElementById('gaFuente').innerHTML = optAll; 
    if(document.getElementById('movOrigen')) document.getElementById('movOrigen').innerHTML = optDeb; 
    if(document.getElementById('movDestino')) document.getElementById('movDestino').innerHTML = currentMovMode === 'pago' ? optCre : optDeb;
}

// 9. CONFIGURACIÓN FINAL Y PERFIL
function getBankLogo(banco) { const map = { "bbva": "bbva.mx", "nu": "nu.com.mx", "santander": "santander.com.mx" }; const dom = map[banco.toLowerCase().trim()] || `${banco.toLowerCase().replace(/\s/g, '')}.com`; return `https://www.google.com/s2/favicons?domain=${dom}&sz=64`; }
function selectColor(hex, el) { state.selectedColor = hex; document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active')); el.classList.add('active'); document.documentElement.style.setProperty('--primary', hex); }
function handleNuevaCuenta(e) { e.preventDefault(); const id=Date.now(); const b=document.getElementById('cuBanco').value; db.ref(`Usuarios/${auth.currentUser.uid}/cuentas/${id}`).set({id, nombre:document.getElementById('cuNombre').value, banco:b, tipo:document.getElementById('cuTipo').value, saldo:parseFloat(document.getElementById('cuSaldo').value), icon:getBankLogo(b), diaPago:parseInt(document.getElementById('cuPago').value)||0}); e.target.reset(); }
function handleGuardarPerfil(e) { e.preventDefault(); db.ref(`Usuarios/${auth.currentUser.uid}/perfil`).set({ nombre: document.getElementById('perfNombre').value, foto: state.currentBase64 || document.getElementById('perfDisplayFoto').src, color: state.selectedColor }).then(() => { alert("Perfil actualizado"); cambiarTab('resumen'); }); }
function toggleTheme() { const t = document.body.getAttribute('data-theme')==='dark'?'light':'dark'; document.body.setAttribute('data-theme', t); }

if(document.getElementById('perfFile')) { document.getElementById('perfFile').addEventListener('change', function(e) { const reader = new FileReader(); reader.onload = function() { state.currentBase64 = reader.result; document.getElementById('perfDisplayFoto').src = reader.result; }; if(e.target.files[0]) reader.readAsDataURL(e.target.files[0]); }); }
function renderChart(total) { const ctx = document.getElementById('chartGastos').getContext('2d'); const cats = {}; state.transacciones.filter(t => t.tipo === 'gasto').forEach(t => cats[t.cat] = (cats[t.cat] || 0) + t.monto); if(chartInstance) chartInstance.destroy(); chartInstance = new Chart(ctx, { type:'doughnut', data:{ labels:Object.keys(cats), datasets:[{data:Object.values(cats), backgroundColor:['#3b82f6','#10b981','#ef4444','#8b5cf6'], borderWidth:0}] }, options:{ maintainAspectRatio:false, plugins:{legend:{display:false}}, cutout:'75%' } }); }
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }
