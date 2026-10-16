import { Check, ShieldCheck } from 'lucide-react'

/** Decorative product artwork. The labels describe the service, not live repair status. */
export default function DeviceCareVisual({ compact = false }: { compact?: boolean }) {
  return <div className={`device-care-visual${compact ? ' device-care-visual--compact' : ''}`} aria-hidden="true">
    <div className="device-care-halo" />
    <svg viewBox="0 0 360 248" fill="none" className="device-care-laptop">
      <defs>
        <linearGradient id={compact ? 'screen-compact' : 'screen-full'} x1="85" y1="40" x2="290" y2="210" gradientUnits="userSpaceOnUse"><stop stopColor="#193F69" /><stop offset="1" stopColor="#0B2039" /></linearGradient>
      </defs>
      <rect x="59" y="27" width="242" height="163" rx="13" fill="#B7D6E8" />
      <rect x="63" y="31" width="234" height="155" rx="10" fill="#091C31" />
      <rect x="71" y="40" width="218" height="137" rx="5" fill={`url(#${compact ? 'screen-compact' : 'screen-full'})`} />
      <path d="M71 77H289M71 114H289M71 151H289M108 40V177M145 40V177M182 40V177M219 40V177M256 40V177" stroke="#6EC1E4" strokeOpacity=".09" />
      <circle cx="180" cy="107" r="47" fill="#14E1F0" fillOpacity=".07" stroke="#6EC1E4" strokeOpacity=".24" />
      <circle cx="180" cy="107" r="34" fill="#14E1F0" fillOpacity=".07" />
      <path d="M197 87a18 18 0 0 0-23 23l-22 22a7 7 0 0 0 10 10l22-22a18 18 0 0 0 23-23l-12 12-10-10 12-12Z" stroke="#84E8F0" strokeWidth="3" strokeLinejoin="round" />
      <path d="M59 190 24 211c-5 3-3 9 3 10h306c6-1 8-7 3-10l-35-21H59Z" fill="#DCEAF3" />
      <path d="M30 218h300" stroke="#8FAFC5" strokeWidth="3" strokeLinecap="round" />
      <path d="M152 191h56l8 10h-72l8-10Z" fill="#AAC6D9" />
      <circle cx="180" cy="35" r="1.5" fill="#6EC1E4" />
      <path d="m252 137 3 23 6-7 9 1-18-17Z" fill="#FFAB65" stroke="#0B2039" strokeWidth="2" strokeLinejoin="round" />
    </svg>
    <div className="device-care-tag device-care-tag--top"><span className="device-care-tag-icon"><ShieldCheck size={16} /></span><span>Expert hands.<br /><strong>Better care.</strong></span></div>
    <div className="device-care-tag device-care-tag--bottom"><span className="device-care-check"><Check size={13} strokeWidth={3} /></span>Clear quotes. No guesswork.</div>
    <div className="device-care-caption"><span />A fresh start for your tech</div>
  </div>
}
