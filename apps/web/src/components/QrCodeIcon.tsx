/** Compact QR glyph for account card actions. */
export function QrCodeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2" />
      <path d="M13.5 13.5h3v3h-3z" />
      <path d="M18 13.5h2.5V16" />
      <path d="M13.5 18v2.5H16" />
      <path d="M18.5 18.5H21V21h-2.5z" />
      <path d="M6 6h1.5v1.5H6z" />
      <path d="M16.5 6H18v1.5h-1.5z" />
      <path d="M6 16.5h1.5V18H6z" />
    </svg>
  );
}
