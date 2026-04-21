import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "MLB Analyst AI",
  description:
    "Search current MLB hitters and estimate their chance to record a hit in a specific game.",
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
