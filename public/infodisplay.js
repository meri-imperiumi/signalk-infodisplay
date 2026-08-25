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
 * (and its own hue, between green and amber) rather than being folded
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

// Exposed for tests (loaded via <script>, so attach to window).
if (typeof window !== 'undefined') {
  window.notificationClass = notificationClass;
  window.notificationTag = notificationTag;
  window.matchesNotificationPattern = matchesNotificationPattern;
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

function handleNotification(path, notification) {
  // Denylist suppresses a notification outright: the user has said they
  // don't want to see it (typically because a status-tiles tile already
  // surfaces it). Applies before the visual check, so a denied path never
  // creates an element. If a live element exists from before the denylist
  // was (re)loaded, tear it down so suppression takes effect immediately.
  if (isNotificationDenied(path)) {
    if (notifications[path]) {
      notifications[path].remove();
      delete notifications[path];
    }
    return;
  }
  let element;
  if (notifications[path]) {
    // We have an element for this
    element = notifications[path];
  } else if (!isNotificationVisual(notification)) {
    // No element, but the alert doesn't have a visual component. We can skip this one
    return;
  } else {
    // New notification, create element
    const stack = document.getElementById('notifications');
    element = document.createElement('div');
    element.className = 'notification';
    const tag = document.createElement('div');
    tag.className = 'ntf-tag';
    const msg = document.createElement('div');
    msg.className = 'ntf-msg';
    element.append(tag, msg);
    notifications[path] = element;
    stack.appendChild(element);
  }
  if (notification && notification.state) {
    const cls = notificationClass(notification.state);
    element.className = `notification ${cls}`;
    const tag = element.querySelector('.ntf-tag');
    tag.textContent = notificationTag(notification.state);
    element.querySelector('.ntf-msg').textContent = notification.message || '';
    element.style.display = '';
  }
  if (isNotificationVisual(notification)) {
    element.style.opacity = '1';
  } else {
    element.style.opacity = '0';
    element.remove();
    delete notifications[path];
  }
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
          notifications[p].remove();
          delete notifications[p];
        }
      });
      callback();
    });
}

function connect() {
  const socket = new WebSocket(`${(window.location.protocol === 'https:' ? 'wss' : 'ws')}://${window.location.host}/signalk/v1/stream?subscribe=none&sendCachedValues=true`);
  socket.addEventListener('open', () => {
    // Start by clearing old notifications
    if (notifications) {
      Object.keys(notifications).forEach((path) => {
        const element = notifications[path];
        element.close();
        element.remove();
        delete notifications[path];
      });
    }

    socket.send(JSON.stringify({
      context: 'vessels.self',
      subscribe: [
        {
          path: 'navigation.state',
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
        if (v.path.indexOf('notifications.') === 0) {
          handleNotification(v.path, v.value);
        }
      });
    });
  });
  socket.addEventListener('close', () => {
    // Auto-reconnect in 1sec
    setTimeout(() => {
      connect();
    }, 1000);
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
