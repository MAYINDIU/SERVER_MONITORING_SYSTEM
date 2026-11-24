export default function Logo({ size = 44, className = '' }) {
  return (
    <div className={`logo-tile ${className}`} style={{ width: size, height: size }}>
      <img src="/logo.jpg" alt="Logo" />
    </div>
  );
}
