import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export default function FeedbackToasts() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const handleFeedback = (event) => {
      const { type, message } = event.detail || {};
      if (!["success", "error"].includes(type) || typeof message !== "string" || !message.trim()) return;

      const id = ++nextId.current;
      setToasts((current) => [...current, { id, type, message: message.trim() }].slice(-4));
      timers.current.set(id, setTimeout(() => dismiss(id), type === "success" ? 4200 : 6500));
    };

    window.addEventListener("talentgraph:feedback", handleFeedback);
    return () => {
      window.removeEventListener("talentgraph:feedback", handleFeedback);
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
  }, [dismiss]);

  return (
    <div className="feedback-toast-stack" aria-label="Notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`feedback-toast feedback-toast-${toast.type}`}
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
        >
          {toast.type === "success" && (
            <span className="feedback-confetti" aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
            </span>
          )}
          {toast.type === "success" ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span className="feedback-toast-message">{toast.message}</span>
          <button type="button" className="feedback-toast-dismiss" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
