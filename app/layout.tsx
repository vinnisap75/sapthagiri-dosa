import type { Metadata } from "next";
import { Cormorant } from "next/font/google";
import "./globals.css";

// Display face for headings — an elegant high-contrast serif that echoes the
// calligraphic feel of the Sapthagiri logo wordmark. Exposed as a CSS variable
// so Tailwind's `font-display` utility resolves to it.
const display = Cormorant({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sapthagiri Dosa Ordering",
  description: "QR-based ordering for the dosa station at Sapthagiri.",
  icons: { icon: "/sapthagiri-wordmark-white.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
