const stateUrls = {};
const notifications = {};
let notificationDenylist = [];

/*
 * Glob match for a notification path against a pattern. Semantics:
 *   - `*`  matches within one dot-segment (zero or more non-dot chars)
 *   - `**` matches zero or more whole segments (so `a.**` matches `a`,
 *     `a.b`, `a.b.c`; `**` alone matches anything, including empty)
 * Dots are literal segment separators and the pattern must match the
 * whole path. Lets a denylist entry target a category across instances,
 * e.g. `notifications.electrical.batteries.**` (any depth) or
 * `notifications.electrical.batteries.*.temperature` (any bank, one
 * segment, between batteries and temperature). Exported for tests.
 */
function matchesNotificationPattern(path, pattern) {
  if (!pattern) return false;
  // Split into segment tokens on literal dots. Each token is either
  // `**` (zero+ segments), contains `*` (one segment, in-segment
  // wildcards), or is a literal segment.
  const tokens = pattern.split('.');
  // Build a regex segment by segment, so a `**` token can absorb the
  // dot separators on either side (matching zero segments = no dot).
  let rx = '^';
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const isDouble = tok === '**';
    // The separator dot before this token is optional when either the
    // previous token was `**` (it may have matched zero segments) or
    // this token is `**` (it may match zero segments up front). It's a
    // required literal dot otherwise.
    const prevDouble = i > 0 && tokens[i - 1] === '**';
    const sepOptional = prevDouble || isDouble;
    let sep;
    if (i === 0) {
      sep = '';
    } else if (sepOptional) {
      sep = '\\.?';
    } else {
      sep = '\\.';
    }
    rx += sep;
    if (isDouble) {
      // `**` = zero or more whole segments: any run of characters,
      // dots included (including empty).
      rx += '.*';
    } else {
      // Literal or single-`*` segment. Escape regex metacharacters in the
      // literal parts, then turn `*` into a within-segment wildcard.
      rx += tok.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*');
    }
  }
  rx += '$';
  return new RegExp(rx).test(path);
}

function isNotificationDenied(path) {
  return notificationDenylist.some((p) => matchesNotificationPattern(path, p));
}

/*
 * Maps a Signal K notification state onto a CSS class. The Signal K
 * ladder is nominal -> alert -> warn -> alarm -> emergency; we keep all
 * five distinct except the `warning` spelling collapses to `warn`.
 * `alert` is "heads up" — below a warning — so it gets its own class
 * (and its own color, between green and amber) rather than being folded
 * into `warn`. An empty/unknown state falls back to `normal` (green)
 * rather than asserting a color it has no right to. Exported for tests.
 */
function notificationClass(state) {
  switch (state) {
    case 'normal':
      return 'normal';
    case 'nominal':
      return 'nominal';
    case 'alert':
      return 'alert';
    case 'warn':
    case 'warning':
      return 'warn';
    case 'alarm':
      return 'alarm';
    case 'emergency':
      return 'emergency';
    default:
      return 'normal';
  }
}

/* Uppercase severity word for the tag line. Empty for normal/nominal
 * (no judgment worth shouting) and for the neutral fallback. */
function notificationTag(state) {
  const cls = notificationClass(state);
  if (cls === 'normal' || cls === 'nominal') {
    return '';
  }
  return cls.toUpperCase();
}

/*
 * Maps a notification state onto one of the tactical UI spec's theme
 * classes (`.theme-*`), which assign the local `--theme-color`
 * variables used by the panel framing and tint. Color rungs follow
 * the severity ladder: green = fine (normal/nominal share it), teal =
 * alert ("heads up", one rung below warn), orange = warn, red =
 * alarm/emergency. Exported for tests.
 */
function notificationTheme(state) {
  switch (notificationClass(state)) {
    case 'alert':
      return 'theme-teal';
    case 'warn':
      return 'theme-orange';
    case 'alarm':
    case 'emergency':
      return 'theme-red';
    default:
      return 'theme-green';
  }
}

/*
 * Day/night mode (SPEC: Environment & Theme). The display passively
 * follows the Signal K `environment.mode` delta and reflects it as
 * `data-mode` on the root <html> element, which shifts the semantic
 * palette (bright/saturated by day, dimmed at night; the canvas stays
 * dark in both). Values other than day/night keep the last known
 * mode; the page boots in night mode as the safe default.
 * Exported for tests.
 */
function setEnvironmentMode(value) {
  if (value === 'day' || value === 'night') {
    document.documentElement.setAttribute('data-mode', value);
  }
}

/*
 * Connection status pseudo-console (SPEC: Terminal Logs). A
 * 3-column (timestamp | message | status) monospace log of link
 * events, fixed top-left. Timestamps are UTC (`HH:MM:SSZ`, SPEC:
 * Time & Dates — local ship time or explicit UTC, never a timezone
 * word). Works as a circular buffer: only the newest
 * LINK_LOG_MAX_LINES rows are kept, the oldest ChildNode is removed
 * on append so the DOM can't grow unbounded. Exported for tests.
 */
const LINK_LOG_MAX_LINES = 5;

function formatUtcClock(date) {
  return `${date.toISOString().slice(11, 19)}Z`;
}

function appendLinkRow(message, statusWord, statusClass) {
  const consoleEl = document.getElementById('link-console');
  if (!consoleEl) {
    return;
  }
  const row = document.createElement('div');
  row.className = 'console-row';
  const ts = document.createElement('span');
  ts.className = 'console-ts';
  ts.textContent = formatUtcClock(new Date());
  const msg = document.createElement('span');
  msg.className = 'console-msg';
  msg.textContent = message;
  const status = document.createElement('span');
  status.className = `console-status ${statusClass}`;
  status.textContent = `[ ${statusWord} ]`;
  row.append(ts, msg, status);
  consoleEl.appendChild(row);
  while (consoleEl.childNodes.length > LINK_LOG_MAX_LINES) {
    consoleEl.removeChild(consoleEl.firstChild);
  }
}

/*
 * Empties the link console when the connection is back up: the
 * console exists to make dropouts visible, so a healthy link means
 * it goes away entirely (the `:empty` rule hides the frame).
 * Exported for tests.
 */
function clearLinkConsole() {
  const consoleEl = document.getElementById('link-console');
  if (!consoleEl) {
    return;
  }
  while (consoleEl.firstChild) {
    consoleEl.removeChild(consoleEl.firstChild);
  }
}

/*
 * Exponential backoff for WebSocket reconnects (SPEC: Connection
 * Resilience): 1s doubling per failed attempt, capped at 30s. The
 * attempt counter is reset on a successful open. Exported for tests.
 */
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

function backoffDelay(failedAttempts) {
  const delay = RECONNECT_BASE_DELAY * 2 ** Math.max(failedAttempts, 0);
  return Math.min(delay, RECONNECT_MAX_DELAY);
}

// Exposed for tests (loaded via <script>, so attach to window).
if (typeof window !== 'undefined') {
  window.notificationClass = notificationClass;
  window.notificationTag = notificationTag;
  window.notificationTheme = notificationTheme;
  window.matchesNotificationPattern = matchesNotificationPattern;
  window.setEnvironmentMode = setEnvironmentMode;
  window.formatUtcClock = formatUtcClock;
  window.appendLinkRow = appendLinkRow;
  window.clearLinkConsole = clearLinkConsole;
  window.backoffDelay = backoffDelay;
}

function getUrlForState(state) {
  if (!stateUrls[state]) {
    return stateUrls.default;
  }
  return stateUrls[state];
}

function switchState(state) {
  const current = document.getElementById('current');
  const next = document.getElementById('next');
  const stateUrl = getUrlForState(state);
  if (current.getAttribute('src') === stateUrl) {
    // Already open!
    return;
  }
  if (next.getAttribute('src') === stateUrl) {
    next.id = 'current';
    current.id = 'next';
    return;
  }
  window.onmessage = null;
  next.onerror = (err) => {
    console.error(err);
    next.onload = null;
    next.onerror = null;
    // Try again
    switchState(state);
  };
  next.onload = () => {
    next.onload = null;
    next.onerror = null;
    // Cross-fade
    next.id = 'current';
    current.id = 'next';
    current.setAttribute('src', 'about:blank');
  };
  next.setAttribute('src', stateUrl);
}

function isNotificationVisual(notification) {
  if (!notification) {
    return false;
  }
  if (!notification.method) {
    return false;
  }
  if (notification.method && notification.method.indexOf('visual') === -1) {
    return false;
  }
  if (!notification.method && (notification.state === 'normal' || notification.state === 'nominal')) {
    return false;
  }
  // FIXME: It seems right now with meta zones you can't have non-visual nominal states
  if (notification.state === 'nominal') {
    return false;
  }
  // FIXME: This is hacky but we really don't need a constant "anchor alarm is normal"
  // visual notification
  if (notification.message === 'Anchor Alarm - Normal' && notification.state === 'normal') {
    return false;
  }
  if (notification.message === 'Watching' && notification.state === 'normal') {
    return false;
  }
  // FIXME: Similarly hacky, but Signal K 2.20 forces visual for these
  if (notification.message === 'Value is within normal range' && notification.state === 'normal') {
    return false;
  }
  return true;
}

/*
 * Live notification entries, keyed by Signal K path. Each entry caches
 * the element plus its tag/message child refs so updates only touch
 * textContent and the class list (SPEC: Granular DOM Updates), never
 * re-rendering the element's HTML.
 */
function handleNotification(path, notification) {
  // Denylist suppresses a notification outright: the user has said they
  // don't want to see it (typically because a status-tiles tile already
  // surfaces it). Applies before the visual check, so a denied path never
  // creates an element. If a live element exists from before the denylist
  // was (re)loaded, tear it down so suppression takes effect immediately.
  if (isNotificationDenied(path)) {
    if (notifications[path]) {
      notifications[path].element.remove();
      delete notifications[path];
    }
    return;
  }
  let entry;
  let element;
  if (notifications[path]) {
    // We have an element for this
    entry = notifications[path];
    element = entry.element;
  } else if (!isNotificationVisual(notification)) {
    // No element, but the alert doesn't have a visual component. We can skip this one
    return;
  } else {
    // New notification, create element
    const stack = document.getElementById('notifications');
    element = document.createElement('div');
    const tag = document.createElement('div');
    tag.className = 'ntf-tag';
    const msg = document.createElement('div');
    msg.className = 'ntf-msg';
    element.append(tag, msg);
    entry = { element, tag, msg };
    notifications[path] = entry;
    stack.appendChild(element);
  }
  if (notification && notification.state) {
    const cls = notificationClass(notification.state);
    element.className = `notification ${notificationTheme(notification.state)} ${cls}`;
    entry.tag.textContent = notificationTag(notification.state);
    entry.msg.textContent = notification.message || '';
  }
  if (!isNotificationVisual(notification)) {
    // The notification lost its visual method: tear the element down
    element.remove();
    delete notifications[path];
  }
}

if (typeof window !== 'undefined') {
  window.handleNotification = handleNotification;
}

function getConfig(callback) {
  fetch('/signalk/v2/api/infodisplay')
    .then((res) => res.json())
    .then((config) => {
      const urls = config.stateUrls || config;
      Object.keys(urls).forEach((state) => {
        stateUrls[state] = urls[state];
      });
      notificationDenylist = Array.isArray(config.notificationDenylist)
        ? config.notificationDenylist
          .filter((p) => typeof p === 'string' && p.length > 0)
        : [];
      // Apply the (possibly changed) denylist to anything already on
      // screen: a newly-denied path vanishes immediately rather than
      // lingering until the next notification update for it.
      Object.keys(notifications).forEach((p) => {
        if (isNotificationDenied(p)) {
          notifications[p].element.remove();
          delete notifications[p];
        }
      });
      callback();
    });
}

let reconnectAttempts = 0;

function connect() {
  // Only log reconnect attempts: on a healthy load the console stays
  // hidden — it exists to surface dropouts, not narrate the happy path
  if (reconnectAttempts > 0) {
    appendLinkRow('RECONNECTING', 'RETRY', 'warn');
  }
  const socket = new WebSocket(`${(window.location.protocol === 'https:' ? 'wss' : 'ws')}://${window.location.host}/signalk/v1/stream?subscribe=none&sendCachedValues=true`);
  socket.addEventListener('open', () => {
    // Link is back: reset the backoff ladder and clear the console —
    // a healthy connection leaves no trace on screen
    reconnectAttempts = 0;
    clearLinkConsole();
    // Start by clearing stale notifications from the previous session
    Object.keys(notifications).forEach((path) => {
      notifications[path].element.remove();
      delete notifications[path];
    });

    socket.send(JSON.stringify({
      context: 'vessels.self',
      subscribe: [
        // SPEC: Subscription Throttling — every subscription carries a
        // minPeriod unless instant delivery is strictly necessary.
        // Notifications are the exception: an anchor or MOB alarm
        // must hit the screen the moment it fires.
        {
          path: 'navigation.state',
          minPeriod: 1000,
        },
        {
          path: 'environment.mode',
          minPeriod: 5000,
        },
        {
          path: 'notifications.*',
          policy: 'instant',
        },
      ],
    }));
  });
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (!data.updates || !data.updates.length) {
      return;
    }
    data.updates.forEach((u) => {
      if (!u.values || !u.values.length) {
        return;
      }
      u.values.forEach((v) => {
        if (v.path === 'navigation.state') {
          switchState(v.value);
          return;
        }
        if (v.path === 'environment.mode') {
          setEnvironmentMode(v.value);
          return;
        }
        if (v.path.indexOf('notifications.') === 0) {
          handleNotification(v.path, v.value);
        }
      });
    });
  });
  socket.addEventListener('close', () => {
    // SPEC: Connection Resilience — exponential backoff, and the link
    // console makes the dropout visible on screen
    appendLinkRow('LINK LOST', 'FAIL', 'fail');
    const delay = backoffDelay(reconnectAttempts);
    reconnectAttempts += 1;
    setTimeout(() => {
      connect();
    }, delay);
  });
  socket.addEventListener('error', () => {
    socket.close();
  });
}

function onPageReady() {
  window.removeEventListener('load', onPageReady, false);
  getConfig(() => {
    switchState('default');
    connect();
  });
}

window.addEventListener('load', onPageReady, false);
