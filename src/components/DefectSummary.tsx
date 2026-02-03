import type { Severity } from "../lib/model3d-viewer";
import { SEVERITY_COLORS } from "../lib/model3d-viewer";
import "./DefectSummary.css";

interface DefectSummaryProps {
    regions: Array<{ severity: Severity }>;
}

function DropIcon({ color }: { color: string }) {
    return (
        <svg
            width="14"
            height="16"
            viewBox="0 0 16 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path d="M8 0C8 0 0 8 0 13a8 8 0 1 0 16 0c0-5-8-13-8-13z" fill={color} />
        </svg>
    );
}

export function DefectSummary({ regions }: DefectSummaryProps) {
    const counts = {
        high: regions.filter((r) => r.severity === "high").length,
        medium: regions.filter((r) => r.severity === "medium").length,
        low: regions.filter((r) => r.severity === "low").length,
    };

    return (
        <div className="defect-summary">
            <div className="summary-item" style={{ backgroundColor: SEVERITY_COLORS.high }}>
                <DropIcon color="white" />
                <span className="summary-count">{counts.high}</span>
            </div>
            <div className="summary-item" style={{ backgroundColor: SEVERITY_COLORS.medium }}>
                <DropIcon color="white" />
                <span className="summary-count">{counts.medium}</span>
            </div>
            <div className="summary-item" style={{ backgroundColor: SEVERITY_COLORS.low }}>
                <DropIcon color="white" />
                <span className="summary-count">{counts.low}</span>
            </div>
        </div>
    );
}
