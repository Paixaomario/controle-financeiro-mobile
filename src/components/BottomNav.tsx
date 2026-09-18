import { NavLink } from 'react-router-dom';
import { Home, Receipt, Plus, Sparkles, Menu } from 'lucide-react';

const items = [
  { to: '/', label: 'Início', Icon: Home },
  { to: '/extrato', label: 'Extrato', Icon: Receipt },
  { to: '/lancamento', label: 'Adicionar', Icon: Plus, isAction: true },
  { to: '/assistente', label: 'Assistente', Icon: Sparkles },
  { to: '/mais', label: 'Mais', Icon: Menu },
];

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 mx-auto max-w-md px-3 pb-3">
      <div className="flex items-center justify-around bg-bg-card border border-border-default rounded-2xl px-1 py-2">
        {items.map(({ to, label, Icon, isAction }) =>
          isAction ? (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              className="w-10 h-10 rounded-full bg-income-green text-bg-base flex items-center justify-center"
            >
              <Icon size={20} strokeWidth={2} />
            </NavLink>
          ) : (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-3 py-1 ${isActive ? 'text-income-green' : 'text-text-muted'}`
              }
            >
              <Icon size={20} strokeWidth={1.75} />
              <span className="text-[9.5px]">{label}</span>
            </NavLink>
          ),
        )}
      </div>
    </nav>
  );
}
