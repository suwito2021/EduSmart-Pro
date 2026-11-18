import React from 'react';

export function PetalLogo({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g transform="translate(32,32)">
        {[0, 60, 120, 180, 240, 300].map((deg, idx) => (
          <path
            key={deg}
            d="M0,-6 C7,-12 10,-22 0,-29 C-10,-22 -7,-12 0,-6 Z"
            transform={`rotate(${deg})`}
            fill={idx % 2 === 0 ? '#0F766E' : '#14B8A6'}
            fillOpacity={idx % 2 === 0 ? 0.92 : 0.72}
          />
        ))}
        <circle cx="0" cy="0" r="6.5" fill="#FFFFFF" stroke="#0F766E" strokeWidth="2.5" />
        <circle cx="0" cy="0" r="2.5" fill="#0F766E" />
      </g>
    </svg>
  );
}

export function AnimatedPetalMotif() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Large rotating petal cluster derived from logo */}
      <svg
        viewBox="0 0 240 240"
        className="absolute -top-16 -right-16 h-72 w-72 text-teal-300/20 animate-petal-orbit"
        fill="none"
      >
        <g transform="translate(120,120)">
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <path
              key={deg}
              d="M0,-18 C24,-38 34,-76 0,-104 C-34,-76 -24,-38 0,-18 Z"
              transform={`rotate(${deg})`}
              stroke="currentColor"
              strokeWidth="1.5"
              fill="currentColor"
              fillOpacity="0.22"
            />
          ))}
        </g>
      </svg>

      {/* Drifting single petals */}
      <svg
        viewBox="0 0 80 120"
        className="absolute top-1/4 left-10 h-28 w-20 text-emerald-200/30 animate-petal-slow"
        fill="currentColor"
      >
        <path d="M40,8 C66,34 68,78 40,112 C12,78 14,34 40,8 Z" />
      </svg>

      <svg
        viewBox="0 0 80 120"
        className="absolute bottom-24 right-14 h-24 w-16 text-teal-100/25 animate-petal-reverse"
        fill="currentColor"
      >
        <path d="M40,8 C66,34 68,78 40,112 C12,78 14,34 40,8 Z" />
      </svg>

      <svg
        viewBox="0 0 160 160"
        className="absolute -bottom-10 -left-10 h-48 w-48 text-teal-200/15 animate-petal-slow"
        fill="none"
      >
        <g transform="translate(80,80)">
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <path
              key={deg}
              d="M0,-10 C15,-22 22,-48 0,-68 C-22,-48 -15,-22 0,-10 Z"
              transform={`rotate(${deg})`}
              fill="currentColor"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
