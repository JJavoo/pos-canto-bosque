import React, { useState, useEffect, useRef } from 'react';
import {
  Utensils, Coffee, Archive, ChevronLeft, Trash2, ArrowLeft, Plus, Minus, Search, XCircle
} from 'lucide-react';

import { db } from './firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy,
  serverTimestamp, runTransaction, getDocs, writeBatch, deleteDoc
} from 'firebase/firestore';

import './App.css'; 

// CONFIGURACIÓN
const LOGO_URL = ''; // Pega tu URL aquí si tienes
// Nota: Se agrego la línea 64 para Michelado en Refrescos
const INITIAL_CSV_DATA = `id;nombre;categoria;precio
1;Ensalada César con pollo;Ensaladas;5000
2;Ensalada con camarones;Ensaladas;5500
3;Arroz con camarones;Platos Principales;6000
4;Pollo a la parrilla;Platos Principales;6000
5;Quesadilla de pollo;Platos Principales;5500
6;Quesadilla de camarón;Platos Principales;5500
7;Dedos de pollo;Platos Principales;5000
8;Dedos de pescado;Platos Principales;5000
9;Costilla de cerdo BBQ;Platos Principales;7500
10;Corte de res Premium;Platos Principales;9500
11;Sirloin (papas y veg);Para Compartir;20000
12;Parrillada mixta para 4;Para Compartir;40000
13;Postre del día;Postres;2500
14;Mojito;Cócteles;3000
15;Aperol Spritz;Cócteles;3000
16;Malibú/Naranja;Cócteles;3000
17;Mojito Blu Curacao;Cócteles;4000
18;Malibú (Solo);Cócteles;4000
19;Cantaritos;Cócteles;3000
20;Margarita;Cócteles;3000
21;Bon Amí;Cócteles;3500
22;Flor de Caña 7 años;Licores;2500
23;Flor de Caña 12 años;Licores;4000
24;Ron Appleton;Licores;3000
25;Ron Centenario 12 años;Licores;4000
26;Tequila Campo Azul;Licores;3000
27;Tequila Don Julio;Licores;4000
28;Tequila 1800;Licores;4000
29;Whiskey Old Par;Licores;3000
30;Whiskey Jhonny W Black;Licores;3000
31;Whiskey Chivas 12 años;Licores;4000
32;Whiskey Buccanans;Licores;3500
33;Whiskey Jameson;Licores;3000
34;Cacique;Licores;1500
35;Campari;Licores;2000
36;Aguardiente;Licores;2000
37;Jagermeister;Licores;3000
38;Baileys;Licores;2500
39;Chiligüaro;Licores;1000
40;Imperial (Light/Silver/Ultra);Cervezas;1500
41;Pilsen 6.0;Cervezas;1500
42;Bavaria (Gold/Light);Cervezas;2000
43;Heineken / Sol / Smirnoff;Cervezas;2000
44;Michelado (Suplemento);Cervezas;300
45;Copa Vino Tinto;Vinos;3000
46;Copa Vino Blanco;Vinos;3000
47;Sangría;Vinos;2500
48;Limonada (Agua);Bebidas Naturales;1500
49;Tamarindo (Agua);Bebidas Naturales;1500
50;Mango (Agua);Bebidas Naturales;1500
51;Piña (Agua);Bebidas Naturales;1500
52;Agua de Sapo;Bebidas Naturales;1500
53;Horchata (Agua);Bebidas Naturales;1500
54;Mango (Leche);Bebidas Naturales;2000
55;Horchata (Leche);Bebidas Naturales;2000
56;Coca Cola Original;Refrescos;1200
57;Coca Cola Light;Refrescos;1200
58;Coca Cola Zero;Refrescos;1200
59;Fresca;Refrescos;1200
60;Ginger Ale;Refrescos;1200
61;Fanta Naranja;Refrescos;1200
62;Fanta Kolita;Refrescos;1200
63;Agua Embotellada;Refrescos;1200
64;Michelado (Suplemento);Refrescos;300
65;Botella de Vino (Precio Variable);Vinos;0
66;Tabla Especial (Pequeña);Especial;15000
67;Tabla Especial (Grande);Especial;20000
68;Tabla Agrandada;Especial;25000`;

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
    const qMenu = query(collection(db, 'menu'), orderBy('id', 'asc'));
    const unsubMenu = onSnapshot(qMenu, (snap) => {
      // Si no hay menú, sembramos el inicial
      if (snap.empty) {
        const parsed = parseCSV(INITIAL_CSV_DATA);
        const batch = writeBatch(db);
        parsed.forEach(p => batch.set(doc(collection(db, 'menu')), { ...p, createdAt: serverTimestamp() }));
        batch.commit();
        return;
      }
      setMenu(snap.docs.map((d) => ({ docId: d.id, ...d.data() })));
    });

    const qMesas = query(collection(db, 'mesas'), orderBy('createdAt', 'asc'));
    const unsubMesas = onSnapshot(qMesas, (snap) => {
      setTables(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const qVentas = query(collection(db, 'ventas'), orderBy('fecha_hora', 'desc'));
    const unsubVentas = onSnapshot(qVentas, (snap) => {
       const ventas = snap.docs.slice(0, 50).map(d => ({id: d.id, ...d.data()}));
       setHistory(ventas);
    });

    return () => { unsubMenu(); unsubMesas(); unsubVentas(); };
  }, []);

  const activeTable = tables.find((t) => t.id === selectedTableId);

  // Handlers
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

        const newVentaRef = doc(ventasColl);
        transaction.set(newVentaRef, {
          fecha_hora: new Date().toISOString(),
          mesaId: tableData.id, mesaNombre: current.name,
          items, subtotal, impuesto_tarjeta: impuesto,
          total_final: total, medio_pago: current.payment || 'Efectivo',
          createdAt: serverTimestamp(),
        });

        transaction.update(tableRef, {
          items: [], status: 'free', payment: 'Efectivo', ultima_actualizacion: serverTimestamp(),
        });
      });
      setView('tables'); setSelectedTableId(null);
    } catch (e) { alert('Error: ' + e.message); }
  };

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
              <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: '50%' }}></span> POS Online
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
    <div className="card" style={{ padding: '1.5rem', height: '100%', overflowY: 'auto' }}>
      <div className="controls-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0 }}>Salón Principal</h2>
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
  
  const subtotal = (table.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
  const tax = table.payment === 'Tarjeta' ? subtotal * 0.13 : 0;
  const total = subtotal + tax;
  
  // Agrupar productos
  const grouped = {};
  (table.items || []).forEach(i => {
    // Usamos ID y Precio como clave para separar si el mismo producto tiene precios distintos
    const key = `${i.id}-${i.price}`;
    if(!grouped[key]) grouped[key] = { ...i, qty: 0, ids: [] };
    grouped[key].qty++;
    grouped[key].ids.push(i.instanceId);
  });
  const cartItems = Object.values(grouped);

  // Filtrado del menú
  const filtered = search 
    ? menu.filter(i => i.name.toLowerCase().includes(search.toLowerCase())) 
    : cat ? menu.filter(i => i.category === cat) : [];

  // --- FUNCIONES DE AGREGAR / QUITAR ---

  // Agregar item nuevo desde el menú
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

  // Aumentar cantidad de un item YA existente en la comanda
  const increaseQty = (groupItem) => {
    // Creamos una copia limpia usando el precio que YA tiene el item en lista
    const newItem = { 
      id: groupItem.id,
      name: groupItem.name,
      category: groupItem.category,
      price: groupItem.price,
      instanceId: Date.now() + Math.random().toString() 
    };
    onUpdateTable({ ...table, items: [...(table.items || []), newItem] });
  };

  // Disminuir cantidad (quita una instancia)
  const decreaseQty = (groupItem) => {
    const removeId = groupItem.ids[0]; // Tomamos el ID de la primera instancia
    onUpdateTable({ ...table, items: table.items.filter(i => i.instanceId !== removeId) });
  };

  // Eliminar TODA la línea (borra todas las instancias de ese producto)
  const removeLine = (groupItem) => {
    // Filtramos para quitar todos los items que estén en la lista de IDs de este grupo
    onUpdateTable({ ...table, items: table.items.filter(i => !groupItem.ids.includes(i.instanceId)) });
  };

  return (
    <div className="pos-layout">
      {/* PANEL IZQUIERDO: CUENTA */}
      <div className="card order-panel">
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button className="btn-icon" onClick={onBack}><ArrowLeft size={20} /></button>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: 0 }}>{table.name}</h2>
        </div>

        <div className="order-items">
          {cartItems.map(item => (
            <div key={`${item.id}-${item.price}`} className="order-item">
              <div className="flex-center" style={{ gap: '10px', flex: 1 }}>
                
                {/* CONTROL DE CANTIDAD (+ y -) */}
                <div style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', borderRadius: '8px', padding: '2px' }}>
                  <button 
                    onClick={() => decreaseQty(item)}
                    style={{ border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', display: 'flex', color: 'var(--danger)' }}
                  >
                    <Minus size={14} />
                  </button>
                  
                  <span style={{ fontWeight: 'bold', minWidth: '20px', textAlign: 'center', fontSize: '0.9rem' }}>
                    {item.qty}
                  </span>

                  <button 
                    onClick={() => increaseQty(item)}
                    style={{ border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', display: 'flex', color: 'var(--primary)' }}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {/* DETALLE DEL ITEM */}
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name}
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.8rem' }}>Unit: {formatColones(item.price)}</div>
                </div>
              </div>

              {/* TOTAL DE LINEA Y ELIMINAR LINEA */}
              <div className="flex-center" style={{ gap: '10px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{formatColones(item.price * item.qty)}</span>
                <button className="btn-icon" style={{ color: '#94a3b8', width: 28, height: 28 }} onClick={() => removeLine(item)} title="Eliminar línea completa">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {cartItems.length === 0 && <div style={{ textAlign: 'center', color: '#cbd5e1', marginTop: '3rem' }}>Mesa vacía</div>}
        </div>

        {/* RESUMEN Y PAGO (Igual que antes) */}
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
              <span>Total</span>
              <b style={{ color: 'var(--primary)' }}>{formatColones(total)}</b>
            </div>
          </div>
          
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.75rem', justifyContent: 'center', padding: '12px' }} 
            onClick={() => { if(window.confirm('¿Cerrar Cuenta?')) onCloseOrder(table); }}>
            COBRAR
          </button>
        </div>
      </div>

      {/* PANEL DERECHO: MENÚ (Igual que antes) */}
      <div className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          {cat && !search && (
            <button className="btn btn-outline" onClick={() => setCat(null)}><ChevronLeft size={16} /></button>
          )}
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
    <div className="card" style={{ padding: '1rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{fontSize:'1.2rem', fontWeight:'800'}}>Historial de Ventas</h2>
        <button className="btn btn-outline" onClick={onExport}>Exportar CSV</button>
      </div>
      
      <div className="table-responsive" style={{ flex: 1 }}>
        <table className="history-table">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Mesa</th>
              <th>Pago</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td>{new Date(h.fecha_hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td>{h.mesaNombre}</td>
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
