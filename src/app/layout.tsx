import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Enclave LLC | Digital Overhaul for Small Business',
    template: '%s | Enclave LLC',
  },
  description:
    'Website rebuilds, AI automation, and content systems for small businesses. Modern technology made simple.',
  keywords: [
    'website rebuild',
    'small business website',
    'AI automation',
    'business automation',
    'digital transformation',
    'content marketing',
    'St. Louis web design',
  ],
  authors: [{ name: 'Enclave LLC' }],
  creator: 'Enclave LLC',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://enclavellc.net',
    siteName: 'Enclave LLC',
    title: 'Enclave LLC | Digital Overhaul for Small Business',
    description:
      'Website rebuilds, AI automation, and content systems for small businesses.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Enclave LLC | Digital Overhaul',
    description:
      'Modern websites and automation for small businesses.',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
