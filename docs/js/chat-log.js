class ChatLog {
    mount(el) {
        this._el = el;
        bus.on('chat:display', ({ username, text, color }) => this._append(username, text, color));
    }

    _append(username, text, color) {
        const div      = document.createElement('div');
        div.className  = 'chat-entry';
        const nameSpan = document.createElement('span');
        nameSpan.className   = 'chat-name';
        nameSpan.style.color = color || '#9146ff';
        nameSpan.textContent = username + ': ';
        const msgSpan        = document.createElement('span');
        msgSpan.textContent  = text;
        div.appendChild(nameSpan);
        div.appendChild(msgSpan);
        this._el.appendChild(div);
        this._el.scrollTop = this._el.scrollHeight;
    }
}

window.ChatLog = ChatLog;
