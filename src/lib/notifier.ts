import type { Incident, Site } from './types'

/**
 * Called by the checker whenever an incident opens or closes.
 *
 * A Discord webhook implementation will be dropped in later. It should be a new
 * class in this file (or its own module) plus a line in `getNotifier()` — no
 * changes to the checker.
 */
export interface Notifier {
  onIncidentOpened(site: Site, incident: Incident): Promise<void>
  onIncidentResolved(site: Site, incident: Incident): Promise<void>
}

/** The only implementation today. Records nothing, sends nothing. */
export class NoopNotifier implements Notifier {
  async onIncidentOpened(): Promise<void> {}
  async onIncidentResolved(): Promise<void> {}
}

let instance: Notifier | null = null

export function getNotifier(): Notifier {
  instance ??= new NoopNotifier()
  return instance
}

/**
 * Notifications are a side effect of monitoring, not part of it. A notifier that
 * throws — a webhook 500, a DNS blip — must never fail the run or roll back the
 * check that was just recorded.
 */
export async function notifySafely(
  fn: () => Promise<void>,
  context: string,
): Promise<void> {
  try {
    await fn()
  } catch (error) {
    console.error(`[notifier] ${context} failed:`, error)
  }
}
