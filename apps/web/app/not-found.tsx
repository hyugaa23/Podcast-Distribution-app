export default function NotFound() {
  return (
    <div className="pe-wrap pe-page" style={{ textAlign: 'center' }}>
      <h1 className="pe-page__title">Page not found</h1>
      <p className="pe-page__lead" style={{ marginInline: 'auto' }}>The page you are looking for doesn’t exist or has moved.</p>
      <p><a href="/">Go to the homepage</a> · <a href="/search">Search</a></p>
    </div>
  );
}
