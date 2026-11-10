import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Static pins for the home-page swap: which file serves /, that it is indexable, and that the two other addresses behave.
const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')

describe('the Night Crew page is the home page', () => {
  it('/ renders the Night Crew page and does not opt out of search', () => {
    const home = read('src/app/page.tsx')
    expect(home).toMatch(/import NightPage from '\.\/night\/night-page'/)
    expect(home).toMatch(/export default NightPage/)
    expect(home).not.toMatch(/robots\s*:/)
    expect(home).not.toMatch(/index:\s*false/)
  })
  it('the page component itself carries no metadata (a noindex there would be dead text that looks live)', () => {
    const page = read('src/app/night/night-page.tsx')
    expect(page).not.toMatch(/export const metadata/)
    expect(page).not.toMatch(/index:\s*false/)
    expect(page).not.toMatch(/preview/i)
  })
  it('/night redirects to /', () => {
    const night = read('src/app/night/page.tsx')
    expect(night).toMatch(/redirect\('\/'\)/)
  })
  it('the previous home page is at /classic and is kept out of search', () => {
    expect(read('src/app/classic/page.tsx')).toMatch(/export default function HomePage/)
    expect(read('src/app/classic/layout.tsx')).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/)
  })
  it('the root layout still allows indexing', () => {
    expect(read('src/app/layout.tsx')).toMatch(/robots:\s*\{\s*index:\s*true,\s*follow:\s*true,?\s*\}/)
  })
})
