/**
 * TTS backend using Supertonic-3 (99M param, 31 languages, ONNX Runtime Web).
 * Models are cached in IndexedDB after first download (~400 MB total).
 *
 * Drop-in replacement for tts.js — same interface:
 *   speak(text, { voiceIndex, rate }) → SpeechHandle
 *   stop()
 *   voices          → array of voice-like objects
 *   supportedVoices → [{voice, index}]
 *   preload(onProgress) → Promise
 *
 * Extra settings (set before speak/preload):
 *   .device   'wasm' | 'webgpu'
 *   .lang     'en' | 'de' | 'fr' | … (31 languages)
 *   .steps    1–12 (denoising steps, default 8)
 */

const SUPERTONIC_VOICES = [
    { id: 'M1', label: 'M1 (Male)'   },
    { id: 'M2', label: 'M2 (Male)'   },
    { id: 'M3', label: 'M3 (Male)'   },
    { id: 'M4', label: 'M4 (Male)'   },
    { id: 'M5', label: 'M5 (Male)'   },
    { id: 'F1', label: 'F1 (Female)' },
    { id: 'F2', label: 'F2 (Female)' },
    { id: 'F3', label: 'F3 (Female)' },
    { id: 'F4', label: 'F4 (Female)' },
    { id: 'F5', label: 'F5 (Female)' },
];

class TtsSupertonic {
    constructor() {
        this._worker     = new Worker('./supertonic-worker.js', { type: 'module' });
        this._worker.onmessage = ({ data }) => this._onMsg(data);
        this._ready      = false;
        this._loading    = null;
        this._loadRes    = null;
        this._genRes     = null;
        this._audioCtx   = null;
        this._current    = null;  // { source, handle }
        this._progressCb = null;
        this._queue      = [];
        this._busy       = false;

        // Optional callback fired when model becomes ready
        this.onready = null;

        // Configurable settings
        this.device           = 'webgpu';
        this.lang             = 'en';
        this.steps            = 8;
        this.supportsLanguage = true;
    }

    // ── Public interface ───────────────────────────────────────────

    get voices() {
        return SUPERTONIC_VOICES.map(v => ({ name: v.label, lang: 'mul' }));
    }

    get supportedVoices() {
        return SUPERTONIC_VOICES.map((v, index) => ({
            voice: { name: v.label, lang: 'mul' }, index,
        }));
    }

    speak(text, { voiceIndex = 0, rate = 1, lang = null } = {}) {
        const handle = new SpeechHandle();
        const style  = (SUPERTONIC_VOICES[voiceIndex] ?? SUPERTONIC_VOICES[0]).id;
        this._queue.push({ text, style, speed: rate, handle, lang: lang ?? this.lang });
        if (!this._busy) this._processQueue();
        return handle;
    }

    stop() {
        // Cancel all queued items
        this._queue.forEach(item => { item.handle.stopped = true; item.handle._fire('end'); });
        this._queue = [];
        // Stop current playback
        if (this._current) {
            this._current.handle.stopped = true;
            this._current.handle._cancelTimers();
            try { this._current.source.stop(); } catch {}
            this._current = null;
        }
        // Cancel in-flight generation
        if (this._genRes) { this._genRes(null); this._genRes = null; }
        this._busy = false;
    }

    async _processQueue() {
        if (this._busy) return;
        this._busy = true;
        while (this._queue.length > 0) {
            const item = this._queue.shift();
            if (!item.handle.stopped) {
                try {
                    await this._doSpeak(item.text, item.style, item.speed, item.handle, item.lang);
                } catch (err) {
                    console.error('[TtsSupertonic]', err.message);
                    item.handle._fire('end');
                    // Don't keep retrying if load failed (e.g. WebGPU unavailable)
                    if (!this._ready) { this._queue.forEach(i => i.handle._fire('end')); this._queue = []; }
                }
            }
        }
        this._busy = false;
    }

    preload(onProgress) {
        this._progressCb = onProgress;
        return this._ensureLoaded();
    }

    // ── Internal ───────────────────────────────────────────────────

    async _doSpeak(text, style, speed, handle, lang) {
        await this._ensureLoaded();
        if (handle.stopped) return;

        const result = await new Promise(res => {
            this._genRes = res;
            this._worker.postMessage({
                type: 'generate', text,
                lang, style,
                steps: this.steps, speed,
            });
        });
        this._genRes = null;

        if (!result || handle.stopped) { handle._fire('end'); return; }

        this._audioCtx ??= new AudioContext();
        await this._audioCtx.resume();

        if (handle.stopped) { handle._fire('end'); return; }

        const buf = this._audioCtx.createBuffer(1, result.audio.length, result.sampleRate);
        buf.getChannelData(0).set(result.audio);

        const src = this._audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(this._audioCtx.destination);
        this._current = { source: src, handle };

        this._scheduleWordBoundaries(text, buf.duration * 1000, handle);

        src.onended = () => {
            if (this._current?.handle === handle) this._current = null;
            handle._cancelTimers();
            handle._fire('end');
        };
        src.start();
    }

    _ensureLoaded() {
        console.log('[TtsSupertonic] _ensureLoaded device=%s ready=%s loading=%s navigator.gpu=%s',
            this.device, this._ready, !!this._loading, navigator.gpu);
        if (this._ready) return Promise.resolve();
        if (this._loading) return this._loading;
        if (this.device === 'webgpu' && !navigator.gpu) {
            console.warn('[TtsSupertonic] WebGPU not available (navigator.gpu is', navigator.gpu, ')');
            return Promise.reject(new Error('WebGPU is not supported in this browser — switch to WASM.'));
        }
        console.log('[TtsSupertonic] posting load to worker, device=%s', this.device);
        this._loading = new Promise(res => {
            this._loadRes = res;
            this._worker.postMessage({ type: 'load', device: this.device });
        });
        return this._loading;
    }

    _onMsg(data) {
        if (data.type === 'progress') {
            this._progressCb?.(data.data);
        } else if (data.type === 'gen-step') {
            this._progressCb?.({ status: 'gen-step', step: data.step, total: data.total });
        } else if (data.type === 'status') {
            this._progressCb?.({ status: 'info', message: data.message });
        } else if (data.type === 'ready') {
            this._ready   = true;
            this._loading = null;
            this._loadRes?.(); this._loadRes = null;
            this.onready?.();
        } else if (data.type === 'audio') {
            this._genRes?.(data); this._genRes = null;
        } else if (data.type === 'error') {
            console.error('[TtsSupertonic]', data.message);
            this._loadRes?.(); this._loadRes = null;
            this._genRes?.(null); this._genRes = null;
        }
    }

    _scheduleWordBoundaries(text, totalMs, handle) {
        const words    = text.split(/\s+/).filter(Boolean);
        const totalLen = words.reduce((s, w) => s + w.length, 0) || 1;
        let elapsed    = 80;
        words.forEach(word => {
            const t = elapsed;
            handle._scheduleTimer(() => handle._fire('boundary', { name: 'word' }), t);
            elapsed += (word.length / totalLen) * totalMs;
        });
    }
}

window.TtsSupertonic = TtsSupertonic;
