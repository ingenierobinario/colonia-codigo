export function Desk({ working }: { working: boolean }) {
  return (
    <svg viewBox="0 0 160 104" className="office-desk" aria-hidden="true">
      <path d="M16 56h128v26H16z" fill="#885a3e" />
      <path d="M22 75h9v23h-9zm107 0h9v23h-9z" fill="#674936" />
      <rect x="12" y="44" width="136" height="32" rx="5" fill="#dcb886" stroke="#987550" strokeWidth="3" />
      <path d="M17 67h126M24 49h43m42 0h25" stroke="#f0d0a0" strokeWidth="2" />
      <rect x="48" y="7" width="64" height="42" rx="4" fill="#374a52" />
      <rect x="53" y="12" width="54" height="31" rx="2" fill={working ? "#b5e4d0" : "#6a8691"} />
      <path d="M60 21h22m-22 7h35m-35 7h17" stroke={working ? "#3f8f79" : "#9ab1b6"} strokeWidth="3" />
      <path d="M77 49v5m-10 0h26" stroke="#374a52" strokeWidth="5" />
      <rect x="54" y="58" width="47" height="9" rx="2" fill="#f4ead8" />
      <path d="M59 62h36" stroke="#b5b1a1" strokeWidth="2" strokeDasharray="3 2" />
      <rect x="120" y="47" width="12" height="14" rx="3" fill="#f4eee2" />
      <path d="M132 50h4v7h-4" stroke="#f4eee2" fill="none" strokeWidth="3" />
      <rect x="26" y="52" width="17" height="14" rx="2" fill="#c1c9a1" transform="rotate(-8 26 52)" />
    </svg>
  );
}

export function Plant() {
  return (
    <svg className="office-plant" viewBox="0 0 70 90" aria-hidden="true">
      <ellipse cx="35" cy="79" rx="25" ry="7" fill="#233a3020" />
      <path d="m20 54 5 25h21l5-25" fill="#c38262" stroke="#926346" strokeWidth="2" />
      <path d="M35 60V20" stroke="#3e7959" strokeWidth="4" />
      <path
        d="M35 42C5 44 10 15 35 37M35 52C63 51 64 26 35 46M35 30C17 11 36 1 38 24M37 36C62 24 54 7 37 30"
        fill="#649c72"
        stroke="#477d59"
        strokeWidth="2"
      />
    </svg>
  );
}

export function Lounge() {
  return (
    <svg viewBox="0 0 360 180" className="office-lounge-art" aria-hidden="true">
      <rect x="65" y="38" width="225" height="124" rx="45" fill="#c3ba9b" opacity=".6" />
      <rect x="38" y="37" width="51" height="106" rx="12" fill="#56867c" stroke="#42695f" strokeWidth="3" />
      <path d="M49 47h29v39H49zm0 46h29v39H49z" fill="#80a79a" />
      <rect x="270" y="38" width="51" height="106" rx="12" fill="#d4a076" stroke="#af805b" strokeWidth="3" />
      <path d="M280 48h30v38h-30zm0 45h30v39h-30z" fill="#e7ba90" />
      <ellipse cx="179" cy="104" rx="54" ry="31" fill="#957452" />
      <ellipse cx="179" cy="97" rx="54" ry="31" fill="#e0c29b" stroke="#b08b62" strokeWidth="3" />
      <rect x="150" y="87" width="27" height="19" rx="2" fill="#7594a1" transform="rotate(-12 150 87)" />
      <circle cx="197" cy="90" r="7" fill="#f8f0dc" />
      <circle cx="197" cy="90" r="4" fill="#8a6547" />
      <path d="M144 21h72v20h-72z" fill="#7f6951" />
      <path d="M151 23v15m10-15v15m12-15v15m11-15v15m13-15v15m10-15v15" stroke="#cad0ab" strokeWidth="6" />
    </svg>
  );
}
