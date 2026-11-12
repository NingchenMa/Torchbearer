// The TorchBearer torch, drawn small for the top bar and headers (matches the product website).
export function TorchMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size * 0.62} height={size} viewBox="0 0 31 50" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tm-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#a4161a" />
          <stop offset=".55" stopColor="#e2383e" />
          <stop offset="1" stopColor="#f2a007" />
        </linearGradient>
        <linearGradient id="tm-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ddbdc2" />
          <stop offset=".5" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9a9ae" />
        </linearGradient>
      </defs>
      {/* flame */}
      <path d="M15.5 1C19 7 25 9.5 24 16.5c-.6 4-4 6.5-8.5 6.5S7.4 20.4 7 16.5C6.4 11 11 9 11.5 4.5c1.5 2.2 2.4 4 2.3 6.4C15.8 8.6 16.4 5 15.5 1Z" fill="url(#tm-flame)" />
      <path d="M15.5 10.5c2 3 4.3 4.6 3.9 7.4-.3 2-1.9 3.3-3.9 3.3s-3.7-1.3-3.9-3.3c-.3-2.6 1.7-3.6 2.1-6 .8.9 1.3 1.9 1.3 3 1-1.3 1-2.8.5-4.4Z" fill="#f9c74f" />
      {/* cup and handle */}
      <path d="M5 23.5h21l-2.6 6.5H7.6Z" fill="url(#tm-metal)" />
      <path d="M11 30.5h9l-2.3 18.5h-4.4Z" fill="url(#tm-metal)" />
    </svg>
  );
}
