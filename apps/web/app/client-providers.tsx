"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "react-aria-components/I18nProvider";

type ClientProvidersProps = Readonly<{
  children: ReactNode;
  locale: string;
}>;

export function ClientProviders({ children, locale }: ClientProvidersProps) {
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
