class EventBus {
    constructor() {
        this._h = {};
    }

    on(event, fn) {
        (this._h[event] ??= []).push(fn);
        return this;
    }

    off(event, fn) {
        if (this._h[event]) this._h[event] = this._h[event].filter(f => f !== fn);
        return this;
    }

    emit(event, payload) {
        console.log(`[bus] ${event}`, payload);
        (this._h[event] || []).slice().forEach(fn => fn(payload));
        return this;
    }
}

window.bus = new EventBus();
