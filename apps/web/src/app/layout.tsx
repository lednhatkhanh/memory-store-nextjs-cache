import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ClientProviders } from "./client-providers";
import "./styles.css";

export const metadata: Metadata = {
  description: "Reference application for the shared Next.js cache handler",
  title: "Memory Store Cache Reference",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html dir="ltr" lang="en-US">
      <body className="antialiased">
        <ClientProviders locale="en-US">{children}</ClientProviders>
      </body>
    </html>
  );
}
