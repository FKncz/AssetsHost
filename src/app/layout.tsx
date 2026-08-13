import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'AssetsHost',
  description: 'Self-hosted asset CDN',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col">{children}</div>
      </body>
    </html>
  );
}
