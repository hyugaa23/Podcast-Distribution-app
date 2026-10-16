export default function SearchLoading() {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ display: 'inline-block', width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
