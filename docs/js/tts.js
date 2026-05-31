class TTS {
    supportsLanguage = false;

    get voices() {
        return speechSynthesis.getVoices();
    }

    // Returns [{voice, index}] filtered to English and German only.
    // Falls back to all voices if none match.
    get supportedVoices() {
        const all      = speechSynthesis.getVoices();
        const filtered = all
            .map((voice, index) => ({ voice, index }))
            .filter(({ voice }) => voice.lang.startsWith('en') || voice.lang.startsWith('de'));
        return filtered.length > 0 ? filtered : all.map((voice, index) => ({ voice, index }));
    }

    speak(text, { voiceIndex = 0, rate = 1, onEnd = null, onBoundary = null } = {}) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        const voice = this.voices[voiceIndex];
        if (voice) utterance.voice = voice;
        if (onEnd) utterance.addEventListener('end', onEnd);
        if (onBoundary) utterance.addEventListener('boundary', onBoundary);
        speechSynthesis.speak(utterance);
        return utterance;
    }

    stop() {
        speechSynthesis.cancel();
    }
}

window.TTS = TTS;
