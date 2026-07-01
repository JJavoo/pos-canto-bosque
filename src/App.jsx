import React, { useState, useEffect } from 'react';
import {
  Utensils, Coffee, Archive, ChevronLeft, Trash2, ArrowLeft, Plus, Minus, 
  Search, XCircle, Tent, Edit, Users, FileText, CheckCircle, Save, Printer, 
  BarChart3, Banknote, ChefHat, Check, ClipboardList
} from 'lucide-react';

import { db } from './firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy, where,
  serverTimestamp, runTransaction, getDoc, setDoc, deleteDoc
} from 'firebase/firestore';

import './App.css'; 

// --- CONFIGURACIÓN & UTILIDADES ---
const LOGO_URL = ''; 

const CATEGORY_ICONS = {
  Ensaladas: '🥗', 'Platos Principales': '🍽️', 'Para Compartir': '🥩', Postres: '🍰',
  Cócteles: '🍹', Licores: '🥃', Cervezas: '🍺', Vinos: '🍷',
  'Bebidas Naturales': '🥤', Refrescos: '🧊', Especial: '✨',
};

const formatColones = (val) => {
  const n = Number(val) || 0;
  return new Intl.NumberFormat('es-CR', {
    style: 'currency', currency: 'CRC',
    minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2,
  }).format(n);
};

// --- APP PRINCIPAL ---
export default function App() {
  // Ahora el view maneja las áreas separadas: meseros vs caja
  const [view, setView] = useState('meseros'); 
  const [menu, setMenu] = useState([]);
  const [tables, setTables] = useState([]);
  const [history, setHistory] = useState([]);
  const [cabanas, setCabanas] = useState([]); 
  const [selectedTableId, setSelectedTableId] = useState(null);
  
  const [ticketData, setTicketData] = useState(null);

  useEffect(() => {
    const unsubMenu = onSnapshot(query(collection(db, 'menu'), orderBy('createdAt', 'asc')), (snap) => {
        const docs = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
        setMenu(docs);
      });

    const unsubMesas = onSnapshot(query(collection(db, 'mesas'), orderBy('createdAt', 'asc')), (snap) => {
      setTables(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsubVentas = onSnapshot(query(collection(db, 'ventas'), orderBy('fecha_hora', 'desc')), (snap) => {
       setHistory(snap.docs.slice(0, 50).map(d => ({id: d.id, ...d.data()})));
    });

    const initCabanas = async () => {
      for(let i=1; i<=7; i++) {
        const cabId = `cabana-${i}`;
        const docRef = doc(db, 'cabanas', cabId);
        const docSnap = await getDoc(docRef);
        if(!docSnap.exists()) {
          await setDoc(docRef, { id: i, name: `Cabaña ${i}`, status: 'Libre', info: {} });
        }
      }
    };
    initCabanas();

    const unsubCabanas = onSnapshot(query(collection(db, 'cabanas'), orderBy('id', 'asc')), (snap) => {
      setCabanas(snap.docs.map(d => ({ docId: d.id, ...d.data() })));
    });

    return () => { unsubMenu(); unsubMesas(); unsubVentas(); unsubCabanas(); };
  }, []);

  const activeTable = tables.find((t) => t.id === selectedTableId);

  const handlePrint = (data) => setTicketData(data);

  useEffect(() => {
    if (!ticketData) return;
    let raf1, raf2;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => { window.print(); });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [ticketData]);

  // --- CRUD MENU ---
  const addMenuItem = async (category, name, price) => {
    try {
      const ref = await addDoc(collection(db, 'menu'), { name, category, price: Number(price), createdAt: serverTimestamp() });
      await setDoc(doc(db, 'menu', ref.id), { id: ref.id }, { merge: true });
      alert('Producto agregado');
    } catch (e) { alert('Error: ' + e.message); }
  };
  const updateMenuItem = async (docId, data) => {
    try {
      await setDoc(doc(db, 'menu', docId), { ...data, updatedAt: serverTimestamp() }, { merge: true });
      alert('Producto actualizado');
    } catch (e) { alert('Error: ' + e.message); }
  };
  const deleteMenuItem = async (docId) => {
    if (!window.confirm('¿Eliminar producto?')) return;
    try { await deleteDoc(doc(db, 'menu', docId)); alert('Producto eliminado'); } catch (e) { alert('Error: ' + e.message); }
  };

  // --- HANDLERS MESAS ---
  const handleCreateTable = async (name) => {
    if (!name) return;
    await addDoc(collection(db, 'mesas'), { name, status: 'free', items: [], payment: 'Efectivo', createdAt: serverTimestamp() });
  };
  const handleUpdateTable = async (updated) => {
    if (!updated.id) return;
    const ref = doc(db, 'mesas', updated.id);
    await updateDoc(ref, {
      items: updated.items,
      status: (updated.items && updated.items.length > 0) ? 'occupied' : 'free',
      payment: updated.payment,
      ultima_actualizacion: serverTimestamp(),
    });
  };
  const handleRenameTable = async (tableId, currentName) => {
    const newName = prompt("Nuevo nombre para la mesa:", currentName);
    if(newName && newName !== currentName) await updateDoc(doc(db, 'mesas', tableId), { name: newName });
  };
  const handleDeleteTable = async (table) => {
    if ((table.items || []).length > 0) return alert('La mesa tiene pedidos activos.');
    if (!window.confirm(`¿Eliminar ${table.name}?`)) return;
    await deleteDoc(doc(db, 'mesas', table.id));
  };

  // --- COBRO ---
  const handleCloseOrder = async (tableData, itemsToPay = null, paymentMethod = 'Efectivo') => {
    const tableRef = doc(db, 'mesas', tableData.id);
    const ventasColl = collection(db, 'ventas');
    const isPartial = itemsToPay !== null;
    const finalItems = isPartial ? itemsToPay : (tableData.items || []);
    
    if(finalItems.length === 0) return alert("No hay items para cobrar");

    try {
      const subtotalYaCobrado = !isPartial ? (Number(tableData.subtotalPagado) || 0) : 0;
      const subtotalBruto = finalItems.reduce((s, it) => s + (Number(it.price) || 0), 0);
      const subtotal = subtotalBruto - subtotalYaCobrado;

      if (subtotal <= 0) {
        if (!window.confirm('Esta cuenta ya fue cobrada por abonos. ¿Cerrar mesa?')) return;
        await deleteDoc(tableRef);
        setView('caja'); setSelectedTableId(null);
        return;
      }

      const impuesto = subtotal * 0.13;
      const descuento = paymentMethod !== 'Tarjeta' ? impuesto : 0;
      const total = subtotal + impuesto - descuento;
      
      const ventaData = {
        fecha_hora: serverTimestamp(), mesaId: tableData.id, 
        mesaNombre: tableData.name + (isPartial ? ' (Parcial)' : ''),
        items: finalItems, subtotal, impuesto, descuento, total_final: total, 
        medio_pago: paymentMethod, createdAt: serverTimestamp(), tipo: isPartial ? 'Parcial' : 'Completa'
      };

      await runTransaction(db, async (transaction) => {
        const tSnap = await transaction.get(tableRef);
        if (!tSnap.exists()) throw new Error('Mesa no existe');
        const currentTable = tSnap.data();
        const allItems = currentTable.items || [];
        const newVentaRef = doc(ventasColl);
        transaction.set(newVentaRef, ventaData);

        finalItems.forEach(item => {
            if (item.linkedCabinId) transaction.update(doc(db, 'cabanas', item.linkedCabinId), { 'info.estadoPago': 'Pagado' });
        });

        if (isPartial) {
          const idsToPay = finalItems.map(i => i.instanceId);
          const remainingItems = allItems.filter(i => !idsToPay.includes(i.instanceId));
          transaction.update(tableRef, { items: remainingItems, status: remainingItems.length > 0 ? 'occupied' : 'free', ultima_actualizacion: serverTimestamp() });
        } else {
          transaction.delete(tableRef);
        }
      });
      
      handlePrint({ ...ventaData, fecha_hora: new Date(), id: 'NUEVA' });
      if(!isPartial) { setView('caja'); setSelectedTableId(null); } 
      else { alert("Cobro parcial exitoso"); }
    } catch (e) { alert('Error: ' + e.message); }
  };

  const handlePartialAmountPayment = async (tableData, monto, paymentMethod) => {
    const tableRef = doc(db, 'mesas', tableData.id);
    const ventasColl = collection(db, 'ventas');
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) return alert('Monto inválido');

    const subtotalTotal = (tableData.items || []).reduce((s, it) => s + (Number(it.price) || 0), 0);
    const subtotalYaCobrado = Number(tableData.subtotalPagado) || 0;
    const subtotalPendiente = Math.max(0, subtotalTotal - subtotalYaCobrado);
    const subtotalPortion = paymentMethod === 'Tarjeta' ? montoNum / 1.13 : montoNum;

    if (subtotalPortion - subtotalPendiente > 0.5) return alert('El monto supera lo pendiente.');

    const impuesto = paymentMethod === 'Tarjeta' ? montoNum - subtotalPortion : subtotalPortion * 0.13;
    const descuento = paymentMethod !== 'Tarjeta' ? impuesto : 0;

    const ventaData = {
      fecha_hora: serverTimestamp(), mesaId: tableData.id, mesaNombre: tableData.name + ' (Abono)',
      items: [{ name: 'Abono a la cuenta', price: subtotalPortion, qty: 1 }],
      subtotal: subtotalPortion, impuesto, descuento, total_final: montoNum,
      medio_pago: paymentMethod, createdAt: serverTimestamp(), tipo: 'Abono'
    };

    try {
      let mesaQuedaCerrada = false;
      await runTransaction(db, async (transaction) => {
        const tSnap = await transaction.get(tableRef);
        if (!tSnap.exists()) throw new Error('Mesa no existe');
        const currentTable = tSnap.data();
        const subtotalActual = (currentTable.items || []).reduce((s, it) => s + (Number(it.price) || 0), 0);
        const yaCobradoActual = Number(currentTable.subtotalPagado) || 0;
        const nuevoAcumulado = yaCobradoActual + subtotalPortion;
        const newVentaRef = doc(ventasColl);
        transaction.set(newVentaRef, ventaData);

        if (nuevoAcumulado >= subtotalActual - 0.5) {
          mesaQuedaCerrada = true;
          transaction.delete(tableRef);
        } else {
          transaction.update(tableRef, { subtotalPagado: nuevoAcumulado, ultima_actualizacion: serverTimestamp() });
        }
      });

      handlePrint({ ...ventaData, fecha_hora: new Date(), id: 'NUEVA' });
      if (mesaQuedaCerrada) { setView('caja'); setSelectedTableId(null); }
    } catch (e) { alert('Error: ' + e.message); }
  };
  
  const handleUpdateCabana = async (docId, newData) => await updateDoc(doc(db, 'cabanas', docId), newData);
  const handleCheckoutCabana = async (cabana) => {
    if(!window.confirm(`¿Finalizar alquiler de ${cabana.name}?`)) return;
    await updateDoc(doc(db, 'cabanas', cabana.docId), { status: 'Libre', info: {} });
  };

  return (
    <>
      <div className="app-container no-print">
        <header className="top-bar">
          <div className="flex-center" style={{ gap: '1rem' }}>
            {LOGO_URL ? <img src={LOGO_URL} alt="Logo" style={{ height: '40px' }} /> : <Utensils className="text-muted" />}
            <div>
              <h1 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--primary)', fontWeight: 800 }}>Canto del Bosque</h1>
              <div className="flex-center" style={{ gap: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: '50%' }}></span> Sistema POS v2.3
              </div>
            </div>
          </div>

          <div className="flex-center" style={{ gap: '0.5rem' }}>
            {/* NUEVA BARRA DE NAVEGACIÓN SEPARADA */}
            <NavBtn icon={<ClipboardList size={18} />} label="Meseros" active={view === 'meseros' || view === 'pos_mesero'} onClick={() => setView('meseros')} />
            <NavBtn icon={<Banknote size={18} />} label="Caja" active={view === 'caja' || view === 'pos_caja'} onClick={() => setView('caja')} />
            <span style={{ width: '1px', height: '20px', background: 'var(--border)', margin: '0 5px' }}></span>
            <NavBtn icon={<ChefHat size={18} />} label="Cocina" active={view === 'kitchen'} onClick={() => setView('kitchen')} />
            <NavBtn icon={<Tent size={18} />} label="Cabañas" active={view === 'cabanas'} onClick={() => setView('cabanas')} />
            <NavBtn icon={<Archive size={18} />} label="Historial" active={view === 'history'} onClick={() => setView('history')} />
            <NavBtn icon={<BarChart3 size={18} />} label="Reportes" active={view === 'reports'} onClick={() => setView('reports')} />
            <NavBtn icon={<FileText size={18} />} label="Menú" active={view === 'menu'} onClick={() => setView('menu')} />
          </div>
        </header>

        <main className="main-area">
          {view === 'meseros' && (
            <TablesManager tables={tables} title="Tomar Pedidos (Meseros)" onCreate={handleCreateTable} onOpen={(id) => { setSelectedTableId(id); setView('pos_mesero'); }} onDelete={handleDeleteTable} onRename={handleRenameTable} />
          )}
          {view === 'pos_mesero' && activeTable && (
            <POSInterface role="mesero" table={activeTable} menu={menu} cabanas={cabanas} onUpdateTable={handleUpdateTable} onBack={() => setView('meseros')} />
          )}
          
          {view === 'caja' && (
            <TablesManager tables={tables} title="Facturación y Cobro (Caja)" onCreate={handleCreateTable} onOpen={(id) => { setSelectedTableId(id); setView('pos_caja'); }} onDelete={handleDeleteTable} onRename={handleRenameTable} />
          )}
          {view === 'pos_caja' && activeTable && (
            <POSInterface role="caja" table={activeTable} menu={menu} cabanas={cabanas} onUpdateTable={handleUpdateTable} onCloseOrder={handleCloseOrder} onPartialAmount={handlePartialAmountPayment} onBack={() => setView('caja')} />
          )}

          {view === 'kitchen' && <KitchenManager tables={tables} onUpdateTable={handleUpdateTable} />}
          {view === 'cabanas' && <CabinsManager cabanas={cabanas} onUpdate={handleUpdateCabana} onCheckout={handleCheckoutCabana} onPrint={handlePrint} />}
          {view === 'history' && <HistoryManager history={history} onPrint={handlePrint} />}
          {view === 'reports' && <ReportsManager />}
          {view === 'menu' && <MenuManager menu={menu} onAdd={addMenuItem} onUpdate={updateMenuItem} onDelete={deleteMenuItem} onBack={() => setView('meseros')} />}
        </main>
      </div>
      <PrintableTicket data={ticketData} />
    </>
  );
}

// --- COMPONENTES ---

function PrintableTicket({ data }) {
  if (!data) return null;
  const { mesaNombre, fecha_hora, items, subtotal, impuesto, impuesto_tarjeta, descuento, total_final, medio_pago, id } = data;
  const dateObj = fecha_hora?.toDate ? fecha_hora.toDate() : new Date(fecha_hora || Date.now());
  
  return (
    <div id="printable-receipt">
      <div className="ticket-header">
        <h2 style={{ margin: 0, fontSize: '16px' }}>Canto del Bosque</h2>
        <div>Tel: 8633-9009</div>
        <div>2,5km al suroeste del Hospital San Vito, cerca de Bario Los Gamboa</div>
      </div>
      <div className="ticket-divider"></div>
      <div style={{display:'flex', justifyContent:'space-between'}}>
         <span>Fecha: {dateObj.toLocaleDateString('es-CR')}</span>
         <span>Hora: {dateObj.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div>Cliente: {mesaNombre}</div>
      <div>Factura #: {id ? id.slice(-6).toUpperCase() : '---'}</div>
      <div className="ticket-divider"></div>
      <div className="ticket-row" style={{ fontWeight: 'bold' }}>
        <span style={{flex: 1}}>Cant. Desc</span><span>Total</span>
      </div>
      {items.map((item, idx) => (
        <div key={idx} style={{ marginBottom: '4px' }}>
          <div>{item.name}</div>
          {item.nota && <div style={{fontSize: '11px', fontStyle: 'italic'}}>- {item.nota}</div>}
          <div className="ticket-row">
            <span>{item.qty || 1} x {formatColones(item.price)}</span>
            <span>{formatColones((item.price * (item.qty || 1)))}</span>
          </div>
        </div>
      ))}
      <div className="ticket-divider"></div>
      <div className="ticket-row"><span>Subtotal:</span><span>{formatColones(subtotal)}</span></div>
      <div className="ticket-row"><span>IVA (13%):</span><span>{formatColones(impuesto !== undefined ? impuesto : (impuesto_tarjeta || 0))}</span></div>
      {descuento > 0 && <div className="ticket-row"><span>Desc. ({medio_pago}):</span><span>-{formatColones(descuento)}</span></div>}
      <div className="ticket-row" style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '5px' }}>
        <span>TOTAL:</span><span>{formatColones(total_final)}</span>
      </div>
      <div style={{textAlign:'right', fontSize:'11px', marginTop:'5px'}}>Pago: {medio_pago}</div>
      <div className="ticket-footer" style={{ textAlign: 'center', marginTop: '15px' }}>
        <span style={{ margin: 0 }}>¡Gracias por su visita!</span>
      </div>
    </div>
  );
}

function TablesManager({ tables, title, onCreate, onOpen, onDelete, onRename }) {
  const [name, setName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTables = tables.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="card" style={{ padding: '1.5rem', height: '100%', overflowY: 'auto' }}>
      <div className="controls-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0, color: 'var(--primary)' }}>{title}</h2>
        <div className="input-group" style={{ display: 'flex', gap: '0.5rem' }}>
          <input className="input-search" style={{width: '150px'}} placeholder="Buscar mesa..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          <input className="input-search" style={{width: '200px'}} placeholder="Nueva Mesa..." value={name} onChange={e => setName(e.target.value)} />
          <button className="btn btn-primary" onClick={() => { onCreate(name); setName(''); }}><Plus size={18} /> Crear</button>
        </div>
      </div>
      <div className="category-grid">
        {filteredTables.map(t => {
          const total = (t.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
          return (
            <div key={t.id} className="cat-card" style={{ position: 'relative', alignItems: 'flex-start', padding: '1.5rem', borderColor: t.status === 'occupied' ? 'var(--primary)' : 'var(--border)' }} onClick={() => onOpen(t.id)}>
              <div style={{position: 'absolute', top: 5, right: 5, display: 'flex', gap: '4px'}}>
                 <button onClick={(e) => { e.stopPropagation(); onRename(t.id, t.name); }} className="btn-icon-mini text-muted"><Edit size={14} /></button>
                {(t.items || []).length === 0 && (
                  <button onClick={(e) => { e.stopPropagation(); onDelete(t); }} className="btn-icon-mini" style={{color: '#ef4444'}}><XCircle size={14} /></button>
                )}
              </div>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{t.status === 'occupied' ? '👨‍👩‍👧‍👦' : '🪑'}</div>
              <div className="cat-name" style={{ fontSize: '1.1rem' }}>{t.name}</div>
              <div className="text-muted" style={{ marginTop: 'auto', fontSize: '0.85rem' }}>
                {t.status === 'occupied' ? formatColones(total) : 'Disponible'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KitchenManager({ tables, onUpdateTable }) {
  // Versión limpia sin audio
  const comandasActivas = tables.filter(t => t.items && t.items.some(i => i.estadoCocina === 'Pendiente'));

  const marcarItemListo = (table, instanceId) => {
    const newItems = table.items.map(i => i.instanceId === instanceId ? { ...i, estadoCocina: 'Listo' } : i);
    onUpdateTable({ ...table, items: newItems });
  };

  const marcarTodoListo = (table) => {
    const newItems = table.items.map(i => i.estadoCocina === 'Pendiente' ? { ...i, estadoCocina: 'Listo' } : i);
    onUpdateTable({ ...table, items: newItems });
  };

  if (comandasActivas.length === 0) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center', height: '100%', background: '#f8fafc' }}>
        <ChefHat size={48} color="#cbd5e1" style={{ marginBottom: '1rem' }} />
        <h2 style={{ color: '#64748b' }}>No hay pedidos en cola</h2>
        <p className="text-muted">La cocina está libre por el momento.</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '1.5rem', height: '100%', overflowY: 'auto', background: '#f8fafc' }}>
      <h2 style={{ fontSize: '1.2rem', fontWeight: '800', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ChefHat size={20} /> Comandas en Preparación
      </h2>
      <div className="category-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {comandasActivas.map(table => {
          const itemsPendientes = table.items.filter(i => i.estadoCocina === 'Pendiente');
          return (
            <div key={table.id} className="comanda-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                 <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>{table.name}</h3>
                 <button className="btn btn-outline" style={{ fontSize: '0.8rem', borderColor: '#10b981', color: '#10b981', padding: '4px 8px' }} onClick={() => marcarTodoListo(table)}>
                   <Check size={14} /> Todo Listo
                 </button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {itemsPendientes.map(item => (
                   <div key={item.instanceId} className="comanda-item" style={{alignItems: 'flex-start'}}>
                     <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>1x {item.name}</div>
                        {/* AQUI MOSTRAMOS LA NOTA AL CHEF */}
                        {item.nota && <div className="item-nota">{item.nota}</div>}
                     </div>
                     <button className="btn-icon" style={{ color: '#059669', background: '#d1fae5', width: '28px', height: '28px', marginTop: '2px' }} onClick={() => marcarItemListo(table, item.instanceId)}>
                       <Check size={14} />
                     </button>
                   </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function POSInterface({ role, table, menu, cabanas, onUpdateTable, onCloseOrder, onPartialAmount, onBack }) {
  const [cat, setCat] = useState(null);
  const [search, setSearch] = useState('');
  const [showCabinSelector, setShowCabinSelector] = useState(false); 
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [selectedForSplit, setSelectedForSplit] = useState([]); 
  const [showMontoPanel, setShowMontoPanel] = useState(false);
  const [montoInput, setMontoInput] = useState('');

  const categories = [...new Set(menu.map(i => i.category))];
  
  // Agrupamos tomando en cuenta la nota para no fusionar una "sin cebolla" con una normal
  const grouped = {};
  (table.items || []).forEach(i => {
    const estado = i.estadoCocina || 'Nuevo';
    const nota = i.nota || '';
    const key = `${i.id}-${i.price}-${estado}-${nota}`;
    if(!grouped[key]) grouped[key] = { ...i, qty: 0, ids: [], estadoCocina: estado, nota: nota };
    grouped[key].qty++;
    grouped[key].ids.push(i.instanceId);
  });
  const cartItems = Object.values(grouped);

  const itemsToCalc = isSplitMode ? (table.items || []).filter(i => selectedForSplit.includes(i.instanceId)) : (table.items || []);

  const montoYaCobrado = Number(table.subtotalPagado) || 0;
  const subtotalBruto = itemsToCalc.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const subtotal = isSplitMode ? subtotalBruto : Math.max(0, subtotalBruto - montoYaCobrado);
  const tax = subtotal * 0.13;
  const discount = table.payment !== 'Tarjeta' ? tax : 0;
  const total = subtotal + tax - discount;

  const subtotalTotalCuenta = (table.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
  const subtotalPendienteCuenta = Math.max(0, subtotalTotalCuenta - montoYaCobrado);
  const taxPendiente = subtotalPendienteCuenta * 0.13;
  const discountPendiente = table.payment !== 'Tarjeta' ? taxPendiente : 0;
  const totalPendienteCuenta = subtotalPendienteCuenta + taxPendiente - discountPendiente;

  const filtered = search ? menu.filter(i => i.name.toLowerCase().includes(search.toLowerCase())) : cat ? menu.filter(i => i.category === cat) : [];

  const addItem = (item) => {
    if(isSplitMode) return alert("Sal del modo Dividir para agregar items");
    let price = Number(item.price);
    if(price === 0) {
      const p = prompt('Precio:');
      if(!p) return;
      price = parseFloat(p) || 0;
    }
    const newItem = { ...item, price, instanceId: Date.now() + Math.random().toString(), estadoCocina: 'Nuevo', nota: '' };
    onUpdateTable({ ...table, items: [...(table.items || []), newItem] });
  };

  const increaseQty = (groupItem) => {
    if(isSplitMode) return;
    const newItem = { ...groupItem, instanceId: Date.now() + Math.random().toString(), qty: 1, ids: [], estadoCocina: groupItem.estadoCocina, nota: groupItem.nota }; 
    onUpdateTable({ ...table, items: [...(table.items || []), newItem] });
  };

  const decreaseQty = (groupItem) => {
    if(isSplitMode) return;
    const removeId = groupItem.ids[0];
    onUpdateTable({ ...table, items: table.items.filter(i => i.instanceId !== removeId) });
  };

  const removeLine = (groupItem) => {
    if(isSplitMode) return;
    onUpdateTable({ ...table, items: table.items.filter(i => !groupItem.ids.includes(i.instanceId)) });
  };

  // NUEVA FUNCION: Agregar nota a un producto
  const addNoteToGroup = (groupItem) => {
    if(isSplitMode) return;
    const note = prompt(`Especificación para ${groupItem.name} (ej. Sin cebolla, bien cocido):`, groupItem.nota || '');
    if (note !== null) {
      // Aplicamos la nota a todos los items individuales que conforman este grupo
      const updatedItems = table.items.map(i => groupItem.ids.includes(i.instanceId) ? { ...i, nota: note.trim() } : i);
      onUpdateTable({ ...table, items: updatedItems });
    }
  };

  const handleGroupSplitClick = (group) => {
    if(!isSplitMode) return;
    const selectedIdsInGroup = group.ids.filter(id => selectedForSplit.includes(id));
    const allSelected = selectedIdsInGroup.length === group.ids.length;

    if (allSelected) {
      setSelectedForSplit(prev => prev.filter(id => !group.ids.includes(id)));
    } else {
      const nextId = group.ids.find(id => !selectedForSplit.includes(id));
      if(nextId) setSelectedForSplit(prev => [...prev, nextId]);
    }
  };

  const handlePay = () => {
    if(!onCloseOrder) return; // Por si acaso un mesero logra llegar aquí
    if (isSplitMode) {
      if(selectedForSplit.length === 0) return alert("Selecciona productos para cobrar");
      if(!window.confirm(`¿Cobrar ${formatColones(total)} a la subcuenta actual?`)) return;
      onCloseOrder(table, itemsToCalc, table.payment); 
      setSelectedForSplit([]); 
    } else {
      if(!window.confirm('¿Cerrar cuenta completa?')) return;
      onCloseOrder(table, null, table.payment); 
    }
  };

  const handleSendToKitchen = () => {
    let hasNewItems = false;
    const updatedItems = (table.items || []).map(item => {
      if (item.category !== 'Hospedaje' && (!item.estadoCocina || item.estadoCocina === 'Nuevo')) {
        hasNewItems = true;
        return { ...item, estadoCocina: 'Pendiente' };
      }
      return item;
    });

    if (hasNewItems) {
      onUpdateTable({ ...table, items: updatedItems });
      alert('¡Comanda enviada a la cocina!');
    } else {
      alert('No hay productos nuevos para enviar a cocina.');
    }
  };

  const hasNewItems = (table.items || []).some(i => i.category !== 'Hospedaje' && (!i.estadoCocina || i.estadoCocina === 'Nuevo'));

  return (
    <div className="pos-layout">
      {/* LEFT: ORDER */}
      <div className="card order-panel">
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
             <button className="btn-icon" onClick={onBack}><ArrowLeft size={20} /></button>
             <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: 0 }}>{table.name}</h2>
          </div>
          
          {/* BOTONES DE CAJA (Ocultos para meseros) */}
          <div style={{display:'flex', gap:'8px'}}>
            {role === 'caja' && (
              <>
                <button className={`btn ${showMontoPanel ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setShowMontoPanel(!showMontoPanel); setIsSplitMode(false); setSelectedForSplit([]); }}>
                  <Banknote size={16} /> Cobro Libre
                </button>
                <button className={`btn ${isSplitMode ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setIsSplitMode(!isSplitMode); setSelectedForSplit([]); setShowMontoPanel(false); }}>
                  <Users size={16} /> {isSplitMode ? 'Cancelar División' : 'Dividir Cuenta'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="order-items">
           {isSplitMode && <div style={{background:'#e0f2fe', padding:'5px', fontSize:'0.8rem', textAlign:'center', color:'#0369a1'}}>Selecciona los productos que paga esta persona</div>}
          
          {cartItems.map(item => {
            const qtySelected = item.ids.filter(id => selectedForSplit.includes(id)).length;
            const isFullySelected = qtySelected === item.qty && item.qty > 0;
            const isPartiallySelected = qtySelected > 0 && !isFullySelected;

            return (
            <div key={`${item.id}-${item.price}-${item.estadoCocina}-${item.nota}`} 
                 className={`order-item ${isSplitMode ? 'split-selectable' : ''}`}
                 style={{ 
                    borderLeft: isFullySelected ? '4px solid var(--primary)' : isPartiallySelected ? '4px solid orange' : '4px solid transparent',
                    background: isFullySelected ? '#f0fdf4' : 'white'
                 }}
                 onClick={() => handleGroupSplitClick(item)}
            >
              <div className="flex-center" style={{ gap: '10px', flex: 1 }}>
                {!isSplitMode ? (
                  <div style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', borderRadius: '8px', padding: '2px' }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => decreaseQty(item)} style={{ border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', color: 'var(--danger)' }}><Minus size={14} /></button>
                    <span style={{ fontWeight: 'bold', minWidth: '20px', textAlign: 'center', fontSize: '0.9rem' }}>{item.qty}</span>
                    <button onClick={() => increaseQty(item)} style={{ border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', color: 'var(--primary)' }}><Plus size={14} /></button>
                  </div>
                ) : (
                    <div className="qty-badge" style={{background: qtySelected > 0 ? 'var(--primary)' : '#cbd5e1'}}>{qtySelected} / {item.qty}</div>
                )}

                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name}
                    {item.estadoCocina === 'Pendiente' && <span className="badge-status status-pendiente">En cocina</span>}
                    {item.estadoCocina === 'Listo' && <span className="badge-status status-listo">Listo</span>}
                  </div>
                  
                  {item.nota && <div className="item-nota">{item.nota}</div>}
                  
                  <div className="text-muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {formatColones(item.price)}
                    {!isSplitMode && (
                      <button className="btn-icon" style={{width: 22, height: 22}} onClick={(e) => { e.stopPropagation(); addNoteToGroup(item); }} title="Añadir Nota">
                        <Edit size={12} color="#f59e0b" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-center" style={{ gap: '10px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{formatColones(item.price * (isSplitMode ? qtySelected : item.qty))}</span>
                {!isSplitMode && (
                  <button className="btn-icon" style={{ color: '#94a3b8' }} onClick={(e) => { e.stopPropagation(); removeLine(item); }}><Trash2 size={16} /></button>
                )}
                {isSplitMode && qtySelected > 0 && <CheckCircle size={16} color="var(--primary)" />}
              </div>
            </div>
          )})}
        </div>

        <div className="order-summary">
          {/* SELECTOR DE PAGO (Solo visible para Caja) */}
          {role === 'caja' && (
             <div className="payment-selector">
               {['Efectivo', 'SINPE', 'Tarjeta'].map(m => (
                 <button key={m} className={`payment-btn ${table.payment === m ? 'active' : ''}`} onClick={() => onUpdateTable({ ...table, payment: m })}>{m}</button>
               ))}
             </div>
          )}

          {/* PANEL DE COBRO LIBRE (Solo Caja) */}
          {role === 'caja' && showMontoPanel && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.8rem', marginBottom: 6 }}>Pendiente por cobrar de la cuenta: <b>{formatColones(totalPendienteCuenta)}</b></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="number" className="input-search" placeholder="Monto a cobrar ahora" value={montoInput} onChange={e => setMontoInput(e.target.value)} />
                <button className="btn btn-primary" onClick={() => {
                    const val = parseFloat(montoInput);
                    if (!val || val <= 0) return alert('Ingresa un monto válido');
                    if (!window.confirm(`¿Cobrar ${formatColones(val)} (${table.payment}) de esta cuenta?`)) return;
                    onPartialAmount(table, val, table.payment);
                    setMontoInput('');
                  }}>Cobrar</button>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="text-muted">Subtotal</span><b>{formatColones(subtotal)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="text-muted">Impuesto (13%)</span><div style={{ textAlign: 'right' }}><b>{formatColones(tax)}</b></div></div>
            {discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="text-muted">Descuento ({table.payment})</span><div style={{ textAlign: 'right', color: 'red' }}><b>-{formatColones(discount)}</b></div></div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', marginTop: '0.5rem', borderTop: '2px solid var(--border)', paddingTop: '0.5rem' }}>
              <span>Total {isSplitMode ? '(Parcial)' : ''}</span><b style={{ color: 'var(--primary)' }}>{formatColones(total)}</b>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '10px', marginTop: '1rem', flexDirection: 'column' }}>
             {/* ENVIAR A COCINA (Visible si hay algo nuevo) */}
             {hasNewItems && (
               <button className="btn" style={{ width: '100%', justifyContent: 'center', padding: '12px', background: '#fffbeb', border: '1px solid #f59e0b', color: '#d97706' }} onClick={handleSendToKitchen}>
                 <ChefHat size={18} /> ENVIAR A COCINA
               </button>
             )}
             
             {/* COBRAR (Solo visible para Caja) */}
             {role === 'caja' && (
               <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px' }} onClick={handlePay}>
                 {isSplitMode ? 'COBRAR SELECCIÓN' : 'COBRAR TODO'}
               </button>
             )}
          </div>
        </div>
      </div>

      {/* RIGHT: MENU */}
      <div className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', background: '#f8fafc', opacity: (isSplitMode || showMontoPanel) ? 0.5 : 1, pointerEvents: (isSplitMode || showMontoPanel) ? 'none' : 'auto' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          {cat && !search && <button className="btn btn-outline" onClick={() => setCat(null)}><ChevronLeft size={16} /></button>}
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: 12, color: '#94a3b8' }} />
            <input className="input-search" style={{ paddingLeft: '34px' }} placeholder="Buscar producto..." value={search} onChange={e => { setSearch(e.target.value); setCat(null); }} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!cat && !search ? (
            <div className="category-grid">
              {categories.map(c => (
                <div key={c} className="cat-card" onClick={() => setCat(c)}>
                  <div className="cat-icon">{CATEGORY_ICONS[c] || '🍽️'}</div>
                  <div className="cat-name">{c}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="product-grid">
              {filtered.map(item => (
                <div key={item.id} className="prod-card" onClick={() => addItem(item)}>
                  <div className="prod-name">{item.name}</div>
                  <div className="prod-price">{formatColones(item.price)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CabinsManager({ cabanas, onUpdate, onCheckout, onPrint }) {
  // ... Código idéntico al de Cabañas (se mantiene intacto, no modificado para ahorrar espacio en la vista. Si requieres el código completo de este componente por un problema visual me avisas, pero funciona igual que en la v2.2)
  const [editingId, setEditingId] = useState(null);
  const [tempData, setTempData] = useState({});
  const [payingCabin, setPayingCabin] = useState(null);

  const startEdit = (c) => { setEditingId(c.docId); setTempData(c.info || {}); };
  const saveEdit = (docId, originalInfo) => {
    const montoCambio = Number(originalInfo?.monto || 0) !== Number(tempData.monto || 0);
    const nuevoInfo = montoCambio ? { ...tempData, estadoPago: null } : tempData;
    onUpdate(docId, { info: nuevoInfo, status: 'Ocupada' });
    setEditingId(null);
  };
  const handleChange = (field, val) => setTempData(prev => ({ ...prev, [field]: val }));
  const handlePayCabin = async (method) => {
    if(!payingCabin) return;
    const montoBase = parseFloat(payingCabin.info.monto || 0);
    const impuesto = montoBase * 0.13;
    const descuento = method !== 'Tarjeta' ? impuesto : 0;
    const total = montoBase + impuesto - descuento;

    if(!window.confirm(`¿Confirmar cobro de ${formatColones(total)} (${method}) para ${payingCabin.name}?`)) return;

    const ventaData = {
        fecha_hora: serverTimestamp(), mesaNombre: `HOSPEDAJE - ${payingCabin.name}`,
        items: [{ name: `Alquiler ${payingCabin.name}`, price: montoBase, qty: 1 }],
        subtotal: montoBase, impuesto: impuesto, descuento: descuento, total_final: total, medio_pago: method,
        createdAt: serverTimestamp(), tipo: 'Hospedaje'
    };

    await addDoc(collection(db, 'ventas'), ventaData);
    await onUpdate(payingCabin.docId, { 'info.estadoPago': 'Pagado' });
    onPrint({ ...ventaData, fecha_hora: new Date(), id: 'NUEVA' });
    setPayingCabin(null); alert("Cobro registrado exitosamente.");
  };

  return (
    <div className="card" style={{ padding: '1.5rem', height: '100%', overflowY: 'auto', background: '#f8fafc' }}>
       <h2 style={{ fontSize: '1.2rem', fontWeight: '800', marginBottom: '1.5rem' }}>Gestión de Cabañas</h2>
       {payingCabin && (
           <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100}}>
               <div className="card" style={{padding:'2rem', width:'300px', textAlign:'center'}}>
                   <h3>Cobrar {payingCabin.name}</h3><p className="text-muted">Monto Base: {formatColones(payingCabin.info.monto)}</p>
                   <div style={{display:'grid', gap:'10px', marginTop:'1rem'}}>
                       <button className="btn btn-primary" onClick={() => handlePayCabin('Efectivo')}>💵 Efectivo (Desc IVA)</button>
                       <button className="btn btn-primary" onClick={() => handlePayCabin('SINPE')}>📱 SINPE (Desc IVA)</button>
                       <button className="btn btn-primary" onClick={() => handlePayCabin('Tarjeta')}>💳 Tarjeta (+13% IVA)</button>
                       <button className="btn btn-outline" onClick={() => setPayingCabin(null)} style={{marginTop:'10px'}}>Cancelar</button>
                   </div>
               </div>
           </div>
       )}

       <div className="category-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
         {cabanas.map(c => {
           const isOccupied = c.status === 'Ocupada'; const isEditing = editingId === c.docId; const isPaid = c.info?.estadoPago === 'Pagado';
           return (
             <div key={c.docId} className="card" style={{ padding: '1rem', borderTop: `4px solid ${isOccupied ? (isPaid ? '#22c55e' : '#ef4444') : '#94a3b8'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}><div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{c.name}</div><div className={`badge ${isOccupied ? 'badge-card' : 'badge-cash'}`}>{c.status}</div></div>
                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input className="input-search" placeholder="Huésped" value={tempData.uesped || ''} onChange={e => handleChange('uesped', e.target.value)} />
                    <select className="input-search" value={tempData.origen || ''} onChange={e => handleChange('origen', e.target.value)}><option value="">Origen...</option><option value="Booking">Booking</option><option value="WhatsApp">WhatsApp</option></select>
                    <div style={{display:'flex', gap: 5}}><input type="date" className="input-search" value={tempData.entrada || ''} onChange={e => handleChange('entrada', e.target.value)} /><input type="date" className="input-search" value={tempData.salida || ''} onChange={e => handleChange('salida', e.target.value)} /></div>
                    <input type="number" className="input-search" placeholder="Monto Total" value={tempData.monto || ''} onChange={e => handleChange('monto', e.target.value)} />
                    <div style={{display:'flex', gap:'5px', marginTop:'5px'}}><button className="btn btn-primary" onClick={() => saveEdit(c.docId, c.info)} style={{flex:1}}><Save size={16}/> Guardar</button><button className="btn btn-outline" onClick={() => setEditingId(null)} style={{flex:1}}>Cancelar</button></div>
                  </div>
                ) : (
                  <>{isOccupied ? (
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div>👤 <b>{c.info.uesped}</b> ({c.info.origen})</div><div>📅 {c.info.entrada} al {c.info.salida}</div>
                        <div>💰 {formatColones(c.info.monto)} <span style={{marginLeft:5, fontWeight:'bold', color: isPaid ? 'green' : 'red'}}>({isPaid ? 'PAGADO' : 'PENDIENTE'})</span></div>
                        <div style={{display:'grid', gridTemplateColumns: '1fr 1fr', gap:'5px', marginTop:'1rem'}}>
                           <button className="btn btn-outline" onClick={() => startEdit(c)}><Edit size={14}/> Editar</button>
                           <button className="btn btn-primary" style={{background: '#334155', borderColor:'#334155'}} onClick={() => onCheckout(c)}>Check Out</button>
                           {!isPaid && (<button className="btn btn-primary" style={{gridColumn: 'span 2', justifyContent:'center', marginTop:'5px', background:'#22c55e', borderColor:'#22c55e'}} onClick={() => setPayingCabin(c)}>💸 Cobrar Ahora</button>)}
                        </div>
                      </div>
                    ) : (<div style={{ textAlign: 'center', padding: '1rem 0' }}><div style={{ color: '#cbd5e1', marginBottom: '1rem' }}>Disponible</div><button className="btn btn-primary" style={{width:'100%', justifyContent:'center'}} onClick={() => startEdit(c)}>Registrar Entrada</button></div>)}
                  </>
                )}
             </div>
           )
         })}
       </div>
    </div>
  )
}

function HistoryManager({ history, onPrint }) {
  const getLocalDate = (d) => {
    const date = d || new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [selectedDate, setSelectedDate] = useState(getLocalDate(new Date()));

  const getSafeDate = (date) => {
    if (!date) return new Date();
    if (date.toDate) return date.toDate(); 
    return new Date(date);
  };

  const filteredHistory = history.filter(h => {
    try {
      const dateObj = getSafeDate(h.fecha_hora);
      if (isNaN(dateObj.getTime())) return false; 
      const hDate = getLocalDate(dateObj);
      return hDate === selectedDate;
    } catch (e) { return false; }
  });

  const dayTotal = filteredHistory.reduce((sum, item) => sum + (Number(item.total_final) || 0), 0);
  const totalEfectivo = filteredHistory.filter(h => h.medio_pago === 'Efectivo').reduce((s, h) => s + (Number(h.total_final) || 0), 0);
  const totalSinpe = filteredHistory.filter(h => h.medio_pago === 'SINPE').reduce((s, h) => s + (Number(h.total_final) || 0), 0);
  const totalTarjeta = filteredHistory.filter(h => h.medio_pago === 'Tarjeta').reduce((s, h) => s + (Number(h.total_final) || 0), 0);
  const totalVendido = dayTotal;

  const downloadDailyReport = () => {
    if (filteredHistory.length === 0) return alert("No hay ventas en la fecha seleccionada.");
    const stats = { Efectivo: 0, SINPE: 0, Tarjeta: 0, Otro: 0 };
    filteredHistory.forEach(h => {
        const metodo = h.medio_pago || 'Otro';
        const monto = Number(h.total_final) || 0;
        if(stats[metodo] !== undefined) stats[metodo] += monto;
        else stats['Otro'] += monto;
    });

    let csv = "REPORTE DIARIO DE VENTAS\n";
    csv += `Fecha,${selectedDate}\nGenerado el,${new Date().toLocaleString()}\nTotal Operaciones,${filteredHistory.length}\nMONTO TOTAL DEL DIA,${dayTotal}\n\n`;
    csv += "DESGLOSE POR METODO DE PAGO\n";
    csv += `Efectivo,${stats.Efectivo}\nSINPE,${stats.SINPE}\nTarjeta,${stats.Tarjeta}\n\n`;
    csv += "========================================\n\nDETALLE DE OPERACIONES\n";

    filteredHistory.forEach((sale, index) => {
      const time = getSafeDate(sale.fecha_hora).toLocaleTimeString();
      csv += `VENTA #${index + 1} | Hora: ${time} | ${sale.mesaNombre}\nMetodo Pago: ${sale.medio_pago}\nProducto,Cantidad,Precio Unit,Subtotal\n`;
      const grouped = {};
      (sale.items || []).forEach(i => {
        const key = `${i.name}-${i.price}`;
        if (!grouped[key]) grouped[key] = { name: i.name, price: i.price, qty: 0 };
        grouped[key].qty += (i.qty || 1); 
      });
      Object.values(grouped).forEach(item => {
        csv += `"${item.name}",${item.qty},${item.price},${item.price * item.qty}\n`;
      });
      csv += `,,,Total Venta: ${sale.total_final}\n----------------------------------------\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Reporte_Diario_${selectedDate}.csv`;
    link.click();
  };

  const downloadSingleInvoice = (saleData) => {
    let csvContent = "data:text/csv;charset=utf-8,Empresa,Canto del Bosque\nFecha," + getSafeDate(saleData.fecha_hora).toLocaleString() + "\nMesa," + saleData.mesaNombre + "\nPago," + saleData.medio_pago + "\n\nProducto,Cantidad,Precio,Subtotal\n";
    const grouped = {};
    saleData.items.forEach(i => {
      const key = `${i.name}-${i.price}`;
      if (!grouped[key]) grouped[key] = { name: i.name, price: i.price, qty: 0 };
      grouped[key].qty += (i.qty || 1);
    });
    Object.values(grouped).forEach(item => { csvContent += `"${item.name}",${item.qty},${item.price},${item.price * item.qty}\n`; });
    csvContent += `\n,,TOTAL,${saleData.total_final}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.href = encodedUri;
    link.download = `Factura_${saleData.mesaNombre}_${getSafeDate(saleData.fecha_hora).getTime()}.csv`;
    link.click();
  };

  return (
    <div className="card" style={{ padding: '1rem', height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{fontSize:'1.2rem', fontWeight:'800', margin:0}}>Historial de Ventas</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input type="date" className="input-search" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{paddingRight: '10px'}} />
          <button className="btn btn-primary" onClick={downloadDailyReport} title="Descargar reporte completo de este día"><Archive size={18} /> Descargar Día</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ padding: '1rem', flex: 1, background: '#f1f5f9', borderRadius: '8px', border: '1px solid #e2e8f0', minWidth: '120px' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Total Vendido</div><div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formatColones(totalVendido)}</div>
        </div>
        <div style={{ padding: '1rem', flex: 1, background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #15803d', minWidth: '120px' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Efectivo</div><div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formatColones(totalEfectivo)}</div>
        </div>
        <div style={{ padding: '1rem', flex: 1, background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #3b82f6', minWidth: '120px' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>SINPE</div><div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formatColones(totalSinpe)}</div>
        </div>
        <div style={{ padding: '1rem', flex: 1, background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #f59e0b', minWidth: '120px' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Tarjeta</div><div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formatColones(totalTarjeta)}</div>
        </div>
      </div>
      
      <div className="table-responsive" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '8px' }}>
        <table className="history-table">
          <thead><tr style={{background: '#f8fafc'}}><th>Hora</th><th>Mesa/Origen</th><th>Items</th><th>Total</th><th style={{textAlign:'center'}}>Acciones</th></tr></thead>
          <tbody>
            {filteredHistory.length === 0 ? (
              <tr><td colSpan="5" style={{textAlign:'center', padding:'2rem', color:'#94a3b8'}}>No hay ventas registradas para el <b>{selectedDate}</b></td></tr>
            ) : (
              filteredHistory.map(h => (
                <tr key={h.id}>
                  <td>{getSafeDate(h.fecha_hora).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                  <td><div style={{fontWeight:'bold'}}>{h.mesaNombre}</div><div className={`badge ${h.medio_pago === 'Tarjeta' ? 'badge-card' : 'badge-cash'}`} style={{fontSize:'0.7rem', display:'inline-block', marginTop:'2px'}}>{h.medio_pago}</div></td>
                  <td style={{fontSize:'0.85rem', maxWidth:'200px', color:'var(--text-muted)'}}>{(h.items || []).length} items</td>
                  <td style={{ fontWeight: 'bold' }}>{formatColones(h.total_final)}</td>
                  <td style={{ textAlign: 'center', display: 'flex', gap: '5px', justifyContent: 'center' }}>
                    <button className="btn-icon" onClick={() => downloadSingleInvoice(h)} title="Descargar CSV"><FileText size={18} /></button>
                    <button className="btn-icon" onClick={() => onPrint(h)} title="Imprimir Ticket"><Printer size={18} /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsManager() {
  const getCurrentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [ventasMes, setVentasMes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rankBy, setRankBy] = useState('monto');

  useEffect(() => {
    setLoading(true); setError(null);
    const [year, month] = selectedMonth.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1); 

    const q = query(collection(db, 'ventas'), where('fecha_hora', '>=', start), where('fecha_hora', '<', end), orderBy('fecha_hora', 'asc'));

    const unsub = onSnapshot(q,
      (snap) => { setVentasMes(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error(err); setError('Error al cargar reportes.'); setLoading(false); }
    );
    return () => unsub();
  }, [selectedMonth]);

  const getSafeDate = (date) => { if (!date) return new Date(); if (date.toDate) return date.toDate(); return new Date(date); };
  const totalVendido = ventasMes.reduce((s, v) => s + (Number(v.total_final) || 0), 0);
  const totalTransacciones = ventasMes.length;
  const ticketPromedio = totalTransacciones > 0 ? totalVendido / totalTransacciones : 0;
  const porMetodo = { Efectivo: 0, SINPE: 0, Tarjeta: 0 };
  ventasMes.forEach(v => { const m = v.medio_pago; if (porMetodo[m] !== undefined) porMetodo[m] += Number(v.total_final) || 0; });
  const [reportYear, reportMonth] = selectedMonth.split('-').map(Number);
  const diasEnMes = new Date(reportYear, reportMonth, 0).getDate();
  const porDia = Array.from({ length: diasEnMes }, (_, i) => ({ dia: i + 1, total: 0 }));
  ventasMes.forEach(v => { const dayIdx = getSafeDate(v.fecha_hora).getDate() - 1; if (porDia[dayIdx]) porDia[dayIdx].total += Number(v.total_final) || 0; });
  const maxDia = Math.max(1, ...porDia.map(d => d.total));
  const productosMap = {};
  ventasMes.forEach(v => { (v.items || []).forEach(item => { const key = item.name; if (!productosMap[key]) productosMap[key] = { name: item.name, qty: 0, monto: 0 }; const qty = item.qty || 1; productosMap[key].qty += qty; productosMap[key].monto += (Number(item.price) || 0) * qty; }); });
  const topProductos = Object.values(productosMap).sort((a, b) => rankBy === 'monto' ? b.monto - a.monto : b.qty - a.qty).slice(0, 10);
  const maxProducto = Math.max(1, ...topProductos.map(p => rankBy === 'monto' ? p.monto : p.qty));
  const nombreMes = new Date(reportYear, reportMonth - 1, 1).toLocaleDateString('es-CR', { month: 'long', year: 'numeric' });

  return (
    <div className="card" style={{ padding: '1.5rem', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0, textTransform: 'capitalize' }}>Reportes — {nombreMes}</h2>
        <input type="month" className="input-search" style={{ width: 'auto' }} value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
      </div>
      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>{error}</div>}
      {loading ? <div className="text-muted" style={{ textAlign: 'center', padding: '3rem' }}>Cargando reportes...</div> : totalTransacciones === 0 ? <div className="text-muted" style={{ textAlign: 'center', padding: '3rem' }}>No hay ventas registradas en {nombreMes}.</div> : (
        <>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ padding: '1rem', flex: 1, background: 'var(--accent)', borderRadius: '8px', minWidth: '140px' }}><div style={{ fontSize: '0.85rem', color: 'var(--primary)' }}>Total del mes</div><div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--primary)' }}>{formatColones(totalVendido)}</div></div>
            <div style={{ padding: '1rem', flex: 1, background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border)', minWidth: '140px' }}><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Transacciones</div><div style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>{totalTransacciones}</div></div>
            <div style={{ padding: '1rem', flex: 1, background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border)', minWidth: '140px' }}><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Ticket promedio</div><div style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>{formatColones(ticketPromedio)}</div></div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
            <div style={{ padding: '1rem', flex: 1, background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #15803d', minWidth: '140px' }}><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Efectivo</div><div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{formatColones(porMetodo.Efectivo)}</div></div>
            <div style={{ padding: '1rem', flex: 1, background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #a16207', minWidth: '140px' }}><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>SINPE</div><div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{formatColones(porMetodo.SINPE)}</div></div>
            <div style={{ padding: '1rem', flex: 1, background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #3b82f6', minWidth: '140px' }}><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Tarjeta</div><div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{formatColones(porMetodo.Tarjeta)}</div></div>
          </div>
          <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.75rem' }}>Ventas por día</h3>
          <div className="report-daychart">{porDia.map(d => (<div key={d.dia} className="report-daybar" title={`Día ${d.dia}: ${formatColones(d.total)}`}><div className="report-daybar-fill" style={{ height: `${(d.total / maxDia) * 100}%` }} /><span className="report-daybar-label">{d.dia}</span></div>))}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700', margin: 0 }}>Productos más vendidos</h3>
            <div className="payment-selector" style={{ width: 'auto', marginBottom: 0 }}>
              <button className={`payment-btn ${rankBy === 'monto' ? 'active' : ''}`} onClick={() => setRankBy('monto')}>Por monto</button>
              <button className={`payment-btn ${rankBy === 'cantidad' ? 'active' : ''}`} onClick={() => setRankBy('cantidad')}>Por cantidad</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {topProductos.map(p => {
              const valor = rankBy === 'monto' ? p.monto : p.qty;
              return (<div key={p.name} className="report-product-row"><div className="report-product-label"><span>{p.name}</span><span className="text-muted">{p.qty} uds · {formatColones(p.monto)}</span></div><div className="report-product-bar"><div className="report-product-bar-fill" style={{ width: `${(valor / maxProducto) * 100}%` }} /></div></div>);
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MenuManager({ menu, onAdd, onUpdate, onDelete, onBack }) {
  const [categoria, setCategoria] = React.useState(null);
  const [nombre, setNombre] = React.useState('');
  const [precio, setPrecio] = React.useState('');
  const [mostrarForm, setMostrarForm] = React.useState(false);
  const [nuevaCategoria, setNuevaCategoria] = React.useState('');

  const categorias = [...new Set(menu.map(m => m.category || 'Sin categoría'))];
  const itemsFiltrados = categoria ? menu.filter(m => (m.category || 'Sin categoría') === categoria) : menu;

  return (
    <div className="card" style={{ padding: 16, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2>Gestión de Menú</h2><button className="btn btn-outline" onClick={onBack}>← Volver</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={() => setCategoria(null)}>Todas</button>
        {categorias.map(cat => (<button key={cat} className="btn btn-outline" onClick={() => setCategoria(cat)}>{cat}</button>))}
      </div>
      <button className="btn btn-primary" onClick={() => setMostrarForm(!mostrarForm)} style={{ marginBottom: 12 }}>{mostrarForm ? 'Cancelar' : 'Añadir producto'}</button>
      {mostrarForm && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="input-search" placeholder="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} style={{ flex: '1 1 150px' }} />
          <input className="input-search" placeholder="Precio" type="number" value={precio} onChange={e => setPrecio(e.target.value)} style={{ flex: '1 1 100px' }} />
          <input className="input-search" placeholder="Categoría nueva" value={nuevaCategoria} onChange={e => setNuevaCategoria(e.target.value)} style={{ flex: '1 1 150px' }} />
          <button className="btn btn-primary" onClick={() => {
              const categoriaFinal = nuevaCategoria.trim() || categoria;
              if (!categoriaFinal || !nombre.trim() || !precio) return alert('Datos inválidos');
              onAdd(categoriaFinal, nombre.trim(), precio);
              setNombre(''); setPrecio(''); setNuevaCategoria(''); setMostrarForm(false);
            }}>Guardar</button>
        </div>
      )}
      <div style={{ overflowY: 'auto', maxHeight: '60vh' }}>
        {itemsFiltrados.map(item => (
          <div key={item.docId} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ddd', padding: 8 }}>
            <div><strong>{item.name}</strong><div style={{ fontSize: 12 }}>{item.category} · ₡{item.price}</div></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-outline" onClick={async () => {
                  try {
                    const nuevoNombre = prompt('Nombre', item.name); if (nuevoNombre === null) return; 
                    const nuevoPrecioRaw = prompt('Precio', item.price); if (nuevoPrecioRaw === null) return;
                    await onUpdate(item.docId, { name: nuevoNombre.trim(), price: Number(nuevoPrecioRaw), category: item.category });
                  } catch (err) { alert('Error: ' + err.message); }
                }}>Editar</button>
              <button className="btn btn-danger" onClick={() => onDelete(item.docId)}>X</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NavBtn({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '8px', background: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--primary)' : 'var(--text-muted)', border: 'none', cursor: 'pointer', fontWeight: '600', alignItems: 'center' }}>
      {icon} {label}
    </button>
  );
}
