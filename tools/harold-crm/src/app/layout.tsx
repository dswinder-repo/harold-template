import type { Metadata } from 'next'
import { AuthProvider } from '@/components/AuthProvider'
import CommandPalette from '@/components/CommandPalette'
import { ToastProvider } from '@/components/ToastProvider'
import LayoutShell from '@/components/LayoutShell'
import './globals.css'

export const metadata: Metadata = {
  title: 'Harold CRM',
  description: 'Your relationships, across everything you work on. The relationship layer of Harold.',
}

// Inline script to set theme before paint — prevents flash of wrong theme
const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('harold-theme');
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch(e) {}
})();
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AuthProvider>
          <ToastProvider>
            <CommandPalette />
            <LayoutShell>{children}</LayoutShell>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
