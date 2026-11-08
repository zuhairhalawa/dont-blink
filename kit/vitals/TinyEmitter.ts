/**
 * kit/vitals/TinyEmitter.ts
 *
 * A minimal typed event emitter that works in both the browser renderer and
 * Node.js (tests, main process).  It replaces Node's built-in `EventEmitter`
 * for code that must be bundled for the browser, where `import { EventEmitter }
 * from 'events'` is not available.
 *
 * API is intentionally limited to what VitalsSource callers actually use:
 *   on(event, listener)    — subscribe (keeps all listeners)
 *   once(event, listener)  — subscribe for one invocation then auto-remove
 *   off(event, listener)   — unsubscribe a previously registered listener
 *   emit(event, ...args)   — invoke all listeners for that event
 *
 * Type-safety: pass an event-map interface as the generic parameter so
 * TypeScript enforces listener signatures at call sites.
 *
 *   interface MyEvents { data: (v: number) => void }
 *   class MySource extends TinyEmitter<MyEvents> { ... }
 *   source.on('data', (v) => console.log(v)); // v is typed as number
 */

// ---------------------------------------------------------------------------
// Internal listener storage
// ---------------------------------------------------------------------------

/** A plain function with any signature. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => void;

// ---------------------------------------------------------------------------
// TinyEmitter
// ---------------------------------------------------------------------------

/**
 * Generic typed emitter base class.
 *
 * @typeParam Events  An object type mapping event names to their listener
 *                    function signature, e.g.
 *                    `{ reading: (r: VitalsReading) => void }`.
 *                    May be a plain interface — no index signature required.
 *                    Defaults to a record of any functions when not specified.
 *
 * Why `{ [K in keyof Events]: AnyFn }` instead of `Record<string, AnyFn>`:
 *   TypeScript interfaces lack an implicit string index signature, so an
 *   interface `I` does not satisfy `Record<string, AnyFn>` even when all its
 *   values are functions.  The mapped-type form only checks that each key of
 *   Events maps to AnyFn, which an interface does satisfy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TinyEmitter<Events extends { [K in keyof Events]: (...args: any[]) => void } = Record<string, AnyFn>> {
  // Map from event name → ordered list of listeners.
  private readonly _listeners = new Map<string, AnyFn[]>();

  // -------------------------------------------------------------------------
  // on
  // -------------------------------------------------------------------------

  /**
   * Register `listener` to be called every time `event` is emitted.
   * Multiple listeners for the same event are called in registration order.
   *
   * Returns `this` for chaining.
   */
  on<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    let list = this._listeners.get(event);
    if (!list) {
      list = [];
      this._listeners.set(event, list);
    }
    list.push(listener as AnyFn);
    return this;
  }

  // -------------------------------------------------------------------------
  // once
  // -------------------------------------------------------------------------

  /**
   * Register `listener` to be called the next time `event` is emitted,
   * then automatically removed.
   *
   * Returns `this` for chaining.
   */
  once<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    // Wrap the listener in a one-shot wrapper that removes itself after firing.
    const wrapper: AnyFn = (...args) => {
      this.off(event, wrapper as Events[K]);
      (listener as AnyFn)(...args);
    };
    return this.on(event, wrapper as Events[K]);
  }

  // -------------------------------------------------------------------------
  // off
  // -------------------------------------------------------------------------

  /**
   * Remove a previously registered `listener` for `event`.
   * If the listener was not registered, this is a no-op.
   *
   * Returns `this` for chaining.
   */
  off<K extends keyof Events & string>(event: K, listener: Events[K]): this {
    const list = this._listeners.get(event);
    if (!list) return this;
    const idx = list.indexOf(listener as AnyFn);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // emit
  // -------------------------------------------------------------------------

  /**
   * Invoke all listeners registered for `event`, passing `args` to each.
   * Listeners are called synchronously in registration order.
   *
   * Returns `true` if at least one listener was called, `false` otherwise
   * (matches the Node EventEmitter contract).
   */
  emit<K extends keyof Events & string>(
    event: K,
    ...args: Parameters<Events[K]>
  ): boolean {
    const list = this._listeners.get(event);
    if (!list || list.length === 0) return false;
    // Snapshot the list before iterating in case a listener calls off().
    for (const fn of list.slice()) {
      fn(...args);
    }
    return true;
  }
}
