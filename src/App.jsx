import React, { useState, useEffect, useRef } from 'react';
import {
  Utensils, Coffee, Archive, ChevronLeft, Trash2, ArrowLeft, Plus, Minus, 
  Search, XCircle, Tent, Edit, Users, FileText, CheckCircle, Save, Printer
} from 'lucide-react';

import { db } from './firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy,
  serverTimestamp, runTransaction, getDocs, writeBatch, deleteDoc, setDoc, getDoc
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
  const [view, setView] = useState('tables'); // tables | cabanas | pos | history | menu
  const [menu, setMenu] = useState([]);
  const [tables, setTables] = useState([]);
  const [history, setHistory] = useState([]);
  const [cabanas, setCabanas] = useState([]); 
  const [selectedTableId, setSelectedTableId] = useState(null);
  
  // Estado para impresión
  const [ticketData, setTicketData] = useState(null);

  useEffect(() => {
    // 1. MENU
    const unsubMenu = onSnapshot(query(collection(db, 'menu'), orderBy('createdAt', 'asc')), (snap) => {
        const docs = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
        setMenu(docs);
      });

    // 2. MESAS
    const unsubMesas = onSnapshot(query(collection(db, 'mesas'), orderBy('createdAt', 'asc')), (snap) => {
      setTables(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    // 3. HISTORIAL
    const unsubVentas = onSnapshot(query(collection(db, 'ventas'), orderBy('fecha_hora', 'desc')), (snap) => {
       setHistory(snap.docs.slice(0, 50).map(d => ({id: d.id, ...d.data()})));
    });

    // 4. CABAÑAS
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

  // --- FUNCION IMPRIMIR ---
  const handlePrint = (data) => {
    setTicketData(data);
    setTimeout(() => {
        window.print();
    }, 300);
  };

  // --- CRUD MENU ---
  const addMenuItem = async (category, name, price) => {
    try {
      const ref = await addDoc(collection(db, 'menu'), {
        name, category, price: Number(price), createdAt: serverTimestamp()
      });
      await setDoc(doc(db, 'menu', ref.id), { id: ref.id }, { merge: true });
      alert('Producto agregado correctamente');
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
    try {
      await deleteDoc(doc(db, 'menu', docId));
      alert('Producto eliminado');
    } catch (e) { alert('Error: ' + e.message); }
  };

  // --- HANDLERS MESAS ---
  const handleCreateTable = async (name) => {
    if (!name) return;
    await addDoc(collection(db, 'mesas'), {
      name, status: 'free', items: [], payment: 'Efectivo', createdAt: serverTimestamp(),
    });
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
    if(newName && newName !== currentName) {
      await updateDoc(doc(db, 'mesas', tableId), { name: newName });
    }
  };

  const handleDeleteTable = async (table) => {
    if ((table.items || []).length > 0) return alert('La mesa tiene pedidos activos.');
    if (!window.confirm(`¿Eliminar ${table.name}?`)) return;
    await deleteDoc(doc(db, 'mesas', table.id));
  };

  // --- COBRO (MESA Y SPLIT) ---
  const handleCloseOrder = async (tableData, itemsToPay = null, paymentMethod = 'Efectivo') => {
    const tableRef = doc(db, 'mesas', tableData.id);
    const ventasColl = collection(db, 'ventas');
    const isPartial = itemsToPay !== null;
    const finalItems = isPartial ? itemsToPay : (tableData.items || []);
    
    if(finalItems.length === 0) return alert("No hay items para cobrar");

    try {
      // Preparamos datos para guardar e imprimir
      const subtotal = finalItems.reduce((s, it) => s + (Number(it.price) || 0), 0);
      const impuesto = paymentMethod === 'Tarjeta' ? subtotal * 0.13 : 0;
      const total = subtotal + impuesto;
      
      const ventaData = {
        fecha_hora: serverTimestamp(),
        mesaId: tableData.id, 
        mesaNombre: tableData.name + (isPartial ? ' (Parcial)' : ''),
        items: finalItems, 
        subtotal, 
        impuesto_tarjeta: impuesto,
        total_final: total, 
        medio_pago: paymentMethod,
        createdAt: serverTimestamp(),
        tipo: isPartial ? 'Parcial' : 'Completa'
      };

      await runTransaction(db, async (transaction) => {
        const tSnap = await transaction.get(tableRef);
        if (!tSnap.exists()) throw new Error('Mesa no existe');
        
        const currentTable = tSnap.data();
        const allItems = currentTable.items || [];

        const newVentaRef = doc(ventasColl);
        transaction.set(newVentaRef, ventaData);

        // Actualizar estado pago Cabaña si corresponde
        finalItems.forEach(item => {
            if (item.linkedCabinId) {
                const cabinRef = doc(db, 'cabanas', item.linkedCabinId);
                transaction.update(cabinRef, { 'info.estadoPago': 'Pagado' });
            }
        });

        // Actualizar Mesa
        if (isPartial) {
          const idsToPay = finalItems.map(i => i.instanceId);
          const remainingItems = allItems.filter(i => !idsToPay.includes(i.instanceId));
          transaction.update(tableRef, {
            items: remainingItems,
            status: remainingItems.length > 0 ? 'occupied' : 'free',
            ultima_actualizacion: serverTimestamp(),
          });
        } else {
          transaction.update(tableRef, {
            items: [], status: 'free', payment: 'Efectivo', ultima_actualizacion: serverTimestamp(),
          });
        }
      });
      
      // Imprimir Ticket Automáticamente (Usamos new Date porque serverTimestamp es asíncrono)
      handlePrint({ ...ventaData, fecha_hora: new Date(), id: 'NUEVA' });

      if(!isPartial) {
        setView('tables'); 
        setSelectedTableId(null);
      } else {
        alert("Cobro parcial realizado con éxito");
      }
    } catch (e) { alert('Error: ' + e.message); }
  };
  
  // --- HANDLERS CABAÑAS ---
  const handleUpdateCabana = async (docId, newData) => {
    await updateDoc(doc(db, 'cabanas', docId), newData);
  };

  const handleCheckoutCabana = async (cabana) => {
    if(!window.confirm(`¿Finalizar alquiler de ${cabana.name}?`)) return;
    await updateDoc(doc(db, 'cabanas', cabana.docId), { status: 'Libre', info: {} });
  };

  // Pasar funcion de imprimir a cabañas también
  const onPrintCabana = (venta) => handlePrint(venta);

  return (
    <div className="app-container">
      <header className="top-bar">
        <div className="flex-center" style={{ gap: '1rem' }}>
          {LOGO_URL ? <img src={LOGO_URL} alt="Logo" style={{ height: '40px' }} /> : <Utensils className="text-muted" />}
          <div>
            <h1 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--primary)', fontWeight: 800 }}>Canto del Bosque</h1>
            <div className="flex-center" style={{ gap: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: '50%' }}></span> Sistema POS v2.1
            </div>
          </div>
        </div>

        <div className="flex-center" style={{ gap: '0.5rem' }}>
          <NavBtn icon={<Coffee size={18} />} label="Mesas" active={view === 'tables' || view === 'pos'} onClick={() => setView('tables')} />
          <NavBtn icon={<Tent size={18} />} label="Cabañas" active={view === 'cabanas'} onClick={() => setView('cabanas')} />
          <NavBtn icon={<Archive size={18} />} label="Historial" active={view === 'history'} onClick={() => setView('history')} />
          <NavBtn icon={<FileText size={18} />} label="Menú" active={view === 'menu'} onClick={() => setView('menu')} />
        </div>
      </header>

      <main className="main-area">
        {view === 'tables' && (
          <TablesManager tables={tables} onCreate={handleCreateTable} onOpen={(id) => { setSelectedTableId(id); setView('pos'); }} onDelete={handleDeleteTable} onRename={handleRenameTable} />
        )}
        {view === 'pos' && activeTable && (
          <POSInterface table={activeTable} menu={menu} cabanas={cabanas} onUpdateTable={handleUpdateTable} onCloseOrder={handleCloseOrder} onBack={() => setView('tables')} />
        )}
        {view === 'cabanas' && (
          <CabinsManager cabanas={cabanas} onUpdate={handleUpdateCabana} onCheckout={handleCheckoutCabana} onPrint={onPrintCabana} />
        )}
        {view === 'history' && <HistoryManager history={history} onPrint={handlePrint} />}
        
        {view === 'menu' && ( 
          <MenuManager menu={menu} onAdd={addMenuItem} onUpdate={updateMenuItem} onDelete={deleteMenuItem} onBack={() => setView('tables')} />
        )}
      </main>
      
      {/* COMPONENTE DE TICKET (OCULTO EN PANTALLA, VISIBLE AL IMPRIMIR) */}
      <PrintableTicket data={ticketData} />
    </div>
  );
}

// --- COMPONENTES ---

function PrintableTicket({ data }) {
  if (!data) return null;

  const { mesaNombre, fecha_hora, items, subtotal, impuesto_tarjeta, total_final, medio_pago, id } = data;
  
  // Manejo seguro de fechas (Firebase timestamp vs JS Date)
  const dateObj = fecha_hora?.toDate ? fecha_hora.toDate() : new Date(fecha_hora || Date.now());
  const fechaStr = dateObj.toLocaleDateString('es-CR');
  const horaStr = dateObj.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div id="printable-receipt">
      <div className="ticket-header">
        <h2 style={{ margin: 0, fontSize: '16px' }}>Canto del Bosque</h2>
        <div>Tel: 8633-9009</div>
        <div>Costa Rica</div>
      </div>
      
      <div className="ticket-divider"></div>
      
      <div style={{display:'flex', justifyContent:'space-between'}}>
         <span>Fecha: {fechaStr}</span>
         <span>Hora: {horaStr}</span>
      </div>
      <div>Cliente: {mesaNombre}</div>
      <div>Factura #: {id ? id.slice(-6).toUpperCase() : '---'}</div>
      
      <div className="ticket-divider"></div>

      <div className="ticket-row" style={{ fontWeight: 'bold' }}>
        <span style={{flex: 1}}>Cant. Desc</span>
        <span>Total</span>
      </div>

      {items.map((item, idx) => (
        <div key={idx} style={{ marginBottom: '4px' }}>
          <div>{item.name}</div>
          <div className="ticket-row">
            <span>{item.qty || 1} x {formatColones(item.price)}</span>
            <span>{formatColones((item.price * (item.qty || 1)))}</span>
          </div>
        </div>
      ))}

      <div className="ticket-divider"></div>

      <div className="ticket-row">
        <span>Subtotal:</span>
        <span>{formatColones(subtotal)}</span>
      </div>
      
      {impuesto_tarjeta > 0 && (
        <div className="ticket-row">
          <span>IVA (13%):</span>
          <span>{formatColones(impuesto_tarjeta)}</span>
        </div>
      )}

      <div className="ticket-row" style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '5px' }}>
        <span>TOTAL:</span>
        <span>{formatColones(total_final)}</span>
      </div>
      
      <div style={{textAlign:'right', fontSize:'11px', marginTop:'5px'}}>
        Pago: {medio_pago}
      </div>

      <div className="ticket-footer">
        <p>¡Gracias por su visita!</p>
      </div>
    </div>
  );
}

function TablesManager({ tables, onCreate, onOpen, onDelete, onRename }) {
  const [name, setName] = useState('');
  return (
    <div className="card" style={{ padding: '1.5rem', height: '100%', overflowY: 'auto' }}>
      <div className="controls-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0 }}>Restaurante</h2>
        <div className="input-group" style={{ display: 'flex', gap: '0.5rem' }}>
          <input className="input-search" style={{width: '200px'}} placeholder="Nueva Mesa..." value={name} onChange={e => setName(e.target.value)} />
          <button className="btn btn-primary" onClick={() => { onCreate(name); setName(''); }}><Plus size={18} /> Crear</button>
        </div>
      </div>

      <div className="category-grid">
        {tables.map(t => {
          const total = (t.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
          return (
            <div key={t.id} className="cat-card" style={{ position: 'relative', alignItems: 'flex-start', padding: '1.5rem', borderColor: t.status === 'occupied' ? 'var(--primary)' : 'var(--border)' }} onClick={() => onOpen(t.id)}>
              <div style={{position: 'absolute', top: 5, right: 5, display: 'flex', gap: '4px'}}>
                 <button onClick={(e) => { e.stopPropagation(); onRename(t.id, t.name); }} className="btn-icon-mini text-muted">
                  <Edit size={14} />
                </button>
                {(t.items || []).length === 0 && (
                  <button onClick={(e) => { e.stopPropagation(); onDelete(t); }} className="btn-icon-mini" style={{color: '#ef4444'}}>
                    <XCircle size={14} />
                  </button>
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

function CabinsManager({ cabanas, onUpdate, onCheckout, onPrint }) {
  const [editingId, setEditingId] = useState(null);
  const [tempData, setTempData] = useState({});
  const [payingCabin, setPayingCabin] = useState(null);

  const startEdit = (c) => {
    setEditingId(c.docId);
    setTempData(c.info || {});
  };

  const saveEdit = (docId) => {
    onUpdate(docId, { 
      info: tempData,
      status: 'Ocupada' 
    });
    setEditingId(null);
  };

  const handleChange = (field, val) => {
    setTempData(prev => ({ ...prev, [field]: val }));
  };

  const handlePayCabin = async (method) => {
    if(!payingCabin) return;
    const montoBase = parseFloat(payingCabin.info.monto || 0);
    const impuesto = method === 'Tarjeta' ? montoBase * 0.13 : 0;
    const total = montoBase + impuesto;

    if(!window.confirm(`¿Confirmar cobro de ${formatColones(total)} (${method}) para ${payingCabin.name}?`)) return;

    const ventaData = {
        fecha_hora: serverTimestamp(),
        mesaNombre: `HOSPEDAJE - ${payingCabin.name}`,
        items: [{ name: `Alquiler ${payingCabin.name}`, price: montoBase, qty: 1 }],
        subtotal: montoBase,
        impuesto_tarjeta: impuesto,
        total_final: total,
        medio_pago: method,
        createdAt: serverTimestamp(),
        tipo: 'Hospedaje'
    };

    await addDoc(collection(db, 'ventas'), ventaData);
    await onUpdate(payingCabin.docId, { 'info.estadoPago': 'Pagado' });
    
    // Imprimir
    onPrint({ ...ventaData, fecha_hora: new Date(), id: 'NUEVA' });

    setPayingCabin(null);
    alert("Cobro registrado exitosamente.");
  };

  return (
    <div className="card" style={{ padding: '1.5rem', height: '100%', overflowY: 'auto', background: '#f8fafc' }}>
       <h2 style={{ fontSize: '1.2rem', fontWeight: '800', marginBottom: '1.5rem' }}>Gestión de Cabañas</h2>
       
       {payingCabin && (
           <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100}}>
               <div className="card" style={{padding:'2rem', width:'300px', textAlign:'center'}}>
                   <h3>Cobrar {payingCabin.name}</h3>
                   <p className="text-muted">Monto Base: {formatColones(payingCabin.info.monto)}</p>
                   <div style={{display:'grid', gap:'10px', marginTop:'1rem'}}>
                       <button className="btn btn-primary" onClick={() => handlePayCabin('Efectivo')}>💵 Efectivo (Sin IVA)</button>
                       <button className="btn btn-primary" onClick={() => handlePayCabin('SINPE')}>📱 SINPE (Sin IVA)</button>
                       <button className="btn btn-primary" onClick={() => handlePayCabin('Tarjeta')}>💳 Tarjeta (+13% IVA)</button>
                       <button className="btn btn-outline" onClick={() => setPayingCabin(null)} style={{marginTop:'10px'}}>Cancelar</button>
                   </div>
               </div>
           </div>
       )}

       <div className="category-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
         {cabanas.map(c => {
           const isOccupied = c.status === 'Ocupada';
           const isEditing = editingId === c.docId;
           const isPaid = c.info?.estadoPago === 'Pagado';

           return (
             <div key={c.docId} className="card" style={{ padding: '1rem', borderTop: `4px solid ${isOccupied ? (isPaid ? '#22c55e' : '#ef4444') : '#94a3b8'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{c.name}</div>
                  <div className={`badge ${isOccupied ? 'badge-card' : 'badge-cash'}`}>{c.status}</div>
                </div>

                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input className="input-search" placeholder="Huésped" value={tempData.uesped || ''} onChange={e => handleChange('uesped', e.target.value)} />
                    <select className="input-search" value={tempData.origen || ''} onChange={e => handleChange('origen', e.target.value)}>
                      <option value="">Origen...</option>
                      <option value="Booking">Booking</option>
                      <option value="WhatsApp">WhatsApp</option>
                    </select>
                    <div style={{display:'flex', gap: 5}}>
                      <input type="date" className="input-search" value={tempData.entrada || ''} onChange={e => handleChange('entrada', e.target.value)} />
                      <input type="date" className="input-search" value={tempData.salida || ''} onChange={e => handleChange('salida', e.target.value)} />
                    </div>
                    <input type="number" className="input-search" placeholder="Monto Total" value={tempData.monto || ''} onChange={e => handleChange('monto', e.target.value)} />
                    <div style={{display:'flex', gap:'5px', marginTop:'5px'}}>
                      <button className="btn btn-primary" onClick={() => saveEdit(c.docId)} style={{flex:1}}><Save size={16}/> Guardar</button>
                      <button className="btn btn-outline" onClick={() => setEditingId(null)} style={{flex:1}}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {isOccupied ? (
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div>👤 <b>{c.info.uesped}</b> ({c.info.origen})</div>
                        <div>📅 {c.info.entrada} al {c.info.salida}</div>
                        <div>💰 {formatColones(c.info.monto)} 
                          <span style={{marginLeft:5, fontWeight:'bold', color: isPaid ? 'green' : 'red'}}>
                             ({isPaid ? 'PAGADO' : 'PENDIENTE'})
                          </span>
                        </div>
                        <div style={{display:'grid', gridTemplateColumns: '1fr 1fr', gap:'5px', marginTop:'1rem'}}>
                           <button className="btn btn-outline" onClick={() => startEdit(c)}><Edit size={14}/> Editar</button>
                           <button className="btn btn-primary" style={{background: '#334155', borderColor:'#334155'}} onClick={() => onCheckout(c)}>Check Out</button>
                           {!isPaid && (
                               <button className="btn btn-primary" style={{gridColumn: 'span 2', justifyContent:'center', marginTop:'5px', background:'#22c55e', borderColor:'#22c55e'}} onClick={() => setPayingCabin(c)}>
                                   💸 Cobrar Ahora
                               </button>
                           )}
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                        <div style={{ color: '#cbd5e1', marginBottom: '1rem' }}>Disponible para reservar</div>
                        <button className="btn btn-primary" style={{width:'100%', justifyContent:'center'}} onClick={() => startEdit(c)}>Registrar Entrada</button>
                      </div>
                    )}
                  </>
                )}
             </div>
           )
         })}
       </div>
    </div>
  )
}

function POSInterface({ table, menu, cabanas, onUpdateTable, onCloseOrder, onBack }) {
  const [cat, setCat] = useState(null);
  const [search, setSearch] = useState('');
  const [showCabinSelector, setShowCabinSelector] = useState(false); 
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [selectedForSplit, setSelectedForSplit] = useState([]); 

  const categories = [...new Set(menu.map(i => i.category))];
  
  const grouped = {};
  (table.items || []).forEach(i => {
    const key = `${i.id}-${i.price}`;
    if(!grouped[key]) grouped[key] = { ...i, qty: 0, ids: [] };
    grouped[key].qty++;
    grouped[key].ids.push(i.instanceId);
  });
  const cartItems = Object.values(grouped);

  const itemsToCalc = isSplitMode 
    ? (table.items || []).filter(i => selectedForSplit.includes(i.instanceId))
    : (table.items || []);

  const subtotal = itemsToCalc.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const tax = table.payment === 'Tarjeta' ? subtotal * 0.13 : 0;
  const total = subtotal + tax;

  const filtered = search 
    ? menu.filter(i => i.name.toLowerCase().includes(search.toLowerCase())) 
    : cat ? menu.filter(i => i.category === cat) : [];

  const handleAddCabinToOrder = (cabin) => {
      const amount = parseFloat(cabin.info.monto || 0);
      const newItem = { 
          id: `cabin-${cabin.docId}`,
          name: `Hospedaje: ${cabin.name} (${cabin.info.uesped})`, 
          category: 'Hospedaje', 
          price: amount,
          qty: 1,
          instanceId: Date.now().toString(),
          linkedCabinId: cabin.docId 
      };
      onUpdateTable({ ...table, items: [...(table.items || []), newItem] });
      setShowCabinSelector(false);
  };

  const pendingCabins = (cabanas || []).filter(c => c.status === 'Ocupada' && c.info?.estadoPago !== 'Pagado');

  const addItem = (item) => {
    if(isSplitMode) return alert("Sal del modo Dividir para agregar items");
    let price = Number(item.price);
    if(price === 0) {
      const p = prompt('Precio:');
      if(!p) return;
      price = parseFloat(p) || 0;
    }
    const newItem = { ...item, price, instanceId: Date.now() + Math.random().toString() };
    onUpdateTable({ ...table, items: [...(table.items || []), newItem] });
  };

  const increaseQty = (groupItem) => {
    if(isSplitMode) return;
    const newItem = { ...groupItem, instanceId: Date.now() + Math.random().toString(), qty: 1, ids: [] }; 
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

  const toggleSplitSelection = (instanceId) => {
    if(selectedForSplit.includes(instanceId)) {
      setSelectedForSplit(prev => prev.filter(id => id !== instanceId));
    } else {
      setSelectedForSplit(prev => [...prev, instanceId]);
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
      if(nextId) toggleSplitSelection(nextId);
    }
  };

  const handlePay = () => {
    if (isSplitMode) {
      if(selectedForSplit.length === 0) return alert("Selecciona productos para cobrar");
      if(!window.confirm(`¿Cobrar ₡${formatColones(total)} a la subcuenta actual?`)) return;
      onCloseOrder(table, itemsToCalc, table.payment); 
      setSelectedForSplit([]); 
    } else {
      if(!window.confirm('¿Cerrar cuenta completa?')) return;
      onCloseOrder(table, null, table.payment); 
    }
  };

  return (
    <div className="pos-layout">
      {/* LEFT: ORDER */}
      <div className="card order-panel">
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
             <button className="btn-icon" onClick={onBack}><ArrowLeft size={20} /></button>
             <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: 0 }}>{table.name}</h2>
          </div>
          <button 
            className={`btn ${isSplitMode ? 'btn-primary' : 'btn-outline'}`} 
            onClick={() => { setIsSplitMode(!isSplitMode); setSelectedForSplit([]); }}
            title="Dividir Cuenta"
          >
            <Users size={16} /> {isSplitMode ? 'Cancelar División' : 'Dividir Cuenta'}
          </button>
        </div>

        <div className="order-items">
           {isSplitMode && <div style={{background:'#e0f2fe', padding:'5px', fontSize:'0.8rem', textAlign:'center', color:'#0369a1'}}>Selecciona los productos que paga esta persona</div>}
          
          {cartItems.map(item => {
            const qtySelected = item.ids.filter(id => selectedForSplit.includes(id)).length;
            const isFullySelected = qtySelected === item.qty && item.qty > 0;
            const isPartiallySelected = qtySelected > 0 && !isFullySelected;

            return (
            <div key={`${item.id}-${item.price}`} 
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
                    <div className="qty-badge" style={{background: qtySelected > 0 ? 'var(--primary)' : '#cbd5e1'}}>
                       {qtySelected} / {item.qty}
                    </div>
                )}

                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                  <div className="text-muted" style={{ fontSize: '0.8rem' }}>{formatColones(item.price)}</div>
                </div>
              </div>

              <div className="flex-center" style={{ gap: '10px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                    {formatColones(item.price * (isSplitMode ? qtySelected : item.qty))}
                </span>
                {!isSplitMode && (
                  <button className="btn-icon" style={{ color: '#94a3b8' }} onClick={(e) => { e.stopPropagation(); removeLine(item); }}>
                    <Trash2 size={16} />
                  </button>
                )}
                {isSplitMode && qtySelected > 0 && <CheckCircle size={16} color="var(--primary)" />}
              </div>
            </div>
          )})}
        </div>

        <div className="order-summary">
          <div className="payment-selector">
            {['Efectivo', 'SINPE', 'Tarjeta'].map(m => (
              <button key={m} className={`payment-btn ${table.payment === m ? 'active' : ''}`} 
                onClick={() => onUpdateTable({ ...table, payment: m })}>
                {m}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.9rem' }}>
            {isSplitMode && <div style={{textAlign:'center', fontWeight:'bold', color:'orange', marginBottom:'5px'}}>Resumen Subcuenta</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Subtotal</span>
              <b>{formatColones(subtotal)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Impuesto (13%)</span>
              <div style={{ textAlign: 'right' }}>
                <b>{formatColones(tax)}</b>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', marginTop: '0.5rem', borderTop: '2px solid var(--border)', paddingTop: '0.5rem' }}>
              <span>Total {isSplitMode ? '(Parcial)' : ''}</span>
              <b style={{ color: 'var(--primary)' }}>{formatColones(total)}</b>
            </div>
          </div>
          
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.75rem', justifyContent: 'center', padding: '12px' }} 
            onClick={handlePay}>
            {isSplitMode ? 'COBRAR SELECCIÓN' : 'COBRAR TODO'}
          </button>
        </div>
      </div>

      {/* RIGHT: MENU */}
      <div className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', background: '#f8fafc', opacity: isSplitMode ? 0.5 : 1, pointerEvents: isSplitMode ? 'none' : 'auto' }}>
        
        {showCabinSelector && (
             <div style={{position:'absolute', top:0, left:0, right:0, bottom:0, background:'white', zIndex:50, padding:'1rem', overflowY:'auto', borderRadius:'8px'}}>
                  <div style={{display:'flex', justifyContent:'space-between', marginBottom:'1rem'}}>
                      <h3>Seleccionar Cabaña</h3>
                      <button className="btn-icon" onClick={() => setShowCabinSelector(false)}><XCircle size={24}/></button>
                  </div>
                  {pendingCabins.length === 0 ? <p className="text-muted">No hay cabañas con deuda.</p> : (
                      <div style={{display:'grid', gap:'10px'}}>
                          {pendingCabins.map(c => (
                              <button key={c.docId} className="cat-card" style={{width:'100%', textAlign:'left', padding:'10px', height:'auto', alignItems:'flex-start'}} onClick={() => handleAddCabinToOrder(c)}>
                                   <div style={{width:'100%'}}>
                                     <div style={{fontWeight:'bold', fontSize:'1rem'}}>{c.name}</div>
                                     <div style={{fontSize:'0.85rem', color:'#64748b'}}>{c.info.uesped}</div>
                                     <div style={{fontWeight:'bold', color:'var(--primary)', marginTop:'4px'}}>Por cobrar: {formatColones(c.info.monto)}</div>
                                   </div>
                              </button>
                          ))}
                      </div>
                  )}
             </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <button 
             className="btn btn-outline" 
             title="Cargar Cabaña"
             onClick={() => setShowCabinSelector(true)}
             style={{color: 'var(--primary)', borderColor: 'var(--primary)', padding:'0 10px'}}
          >
             <Tent size={18} />
          </button>

          {cat && !search && (
            <button className="btn btn-outline" onClick={() => setCat(null)}><ChevronLeft size={16} /></button>
          )}
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: 12, color: '#94a3b8' }} />
            <input className="input-search" style={{ paddingLeft: '34px' }} placeholder="Buscar..." value={search} onChange={e => { setSearch(e.target.value); setCat(null); }} />
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

  // --- LOGICA REPORTE CSV CON DESGLOSE ---
  const downloadDailyReport = () => {
    if (filteredHistory.length === 0) return alert("No hay ventas en la fecha seleccionada.");

    // Calcular desglose por tipo de pago
    const stats = { Efectivo: 0, SINPE: 0, Tarjeta: 0, Otro: 0 };
    filteredHistory.forEach(h => {
        const metodo = h.medio_pago || 'Otro';
        const monto = Number(h.total_final) || 0;
        if(stats[metodo] !== undefined) stats[metodo] += monto;
        else stats['Otro'] += monto;
    });

    let csv = "REPORTE DIARIO DE VENTAS\n";
    csv += `Fecha,${selectedDate}\n`;
    csv += `Generado el,${new Date().toLocaleString()}\n`;
    csv += `Total Operaciones,${filteredHistory.length}\n`;
    csv += `MONTO TOTAL DEL DIA,${dayTotal}\n\n`;
    
    // Agregamos el desglose al CSV
    csv += "DESGLOSE POR METODO DE PAGO\n";
    csv += `Efectivo,${stats.Efectivo}\n`;
    csv += `SINPE,${stats.SINPE}\n`;
    csv += `Tarjeta,${stats.Tarjeta}\n\n`;

    csv += "========================================\n\n";
    csv += "DETALLE DE OPERACIONES\n";

    filteredHistory.forEach((sale, index) => {
      const time = getSafeDate(sale.fecha_hora).toLocaleTimeString();
      csv += `VENTA #${index + 1} | Hora: ${time} | ${sale.mesaNombre}\n`;
      csv += `Metodo Pago: ${sale.medio_pago}\n`;
      csv += `Producto,Cantidad,Precio Unit,Subtotal\n`;

      const grouped = {};
      (sale.items || []).forEach(i => {
        const key = `${i.name}-${i.price}`;
        if (!grouped[key]) grouped[key] = { name: i.name, price: i.price, qty: 0 };
        grouped[key].qty += (i.qty || 1); 
      });

      Object.values(grouped).forEach(item => {
        csv += `"${item.name}",${item.qty},${item.price},${item.price * item.qty}\n`;
      });

      csv += `,,,Total Venta: ${sale.total_final}\n`;
      csv += "----------------------------------------\n";
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Reporte_Diario_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadSingleInvoice = (saleData) => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += `Empresa,Canto del Bosque\nFecha,${getSafeDate(saleData.fecha_hora).toLocaleString()}\nMesa,${saleData.mesaNombre}\nPago,${saleData.medio_pago}\n\nProducto,Cantidad,Precio,Subtotal\n`;
    
    const grouped = {};
    saleData.items.forEach(i => {
      const key = `${i.name}-${i.price}`;
      if (!grouped[key]) grouped[key] = { name: i.name, price: i.price, qty: 0 };
      grouped[key].qty += (i.qty || 1);
    });

    Object.values(grouped).forEach(item => {
      csvContent += `"${item.name}",${item.qty},${item.price},${item.price * item.qty}\n`;
    });
    csvContent += `\n,,TOTAL,${saleData.total_final}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.href = encodedUri;
    link.download = `Factura_${saleData.mesaNombre}_${getSafeDate(saleData.fecha_hora).getTime()}.csv`;
    link.click();
  };

  return (
    <div className="card" style={{ padding: '1rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '10px' }}>
        <div>
           <h2 style={{fontSize:'1.2rem', fontWeight:'800', margin:0}}>Historial de Ventas</h2>
           <div style={{fontSize:'0.85rem', color:'var(--text-muted)'}}>
             Ventas del día: <b>{formatColones(dayTotal)}</b> ({filteredHistory.length} ops)
           </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{position:'relative'}}>
             <input type="date" className="input-search" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{paddingRight: '10px'}} />
          </div>
          <button className="btn btn-primary" onClick={downloadDailyReport} title="Descargar reporte completo de este día">
            <Archive size={18} /> Descargar Día
          </button>
        </div>
      </div>
      
      <div className="table-responsive" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '8px' }}>
        <table className="history-table">
          <thead>
            <tr style={{background: '#f8fafc'}}>
              <th>Hora</th>
              <th>Mesa/Origen</th>
              <th>Items</th>
              <th>Total</th>
              <th style={{textAlign:'center'}}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.length === 0 ? (
              <tr>
                <td colSpan="5" style={{textAlign:'center', padding:'2rem', color:'#94a3b8'}}>
                  No hay ventas registradas para el <b>{selectedDate}</b>
                </td>
              </tr>
            ) : (
              filteredHistory.map(h => (
                <tr key={h.id}>
                  <td>
                    {getSafeDate(h.fecha_hora).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </td>
                  <td>
                    <div style={{fontWeight:'bold'}}>{h.mesaNombre}</div>
                    <div className={`badge ${h.medio_pago === 'Tarjeta' ? 'badge-card' : 'badge-cash'}`} style={{fontSize:'0.7rem', display:'inline-block', marginTop:'2px'}}>
                      {h.medio_pago}
                    </div>
                  </td>
                  <td style={{fontSize:'0.85rem', maxWidth:'200px', color:'var(--text-muted)'}}>
                     {(h.items || []).length} items
                  </td>
                  <td style={{ fontWeight: 'bold' }}>{formatColones(h.total_final)}</td>
                  <td style={{ textAlign: 'center', display: 'flex', gap: '5px', justifyContent: 'center' }}>
                    <button className="btn-icon" onClick={() => downloadSingleInvoice(h)} title="Descargar CSV">
                      <FileText size={18} />
                    </button>
                    <button className="btn-icon" onClick={() => onPrint(h)} title="Imprimir Ticket">
                      <Printer size={18} />
                    </button>
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

function MenuManager({ menu, onAdd, onUpdate, onDelete, onBack }) {
  const [categoria, setCategoria] = React.useState(null);
  const [nombre, setNombre] = React.useState('');
  const [precio, setPrecio] = React.useState('');
  const [mostrarForm, setMostrarForm] = React.useState(false);

  const categorias = [...new Set(menu.map(m => m.category || 'Sin categoría'))];

  const itemsFiltrados = categoria
    ? menu.filter(m => (m.category || 'Sin categoría') === categoria)
    : menu;

  return (
    <div className="card" style={{ padding: 16, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2>Gestión de Menú</h2>
        <button className="btn btn-outline" onClick={onBack}>← Volver</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={() => setCategoria(null)}>Todas</button>
        {categorias.map(cat => (
          <button key={cat} className="btn btn-outline" onClick={() => setCategoria(cat)}>{cat}</button>
        ))}
      </div>

      <button className="btn btn-primary" onClick={() => setMostrarForm(!mostrarForm)} style={{ marginBottom: 12 }}>
        {mostrarForm ? 'Cancelar' : 'Añadir producto'}
      </button>

      {mostrarForm && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input className="input-search" placeholder="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} />
          <input className="input-search" placeholder="Precio" type="number" value={precio} onChange={e => setPrecio(e.target.value)} />
          <button className="btn btn-primary" onClick={() => {
              if (!categoria) return alert('Selecciona una categoría');
              onAdd(categoria, nombre, precio);
              setNombre(''); setPrecio(''); setMostrarForm(false);
            }}>
            Guardar
          </button>
        </div>
      )}

      <div style={{ overflowY: 'auto', maxHeight: '60vh' }}>
        {itemsFiltrados.map(item => (
          <div key={item.docId} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ddd', padding: 8 }}>
            <div>
              <strong>{item.name}</strong>
              <div style={{ fontSize: 12 }}>{item.category} · ₡{item.price}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-outline" onClick={async () => {
                  try {
                    const nuevoNombre = prompt('Nombre', item.name);
                    if (nuevoNombre === null) return; 
                    const nuevoPrecioRaw = prompt('Precio', item.price);
                    if (nuevoPrecioRaw === null) return;
                    const nuevoPrecio = Number(nuevoPrecioRaw);
                    if (nuevoNombre.trim() === '' || Number.isNaN(nuevoPrecio)) return alert('Datos inválidos');
                    await onUpdate(item.docId, { name: nuevoNombre.trim(), price: nuevoPrecio, category: item.category });
                  } catch (err) { alert('Error: ' + err.message); }
                }}>
                Editar
              </button>
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
    <button onClick={onClick} style={{
      display: 'flex', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '8px',
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? 'var(--primary)' : 'var(--text-muted)',
      border: 'none', cursor: 'pointer', fontWeight: '600', alignItems: 'center'
    }}>
      {icon} {label}
    </button>
  );
}
