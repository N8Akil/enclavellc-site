import type { Metadata } from 'next'

// The previous home page, kept as the way back. Not linked from anywhere and kept out of search.
export const metadata: Metadata = {
  title: 'Classic home',
  robots: { index: false, follow: false },
}

export default function ClassicLayout({ children }: { children: React.ReactNode }) {
  return children
}
