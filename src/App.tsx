import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { BottomNav } from './components/BottomNav';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Extrato from './pages/Extrato';
import Cartoes from './pages/Cartoes';
import Orcamento from './pages/Orcamento';
import Investimentos from './pages/Investimentos';
import Relatorios from './pages/Relatorios';
import CaptureSms from './pages/CaptureSms';
import NovoLancamento from './pages/NovoLancamento';
import Assistente from './pages/Assistente';
import Configuracoes from './pages/Configuracoes';
import FinanciamentosList from './pages/financiamentos/FinanciamentosList';
import NovoFinanciamento from './pages/financiamentos/NovoFinanciamento';
import Demonstrativo from './pages/financiamentos/Demonstrativo';

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-base">
      {children}
      <BottomNav />
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="min-h-screen bg-bg-base" />;

  if (!session) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AuthenticatedLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/extrato" element={<Extrato />} />
          <Route path="/cartoes" element={<Cartoes />} />
          <Route path="/orcamento" element={<Orcamento />} />
          <Route path="/investimentos" element={<Investimentos />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/lancamento" element={<NovoLancamento />} />
          <Route path="/assistente" element={<Assistente />} />
          <Route path="/capturar" element={<CaptureSms />} />
          <Route path="/capture-sms" element={<CaptureSms />} />
          <Route path="/mais" element={<Configuracoes />} />
          <Route path="/financiamentos" element={<FinanciamentosList />} />
          <Route path="/financiamentos/novo" element={<NovoFinanciamento />} />
          <Route path="/financiamentos/:id" element={<Demonstrativo />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthenticatedLayout>
    </BrowserRouter>
  );
}
