export const TASK_STATES = Object.freeze({
  RECEIVED: "RECEIVED",
  PLANNED: "PLANNED",
  WAITING_FOR_APPROVAL: "WAITING_FOR_APPROVAL",
  EXECUTING: "EXECUTING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED"
});

const ALLOWED_TRANSITIONS = {
  RECEIVED: ["PLANNED", "FAILED"],
  PLANNED: ["WAITING_FOR_APPROVAL", "EXECUTING", "FAILED"],
  WAITING_FOR_APPROVAL: ["EXECUTING", "FAILED"],
  EXECUTING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: []
};

export class TaskLifecycle {
  constructor(initialState = TASK_STATES.RECEIVED) {
    if (!Object.hasOwn(ALLOWED_TRANSITIONS, initialState)) {
      throw new Error("Invalid initial task state.");
    }

    this.state = initialState;
    this.history = [initialState];
  }

  getState() {
    return this.state;
  }

  getHistory() {
    return [...this.history];
  }

  transition(nextState) {
    if (!Object.hasOwn(ALLOWED_TRANSITIONS, nextState)) {
      throw new Error("Invalid task state.");
    }

    if (!ALLOWED_TRANSITIONS[this.state].includes(nextState)) {
      throw new Error(
        `Invalid task transition: ${this.state} -> ${nextState}`
      );
    }

    this.state = nextState;
    this.history.push(nextState);

    return this.state;
  }
}
