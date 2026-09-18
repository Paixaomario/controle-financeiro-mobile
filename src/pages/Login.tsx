import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Mode = 'login' | 'signup';

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate(): string | null {
    if (!email || !password) return 'Preencha e-mail e senha.';
    if (password.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (mode === 'signup' && password !== confirmPassword) return 'As senhas não coincidem.';
    return null;
  }

  async function handleSubmit() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setLoading(true);

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(traduzErro(error.message));
      // com "Confirm email" desativado nas configurações do Supabase, o
      // signUp já retorna sessão ativa — onAuthStateChange no App.tsx
      // cuida de levar para o Dashboard automaticamente.
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(traduzErro(error.message));
    }

    setLoading(false);
  }

  function traduzErro(message: string): string {
    if (message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (message.includes('User already registered')) return 'Este e-mail já tem cadastro — tente entrar.';
    if (message.includes('Password should be')) return 'A senha precisa ter pelo menos 6 caracteres.';
    return message;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <div className="flex justify-center mb-3">
          <div className="w-12 h-12 rounded-2xl bg-income-green/15 flex items-center justify-center">
            <Wallet size={24} className="text-income-green" strokeWidth={1.75} />
          </div>
        </div>
        <h1 className="text-xl font-medium text-text-primary mb-1 text-center">Controle Financeiro</h1>
        <p className="text-[12px] text-text-secondary text-center mb-6">
          {mode === 'login' ? 'Entre com seu e-mail e senha' : 'Crie sua conta com e-mail e senha'}
        </p>

        <div className="flex gap-1 bg-bg-card border border-border-default rounded-lg p-1 mb-4">
          <button
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 text-[13px] font-medium py-2 rounded-md transition-colors ${
              mode === 'login' ? 'bg-income-green text-bg-base' : 'text-text-secondary'
            }`}
          >
            Entrar
          </button>
          <button
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`flex-1 text-[13px] font-medium py-2 rounded-md transition-colors ${
              mode === 'signup' ? 'bg-income-green text-bg-base' : 'text-text-secondary'
            }`}
          >
            Cadastrar
          </button>
        </div>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com"
          autoComplete="email"
          className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm mb-3 outline-none focus:border-income-green"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm mb-3 outline-none focus:border-income-green"
        />
        {mode === 'signup' && (
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirmar senha"
            autoComplete="new-password"
            className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm mb-3 outline-none focus:border-income-green"
          />
        )}

        {error && <div className="text-expense-red text-xs mb-3">{error}</div>}

        <button
          onClick={handleSubmit}
          disabled={loading || !email || !password}
          className="w-full bg-income-green text-bg-base text-center text-sm font-medium py-3 rounded-xl disabled:opacity-50"
        >
          {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Cadastrar'}
        </button>
      </div>
    </div>
  );
}
