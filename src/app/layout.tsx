import type { Metadata, Viewport } from "next";
import { AuthGate } from "@/components/AuthGate";
import { AuthProvider } from "@/lib/auth-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { productTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: `${productTheme.name} — Conversational Video`,
  description: productTheme.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("dark font-sans antialiased")}>
      <body className="min-h-svh max-w-[100vw] overflow-x-hidden font-sans antialiased">
        <AuthProvider>
          <TooltipProvider>
            <AuthGate>{children}</AuthGate>
          </TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
