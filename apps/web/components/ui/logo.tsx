import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoMarkProps {
  className?: string;
  size?: number;
}

/** The rock rock. Generated from brand/rock.png by brand/generate.sh. */
export function LogoMark({ className, size = 32 }: LogoMarkProps) {
  return (
    <Image
      src="/brand/rock.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      loading="eager"
    />
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
          rock
        </span>
      )}
    </div>
  );
}
