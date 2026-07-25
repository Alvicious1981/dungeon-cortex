import type { SVGProps } from "react";

export default function CortexSigil(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 512 512" role="img" aria-labelledby="cortex-sigil-title" {...props}>
      <title id="cortex-sigil-title">Dungeon Cortex sigil</title>
      <defs>
        <radialGradient id="cortex-core" cx="42%" cy="35%" r="70%">
          <stop offset="0" stopColor="#fff4bd" />
          <stop offset="0.4" stopColor="#e7c65c" />
          <stop offset="1" stopColor="#7b4218" />
        </radialGradient>
        <linearGradient id="cortex-violet" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#e2d4ff" />
          <stop offset="0.55" stopColor="#a783e4" />
          <stop offset="1" stopColor="#4b2b86" />
        </linearGradient>
        <filter id="cortex-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="12" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle cx="256" cy="256" r="218" fill="#090812" stroke="#5f4b78" strokeWidth="10" />
      <circle
        cx="256"
        cy="256"
        r="190"
        fill="none"
        stroke="#b595d8"
        strokeOpacity="0.48"
        strokeWidth="3"
        strokeDasharray="4 18"
      />

      <g fill="#d7b95b" opacity="0.8">
        <path d="M256 34l9 22-9 18-9-18z" />
        <path d="M478 256l-22 9-18-9 18-9z" />
        <path d="M256 478l-9-22 9-18 9 18z" />
        <path d="M34 256l22-9 18 9-18 9z" />
      </g>

      <g filter="url(#cortex-glow)">
        <path d="M256 112 382 206 334 365 178 365 130 206Z" fill="#121020" stroke="url(#cortex-violet)" strokeWidth="10" />
        <path d="M256 145 346 213 312 327 200 327 166 213Z" fill="none" stroke="#7c5bb6" strokeWidth="5" />
        <path d="M256 174 315 219 293 294 219 294 197 219Z" fill="url(#cortex-core)" stroke="#f3dc8a" strokeWidth="7" />
      </g>

      <path d="M218 239c15-19 33-29 38-29s23 10 38 29c-17-7-30-10-38-10s-21 3-38 10Z" fill="#180e0a" opacity="0.82" />
      <circle cx="256" cy="247" r="18" fill="#090812" stroke="#f6e7a4" strokeWidth="6" />
      <circle cx="256" cy="247" r="6" fill="#d6b44f" />
      <path d="M209 328v-30h94v30M228 328v-55h56v55M247 328v-33h18v33" fill="none" stroke="#0b0912" strokeWidth="12" strokeLinejoin="round" />
      <path
        d="M147 183c-28 26-45 61-47 101M365 183c28 26 45 61 47 101M163 349c25 34 57 53 93 57M349 349c-25 34-57 53-93 57"
        fill="none"
        stroke="#d5c0ff"
        strokeOpacity="0.42"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}
