const LemonadeCarrier = require('./LemonadeCarrier');
const AAACarrier = require('./AAACarrier');

const carriers = {};

function register(id, displayName, CarrierClass, options = {}) {
  carriers[id] = { class: CarrierClass, displayName, ...options };
}

// Register carriers
register('lemonade', 'Lemonade', LemonadeCarrier, { requiresPassword: false });
register('aaa', 'AAA Insurance', AAACarrier, { requiresPassword: true });

function getCarrier(name) {
  const entry = carriers[name.toLowerCase()];
  if (!entry) throw Object.assign(new Error(`Unknown carrier: ${name}`), { status: 400 });
  return entry;
}

function listCarriers() {
  return Object.entries(carriers).map(([id, c]) => ({
    id,
    displayName: c.displayName,
    requiresPassword: c.requiresPassword !== false,
  }));
}

module.exports = { register, getCarrier, listCarriers };
