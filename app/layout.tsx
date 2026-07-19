import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PulseGrid — Live Momentum Scanner",
  description: "Real-time small-cap momentum alerts, halts, catalysts, and market intelligence.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
