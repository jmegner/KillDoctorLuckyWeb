import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import App from '@/App.tsx';
import Fiddle from '@/components/Fiddle.tsx';
import wasmBindgenInit from '@/KdlRust/pkg/kill_doctor_lucky_rust';

wasmBindgenInit().then((/*wasm*/) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      <Fiddle />
    </StrictMode>
  );
});
