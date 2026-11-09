// The stage: the director first, then one partner steps into the spot per screen.
// w/h: cutout size in pixels; fx: the head's offset from the cutout's centre, as a share of its width (measured from the alpha).
export type CrewMember = {
  id: string
  name: string
  role: string
  call: string
  line: string
  does: string[]
  demo: 'board' | 'wf' | 'code' | 'uptime' | 'cal' | 'checks' | 'gantt'
  w: number
  h: number
  fx: number
  dir?: boolean
}

export const crew: CrewMember[] = [
  { id: 'nate', name: 'Nate', role: 'Director · Founder', call: 'Your hours', line: 'Every call with you, every decision, final approval. You always talk to a person.', does: ['One call to understand your business', 'Every decision runs past him', 'Final approval before anything ships'], demo: 'board', w: 1653, h: 1150, fx: -0.045, dir: true },
  { id: 'isis', name: 'Isis', role: 'Design and build', call: 'Always on', line: 'Turns your business into a site people trust in the first five seconds.', does: ['Layouts that work on a phone first', 'Native iPhone apps, built in Swift', 'Your brand, colors and type, made consistent'], demo: 'wf', w: 750, h: 1150, fx: 0.045 },
  { id: 'thoth', name: 'Thoth', role: 'Engineering', call: 'Always on', line: 'Connects the pieces so a form becomes a booked customer without you lifting a finger.', does: ['Booking and contact forms that route themselves', 'Follow-up emails and reminders', 'Connections to the tools you already use'], demo: 'code', w: 1221, h: 1099, fx: -0.203 },
  { id: 'ra', name: 'Ra', role: 'Operations', call: 'After hours too', line: 'Keeps everything fast, backed up and online.', does: ['Hosting, security and backups', 'Watching for problems before you do', 'Updates without the downtime'], demo: 'uptime', w: 786, h: 1181, fx: -0.008 },
  { id: 'horus', name: 'Horus', role: 'Content and social', call: 'On schedule', line: 'Keeps you visible with posts, videos and newsletters in your voice.', does: ['A posting calendar you approve', 'Short videos and graphics', 'Replies and simple monthly reporting'], demo: 'cal', w: 734, h: 1166, fx: -0.04 },
  { id: 'osiris', name: 'Osiris', role: 'Quality review', call: 'Before every release', line: 'Checks every page, link and word before anything reaches your customers.', does: ['Speed and accessibility checks', 'Every link and form tested', 'Copy read for clarity and accuracy'], demo: 'checks', w: 902, h: 1174, fx: -0.063 },
  { id: 'amun', name: 'Amun', role: 'Planning [confirm]', call: 'At kickoff', line: 'Maps the work into a clear plan and one price, so there are no surprises.', does: ['A written plan with milestones', 'One quote, agreed up front', 'Progress you can see each week'], demo: 'gantt', w: 658, h: 1152, fx: 0.068 },
]

export const crewSrc = (id: string) => `/night/crew/${id}.webp`

export const pad = (n: number) => String(n).padStart(2, '0')

// Phone cards are sized by height, so a landscape cutout matches the rest; a wide one is cropped around the head.
export function mobileCardFrame(c: CrewMember) {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  const iw = 190 * c.w / c.h, bw = Math.min(132, iw), hx = 0.5 + c.fx, ox = iw > bw ? clamp01((hx * iw - bw / 2) / (iw - bw)) : 0.5
  return {
    hx: `${Math.round(iw > bw ? (hx * iw - ox * (iw - bw)) / bw * 100 : hx * 100)}%`,
    objectPosition: `${Math.round(ox * 100)}% 100%`,
  }
}
