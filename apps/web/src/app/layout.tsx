import "./globals.css";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getWorkbenchCopy, resolveLocaleFromAcceptLanguage } from "../lib/i18n";

export async function generateMetadata() {
  const requestHeaders = await headers();
  const copy = getWorkbenchCopy(
    resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"))
  );

  return copy.metadata;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const locale = resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"));

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
