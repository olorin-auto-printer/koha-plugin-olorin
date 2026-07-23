// Controllable WebSocket mock, following the pattern used in
// olorin-browser-extension/tests/helpers/setup.mjs.
export class MockWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    MockWebSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    if (this.onclose) {
      this.onclose({ type: "close" });
    }
  }

  serverOpen() {
    if (this.onopen) {
      this.onopen({ type: "open" });
    }
  }

  serverReply(data) {
    if (this.onmessage) {
      this.onmessage({
        type: "message",
        data: typeof data === "string" ? data : JSON.stringify(data),
      });
    }
  }

  serverError() {
    if (this.onerror) {
      this.onerror({ type: "error" });
    }
  }

  static get last() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}
