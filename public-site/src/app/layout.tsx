import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Familjen_Grotesk,
  Space_Mono,
} from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
});

const familjen = Familjen_Grotesk({
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  variable: "--font-familjen",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "LeadLoop — Leads in. Leases out.",
  description:
    "Run a whole leasing operation as one board. Stages are groups, leads are rows, and every visit, message and signature lands on the same line — built in Montréal, in both languages.",
  openGraph: {
    title: "LeadLoop — Leads in. Leases out.",
    description:
      "Board-based leasing CRM for Montréal property teams. EN + FR, single tenant, everything on.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${familjen.variable} ${spaceMono.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
