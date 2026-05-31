class TwitchChat {
    #ws = null;
    #channel = null;
    #handlers = { message: [], connected: [], disconnected: [], error: [] };

    on(event, fn) {
        this.#handlers[event]?.push(fn);
        return this;
    }

    #emit(event, ...args) {
        this.#handlers[event]?.forEach(fn => fn(...args));
    }

    connect(channel, wsUrl = "wss://irc-ws.chat.twitch.tv:443") {
        if (this.#ws) this.disconnect();

        this.#channel = channel.toLowerCase();
        this.#ws = new WebSocket(wsUrl);

        this.#ws.onopen = () => {
            this.#ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
            this.#ws.send("PASS SCHMOOPIIE");
            this.#ws.send("NICK justinfan" + Math.floor(Math.random() * 99999));
            this.#ws.send(`JOIN #${this.#channel}`);
        };

        this.#ws.onmessage = (event) => {
            for (const line of event.data.split("\r\n")) {
                if (line) this.#handleLine(line);
            }
        };

        this.#ws.onclose = () => {
            this.#emit("disconnected");
            this.#ws = null;
        };

        this.#ws.onerror = () => {
            this.#emit("error", new Error("WebSocket error"));
        };
    }

    disconnect() {
        if (!this.#ws) return;
        this.#ws.close();
        this.#ws = null;
    }

    #parseTags(tagStr) {
        const tags = {};
        for (const part of tagStr.split(";")) {
            const eq = part.indexOf("=");
            if (eq !== -1) tags[part.slice(0, eq)] = part.slice(eq + 1);
        }
        return tags;
    }

    #handleLine(line) {
        if (line.startsWith("PING")) {
            this.#ws.send("PONG :tmi.twitch.tv");
            return;
        }

        let tags = {};
        let rest = line;

        if (rest.startsWith("@")) {
            const sp = rest.indexOf(" ");
            tags = this.#parseTags(rest.slice(1, sp));
            rest = rest.slice(sp + 1);
        }

        const parts = rest.split(" ");
        const command = parts[1];

        if (command === "PRIVMSG") {
            const msgStart = rest.indexOf(" :", rest.indexOf("PRIVMSG"));
            this.#emit("message", {
                username: tags["display-name"] || parts[0].slice(1).split("!")[0],
                color: tags["color"] || null,
                text: msgStart !== -1 ? rest.slice(msgStart + 2) : "",
            });
        } else if (command === "JOIN") {
            this.#emit("connected", this.#channel);
        }
    }
}

window.TwitchChat = TwitchChat;
