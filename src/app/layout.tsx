import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sophon",
  description: "A mechanistic interpretability visualization workbench"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
