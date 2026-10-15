const listeners = new Map();
const statusListeners = new Set();
let source = null;

function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`stream handler failed for "${event}"`, error);
    }
  }
}

export function subscribe(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function onStatus(handler) {
  statusListeners.add(handler);
  return () => statusListeners.delete(handler);
}

function setStatus(connected, ingesting) {
  for (const handler of statusListeners) {
    try {
      handler(connected, ingesting);
    } catch (error) {
      console.error("status handler failed", error);
    }
  }
}

export function startStream() {
  if (source) source.close();
  source = new EventSource("/api/stream");
  source.onopen = () => setStatus(true, false);
  source.onerror = () => setStatus(false, false);

  for (const event of ["hello", "stats", "status", "lead", "error"]) {
    source.addEventListener(event, (message) => {
      let data = null;
      try {
        data = JSON.parse(message.data);
      } catch {
        data = message.data;
      }
      if (event === "status") setStatus(true, Boolean(data?.running));
      emit(event, data);
    });
  }
}
