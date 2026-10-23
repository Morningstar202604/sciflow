/** SciFlow 品牌标志（唯一矢量来源，与 docs/brand/logo-mark-light.svg 同路径） */
export function BrandMark({ className = 'h-5 w-5', title = 'SciFlow' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      <path
        d="M 46.2 16.8 C 40.4 11.0, 28.2 10.5, 22.8 16.4 C 17.1 22.6, 23.2 29.3, 32.0 31.4 C 40.7 33.5, 47.0 36.9, 44.8 43.4 C 42.5 49.9, 31.3 52.4, 20.6 46.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="5.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 品牌组合：标志 + 词标 + 标语（侧栏/登录门/关于页共用） */
export function BrandLockup({ subtitle = '让科研从想法到成文' }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="brand-logo flex h-8 w-8 items-center justify-center rounded-lg">
        <BrandMark className="h-5 w-5" />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Sci<span className="brand-gradient-text">Flow</span>
        </div>
        <div className="-mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</div>
      </div>
    </div>
  );
}
