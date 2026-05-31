import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.bundle.min.mjs';

ort.env.wasm.wasmPaths  = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';
ort.env.wasm.numThreads = 1; // avoid SharedArrayBuffer requirement

const HF_BASE  = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';
const ONNX_DIR = `${HF_BASE}/onnx`;
const STYLE_DIR = `${HF_BASE}/voice_styles`;

// ── Cache API model store ──────────────────────────────────────
const CACHE_NAME = 'supertonic-models-v1';

// ── Download with progress + Cache API ────────────────────────
async function fetchWithProgress(url, label, onProgress) {
    // Check Cache API first — safe across multiple workers, no IDB issues
    try {
        const cache  = await caches.open(CACHE_NAME);
        const cached = await cache.match(url);
        if (cached) {
            const buf = await cached.arrayBuffer();
            onProgress({ file: `${label} (cached)`, loaded: buf.byteLength, total: buf.byteLength, progress: 100, status: 'done' });
            return buf;
        }
    } catch { /* cache unavailable — fall through to network */ }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const total  = parseInt(res.headers.get('content-length') || '0');
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress({ file: label, loaded, total, progress: total ? (loaded / total) * 100 : 0, status: 'progress' });
    }
    onProgress({ file: label, loaded, total, progress: 100, status: 'done' });

    const out = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }

    // Store in cache for next run (best-effort)
    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(url, new Response(out, {
            headers: { 'content-type': 'application/octet-stream' },
        }));
    } catch { /* storage quota or unavailable — no problem */ }

    return out.buffer;
}

// ── Text processor ─────────────────────────────────────────────
const LANGS = ['en','ko','ja','ar','bg','cs','da','de','el','es','et','fi','fr','hi','hr','hu','id','it','lt','lv','nl','pl','pt','ro','ru','sk','sl','sv','tr','uk','vi','na'];

class UnicodeProcessor {
    constructor(indexer) { this.indexer = indexer; }

    call(textList, langList) {
        const processed = textList.map((t, i) => this._preprocess(t, langList[i]));
        const lengths   = processed.map(t => t.length);
        const maxLen    = Math.max(...lengths);
        const textIds   = processed.map(text => {
            const row = new Array(maxLen).fill(0);
            for (let j = 0; j < text.length; j++) {
                const cp = text.codePointAt(j);
                row[j]   = cp < this.indexer.length ? this.indexer[cp] : -1;
            }
            return row;
        });
        return { textIds, textMask: this._mask(lengths) };
    }

    _preprocess(text, lang) {
        text = text.normalize('NFKD');
        text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '');
        const reps = { '–':'-','‑':'-','—':'-','_':' ','“':'"','”':'"','‘':"'",'’':"'",'´':"'",'`':"'",'[':' ',']':' ','|':' ','/':' ','#':' ','→':' ','←':' ' };
        for (const [k,v] of Object.entries(reps)) text = text.replaceAll(k, v);
        text = text.replace(/[♥☆♡©\\]/g, '');
        text = text.replaceAll('@', ' at ').replaceAll('e.g.,', 'for example, ').replaceAll('i.e.,', 'that is, ');
        text = text.replace(/ ([,\.!?;:'])/g, '$1');
        text = text.replace(/\s+/g, ' ').trim();
        if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(text)) text += '.';
        if (!LANGS.includes(lang)) throw new Error(`Invalid lang: ${lang}`);
        return `<${lang}>${text}</${lang}>`;
    }

    _mask(lengths) {
        const maxLen = Math.max(...lengths);
        return lengths.map(len => {
            const row = new Array(maxLen).fill(0);
            for (let j = 0; j < Math.min(len, maxLen); j++) row[j] = 1;
            return [row];
        });
    }
}

// ── Style ──────────────────────────────────────────────────────
class Style {
    constructor(ttl, dp) { this.ttl = ttl; this.dp = dp; }
}

async function loadVoiceStyle(url) {
    const js = await (await fetch(url)).json();
    const { dims: ttlDims, data: ttlData } = js.style_ttl;
    const { dims: dpDims,  data: dpData  } = js.style_dp;
    return new Style(
        new ort.Tensor('float32', new Float32Array(ttlData.flat(Infinity)), ttlDims),
        new ort.Tensor('float32', new Float32Array(dpData.flat(Infinity)),  dpDims)
    );
}

// ── TextToSpeech ───────────────────────────────────────────────
class TextToSpeech {
    constructor(cfgs, proc, dp, enc, vest, voc) {
        this.cfgs = cfgs; this.proc = proc;
        this.dp = dp; this.enc = enc; this.vest = vest; this.voc = voc;
        this.sampleRate = cfgs.ae.sample_rate;
    }

    async call(text, lang, style, totalStep, speed = 1.05, silenceDuration = 0.3, onProgress = null) {
        const maxLen  = (lang === 'ko' || lang === 'ja') ? 120 : 300;
        const chunks  = chunkText(text, maxLen);
        let wavCat = [], durCat = 0;
        for (let i = 0; i < chunks.length; i++) {
            const { wav, duration } = await this._infer([chunks[i]], [lang], style, totalStep, speed, onProgress);
            if (!wavCat.length) {
                wavCat = wav; durCat = duration[0];
            } else {
                const sil = new Array(Math.floor(silenceDuration * this.sampleRate)).fill(0);
                wavCat = [...wavCat, ...sil, ...wav];
                durCat += duration[0] + silenceDuration;
            }
        }
        return { wav: wavCat, duration: [durCat] };
    }

    async _infer(textList, langList, style, totalStep, speed, onProgress) {
        const bsz = textList.length;
        const { textIds, textMask } = this.proc.call(textList, langList);

        const tidFlat = new BigInt64Array(textIds.flat().map(x => BigInt(x)));
        const tidT    = new ort.Tensor('int64', tidFlat, [bsz, textIds[0].length]);
        const tmFlat  = new Float32Array(textMask.flat(2));
        const tmT     = new ort.Tensor('float32', tmFlat, [bsz, 1, textMask[0][0].length]);

        const t_dp = performance.now();
        const dpOut  = await this.dp.run({ text_ids: tidT, style_dp: style.dp, text_mask: tmT });
        console.log(`[worker] duration_predictor: ${(performance.now()-t_dp).toFixed(0)}ms`);

        const dur    = Array.from(dpOut.duration.data).map(d => d / speed);

        const t_enc = performance.now();
        const encOut = await this.enc.run({ text_ids: tidT, style_ttl: style.ttl, text_mask: tmT });
        console.log(`[worker] text_encoder: ${(performance.now()-t_enc).toFixed(0)}ms`);
        const textEmb = encOut.text_emb;

        let { xt, latentMask } = this._noiseLatent(dur);
        const lmT   = new ort.Tensor('float32', new Float32Array(latentMask.flat(2)), [bsz, 1, latentMask[0][0].length]);
        const totT  = new ort.Tensor('float32', new Float32Array(bsz).fill(totalStep), [bsz]);

        for (let step = 0; step < totalStep; step++) {
            onProgress?.(step + 1, totalStep);
            const xtFlat = new Float32Array(xt.flat(2));
            const xtT    = new ort.Tensor('float32', xtFlat, [bsz, xt[0].length, xt[0][0].length]);
            const curT   = new ort.Tensor('float32', new Float32Array(bsz).fill(step), [bsz]);
            const t_vest = performance.now();
            const vOut   = await this.vest.run({ noisy_latent: xtT, text_emb: textEmb, style_ttl: style.ttl, latent_mask: lmT, text_mask: tmT, current_step: curT, total_step: totT });
            console.log(`[worker] vector_estimator step ${step+1}/${totalStep}: ${(performance.now()-t_vest).toFixed(0)}ms`);
            const den    = Array.from(vOut.denoised_latent.data);
            const [ld, ll] = [xt[0].length, xt[0][0].length];
            xt = []; let idx = 0;
            for (let b = 0; b < bsz; b++) {
                const batch = [];
                for (let d = 0; d < ld; d++) { const row = []; for (let t = 0; t < ll; t++) row.push(den[idx++]); batch.push(row); }
                xt.push(batch);
            }
        }

        const fT    = new ort.Tensor('float32', new Float32Array(xt.flat(2)), [bsz, xt[0].length, xt[0][0].length]);
        const t_voc = performance.now();
        const vocOut = await this.voc.run({ latent: fT });
        console.log(`[worker] vocoder: ${(performance.now()-t_voc).toFixed(0)}ms`);
        return { wav: Array.from(vocOut.wav_tts.data), duration: dur };
    }

    _noiseLatent(duration) {
        const bsz  = duration.length;
        const maxDur = Math.max(...duration);
        const { base_chunk_size, chunk_compress_factor, latent_dim } = { ...this.cfgs.ae, ...this.cfgs.ttl };
        const chunkSize = base_chunk_size * chunk_compress_factor;
        const latLen    = Math.ceil(maxDur * this.sampleRate / chunkSize);
        const latDimV   = latent_dim * chunk_compress_factor;
        const xt = Array.from({ length: bsz }, () =>
            Array.from({ length: latDimV }, () =>
                Array.from({ length: latLen }, () => {
                    const u1 = Math.max(1e-4, Math.random()), u2 = Math.random();
                    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
                })
            )
        );
        const wavLens = duration.map(d => Math.floor(d * this.sampleRate));
        const latLens = wavLens.map(l => Math.ceil(l / chunkSize));
        const mask    = latLens.map(len => {
            const row = new Array(latLen).fill(0);
            for (let j = 0; j < Math.min(len, latLen); j++) row[j] = 1;
            return [row];
        });
        for (let b = 0; b < bsz; b++)
            for (let d = 0; d < latDimV; d++)
                for (let t = 0; t < latLen; t++)
                    xt[b][d][t] *= mask[b][0][t];
        return { xt, latentMask: mask };
    }
}

function chunkText(text, maxLen = 300) {
    const paragraphs = text.trim().split(/\n\s*\n+/).filter(p => p.trim());
    const chunks = [];
    for (const para of paragraphs) {
        const sentences = para.trim().split(/(?<=[.!?])\s+/);
        let cur = '';
        for (const s of sentences) {
            if (cur.length + s.length + 1 <= maxLen) { cur += (cur ? ' ' : '') + s; }
            else { if (cur) chunks.push(cur.trim()); cur = s; }
        }
        if (cur) chunks.push(cur.trim());
    }
    return chunks;
}

function writeWavFile(audioData, sampleRate) {
    const dataSize = audioData.length * 2;
    const buf  = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const ws   = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ws(36, 'data');
    view.setUint32(40, dataSize, true);
    const pcm = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++)
        pcm[i] = Math.floor(Math.max(-1, Math.min(1, audioData[i])) * 32767);
    new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));
    return buf;
}

// ── Worker state ───────────────────────────────────────────────
let tts = null;

self.onerror = (e) => {
    self.postMessage({ type: 'error', message: `Worker error: ${e.message}` });
};

self.onmessage = async ({ data }) => {
    if (data.type === 'load') {
        tts = null;
        console.log('[supertonic-worker] load requested, device=%s', data.device);
        try {
            const execProviders = data.device === 'webgpu' ? ['webgpu'] : ['wasm'];
            const sessionOpts   = { executionProviders: execProviders };
            console.log('[supertonic-worker] sessionOpts:', JSON.stringify(sessionOpts));
            const onDl = e => self.postMessage({ type: 'progress', data: e });

            const models = [
                ['duration_predictor.onnx', 'Duration predictor (3.7 MB)'],
                ['text_encoder.onnx',       'Text encoder (36 MB)'],
                ['vector_estimator.onnx',   'Vector estimator (257 MB)'],
                ['vocoder.onnx',            'Vocoder (101 MB)'],
            ];

            self.postMessage({ type: 'progress', data: { status: 'progress', file: 'Initialising ONNX Runtime…', loaded: 0, total: 0, progress: 0 } });

            const sessions = [];
            for (const [file, label] of models) {
                const buf = await fetchWithProgress(`${ONNX_DIR}/${file}`, label, onDl);
                self.postMessage({ type: 'progress', data: { status: 'progress', file: `Loading ${label} into ORT…`, loaded: 0, total: 0, progress: 0 } });
                sessions.push(await ort.InferenceSession.create(buf, sessionOpts));
            }

            const cfgsJson    = await (await fetch(`${ONNX_DIR}/tts.json`)).json();
            const indexerJson = await (await fetch(`${ONNX_DIR}/unicode_indexer.json`)).json();
            tts = new TextToSpeech(cfgsJson, new UnicodeProcessor(indexerJson), ...sessions);

            // WebGPU compiles shaders on first use — run a silent dummy pass so real
            // synthesis is fast from the start instead of stalling on the first call.
            if (data.device === 'webgpu') {
                self.postMessage({ type: 'progress', data: { status: 'progress', file: 'Warming up WebGPU shaders…', loaded: 0, total: 0, progress: 0 } });
                const warmupStyle = await loadVoiceStyle(`${STYLE_DIR}/M1.json`);
                await tts.call('Hi.', 'en', warmupStyle, 1, 1.0, 0);
                self.postMessage({ type: 'progress', data: { status: 'done', file: 'WebGPU shaders ready' } });
            }

            self.postMessage({ type: 'ready' });

        } catch (err) {
            console.error('[supertonic-worker] load failed:', err, 'stack:', err.stack);
            if (data.device === 'webgpu') {
                console.log('[supertonic-worker] WebGPU failed, falling back to WASM');
                self.postMessage({ type: 'status', message: 'WebGPU failed, retrying with WASM…' });
                self.onmessage({ data: { ...data, device: 'wasm' } });
            } else {
                self.postMessage({ type: 'error', message: `Load failed: ${err.message}` });
            }
        }

    } else if (data.type === 'generate') {
        try {
            const style = await loadVoiceStyle(`${STYLE_DIR}/${data.style}.json`);
            const { wav, duration } = await tts.call(
                data.text, data.lang, style,
                data.steps ?? 8, data.speed ?? 1.05, 0.3,
                (step, total) => self.postMessage({ type: 'gen-step', step, total })
            );
            const wavLen = Math.floor(tts.sampleRate * duration[0]);
            const audio  = new Float32Array(wav.slice(0, wavLen));
            self.postMessage({ type: 'audio', audio, sampleRate: tts.sampleRate }, [audio.buffer]);
        } catch (err) {
            console.error('[supertonic-worker] generate failed:', err);
            self.postMessage({ type: 'error', message: `Generate failed: ${err.message }` });
        }
    }
};
