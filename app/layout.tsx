import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sapthagiri Dosa Ordering",
  description: "QR-based ordering for the dosa station at Sapthagiri.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
