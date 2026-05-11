import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "LP Engineering Team Agent",
  description: "Static landing page generation workbench"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
