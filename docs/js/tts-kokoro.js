/**
 * TTS backend using Kokoro-js (neural TTS, ~80 MB model download on first use).
 * Runs the model in a Web Worker so the main thread stays responsive.
 *
 * Drop-in replacement for tts.js — same interface:
 *   speak(text, { voiceIndex, rate }) → SpeechHandle
 *   stop()
 *   voices          → array of voice-like objects
 *   supportedVoices → [{voice, index}]
 *   preload(onProgress) → Promise
 *
 * Also exposes TtsKokoro.createWorker() for use by other pages (e.g. voice-test.html).
 */

// ── Kokoro voice catalogue ─────────────────────────────────────
const KOKORO_VOICES = [
    { id: 'af_heart',    lang: 'en-US', label: 'Heart (US, F)'    },
    { id: 'af_bella',    lang: 'en-US', label: 'Bella (US, F)'    },
    { id: 'af_sarah',    lang: 'en-US', label: 'Sarah (US, F)'    },
    { id: 'af_sky',      lang: 'en-US', label: 'Sky (US, F)'      },
    { id: 'af_nicole',   lang: 'en-US', label: 'Nicole (US, F)'   },
    { id: 'am_adam',     lang: 'en-US', label: 'Adam (US, M)'     },
    { id: 'am_michael',  lang: 'en-US', label: 'Michael (US, M)'  },
    { id: 'bf_emma',     lang: 'en-GB', label: 'Emma (GB, F)'     },
    { id: 'bf_isabella', lang: 'en-GB', label: 'Isabella (GB, F)' },
    { id: 'bm_george',   lang: 'en-GB', label: 'George (GB, M)'   },
    { id: 'bm_lewis',    lang: 'en-GB', label: 'Lewis (GB, M)'    },
];

// ── Inline worker code ─────────────────────────────────────────
const WORKER_CODE = `
import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

let tts = null;

self.onmessage = async ({ data }) => {
    if (data.type === 'load') {
        try {
            tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', {
                dtype: data.dtype,
                device: data.device,
                progress_callback(e) { self.postMessage({ type: 'progress', data: e }); },
            });
            self.postMessage({ type: 'ready' });
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    } else if (data.type === 'generate') {
        try {
            const output = await tts.generate(data.text, { voice: data.voice });
            const audio  = output.audio instanceof Float32Array
                ? output.audio
                : new Float32Array(output.audio);
            self.postMessage(
                { type: 'audio', audio, sampleRate: output.sampling_rate },
                [audio.buffer]
            );
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
};
`;

const WORKER_BLOB_URL = URL.createObjectURL(
    new Blob([WORKER_CODE], { type: 'text/javascript' })
);

class TtsKokoro {
    constructor() {
        this._worker     = null;
        this._ready      = false;
        this._loading    = null;
        this._audioCtx   = null;
        this._current    = null;
        this._queue      = [];
        this._busy       = false;
        this._genResolve = null;
        this._onProgress = null;
        this.device      = 'wasm';
    }

    static createWorker() {
        return new Worker(WORKER_BLOB_URL, { type: 'module' });
    }

    // ── Public interface (matches tts.js) ──────────────────────

    get voices() {
        return KOKORO_VOICES.map(v => ({ name: v.label, lang: v.lang }));
    }

    get supportedVoices() {
        return KOKORO_VOICES.map((v, index) => ({
            voice: { name: v.label, lang: v.lang },
            index,
        }));
    }

    speak(text, { voiceIndex = 0, rate = 1 } = {}) {
        const handle  = new SpeechHandle();
        const voiceId = (KOKORO_VOICES[voiceIndex] ?? KOKORO_VOICES[0]).id;
        this._queue.push({ text, voiceId, rate, handle });
        this._processQueue();
        return handle;
    }

    stop() {
        this._queue.forEach(item => { item.handle.stopped = true; item.handle._fire('end'); });
        this._queue = [];
        if (this._current) {
            this._current.handle.stopped = true;
            this._current.handle._cancelTimers();
            try { this._current.source.stop(); } catch {}
            this._current = null;
        }
        this._genResolve?.(null);
        this._genResolve = null;
    }

    preload(onProgress) {
        return this._ensureLoaded(onProgress);
    }

    // ── Queue processing (sequential, one at a time) ───────────

    async _processQueue() {
        if (this._busy) return;
        this._busy = true;
        while (this._queue.length > 0) {
            const item = this._queue.shift();
            if (!item.handle.stopped) {
                try {
                    await this._doSpeak(item.text, item.voiceId, item.rate, item.handle);
                } catch (err) {
                    console.error('[TtsKokoro]', err.message);
                    item.handle._fire('end');
                }
            }
        }
        this._busy = false;
    }

    // ── Initialisation ─────────────────────────────────────────

    _ensureLoaded(onProgress) {
        if (this._ready) return Promise.resolve();
        if (this._loading) return this._loading;
        this._onProgress = onProgress ?? null;
        this._loading = this._load();
        return this._loading;
    }

    async _load() {
        const deviceMap = { wasm: 'q8', webgpu: 'fp32' };
        const dtype  = deviceMap[this.device] ?? 'q8';

        this._worker = TtsKokoro.createWorker();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this._worker.terminate();
                this._worker = null;
                this._loading = null;
                this._queue.forEach(item => { item.handle.stopped = true; item.handle._fire('end'); });
                this._queue = [];
                reject(new Error('Loading timed out'));
            }, 120000);

            this._worker.onmessage = (e) => {
                const data = e.data;
                if (data.type === 'progress') {
                    this._onProgress?.(data.data);
                } else if (data.type === 'ready') {
                    clearTimeout(timeout);
                    this._worker.onmessage = (e) => this._onWorkerMsg(e.data);
                    this._audioCtx ??= new AudioContext();
                    this._ready = true;
                    this._loading = null;
                    this.onready?.();
                    this._processQueue();
                    resolve();
                } else if (data.type === 'error') {
                    clearTimeout(timeout);
                    this._worker.terminate();
                    this._worker = null;
                    this._loading = null;
                    this._queue.forEach(item => { item.handle.stopped = true; item.handle._fire('end'); });
                    this._queue = [];
                    reject(new Error(data.message));
                }
            };

            this._worker.postMessage({ type: 'load', dtype, device: this.device });
        });
    }

    // ── Worker message handling ─────────────────────────────────

    _onWorkerMsg(data) {
        if (data.type === 'progress') {
            this._onProgress?.(data.data);
        } else if (data.type === 'audio') {
            this._genResolve?.(data);
            this._genResolve = null;
        } else if (data.type === 'error') {
            this._genResolve?.(null);
            this._genResolve = null;
        }
    }

    // ── Synthesis & playback ───────────────────────────────────

    async _doSpeak(text, voiceId, rate, handle) {
        await this._ensureLoaded();
        if (handle.stopped) return;

        this._worker.postMessage({ type: 'generate', text, voice: voiceId });
        const result = await new Promise(res => {
            this._genResolve = res;
        });
        if (!result || handle.stopped) { handle._fire('end'); return; }

        this._audioCtx ??= new AudioContext();
        await this._audioCtx.resume();
        if (handle.stopped) { handle._fire('end'); return; }

        const buf = this._audioCtx.createBuffer(1, result.audio.length, result.sampleRate);
        buf.getChannelData(0).set(result.audio);

        const source = this._audioCtx.createBufferSource();
        source.buffer             = buf;
        source.playbackRate.value = rate;
        source.connect(this._audioCtx.destination);

        this._current = { source, handle };

        const durationMs = (buf.duration / rate) * 1000;
        this._scheduleWordBoundaries(text, durationMs, handle);

        source.onended = () => {
            if (this._current?.handle === handle) this._current = null;
            handle._cancelTimers();
            handle._fire('end');
        };
        source.start();
    }

    _scheduleWordBoundaries(text, totalMs, handle) {
        const words    = text.split(/\s+/).filter(Boolean);
        const totalLen = words.reduce((s, w) => s + w.length, 0) || 1;
        let   elapsed  = 80;

        words.forEach(word => {
            const t = elapsed;
            handle._scheduleTimer(
                () => handle._fire('boundary', { name: 'word' }),
                t
            );
            elapsed += (word.length / totalLen) * totalMs;
        });
    }
}

window.TtsKokoro = TtsKokoro;
