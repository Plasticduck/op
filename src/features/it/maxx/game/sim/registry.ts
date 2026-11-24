// The one piece of module-level state in the simulation: which behaviour
// runs each entity kind. Files under sim/entities call registerEntity() when
// they load; sim/index.ts loads that whole folder by glob.
import type { EntityBehavior } from './types'

const behaviors = new Map<string, EntityBehavior>()

/** Registering a kind twice replaces the first (that is what a hot reload does). */
export function registerEntity(kind: string, behavior: EntityBehavior): void {
  behaviors.set(kind, behavior)
}

export function getBehavior(kind: string): EntityBehavior | undefined {
  return behaviors.get(kind)
}

export function hasBehavior(kind: string): boolean {
  return behaviors.has(kind)
}

export function registeredKinds(): string[] {
  return [...behaviors.keys()].sort()
}
