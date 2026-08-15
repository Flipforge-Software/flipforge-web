export function BoardIllustration({ active }: { active: boolean }) {
  return (
    <svg className={`board-illustration ${active ? "is-active" : ""}`} viewBox="0 0 920 430" role="img" aria-label="Flipper Wi-Fi Devboard illustration">
      <defs>
        <linearGradient id="board" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#282b2f" />
          <stop offset="1" stopColor="#111315" />
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="16" /></filter>
      </defs>
      <path className="board-glow" d="M146 62h630l70 82v155l-73 69H145l-71-77V137z" filter="url(#glow)" />
      <path className="board-shell" d="M146 62h630l70 82v155l-73 69H145l-71-77V137z" fill="url(#board)" />
      <path className="board-trace" d="M166 91h589l54 64v129l-55 54H163l-53-58V151z" />
      <rect x="305" y="125" width="307" height="180" rx="18" className="chip" />
      <text x="458" y="195" textAnchor="middle" className="chip-label">ESP32-S2</text>
      <text x="458" y="225" textAnchor="middle" className="chip-sub">FLIPPER WI-FI DEVBOARD</text>
      <g className="pins">
        {Array.from({ length: 9 }, (_, index) => <rect key={`top-${index}`} x={327 + index * 31} y="105" width="12" height="20" rx="2" />)}
        {Array.from({ length: 9 }, (_, index) => <rect key={`bottom-${index}`} x={327 + index * 31} y="305" width="12" height="20" rx="2" />)}
      </g>
      <circle cx="720" cy="180" r="19" className="button-ring" /><text x="720" y="185" textAnchor="middle" className="button-label">B</text>
      <circle cx="720" cy="247" r="19" className="button-ring" /><text x="720" y="252" textAnchor="middle" className="button-label">R</text>
      <rect x="105" y="187" width="104" height="58" rx="12" className="usb" />
      <rect x="73" y="201" width="51" height="31" rx="6" className="usb-port" />
      <circle cx="778" cy="318" r="8" className="status-led" />
      <path className="signal" d="M640 107c35-32 81-32 116 0M661 129c23-21 49-21 73 0M685 150c8-7 17-7 25 0" />
    </svg>
  );
}
