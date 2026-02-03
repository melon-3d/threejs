import type { ReactNode } from "react";
import "./LeftSideMenu.css";

interface LeftSideMenuProps {
    title?: string;
    children?: ReactNode;
    showModeToggle?: boolean;
    mode?: "edit" | "view";
    onModeChange?: (mode: "edit" | "view") => void;
    settingsDropdown?: ReactNode;
}

export function LeftSideMenu({
    title = "Controls",
    children,
    showModeToggle,
    mode = "edit",
    onModeChange,
    settingsDropdown,
}: LeftSideMenuProps) {
    return (
        <div className="left-side-menu">
            <div className="left-side-menu-header">
                <h2>{title}</h2>
                <div className="header-actions">
                    {showModeToggle && (
                        <button
                            className="mode-toggle-chevron"
                            onClick={() => onModeChange?.(mode === "edit" ? "view" : "edit")}
                            title={mode === "edit" ? "Collapse form" : "Expand form"}
                        >
                            {mode === "edit" ? "▲" : "▶"}
                        </button>
                    )}
                    {settingsDropdown}
                </div>
            </div>
            <div className="left-side-menu-content">{children}</div>
        </div>
    );
}
