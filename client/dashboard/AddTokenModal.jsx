import { useState } from 'react';

export default function AddTokenModal({ open, onClose, onAdded }) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');

  if (!open) return null;

  async function add() {
    if (!symbol.trim()) { alert('Introduce un símbolo'); return; }
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbol.trim(), name: name.trim() }),
      });
      const data = await res.json();
      if (data.success) { setSymbol(''); setName(''); onClose(); onAdded(); }
      else { alert(data.message); }
    } catch (e) { alert('Error: ' + e.message); }
  }

  return (
    <div className="modal-overlay active" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Añadir Token</h2>
        <div className="form-group">
          <label>Símbolo (ej: BTC, ETH, SOL)</label>
          <input type="text" value={symbol} onChange={e => setSymbol(e.target.value)}
            placeholder="BTC" maxLength={20}
            onKeyDown={e => e.key === 'Enter' && add()} />
        </div>
        <div className="form-group">
          <label>Nombre (opcional)</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Bitcoin" />
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={add}>Añadir</button>
        </div>
      </div>
    </div>
  );
}
