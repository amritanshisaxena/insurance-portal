class FlowTimer {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.marks = {};
    this.start = Date.now();
  }

  mark(label) {
    this.marks[label] = Date.now() - this.start;
  }

  summary() {
    return {
      sessionId: this.sessionId,
      totalMs: Date.now() - this.start,
      marks: this.marks,
    };
  }
}

module.exports = FlowTimer;
