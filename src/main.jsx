import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './Style.css'; // <--- IMPORTANTE: Esto carga tus colores verdes
import { NegocioProvider, AuthGate } from './core/negocio.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NegocioProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </NegocioProvider>
  </React.StrictMode>
);