export function notifyFeedback(type, message) {
  window.dispatchEvent(new CustomEvent("talentgraph:feedback", {
    detail: { type, message },
  }));
}
