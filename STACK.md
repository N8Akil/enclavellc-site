# Enclave LLC - Stack & Deployment Documentation

**Domain**: https://enclavellc.net
**Repository**: https://github.com/N8Akil/enclavellc-site
**Project Location**: `/mnt/extreme-pro/enclavellc-site`
**Port**: 3008
**PM2 Process**: `enclavellc`

---

## Tech Stack

### Runtime
| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 22.17.1 | LTS - same as all other sites |
| npm | 11.5.2 | Package manager |
| PM2 | Latest | Process manager with auto-restart |

### Framework
| Package | Version | Purpose |
|---------|---------|---------|
| Next.js | ^15.5.5 | App Router, React Server Components |
| React | ^19.2.0 | UI library |
| React-DOM | ^19.2.0 | DOM rendering |
| TypeScript | ^5 | Type safety |

### Styling
| Package | Version | Purpose |
|---------|---------|---------|
| Tailwind CSS | ^4.1.9 | Utility-first CSS |
| @tailwindcss/postcss | ^4.1.9 | PostCSS integration |
| autoprefixer | ^10.4.20 | Vendor prefixes |
| tw-animate-css | ^1.4.0 | Animation utilities |
| tailwind-merge | ^3.4.0 | Class merging |
| clsx | ^2.1.1 | Conditional classes |
| class-variance-authority | ^0.7.1 | Variant management |

### UI Components
| Package | Version | Purpose |
|---------|---------|---------|
| lucide-react | ^0.556.0 | Icons |
| framer-motion | ^12.23.12 | Animations |
| next-themes | ^0.4.6 | Dark/light mode |
| sonner | ^2.0.7 | Toast notifications |
| @radix-ui/* | Latest | Accessible primitives |

### Forms
| Package | Version | Purpose |
|---------|---------|---------|
| react-hook-form | ^7.68.0 | Form state management |
| @hookform/resolvers | ^5.2.2 | Schema validation |
| zod | ^4.1.13 | Schema validation |

---

## Infrastructure

### Server
- **Location**: Self-hosted VPS (96.40.219.151)
- **OS**: Ubuntu Linux 6.8.0
- **Storage**: /mnt/extreme-pro (SSD)

### Cloudflare
- **Tunnel ID**: 31303bf3-8302-4faa-9cba-94985a29ad5a
- **Tunnel Name**: enclave
- **DNS**: Managed via Cloudflare (nameservers: alexia.ns.cloudflare.com, charles.ns.cloudflare.com)
- **SSL**: Automatic via Cloudflare (free)
- **Email Routing**: n.garrett@enclavellc.net → nathan.akil.garrett@gmail.com

### Process Management
```bash
# PM2 Process
Name: enclavellc
Port: 3008
Status: Online
Auto-restart: Yes
```

---

## n8n Integration

### Webhook Configuration
- **n8n Instance**: http://localhost:5680 (internal) / https://n8n.ienclave.io (external)
- **Webhook Endpoint**: `/webhook/enclavellc-contact`
- **Authentication**: Bearer token (optional)

### Contact Form Payload
```json
{
  "timestamp": "2025-12-17T00:00:00.000Z",
  "source": "enclavellc.net",
  "formType": "contact",
  "data": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "555-123-4567",
    "message": "I need a website rebuild",
    "service": "Website Rebuild"
  },
  "metadata": {
    "userAgent": "Mozilla/5.0...",
    "ip": "xxx.xxx.xxx.xxx"
  }
}
```

### Environment Variables
```bash
# .env.local
N8N_WEBHOOK_URL=http://localhost:5680/webhook/enclavellc-contact
N8N_WEBHOOK_TOKEN=your_token_here
```

---

## Directory Structure

```
/mnt/extreme-pro/enclavellc-site/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── contact/
│   │   │       └── route.ts      # Contact form API
│   │   ├── globals.css           # Tailwind + design tokens
│   │   ├── layout.tsx            # Root layout
│   │   └── page.tsx              # Homepage
│   ├── components/
│   │   └── ui/                   # shadcn/ui components
│   └── lib/
│       └── utils.ts              # Utility functions
├── public/                       # Static assets
├── .env.local                    # Environment variables
├── .env.local.example            # Example env file
├── next.config.ts                # Next.js config
├── postcss.config.mjs            # PostCSS config
├── tsconfig.json                 # TypeScript config
├── package.json                  # Dependencies
└── STACK.md                      # This file
```

---

## Design System

### Theme: Platinum/Brushed Metal with Red/Orange/Yellow Accents

#### Colors (Light Mode)
| Token | Value | Usage |
|-------|-------|-------|
| `--color-background` | oklch(98% 0.005 250) | Page background |
| `--color-surface` | oklch(96% 0.005 250) | Cards, panels |
| `--color-border` | oklch(88% 0.01 250) | Borders |
| `--color-text-primary` | oklch(20% 0.01 250) | Headings |
| `--color-text-secondary` | oklch(45% 0.01 250) | Body text |
| `--color-platinum` | oklch(75% 0.01 250) | Brand primary |
| `--color-steel` | oklch(55% 0.02 250) | Brand secondary |

#### Accent Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--color-accent-red` | oklch(55% 0.22 25) | CTAs, alerts |
| `--color-accent-orange` | oklch(65% 0.2 45) | Highlights |
| `--color-accent-yellow` | oklch(80% 0.15 85) | Accent |

#### Typography
- **Font**: Inter (Google Fonts via Next.js)
- **Headings**: Bold, gradient text for emphasis
- **Body**: Regular weight, good contrast

---

## Development Commands

```bash
# Navigate to project
cd /mnt/extreme-pro/enclavellc-site

# Install dependencies
npm install

# Run development server (port 3008)
npm run dev

# Build for production
NEXT_TELEMETRY_DISABLED=1 npm run build

# Start production server
npm start

# Lint code
npm run lint
```

---

## Deployment Commands

```bash
# Build and deploy
cd /mnt/extreme-pro/enclavellc-site
rm -rf .next
NEXT_TELEMETRY_DISABLED=1 npm run build
pm2 restart enclavellc

# Or if PM2 process doesn't exist
PORT=3008 pm2 start npm --name "enclavellc" -- start
pm2 save

# Restart tunnel (if needed)
pm2 restart enclave-tunnel
```

---

## Cloudflare Zero Trust Setup (REQUIRED)

The tunnel uses remote configuration from Cloudflare dashboard. To add enclavellc.net:

1. Go to: https://one.dash.cloudflare.com
2. Navigate to: **Networks** → **Tunnels** → **enclave** → **Configure**
3. Add Public Hostname:
   - **Subdomain**: (leave empty for root)
   - **Domain**: enclavellc.net
   - **Service**: http://localhost:3008
4. Add another for www:
   - **Subdomain**: www
   - **Domain**: enclavellc.net
   - **Service**: http://localhost:3008
5. Save configuration

The tunnel will automatically pick up the new routes.

---

## Comparison with Other Sites

| Site | Port | Stack | Status |
|------|------|-------|--------|
| ienclave.io | 3004 (via nginx) | Next.js 15 + React 19 + Monorepo | Production |
| angelscare-homehealth.com | 3007 | Next.js 16 + React 19 | Production |
| kingblvd.net | 3005 | Next.js 15 + React 19 | Production |
| queenblvd.net | 3006 | Next.js 15 + React 19 | Production |
| **enclavellc.net** | **3008** | **Next.js 15 + React 19** | **Ready** |

---

## For Frontend Team (ChatGPT)

### Converting HTML Template to Next.js

1. **Page Structure**:
   - Put page content in `src/app/page.tsx`
   - Use `'use client'` directive for interactive components
   - Keep server components for static content

2. **Styling**:
   - All CSS goes in `src/app/globals.css`
   - Use Tailwind utilities in JSX
   - Design tokens available as CSS variables

3. **Components**:
   - Create in `src/components/`
   - Use `src/components/ui/` for shadcn-style primitives
   - Import with `@/components/...`

4. **Forms**:
   - Use react-hook-form + zod for validation
   - Submit to `/api/contact` endpoint
   - Webhook payload automatically sent to n8n

5. **Images**:
   - Put in `public/` directory
   - Use Next.js `<Image>` component for optimization
   - External images allowed from unsplash.com and cloudinary.com

6. **Dark Mode**:
   - Handled by next-themes
   - Use `.dark` CSS selector or `dark:` Tailwind prefix
   - Toggle with `useTheme()` hook

### Example Component Structure
```tsx
'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export function Hero() {
  return (
    <section className="min-h-screen flex items-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="text-5xl font-bold gradient-text">
          DIGITAL OVERHAUL
        </h1>
        <p className="text-[var(--color-text-secondary)]">
          Modern websites and automation for small businesses.
        </p>
      </motion.div>
    </section>
  )
}
```

---

## Contact

- **Developer**: Nathan Garrett
- **Email**: n.garrett@enclavellc.net
- **Phone**: (424) 202-7591

---

*Last Updated: December 17, 2025*
