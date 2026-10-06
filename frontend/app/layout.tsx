import type { Metadata } from "next";
import localFont from "next/font/local";
import { NavigationProvider } from '@/lib/contexts/navigation-context'
import { UserProvider } from '@/lib/contexts/user-context'
import { ToastProvider } from '@/lib/contexts/toast-context'
import { LoadingProvider } from '@/lib/contexts/loading-context'
import { TracerProvider } from '@/lib/behavior/tracer'
import { HelpChatWidget } from '@/components/help-chat/chat-widget'
import "./globals.css";

// Fonts are self-hosted from Fontsource packages (the same Google Fonts files, latin
// subset), so the build never fetches fonts.googleapis.com. next/font/google made
// Turbopack builds fail at random when Google returned extensionless `…&skey=…` URLs
// (vercel/next.js#99114; roadmap 8.1, 2026-10-02). Variable fonts declare their weight range.
// Removed as unused: Pirata One, Bodoni Moda, Special Elite.

const geistSans = localFont({
  src: '../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
  weight: '100 900',
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: '../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
  weight: '100 900',
  variable: "--font-geist-mono",
  display: "swap",
});

const anton = localFont({
  src: [
    { path: '../node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2', weight: '400', style: 'normal' },
  ],
  variable: "--font-anton",
  display: "swap",
});

const bebasNeue = localFont({
  src: [
    { path: '../node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2', weight: '400', style: 'normal' },
  ],
  variable: "--font-bebas",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: '../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  variable: "--font-jetbrains",
  display: "swap",
});

const inter = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  weight: '100 900',
  variable: "--font-inter",
  display: "swap",
});

const cinzel = localFont({
  src: '../node_modules/@fontsource-variable/cinzel/files/cinzel-latin-wght-normal.woff2',
  weight: '400 900',
  variable: "--font-cinzel",
  display: "swap",
});

const cormorantSC = localFont({
  src: [
    { path: '../node_modules/@fontsource/cormorant-sc/files/cormorant-sc-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/cormorant-sc/files/cormorant-sc-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../node_modules/@fontsource/cormorant-sc/files/cormorant-sc-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: "--font-cormorant-sc",
  display: "swap",
});

const ebGaramond = localFont({
  src: [
    { path: '../node_modules/@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2', weight: '400 800', style: 'normal' },
    { path: '../node_modules/@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-italic.woff2', weight: '400 800', style: 'italic' },
  ],
  variable: "--font-eb-garamond",
  display: "swap",
});

const plexMono = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

const fraunces = localFont({
  src: [
    { path: '../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2', weight: '100 900', style: 'normal' },
    { path: '../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2', weight: '100 900', style: 'italic' },
  ],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Zero Day Market",
  description: "Master trading through history",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} ${bebasNeue.variable} ${jetbrainsMono.variable} ${inter.variable} ${cinzel.variable} ${cormorantSC.variable} ${ebGaramond.variable} ${plexMono.variable} ${fraunces.variable} font-sans antialiased`}
      >
        <TracerProvider>
          <UserProvider>
            <ToastProvider>
              <LoadingProvider>
                <NavigationProvider>
                  {children}
                  <HelpChatWidget/>
                </NavigationProvider>
              </LoadingProvider>
            </ToastProvider>
          </UserProvider>
        </TracerProvider>
      </body>
    </html>
  );
}
