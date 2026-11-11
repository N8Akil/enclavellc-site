import type { Metadata } from 'next'
import NightPage from './night/night-page'

// The home page is the Night Crew page. Title, Open Graph and robots come from the root layout (indexed);
// the description is this page's own pitch line. The previous home page lives at /classic, unlinked and out of search.
export const metadata: Metadata = {
  description: 'Your website, your follow-up and your content keep working after you close. One founder, six AI partners, one studio.',
  alternates: { canonical: 'https://enclavellc.net/' },
}

export default NightPage
