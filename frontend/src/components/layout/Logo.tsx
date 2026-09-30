export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22C55E" /><stop offset="1" stopColor="#0E2F36" /></linearGradient>
        <linearGradient id="lg2" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#16A34A" /><stop offset="1" stopColor="#86EFAC" /></linearGradient>
      </defs>
      <path d="M20 4a16 16 0 0 1 15.2 11" stroke="url(#lg1)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M35.5 22A16 16 0 0 1 12 34" stroke="url(#lg2)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M8 30A16 16 0 0 1 12 7" stroke="url(#lg1)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <circle cx="20" cy="20" r="4" fill="#16A34A" />
    </svg>
  );
}
