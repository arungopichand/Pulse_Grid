import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PulseGrid Lite",
  description: "Momentum stock signal dashboard with a premium real-time inspired UI.",
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
