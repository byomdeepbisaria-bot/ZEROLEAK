import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZEROLEAK | Local Redaction Workbench",
  description: "A local-first workspace for reviewing and redacting sensitive text.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
