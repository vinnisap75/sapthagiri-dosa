import Image from "next/image";

// Intrinsic pixel dimensions of the source PNGs in /public.
const ART = {
  full: { src: "/sapthagiri-logo.png", width: 600, height: 180 },
  wordmark: { src: "/sapthagiri-wordmark-white.png", width: 338, height: 95 },
} as const;

/**
 * Official Sapthagiri logo, white-on-transparent so it sits on the burgundy
 * headers. `full` shows the emblems + wordmark + tagline (brand moments like
 * the customer order/status screens); `wordmark` is the slimmer text-only mark
 * for compact headers (kitchen board, admin bars).
 *
 * Size with a Tailwind height class (e.g. `h-10`) — width auto-scales.
 */
export function BrandLogo({
  variant = "full",
  className = "h-10 w-auto",
  priority = false,
}: {
  variant?: "full" | "wordmark";
  className?: string;
  priority?: boolean;
}) {
  const art = ART[variant];
  return (
    <Image
      src={art.src}
      width={art.width}
      height={art.height}
      alt="Sapthagiri — Taste of India"
      className={className}
      priority={priority}
      sizes="(max-width: 640px) 60vw, 240px"
    />
  );
}
