import React, { useState, useEffect, useRef } from 'react';
import {
  Utensils,
  Coffee,
  Archive,
  ChevronLeft,
  Trash2,
  ArrowLeft,
  Plus,
  Search,
  XCircle
} from 'lucide-react';

import { db } from './firebase';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
  runTransaction,
  getDocs,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';

import './App.css'; // Asegúrate de importar el CSS

// CONFIG
const LOGO_URL = ''; // Pega tu URL si tienes
const INITIAL_CSV_DATA = `id;nombre;categoria;precio
1;Ensalada César con pollo;Ensaladas;5000
99;Producto Especial (Tablas);Especial;0`; // (Resumido para ahorrar espacio, el original funciona igual)

const CATEGORY_ICONS = {
  Ensaladas: '🥗', 'Platos Principales': '🍽️', 'Para Compartir': '🥩', Postres: '🍰',
  Cócteles: '🍹', Licores: '🥃', Cervezas: '🍺', Vinos: '🍷',
  'Bebidas Naturales': '🥤', Refrescos: '🧊', Especial: '✨',
};

// UTILIDADES
const formatColones = (val) => {
  const n = Number(val) || 0;
  return new Intl.NumberFormat('es-CR', {
    style: 'currency', currency: 'CRC',
    minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2,
  }).format(n);
};

const parseCSV = (csv) => {
  const lines = csv.trim().split('\n');
  return lines.slice(1).map((line) => {
    const [id, name, cat, price] = line.split(';');
    return { id, name: name?.trim(), category: cat?.trim(), price: parseFloat(price?.trim()) || 0 };
  }).filter((i) => i.id);
};

// --- APP PRINCIPAL ---
export default function App() {
  const [view, setView] = useState('tables');
  const [menu, setMenu] = useState([]);
  const [tables, setTables] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const fileInputRef = useRef(null);

  // Cargar datos
  useEffect(() => {
    // 1. Menú
    const qMenu = query(collection(db, 'menu'), orderBy('id', 'asc'));
    const unsubMenu = onSnapshot(qMenu, (snap) => {
      if (snap.empty) return; // Opcional: sembrar datos iniciales si está vacío
      setMenu(snap.docs.map((d) => ({ docId: d.id, ...d.data() })));
    });

    // 2. Mesas
    const qMesas = query(collection(db, 'mesas'), orderBy('createdAt', 'asc'));
    const unsubMesas = onSnapshot(qMesas, (snap) => {
      setTables(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    // 3. Historial (Ventas recientes, opcional cargar solo las de hoy)
    const qVentas = query(collection(db, 'ventas'), orderBy('fecha_hora', 'desc')); // Cuidado con muchos datos
    const unsubVentas = onSnapshot(qVentas, (snap) => {
       // Limitamos a las ultimas 50 para no saturar memoria en el cliente
       const ventas = snap.docs.slice(0, 50).map(d => ({id: d.id, ...d.data()}));
       setHistory(ventas);
    });

    return () => { unsubMenu(); unsubMesas(); unsubVentas(); };
  }, []);

  const activeTable = tables.find((t) => t.id === selectedTableId);

  // Acciones Mesas
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

  const handleDeleteTable = async (table) => {
    if ((table.items || []).length > 0) return alert('La mesa tiene pedidos activos.');
    if (!window.confirm(`¿Eliminar ${table.name}?`)) return;
    await deleteDoc(doc(db, 'mesas', table.id));
  };

  // Acciones POS
  const handleCloseOrder = async (tableData) => {
    const tableRef = doc(db, 'mesas', tableData.id);
    const ventasColl = collection(db, 'ventas');

    try {
      await runTransaction(db, async (transaction) => {
        const tSnap = await transaction.get(tableRef);
        if (!tSnap.exists()) throw new Error('Mesa no existe');
        
        const current = tSnap.data();
        const items = current.items || [];
        const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
        const impuesto = current.payment === 'Tarjeta' ? subtotal * 0.13 : 0;
        const total = subtotal + impuesto;

        // Registrar Venta
        const newVentaRef = doc(ventasColl);
        transaction.set(newVentaRef, {
          fecha_hora: new Date().toISOString(),
          mesaId: tableData.id,
          mesaNombre: current.name,
          items, subtotal, impuesto_tarjeta: impuesto,
          total_final: total, medio_pago: current.payment || 'Efectivo',
          createdAt: serverTimestamp(),
        });

        // Limpiar Mesa
        transaction.update(tableRef, {
          items: [], status: 'free', payment: 'Efectivo', ultima_actualizacion: serverTimestamp(),
        });
      });
      setView('tables');
      setSelectedTableId(null);
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // Importar/Exportar
  const exportCSV = (onlyToday) => {
    if (history.length === 0) return alert('No hay historial cargado');
    const today = new Date();
    
    const rows = history.filter(d => {
       if(!onlyToday) return true;
       const f = new Date(d.fecha_hora);
       return f.getDate() === today.getDate() && f.getMonth() === today.getMonth();
    }).map(d => 
      `${d.fecha_hora};${d.mesaNombre};${JSON.stringify(d.items)};${d.subtotal};${d.impuesto_tarjeta};${d.total_final};${d.medio_pago}`
    );
    
    if (rows.length === 0) return alert('No hay ventas hoy.');
    
    const csv = 'fecha;mesa;items;subtotal;impuesto;total;pago\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ventas_${onlyToday ? 'hoy' : 'historial'}.csv`;
    link.click();
  };

  const handleImportMenu = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length === 0) return alert('CSV inválido');
    if (!window.confirm(`¿Reemplazar menú con ${parsed.length} items?`)) return;

    const batch = writeBatch(db);
    const old = await getDocs(collection(db, 'menu'));
    old.forEach(d => batch.delete(d.ref));
    parsed.forEach(p => batch.set(doc(collection(db, 'menu')), { ...p, createdAt: serverTimestamp() }));
    await batch.commit();
    alert('Menú actualizado');
  };

  return (
    <div className="app-container">
      <header className="top-bar">
        <div className="flex-center" style={{ gap: '1rem' }}>
          {LOGO_URL ? <img src={LOGO_URL} alt="Logo" style={{ height: '40px' }} /> : <Utensils className="text-muted" />}
          <div>
            <h1 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--primary)', fontWeight: 800 }}>Canto del Bosque</h1>
            <div className="flex-center" style={{ gap: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: '50%' }}></span>
              POS Online
            </div>
          </div>
        </div>

        <div className="flex-center" style={{ gap: '0.5rem' }}>
          <input ref={fileInputRef} type="file" hidden onChange={handleImportMenu} accept=".csv" />
          <button className="btn btn-ghost" onClick={() => fileInputRef.current.click()} title="Importar">Importar</button>
          
          <div style={{width: '1px', height: '24px', background: 'var(--border)', margin: '0 0.5rem'}}></div>

          <NavBtn icon={<Coffee size={18} />} label="Mesas" active={view === 'tables'} onClick={() => setView('tables')} />
          <NavBtn icon={<Archive size={18} />} label="Historial" active={view === 'history'} onClick={() => setView('history')} />
        </div>
      </header>

      <main className="main-area">
        {view === 'tables' && (
          <TablesManager tables={tables} onCreate={handleCreateTable} onOpen={(id) => { setSelectedTableId(id); setView('pos'); }} onDelete={handleDeleteTable} />
        )}
        {view === 'pos' && activeTable && (
          <POSInterface table={activeTable} menu={menu} onUpdateTable={handleUpdateTable} onCloseOrder={handleCloseOrder} onBack={() => setView('tables')} />
        )}
        {view === 'history' && <HistoryManager history={history} onExport={() => exportCSV(false)} />}
      </main>
    </div>
  );
}

// --- SUB-COMPONENTES ---

function TablesManager({ tables, onCreate, onOpen, onDelete }) {
  const [name, setName] = useState('');
  return (
    <div className="card" style={{ padding: '2rem', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <h2 className="text-xl">Salón Principal</h2>
        <div className="flex-center" style={{ gap: '0.5rem' }}>
          <input className="input-search" style={{width: '200px'}} placeholder="Nueva Mesa..." value={name} onChange={e => setName(e.target.value)} />
          <button className="btn btn-primary" onClick={() => { onCreate(name); setName(''); }}><Plus size={18} /> Crear</button>
        </div>
      </div>

      <div className="category-grid">
        {tables.map(t => {
          const total = (t.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
          return (
            <div key={t.id} className="cat-card" style={{ position: 'relative', alignItems: 'flex-start', padding: '1.5rem', borderColor: t.status === 'occupied' ? 'var(--primary)' : 'var(--border)' }} onClick={() => onOpen(t.id)}>
              {(t.items || []).length === 0 && (
                <button onClick={(e) => { e.stopPropagation(); onDelete(t); }} style={{ position: 'absolute', top: 5, right: 5, background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                  <XCircle size={16} />
                </button>
              )}
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

function POSInterface({ table, menu, onUpdateTable, onCloseOrder, onBack }) {
  const [cat, setCat] = useState(null);
  const [search, setSearch] = useState('');
  
  const categories = [...new Set(menu.map(i => i.category))];
  
  // Cálculos
  const subtotal = (table.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
  const tax = table.payment === 'Tarjeta' ? subtotal * 0.13 : 0;
  const total = subtotal + tax;
  
  // Agrupación visual
  const grouped = {};
  (table.items || []).forEach(i => {
    const key = `${i.id}-${i.price}`;
    if(!grouped[key]) grouped[key] = { ...i, qty: 0, ids: [] };
    grouped[key].qty++;
    grouped[key].ids.push(i.instanceId);
  });
  const cartItems = Object.values(grouped);

  // Filtrado Menú
  const filtered = search 
    ? menu.filter(i => i.name.toLowerCase().includes(search.toLowerCase())) 
    : cat ? menu.filter(i => i.category === cat) : [];

  const addItem = (item) => {
    let price = Number(item.price);
    if(price === 0) {
      const p = prompt('Precio:');
      if(!p) return;
      price = parseFloat(p) || 0;
    }
    const newItem = { ...item, price, instanceId: Date.now() + Math.random().toString() };
    onUpdateTable({ ...table, items: [...(table.items || []), newItem] });
  };

  const removeOne = (group) => {
    const removeId = group.ids[0];
    onUpdateTable({ ...table, items: table.items.filter(i => i.instanceId !== removeId) });
  };

  return (
    <div className="pos-layout">
      {/* PANEL IZQUIERDO: CUENTA */}
      <div className="card order-panel">
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button className="btn-icon" onClick={onBack}><ArrowLeft size={20} /></button>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: 0 }}>{table.name}</h2>
        </div>

        <div className="order-items">
          {cartItems.map(item => (
            <div key={`${item.id}-${item.price}`} className="order-item">
              <div className="flex-center" style={{ gap: '10px' }}>
                <div className="qty-badge">{item.qty}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{item.name}</div>
                  <div className="text-muted" style={{ fontSize: '0.8rem' }}>{formatColones(item.price)}</div>
                </div>
              </div>
              <div className="flex-center" style={{ gap: '10px' }}>
                <span style={{ fontWeight: 'bold' }}>{formatColones(item.price * item.qty)}</span>
                <button className="btn-icon" style={{ color: 'var(--danger)', width: 28, height: 28 }} onClick={() => removeOne(item)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {cartItems.length === 0 && <div style={{ textAlign: 'center', color: '#cbd5e1', marginTop: '3rem' }}>Mesa vacía</div>}
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

          <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Subtotal</span>
              <b>{formatColones(subtotal)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Impuesto (13%)</span>
              <div style={{ textAlign: 'right' }}>
                <b>{formatColones(tax)}</b>
                {total > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{((tax/total)*100).toFixed(2)}% del total</div>}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', marginTop: '0.5rem', borderTop: '2px solid var(--border)', paddingTop: '0.5rem' }}>
              <span>Total</span>
              <b style={{ color: 'var(--primary)' }}>{formatColones(total)}</b>
            </div>
          </div>
          
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem', justifyContent: 'center', padding: '12px' }} 
            onClick={() => { if(window.confirm('¿Cerrar Cuenta?')) onCloseOrder(table); }}>
            COBRAR
          </button>
        </div>
      </div>

      {/* PANEL DERECHO: MENÚ */}
      <div className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {cat && !search && (
            <button className="btn btn-outline" onClick={() => setCat(null)}><ChevronLeft size={16} /></button>
          )}
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: 12, color: '#94a3b8' }} />
            <input className="input-search" style={{ paddingLeft: '34px' }} placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
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
              {filtered.length === 0 && <div className="text-muted" style={{ width: '100%', textAlign: 'center' }}>No hay resultados</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryManager({ history, onExport }) {
  return (
    <div className="card" style={{ padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 className="text-xl">Historial de Ventas</h2>
        <button className="btn btn-outline" onClick={onExport}>Exportar CSV</button>
      </div>
      
      <div className="table-responsive" style={{ flex: 1 }}>
        <table className="history-table">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Mesa</th>
              <th>Items</th>
              <th>Pago</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td>{new Date(h.fecha_hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td>{h.mesaNombre}</td>
                <td className="text-muted" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.items.map(i => i.name).join(', ')}
                </td>
                <td>
                  <span className={`badge ${h.medio_pago === 'Tarjeta' ? 'badge-card' : h.medio_pago === 'SINPE' ? 'badge-sinpe' : 'badge-cash'}`}>
                    {h.medio_pago}
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatColones(h.total_final)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      border: 'none', cursor: 'pointer', fontWeight: '600'
    }}>
      {icon} {label}
    </button>
  );
}