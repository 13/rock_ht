import { cn } from "@/lib/utils";

interface LogoMarkProps {
  className?: string;
  size?: number;
}

/** Sisyphus pushing the boulder — no background, scales via size prop */
export function LogoMark({ className, size = 32 }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {/* Hill */}
      <path
        d="M 4 88 Q 28 82 50 70 Q 66 62 96 50"
        stroke="#6366f1"
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.5"
      />

      {/* Boulder glow */}
      <circle cx="57" cy="55" r="22" fill="#6366f1" opacity="0.18" />

      {/* Boulder */}
      <circle cx="57" cy="55" r="18" fill="url(#boulder-grad)" />

      {/* Boulder highlight */}
      <ellipse
        cx="51"
        cy="49"
        rx="6"
        ry="4"
        fill="white"
        opacity="0.2"
        transform="rotate(-25 51 49)"
      />

      {/* Figure — legs */}
      <line x1="33" y1="76" x2="29" y2="90" stroke="url(#fig-grad)" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="41" y1="74" x2="39" y2="90" stroke="url(#fig-grad)" strokeWidth="4.5" strokeLinecap="round" />

      {/* Figure — torso leaning forward */}
      <line x1="35" y1="76" x2="44" y2="63" stroke="url(#fig-grad)" strokeWidth="5" strokeLinecap="round" />

      {/* Figure — arms pushing boulder */}
      <line x1="44" y1="63" x2="50" y2="59" stroke="url(#fig-grad)" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="40" y1="69" x2="46" y2="65" stroke="url(#fig-grad)" strokeWidth="4" strokeLinecap="round" />

      {/* Figure — head */}
      <circle cx="46" cy="60" r="7" fill="url(#fig-grad)" />

      {/* Motion lines above boulder */}
      <line x1="42" y1="39" x2="36" y2="32" stroke="#818cf8" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      <line x1="50" y1="35" x2="47" y2="27" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" opacity="0.38" />
      <line x1="58" y1="33" x2="57" y2="25" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" opacity="0.25" />

      <defs>
        <linearGradient id="boulder-grad" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id="fig-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e0e7ff" />
          <stop offset="100%" stopColor="#a5b4fc" />
        </linearGradient>
      </defs>
    </svg>
  );
}

interface LogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
  textClassName?: string;
}

export function Logo({ className, size = 32, showText = true, textClassName }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark size={size} />
      {showText && (
        <span className={cn("font-bold tracking-tight text-foreground", textClassName)}>
          sisiGo
        </span>
      )}
    </div>
  );
}
