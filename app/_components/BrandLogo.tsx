import Image from "next/image";

// Intrinsic pixel dimensions of the source PNGs in /public.
//   full     — pale cream wordmark + colored emblems (already light; sits on burgundy as-is)
//   wordmark — monochrome BURGUNDY wordmark (the file name says "white" but the
//              art is brand-maroon). It's whitened at render time so it doesn't
//              camouflage against the burgundy header.
const ART = {
  full: { src: "/sapthagiri-logo.png", width: 600, height: 180, whiten: false },
  wordmark: { src: "/sapthagiri-wordmark-white.png", width: 338, height: 95, whiten: true },
} as const;

/**
 * Official Sapthagiri logo. `full` shows the emblems + wordmark + tagline (brand
 * moments like the customer order/status screens); `wordmark` is the slimmer
 * text-only mark for compact headers (kitchen board, admin bars).
 *
 * Both variants are meant for the burgundy headers. The wordmark art is maroon,
 * so `brightness-0 invert` flips it to solid white for contrast; the full logo
 * keeps its colors (the emblems must stay colorful).
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
      className={`${className}${art.whiten ? " brightness-0 invert" : ""}`}
      priority={priority}
      sizes="(max-width: 640px) 60vw, 240px"
    />
  );
}
