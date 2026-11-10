import { describe, expect, it } from 'vitest'
import { QUEUE_MAX_RUNNING, QUEUE_MAX_WAITING } from '@/lib/audit/config'
import { createAuditQueue } from '@/lib/audit/queue'

// a job that stops until the test lets it go
function gated() {
  let open!: () => void
  const gate = new Promise<void>((resolve) => (open = resolve))
  return { open, gate }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('the audit queue: at most 2 running and 5 waiting, in this one process', () => {
  it('the defaults are 2 and 5', () => {
    expect([QUEUE_MAX_RUNNING, QUEUE_MAX_WAITING]).toEqual([2, 5])
    const queue = createAuditQueue({ isClusterWorker: () => false })
    for (let i = 0; i < 7; i++) expect(queue.reserve()).toBe(true)
    expect(queue.reserve()).toBe(false)
    expect(queue.stats()).toEqual({ held: 7, running: 0, waiting: 0 })
  })

  it('seven places; the eighth request is refused; a place given back can be taken again', () => {
    const queue = createAuditQueue({ isClusterWorker: () => false })
    for (let i = 0; i < 7; i++) expect(queue.reserve()).toBe(true)
    for (let i = 0; i < 3; i++) expect(queue.reserve()).toBe(false)
    queue.release()
    expect(queue.reserve()).toBe(true)
    expect(queue.reserve()).toBe(false)
  })

  it('never more than two run at once; the rest wait and start in the order they came', async () => {
    const queue = createAuditQueue({ isClusterWorker: () => false })
    const gates = Array.from({ length: 7 }, gated)
    const started: number[] = []
    const finished: number[] = []
    let running = 0
    let peak = 0
    const jobs = gates.map(({ gate }, i) => {
      expect(queue.reserve()).toBe(true)
      return queue.run(async () => {
        started.push(i)
        running++
        peak = Math.max(peak, running)
        await gate
        running--
        finished.push(i)
        return i
      })
    })
    await tick()
    expect(started).toEqual([0, 1])
    expect(queue.stats()).toEqual({ held: 7, running: 2, waiting: 5 })
    expect(queue.reserve()).toBe(false)

    gates[1].open()
    await tick()
    expect(started).toEqual([0, 1, 2])
    expect(queue.stats()).toEqual({ held: 6, running: 2, waiting: 4 })
    // one finished, so there is one place again, and only one
    expect(queue.reserve()).toBe(true)
    expect(queue.reserve()).toBe(false)
    queue.release()

    for (const index of [0, 2, 3, 4, 5, 6]) {
      gates[index].open()
      await tick()
      expect(running).toBeLessThanOrEqual(2)
    }
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(peak).toBe(2)
    expect(queue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
  })

  it('a job that throws gives its place back and lets the next one start', async () => {
    const queue = createAuditQueue({ maxRunning: 1, maxWaiting: 1, isClusterWorker: () => false })
    expect(queue.reserve()).toBe(true)
    expect(queue.reserve()).toBe(true)
    expect(queue.reserve()).toBe(false)
    const first = queue.run(async () => {
      throw new Error('stage failed')
    })
    const second = queue.run(async () => 'ran')
    await expect(first).rejects.toThrow('stage failed')
    await expect(second).resolves.toBe('ran')
    expect(queue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
    expect(queue.reserve()).toBe(true)
  })

  it('a job that arrives the moment another finishes cannot push the count past the limit', async () => {
    const queue = createAuditQueue({ maxRunning: 2, maxWaiting: 5, isClusterWorker: () => false })
    const gates = Array.from({ length: 4 }, gated)
    let running = 0
    let peak = 0
    const work = (i: number) => async () => {
      running++
      peak = Math.max(peak, running)
      await gates[i].gate
      running--
    }
    for (let i = 0; i < 3; i++) queue.reserve()
    const jobs = [0, 1, 2].map((i) => queue.run(work(i)))
    await tick()
    // job 0 finishes: its slot is handed to job 2 at once. A fourth job arriving in the same breath must wait.
    gates[0].open()
    queue.reserve()
    jobs.push(queue.run(work(3)))
    await tick()
    expect(running).toBe(2)
    expect(queue.stats()).toMatchObject({ running: 2, waiting: 1 })
    gates.forEach((g) => g.open())
    await Promise.all(jobs)
    expect(peak).toBe(2)
  })

  it('a cluster worker refuses every request, as the limiter does: each worker would otherwise keep its own count', () => {
    let worker = true
    const queue = createAuditQueue({ isClusterWorker: () => worker })
    for (let i = 0; i < 3; i++) expect(queue.reserve()).toBe(false)
    expect(queue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
    // the separating control: the same queue in a single process takes the request
    worker = false
    expect(queue.reserve()).toBe(true)
  })

  it('fails closed: if it cannot tell whether it is a cluster worker, it refuses', () => {
    const queue = createAuditQueue({
      isClusterWorker: () => {
        throw new Error('cannot tell')
      },
    })
    expect(queue.reserve()).toBe(false)
    expect(queue.stats().held).toBe(0)
  })
})
