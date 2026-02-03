import { useEffect } from "react";
import "./Toast.css";

interface ToastProps {
    message: string;
    type: "error" | "info";
    onClose: () => void;
    duration?: number;
}

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onClose]);

    return (
        <div className={`toast toast-${type}`}>
            <span className="toast-message">{message}</span>
            <button className="toast-close" onClick={onClose} aria-label="Close">
                ×
            </button>
        </div>
    );
}
