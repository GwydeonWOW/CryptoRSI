export default function Loading({ text = 'Cargando...' }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <p>{text}</p>
    </div>
  );
}
