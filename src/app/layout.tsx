import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { BrandProvider, brandBootScript } from "@credigit/web-ui";
import { PlatformProvider } from "@/components/platform-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Smart Enterprise Risk 360°", template: "%s · Smart Enterprise Risk 360°" },
  description: "Credit and enterprise risk management for banks and microfinance institutions.",
  applicationName: "Smart Enterprise Risk 360°",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/credigit-favicon-small.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/favicon-180.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: brandBootScript() }} />
      </head>
      <body className="bg-bg font-sans text-fg antialiased">
        <BrandProvider>
          <PlatformProvider>{children}</PlatformProvider>
        </BrandProvider>
      </body>
    </html>
  );
}
