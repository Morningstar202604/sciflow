import type { SVGProps } from 'react';

/* ── Document pile with magnifying glass ── */
export function EmptyDocuments({ className = '' }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="brandDoc" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="55%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      {/* Document stack */}
      <rect x="20" y="45" width="50" height="38" rx="4" fill="url(#brandDoc)" opacity="0.15" stroke="url(#brandDoc)" strokeWidth="1.5" />
      <rect x="25" y="38" width="50" height="38" rx="4" fill="url(#brandDoc)" opacity="0.25" stroke="url(#brandDoc)" strokeWidth="1.5" />
      <rect x="30" y="31" width="50" height="38" rx="4" fill="url(#brandDoc)" opacity="0.4" stroke="url(#brandDoc)" strokeWidth="1.5" />
      {/* Doc lines */}
      <line x1="40" y1="50" x2="68" y2="50" stroke="url(#brandDoc)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="40" y1="57" x2="62" y2="57" stroke="url(#brandDoc)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <line x1="40" y1="64" x2="65" y2="64" stroke="url(#brandDoc)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      {/* Magnifying glass */}
      <circle cx="80" cy="58" r="14" stroke="url(#brandDoc)" strokeWidth="2.5" fill="url(#brandDoc)" fillOpacity="0.1" />
      <line x1="91" y1="69" x2="100" y2="78" stroke="url(#brandDoc)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="80" cy="58" r="6" stroke="url(#brandDoc)" strokeWidth="1.5" fill="none" opacity="0.5" />
    </svg>
  );
}

/* ── Search radar ── */
export function EmptySearch({ className = '' }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="brandSearch" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="55%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      {/* Radar circles */}
      <circle cx="60" cy="50" r="22" stroke="url(#brandSearch)" strokeWidth="1.5" opacity="0.25" />
      <circle cx="60" cy="50" r="14" stroke="url(#brandSearch)" strokeWidth="1.5" opacity="0.35" />
      <circle cx="60" cy="50" r="6" stroke="url(#brandSearch)" strokeWidth="1.5" opacity="0.5" />
      {/* Sweep line */}
      <line x1="60" y1="50" x2="78" y2="42" stroke="url(#brandSearch)" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      {/* Blips */}
      <circle cx="72" cy="40" r="3" fill="url(#brandSearch)" opacity="0.7" />
      <circle cx="55" cy="62" r="2.5" fill="url(#brandSearch)" opacity="0.6" />
      <circle cx="65" cy="36" r="2" fill="url(#brandSearch)" opacity="0.5" />
      {/* Center dot */}
      <circle cx="60" cy="50" r="2.5" fill="url(#brandSearch)" />
      {/* Crosshair */}
      <line x1="60" y1="24" x2="60" y2="28" stroke="url(#brandSearch)" strokeWidth="1" opacity="0.3" />
      <line x1="60" y1="72" x2="60" y2="76" stroke="url(#brandSearch)" strokeWidth="1" opacity="0.3" />
      <line x1="34" y1="50" x2="38" y2="50" stroke="url(#brandSearch)" strokeWidth="1" opacity="0.3" />
      <line x1="82" y1="50" x2="86" y2="50" stroke="url(#brandSearch)" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

/* ── Chat bubble with dots ── */
export function EmptyChat({ className = '' }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="brandChat" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="55%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      {/* Main bubble */}
      <rect x="20" y="22" width="65" height="40" rx="14" fill="url(#brandChat)" opacity="0.15" stroke="url(#brandChat)" strokeWidth="1.5" />
      {/* Tail */}
      <path d="M35 62 L30 72 L42 65 Z" fill="url(#brandChat)" opacity="0.25" />
      {/* Typing dots */}
      <circle cx="40" cy="42" r="3.5" fill="url(#brandChat)" opacity="0.7" />
      <circle cx="53" cy="42" r="3.5" fill="url(#brandChat)" opacity="0.5" />
      <circle cx="66" cy="42" r="3.5" fill="url(#brandChat)" opacity="0.35" />
      {/* Secondary smaller bubble */}
      <rect x="55" y="58" width="35" height="24" rx="10" fill="url(#brandChat)" fillOpacity="0.08" stroke="url(#brandChat)" strokeWidth="1.2" strokeOpacity="0.3" />
      <circle cx="66" cy="70" r="2" fill="url(#brandChat)" opacity="0.4" />
      <circle cx="75" cy="70" r="2" fill="url(#brandChat)" opacity="0.3" />
    </svg>
  );
}

/* ── Open book with knowledge nodes ── */
export function EmptyKnowledge({ className = '' }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="brandKnowledge" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="55%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      {/* Book spine */}
      <line x1="60" y1="30" x2="60" y2="72" stroke="url(#brandKnowledge)" strokeWidth="2" opacity="0.6" />
      {/* Left page */}
      <path d="M60 30 Q42 28 25 32 L25 70 Q42 66 60 72 Z" fill="url(#brandKnowledge)" opacity="0.15" stroke="url(#brandKnowledge)" strokeWidth="1.5" />
      {/* Right page */}
      <path d="M60 30 Q78 28 95 32 L95 70 Q78 66 60 72 Z" fill="url(#brandKnowledge)" opacity="0.2" stroke="url(#brandKnowledge)" strokeWidth="1.5" />
      {/* Page lines left */}
      <line x1="32" y1="44" x2="55" y2="42" stroke="url(#brandKnowledge)" strokeWidth="1" strokeLinecap="round" opacity="0.3" />
      <line x1="32" y1="50" x2="53" y2="48" stroke="url(#brandKnowledge)" strokeWidth="1" strokeLinecap="round" opacity="0.25" />
      <line x1="32" y1="56" x2="52" y2="54" stroke="url(#brandKnowledge)" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
      {/* Page lines right */}
      <line x1="65" y1="42" x2="88" y2="44" stroke="url(#brandKnowledge)" strokeWidth="1" strokeLinecap="round" opacity="0.3" />
      <line x1="67" y1="48" x2="88" y2="50" stroke="url(#brandKnowledge)" strokeWidth="1" strokeLinecap="round" opacity="0.25" />
      <line x1="68" y1="54" x2="88" y2="56" stroke="url(#brandKnowledge)" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
      {/* Knowledge nodes */}
      <circle cx="38" cy="22" r="4" fill="url(#brandKnowledge)" opacity="0.7" />
      <circle cx="82" cy="22" r="4" fill="url(#brandKnowledge)" opacity="0.7" />
      <circle cx="60" cy="16" r="4" fill="url(#brandKnowledge)" opacity="0.8" />
      {/* Connecting lines */}
      <line x1="38" y1="22" x2="60" y2="16" stroke="url(#brandKnowledge)" strokeWidth="1" opacity="0.3" />
      <line x1="82" y1="22" x2="60" y2="16" stroke="url(#brandKnowledge)" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

/* ── Flowchart with playing/done nodes ── */
export function EmptyPipeline({ className = '' }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="brandPipeline" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="55%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      {/* Connection lines */}
      <path d="M30 50 L45 50" stroke="url(#brandPipeline)" strokeWidth="1.5" opacity="0.4" />
      <path d="M58 50 L68 50" stroke="url(#brandPipeline)" strokeWidth="1.5" opacity="0.4" />
      <path d="M82 50 L90 50" stroke="url(#brandPipeline)" strokeWidth="1.5" opacity="0.4" />
      {/* Nodes */}
      <rect x="14" y="38" width="18" height="24" rx="4" fill="url(#brandPipeline)" opacity="0.3" stroke="url(#brandPipeline)" strokeWidth="1.2" />
      <rect x="46" y="38" width="14" height="24" rx="4" fill="url(#brandPipeline)" opacity="0.5" stroke="url(#brandPipeline)" strokeWidth="1.2" />
      <rect x="70" y="38" width="14" height="24" rx="4" fill="url(#brandPipeline)" opacity="0.15" stroke="url(#brandPipeline)" strokeWidth="1.2" strokeDasharray="3 2" />
      <rect x="92" y="38" width="14" height="24" rx="4" fill="url(#brandPipeline)" opacity="0.08" stroke="url(#brandPipeline)" strokeWidth="1.2" strokeDasharray="3 2" />
      {/* Play icon on middle */}
      <polygon points="51,44 51,56 60,50" fill="url(#brandPipeline)" opacity="0.6" />
      {/* Check on first */}
      <path d="M19 50 L23 54 L29 45" stroke="url(#brandPipeline)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      {/* Branch at bottom */}
      <path d="M53 62 L53 72 L35 72 L35 78" stroke="url(#brandPipeline)" strokeWidth="1" opacity="0.3" strokeDasharray="3 2" />
      <path d="M53 62 L53 72 L78 72 L78 78" stroke="url(#brandPipeline)" strokeWidth="1" opacity="0.3" strokeDasharray="3 2" />
      <rect x="27" y="77" width="16" height="12" rx="3" fill="url(#brandPipeline)" opacity="0.1" stroke="url(#brandPipeline)" strokeWidth="0.8" strokeDasharray="2 2" />
      <rect x="70" y="77" width="16" height="12" rx="3" fill="url(#brandPipeline)" opacity="0.1" stroke="url(#brandPipeline)" strokeWidth="0.8" strokeDasharray="2 2" />
    </svg>
  );
}
