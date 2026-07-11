import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { productTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: `${productTheme.name} — Conversational Video`,
  description: productTheme.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("dark font-sans antialiased")}>
      <body className="min-h-svh font-sans antialiased">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
