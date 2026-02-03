import { useState, useRef, useEffect } from "react";
import type { ShapeType } from "../lib/model3d-viewer";
import "./TypeDropdown.css";

interface TypeDropdownProps {
    value: ShapeType;
    onChange: (type: ShapeType) => void;
    disabled?: boolean;
}

export function TypeDropdown({ value, onChange, disabled = false }: TypeDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const types: Array<{ value: ShapeType; label: string }> = [
        { value: "cube", label: "Cube" },
        { value: "sphere", label: "Sphere" },
        { value: "none", label: "Point" },
    ];

    const currentLabel = types.find((type) => type.value === value)?.label || types[0].label;

    // Update highlighted index when value changes
    useEffect(() => {
        const index = types.findIndex((type) => type.value === value);
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
    const handleSelect = (typeValue: ShapeType) => {
        onChange(typeValue);
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
                setHighlightedIndex((prev) => (prev < types.length - 1 ? prev + 1 : prev));
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (isOpen) {
                setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
            }
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isOpen && highlightedIndex >= 0) {
                handleSelect(types[highlightedIndex].value);
            } else {
                setIsOpen(true);
            }
        } else if (e.key === "Escape") {
            setIsOpen(false);
            buttonRef.current?.blur();
        }
    };

    return (
        <div ref={containerRef} className="type-dropdown-container">
            <button
                ref={buttonRef}
                type="button"
                className={`type-dropdown-button ${disabled ? "disabled" : ""} ${isOpen ? "open" : ""}`}
                onClick={handleButtonClick}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span className="type-dropdown-label">{currentLabel}</span>
                <span className="type-dropdown-arrow">▼</span>
            </button>
            {isOpen && !disabled && (
                <div ref={dropdownRef} className="type-dropdown-menu">
                    {types.map((type, index) => (
                        <div
                            key={type.value}
                            className={`type-dropdown-item ${index === highlightedIndex ? "highlighted" : ""} ${value === type.value ? "selected" : ""}`}
                            onClick={() => handleSelect(type.value)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                        >
                            {type.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
