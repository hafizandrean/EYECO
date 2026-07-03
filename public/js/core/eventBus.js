// eventBus.js - Publisher/Subscriber Event Bus untuk EYECO
class EventBusClass {
  constructor() {
    this.events = {};
  }

  // Subscribe ke event
  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
    return () => this.off(event, callback); // Return unsubscribe function
  }

  // Unsubscribe dari event
  off(event, callback) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(cb => cb !== callback);
  }

  // Emit/Publish event
  emit(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`[EventBus Error] Gagal memicu callback untuk event "${event}":`, err);
      }
    });
  }
}

export const EventBus = new EventBusClass();
