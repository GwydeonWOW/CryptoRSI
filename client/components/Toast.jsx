const COLORS = {
  success: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)', text: '#22c55e' },
  error:   { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', text: '#ef4444' },
  info:    { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', text: '#3b82f6' },
  warning: { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.3)', text: '#eab308' },
};

export default function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8,
      maxWidth: 'calc(100vw - 32px)', width: 360,
    }}>
      {toasts.map(t => {
        const c = COLORS[t.type] || COLORS.info;
        return (
          <div key={t.id} onClick={() => onDismiss(t.id)} style={{
            background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8,
            padding: '0.6rem 1rem', color: c.text, fontSize: '0.85rem',
            cursor: 'pointer', fontWeight: 500,
            animation: 'toast-in 0.2s ease-out',
          }}>
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
