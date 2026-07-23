import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Bricolage_Grotesque,
  IBM_Plex_Mono,
  Instrument_Sans,
} from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, SITE_TAGLINE } from "@/lib/site";
import "./globals.css";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: `${SITE_NAME} — Financial agent process control with evidence`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Ashlr AI" }],
  keywords: [
    "agent safety",
    "control plane",
    "MCP",
    "financial agent",
    "proof capsule",
    "process evidence",
    "shadow lab",
  ],
  alternates: { canonical: SITE_ORIGIN },
  openGraph: {
    type: "website",
    url: SITE_ORIGIN,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — process control with evidence`,
    description: SITE_TAGLINE,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — process control with evidence`,
    description: SITE_TAGLINE,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
