/**
 * Tiny module-scoped registry for "named UI intents" that can be fired
 * remotely (typically from the web demo over the Supabase channel).
 *
 *   // In a script that owns the action:
 *   import { registerRemoteTrigger } from '../Streaming/RemoteTriggers';
 *   registerRemoteTrigger('resolve', () => this.refresh());
 *
 *   // In the broadcaster (or any code that receives a trigger name):
 *   import { fireRemoteTrigger } from '../Streaming/RemoteTriggers';
 *   fireRemoteTrigger('resolve');
 *
 * No scene-graph wiring, no @input refs. LS modules are singletons, so the
 * `_registry` object below is shared across every importer in the lens.
 */

const _registry: { [k: string]: () => void } = {};

export function registerRemoteTrigger(name: string, handler: () => void): void {
  _registry[name] = handler;
}

export function unregisterRemoteTrigger(name: string): void {
  delete _registry[name];
}

export function fireRemoteTrigger(name: string): boolean {
  const fn = _registry[name];
  if (typeof fn === 'function') {
    fn();
    return true;
  }
  return false;
}

export function listRemoteTriggers(): string[] {
  const out: string[] = [];
  for (const k in _registry) out.push(k);
  return out;
}
