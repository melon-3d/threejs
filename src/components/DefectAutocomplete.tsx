import { useState, useRef, useEffect } from "react";
import type { DefectEntry } from "../lib/dictionary-parser";
import "./DefectAutocomplete.css";

interface DefectAutocompleteProps {
    entries: DefectEntry[];
    value: DefectEntry | null;
    onChange: (entry: DefectEntry | null) => void;
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
    autoFocus?: boolean;
}

export function DefectAutocomplete({
    entries,
    value,
    onChange,
    placeholder = "Search defect...",
    disabled = false,
    error = false,
    autoFocus = false,
}: DefectAutocompleteProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Filter entries based on search query
    const filteredEntries = entries.filter((entry) => {
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase();
        return (
            entry.id.toLowerCase().includes(query) ||
            entry.defect.toLowerCase().includes(query) ||
            entry.description.toLowerCase().includes(query)
        );
    });

    // Update input value when selection changes
    useEffect(() => {
        if (value) {
            setSearchQuery(value.defect);
        } else {
            setSearchQuery("");
        }
    }, [value]);

    // Cleanup blur timeout on unmount
    useEffect(() => {
        return () => {
            if (blurTimeoutRef.current) {
                clearTimeout(blurTimeoutRef.current);
            }
        };
    }, []);

    // Handle input change
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const query = e.target.value;
        setSearchQuery(query);
        setIsOpen(true);
        setHighlightedIndex(0);

        // Clear selection if user is typing
        if (value && query !== value.defect) {
            onChange(null);
        }
    };

    // Handle input focus
    const handleInputFocus = () => {
        if (blurTimeoutRef.current) {
            clearTimeout(blurTimeoutRef.current);
            blurTimeoutRef.current = null;
        }
        if (!disabled) {
            setIsOpen(true);
        }
    };

    // Handle input blur (with delay to allow click on dropdown)
    const handleInputBlur = () => {
        // Delay to allow click on dropdown item
        blurTimeoutRef.current = setTimeout(() => {
            setIsOpen(false);
            blurTimeoutRef.current = null;
        }, 200);
    };

    // Handle entry selection
    const handleSelectEntry = (entry: DefectEntry) => {
        onChange(entry);
        setSearchQuery(entry.defect);
        setIsOpen(false);
        inputRef.current?.blur();
    };

    // Handle clear button
    const handleClear = () => {
        onChange(null);
        setSearchQuery("");
        inputRef.current?.focus();
    };

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!isOpen && filteredEntries.length > 0) {
                setIsOpen(true);
            } else if (filteredEntries.length > 0) {
                setHighlightedIndex((prev) =>
                    prev < filteredEntries.length - 1 ? prev + 1 : prev
                );
                // Scroll into view
                scrollToHighlighted();
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (isOpen && filteredEntries.length > 0) {
                setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
                scrollToHighlighted();
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (isOpen && filteredEntries.length > 0 && highlightedIndex >= 0) {
                handleSelectEntry(filteredEntries[highlightedIndex]);
            }
        } else if (e.key === "Escape") {
            setIsOpen(false);
            inputRef.current?.blur();
        }
    };

    // Scroll highlighted item into view
    const scrollToHighlighted = () => {
        if (dropdownRef.current) {
            const items = dropdownRef.current.querySelectorAll(".autocomplete-item");
            if (items[highlightedIndex]) {
                items[highlightedIndex].scrollIntoView({
                    block: "nearest",
                    behavior: "smooth",
                });
            }
        }
    };

    // Truncate description for display
    const truncateDescription = (text: string, maxLength: number = 60): string => {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    };

    return (
        <div ref={containerRef} className="defect-autocomplete">
            <div className="autocomplete-input-wrapper">
                <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={handleInputChange}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    disabled={disabled}
                    className={`autocomplete-input ${error ? "input-error" : ""}`}
                    autoFocus={autoFocus}
                />
                {value && !disabled && (
                    <button
                        type="button"
                        className="autocomplete-clear"
                        onClick={handleClear}
                        title="Clear selection"
                    >
                        ×
                    </button>
                )}
            </div>
            {isOpen && !disabled && filteredEntries.length > 0 && (
                <div ref={dropdownRef} className="autocomplete-dropdown">
                    {filteredEntries.map((entry, index) => (
                        <div
                            key={`${entry.id}-${index}`}
                            className={`autocomplete-item ${
                                index === highlightedIndex ? "highlighted" : ""
                            }`}
                            onClick={() => handleSelectEntry(entry)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                        >
                            <div className="autocomplete-item-main">
                                <span className="autocomplete-item-id">{entry.id}</span>
                                <span className="autocomplete-item-separator"> - </span>
                                <span className="autocomplete-item-defect">{entry.defect}</span>
                            </div>
                            {entry.description && (
                                <div className="autocomplete-item-description">
                                    {truncateDescription(entry.description)}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {isOpen && !disabled && searchQuery.trim() && filteredEntries.length === 0 && (
                <div className="autocomplete-dropdown">
                    <div className="autocomplete-no-results">No matching defects found</div>
                </div>
            )}
        </div>
    );
}
