class ChatTwitch {
    constructor() {
        this._twitch = new TwitchChat();
        this._twitch
            .on('connected',    ch => bus.emit('chat:status', { state: 'connected', channel: ch }))
            .on('disconnected', ()  => bus.emit('chat:status', { state: 'disconnected' }))
            .on('error',        ()  => bus.emit('chat:status', { state: 'error' }))
            .on('message', ({ username, text, color }) => bus.emit('chat:message', { username, text, color }));
    }

    mount(el) {
        el.innerHTML = `
            <div class="row" style="align-items:center;flex-wrap:wrap;gap:8px;">
                <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#aaa;cursor:pointer;">
                    <input type="radio" name="irc-source" value="twitch" checked> Twitch
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#aaa;cursor:pointer;">
                    <input type="radio" name="irc-source" value="local"> Local IRC
                    <span style="font-size:11px;color:#666;">(ws://127.0.0.1:7000)</span>
                </label>
            </div>
            <div class="row">
                <input id="channel-input" type="text" placeholder="Channel name">
                <button class="btn-purple" id="btn-connect">Connect</button>
                <button class="btn-red"    id="btn-disconnect">Disconnect</button>
            </div>
            <div id="conn-status" style="margin-bottom:18px;font-style:italic;color:#aaa;">Not connected</div>
        `;

        this._statusEl = el.querySelector('#conn-status');

        const channelInput = el.querySelector('#channel-input');
        const updateChannelVisibility = () => {
            const src = el.querySelector('input[name="irc-source"]:checked').value;
            channelInput.style.display = src === 'local' ? 'none' : '';
        };
        el.querySelectorAll('input[name="irc-source"]').forEach(r =>
            r.addEventListener('change', updateChannelVisibility)
        );

        el.querySelector('#btn-connect').addEventListener('click', () => {
            const src = el.querySelector('input[name="irc-source"]:checked').value;
            const ch  = src === 'local' ? 'local' : channelInput.value.trim();
            if (!ch) return;
            const url = src === 'local' ? 'ws://127.0.0.1:7000' : 'wss://irc-ws.chat.twitch.tv:443';
            this._statusEl.textContent = src === 'local' ? 'Connecting to local IRC…' : `Connecting to #${ch}…`;
            this._twitch.connect(ch, url);
        });

        el.querySelector('#btn-disconnect').addEventListener('click', () => this._twitch.disconnect());

        bus.on('chat:status', ({ state, channel }) => {
            if (!this._statusEl) return;
            if (state === 'connected')         this._statusEl.textContent = `Connected to #${channel}`;
            else if (state === 'disconnected') this._statusEl.textContent = 'Disconnected';
            else                               this._statusEl.textContent = 'Connection error';
        });
    }
}

window.ChatTwitch = ChatTwitch;
