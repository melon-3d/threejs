import { useState, useRef, useEffect } from "react";
import type { DecalTextureId } from "../lib/model3d-viewer";
import { DECAL_OPTIONS } from "../lib/model3d-viewer";
import "./DecalDropdown.css";

interface DecalDropdownProps {
    value: DecalTextureId;
    onChange: (decalId: DecalTextureId) => void;
    disabled?: boolean;
}

export function DecalDropdown({ value, onChange, disabled = false }: DecalDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    const currentLabel = DECAL_OPTIONS.find((opt) => opt.value === value)?.label || DECAL_OPTIONS[0].label;

    // Update highlighted index when value changes
    useEffect(() => {
        const index = DECAL_OPTIONS.findIndex((opt) => opt.value === value);
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

    const handleButtonClick = () => {
        if (!disabled) {
            setIsOpen(!isOpen);
        }
    };

    const handleSelect = (decalValue: DecalTextureId) => {
        onChange(decalValue);
        setIsOpen(false);
        buttonRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
            } else {
                setHighlightedIndex((prev) => (prev < DECAL_OPTIONS.length - 1 ? prev + 1 : prev));
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (isOpen) {
                setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
            }
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isOpen && highlightedIndex >= 0) {
                handleSelect(DECAL_OPTIONS[highlightedIndex].value);
            } else {
                setIsOpen(true);
            }
        } else if (e.key === "Escape") {
            setIsOpen(false);
            buttonRef.current?.blur();
        }
    };

    return (
        <div ref={containerRef} className="decal-dropdown-container">
            <button
                ref={buttonRef}
                type="button"
                className={`decal-dropdown-button ${disabled ? "disabled" : ""} ${isOpen ? "open" : ""}`}
                onClick={handleButtonClick}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span className="decal-dropdown-label">{currentLabel}</span>
                <span className="decal-dropdown-arrow">▼</span>
            </button>
            {isOpen && !disabled && (
                <div className="decal-dropdown-menu">
                    {DECAL_OPTIONS.map((option, index) => (
                        <div
                            key={option.value}
                            className={`decal-dropdown-item ${index === highlightedIndex ? "highlighted" : ""} ${value === option.value ? "selected" : ""}`}
                            onClick={() => handleSelect(option.value)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                        >
                            {option.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
