import type { SVGProps } from "react";

export default function CortexGateway(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 1200 1200" role="img" aria-labelledby="cortex-gateway-title" {...props}>
      <title id="cortex-gateway-title">Arcane dungeon gateway</title>
      <defs>
        <radialGradient id="gateway-mist" cx="50%" cy="44%" r="48%">
          <stop offset="0" stopColor="#d6c1ff" stopOpacity="0.65" />
          <stop offset="0.28" stopColor="#845bc9" stopOpacity="0.38" />
          <stop offset="0.72" stopColor="#2e1f4e" stopOpacity="0.12" />
          <stop offset="1" stopColor="#090711" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="gateway-portal" cx="50%" cy="45%" r="55%">
          <stop offset="0" stopColor="#f9ecb4" />
          <stop offset="0.18" stopColor="#e3c15b" />
          <stop offset="0.34" stopColor="#9c72dc" />
          <stop offset="0.7" stopColor="#3b235f" />
          <stop offset="1" stopColor="#0b0912" />
        </radialGradient>
        <linearGradient id="gateway-stone" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#2d2937" />
          <stop offset="1" stopColor="#0a0910" />
        </linearGradient>
        <linearGradient id="gateway-gold" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f5df8b" />
          <stop offset="0.5" stopColor="#c28b2e" />
          <stop offset="1" stopColor="#704018" />
        </linearGradient>
        <filter id="gateway-blur"><feGaussianBlur stdDeviation="22" /></filter>
        <filter id="gateway-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="10" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <ellipse cx="600" cy="544" rx="440" ry="420" fill="url(#gateway-mist)" />
      <ellipse cx="600" cy="548" rx="282" ry="330" fill="#5d3794" opacity="0.18" filter="url(#gateway-blur)" />

      <g opacity="0.58" fill="#5a456f">
        <path d="M184 454 290 398 330 465 250 515Z" />
        <path d="M924 396 1036 452 956 516 880 464Z" />
        <path d="M265 250 340 220 363 300 290 319Z" />
        <path d="M935 232 1012 279 947 326 904 290Z" />
      </g>

      <g strokeLinecap="round" fill="none">
        <circle cx="600" cy="520" r="338" stroke="#a77bdd" strokeOpacity="0.24" strokeWidth="3" strokeDasharray="5 22" />
        <circle cx="600" cy="520" r="295" stroke="#d9be68" strokeOpacity="0.24" strokeWidth="2" strokeDasharray="2 16" />
      </g>

      <g filter="url(#gateway-glow)">
        <ellipse cx="600" cy="516" rx="225" ry="278" fill="url(#gateway-portal)" stroke="#d7b867" strokeWidth="10" />
        <ellipse cx="600" cy="516" rx="182" ry="230" fill="#0d0915" stroke="#a581dc" strokeWidth="8" />
        <ellipse cx="600" cy="516" rx="143" ry="193" fill="url(#gateway-portal)" opacity="0.82" />
      </g>

      <path d="M417 585 446 331 508 245 692 245 754 331 783 585 735 608 703 364 654 297 546 297 497 364 465 608Z" fill="url(#gateway-stone)" stroke="#5b4d6c" strokeWidth="7" />

      <g fill="url(#gateway-gold)">
        <path d="m600 197 19 33-19 31-19-31z" />
        <path d="m389 424 31 18 3 36-33-15z" />
        <path d="m811 424-31 18-3 36 33-15z" />
        <path d="m450 280 26 15-4 30-25-14z" />
        <path d="m750 280-26 15 4 30 25-14z" />
      </g>

      <path d="M522 738 678 738 803 1092 397 1092Z" fill="url(#gateway-stone)" stroke="#4c4159" strokeWidth="6" />
      <path d="M547 738 653 738 716 1092 484 1092Z" fill="#15121c" />
      <path d="M600 760v332M560 820l-32 272M640 820l32 272" stroke="#8a6c3c" strokeOpacity="0.38" strokeWidth="4" />
      <ellipse cx="600" cy="1100" rx="300" ry="38" fill="#000" opacity="0.36" filter="url(#gateway-blur)" />
    </svg>
  );
}
