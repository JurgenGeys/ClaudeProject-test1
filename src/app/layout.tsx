import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elmija – testproject",
  description: "Oefenproject voor maatsoftware voor KMO's",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
