const { EventEmitter } = require('events');

/**
 * Process-wide event bus.
 *
 * Used to decouple domain events (e.g. `item.created`) from the
 * subscribers that react to them — chiefly the automation
 * dispatcher that fires `ITEM_CREATED` triggers.
 *
 * Module-scoped singleton: `require('./eventBus')` from anywhere
 * in the server returns the same emitter. `mount()` is a no-op
 * the second time it's called so server entry can invoke it
 * idempotently on boot.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

let mounted = false;

const mount = () => {
  if (mounted) return emitter;
  mounted = true;
  return emitter;
};

const isMounted = () => mounted;

module.exports = emitter;
module.exports.mount = mount;
module.exports.isMounted = isMounted;
