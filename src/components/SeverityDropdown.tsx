import { useState, useRef, useEffect } from "react";
import type { Severity } from "../lib/model3d-viewer";
import { SEVERITY_COLORS } from "../lib/model3d-viewer";
import "./SeverityDropdown.css";

interface SeverityDropdownProps {
    value: Severity;
    onChange: (severity: Severity) => void;
    disabled?: boolean;
}

export function SeverityDropdown({ value, onChange, disabled = false }: SeverityDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const severities: Severity[] = ["high", "medium", "low"];

    const currentLabel = value.charAt(0).toUpperCase() + value.slice(1);

    // Update highlighted index when value changes
    useEffect(() => {
        const index = severities.findIndex((s) => s === value);
        if (index >= 0) {
            setHighlightedIndex(index);
        }
    }, [value]);

    // Handle click outside to close
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [isOpen]);

    // Handle button click
    const handleButtonClick = () => {
        if (!disabled) {
            setIsOpen(!isOpen);
        }
    };

    // Handle option selection
    const handleSelect = (severity: Severity) => {
        onChange(severity);
        setIsOpen(false);
        buttonRef.current?.focus();
    };

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
            } else {
                setHighlightedIndex((prev) => (prev < severities.length - 1 ? prev + 1 : prev));
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (isOpen) {
                setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
            }
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isOpen && highlightedIndex >= 0) {
                handleSelect(severities[highlightedIndex]);
            } else {
                setIsOpen(true);
            }
        } else if (e.key === "Escape") {
            setIsOpen(false);
            buttonRef.current?.blur();
        }
    };

    return (
        <div ref={containerRef} className="severity-dropdown-container">
            <button
                ref={buttonRef}
                type="button"
                className={`severity-dropdown-button ${disabled ? "disabled" : ""} ${isOpen ? "open" : ""}`}
                onClick={handleButtonClick}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span className="severity-dropdown-content">
                    <span
                        className="severity-dropdown-indicator"
                        style={{ backgroundColor: SEVERITY_COLORS[value] }}
                    />
                    <span className="severity-dropdown-label">{currentLabel}</span>
                </span>
                <span className="severity-dropdown-arrow">▼</span>
            </button>
            {isOpen && !disabled && (
                <div ref={dropdownRef} className="severity-dropdown-menu">
                    {severities.map((severity, index) => (
                        <div
                            key={severity}
                            className={`severity-dropdown-item ${index === highlightedIndex ? "highlighted" : ""} ${value === severity ? "selected" : ""}`}
                            onClick={() => handleSelect(severity)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                        >
                            <span
                                className="severity-dropdown-item-indicator"
                                style={{ backgroundColor: SEVERITY_COLORS[severity] }}
                            />
                            <span className="severity-dropdown-item-label">
                                {severity.charAt(0).toUpperCase() + severity.slice(1)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
