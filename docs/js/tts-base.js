// Shared across all non-Web-Speech TTS backends.
// Returned by speak() as an utterance-like handle that fires 'boundary' and 'end'.
class SpeechHandle {
    constructor() {
        this._h      = {};
        this._timers = [];
        this.stopped = false;
    }
    addEventListener(type, fn) {
        (this._h[type] ??= []).push(fn);
    }
    _fire(type, data = {}) {
        if (!this.stopped) (this._h[type] || []).forEach(fn => fn(data));
    }
    _scheduleTimer(fn, ms) {
        this._timers.push(setTimeout(fn, ms));
    }
    _cancelTimers() {
        this._timers.forEach(clearTimeout);
        this._timers = [];
    }
}

window.SpeechHandle = SpeechHandle;
