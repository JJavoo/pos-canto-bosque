import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';

const NegocioContext = createContext(null);
export const useNegocio = () => useContext(NegocioContext);

// Envuelve la app: resuelve usuario -> negocio -> rol, y entrega helpers de rutas.
export function NegocioProvider({ children }) {
  const [estado, setEstado] = useState({ cargando: true, user: null, negocioId: null, negocio: null, rol: null });

  useEffect(() => {
    let unsubs = [];
    const limpiar = () => { unsubs.forEach((u) => u()); unsubs = []; };

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      limpiar();
      if (!user) return setEstado({ cargando: false, user: null, negocioId: null, negocio: null, rol: null });

      try {
        const perfil = await getDoc(doc(db, 'usuarios', user.uid));
        const negocioId = perfil.exists() ? perfil.data().negocioId : null;
        if (!negocioId) return setEstado({ cargando: false, user, negocioId: null, negocio: null, rol: null });

        let negocio = null, miembro = null;
        const publicar = () => {
          if (negocio && miembro) {
            setEstado({ cargando: false, user, negocioId, negocio, rol: miembro.activo ? miembro.rol : null });
          }
        };
        unsubs.push(onSnapshot(doc(db, 'negocios', negocioId), (s) => { negocio = { id: s.id, ...s.data() }; publicar(); }));
        unsubs.push(onSnapshot(doc(db, 'negocios', negocioId, 'miembros', user.uid), (s) => { miembro = s.data() || { activo: false }; publicar(); }));
      } catch (e) {
        console.error(e);
        setEstado({ cargando: false, user, negocioId: null, negocio: null, rol: null });
      }
    });

    return () => { unsubAuth(); limpiar(); };
  }, []);

  const valor = useMemo(() => ({
    ...estado,
    col: (nombre) => collection(db, 'negocios', estado.negocioId, nombre),
    doc_: (nombre, id) => doc(db, 'negocios', estado.negocioId, nombre, id),
    salir: () => signOut(auth),
  }), [estado]);

  return <NegocioContext.Provider value={valor}>{children}</NegocioContext.Provider>;
}

// Pantalla de acceso: no deja pasar sin sesión, negocio y rol activo.
export function AuthGate({ children }) {
  const { cargando, user, negocioId, rol, salir } = useNegocio();
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');

  if (cargando) return <div style={{ padding: '3rem', textAlign: 'center' }} className="text-muted">Cargando...</div>;

  if (!user) {
    const entrar = async () => {
      setError('');
      try { await signInWithEmailAndPassword(auth, email.trim(), clave); }
      catch { setError('Correo o contraseña incorrectos'); }
    };
    return (
      <div className="modal-backdrop" style={{ background: 'var(--bg-app)' }}>
        <div className="card" style={{ padding: '2rem', width: 340, display: 'grid', gap: 10 }}>
          <h2 style={{ margin: 0, color: 'var(--primary)' }}>Iniciar sesión</h2>
          <input className="input-search" type="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input-search" type="password" placeholder="Contraseña" value={clave} onChange={(e) => setClave(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && entrar()} />
          {error && <div style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</div>}
          <button className="btn btn-primary" onClick={entrar}>Entrar</button>
        </div>
      </div>
    );
  }

  if (!negocioId || !rol) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p>Tu usuario no tiene un negocio o rol activo asignado. Pídele al administrador que te agregue.</p>
        <button className="btn btn-outline" onClick={salir}>Cerrar sesión</button>
      </div>
    );
  }

  return children;
}