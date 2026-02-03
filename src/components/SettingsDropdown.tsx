import "./SettingsDropdown.css";

interface SettingsDropdownProps {
    isOpen: boolean;
    onClose: () => void;
    onReloadDictionary: () => void;
    dictionaryLoading: boolean;
    dictionaryProgress?: { currentPage: number; totalPages: number } | null;
    dictionaryEntryCount: number;
    dictionaryError?: string | null;
    onDictionaryErrorClear?: () => void;
    smoothCamera: boolean;
    onSmoothCameraChange: (enabled: boolean) => void;
}

export function SettingsDropdown({
    isOpen,
    onClose,
    onReloadDictionary,
    dictionaryLoading,
    dictionaryProgress,
    dictionaryEntryCount,
    dictionaryError,
    onDictionaryErrorClear,
    smoothCamera,
    onSmoothCameraChange,
}: SettingsDropdownProps) {
    if (!isOpen) return null;

    return (
        <>
            <div className="settings-backdrop" onClick={onClose} />
            <div className="settings-dropdown">
                <div className="settings-section">
                    <h4>Dictionary</h4>
                    <button
                        className="settings-action-btn"
                        onClick={onReloadDictionary}
                        disabled={dictionaryLoading}
                    >
                        {dictionaryLoading ? "Loading..." : "Reload Dictionary"}
                    </button>
                    {dictionaryLoading && dictionaryProgress && (
                        <div className="settings-progress">
                            Loading page {dictionaryProgress.currentPage}/
                            {dictionaryProgress.totalPages}...
                        </div>
                    )}
                    {!dictionaryLoading && dictionaryEntryCount > 0 && (
                        <div className="settings-info">{dictionaryEntryCount} entries loaded</div>
                    )}
                    {dictionaryError && (
                        <div className="settings-error">
                            <span>{dictionaryError}</span>
                            {onDictionaryErrorClear && (
                                <button onClick={onDictionaryErrorClear}>×</button>
                            )}
                        </div>
                    )}
                </div>
                <div className="settings-section">
                    <h4>Camera</h4>
                    <label className="settings-checkbox">
                        <input
                            type="checkbox"
                            checked={smoothCamera}
                            onChange={(e) => onSmoothCameraChange(e.target.checked)}
                        />
                        <span>Smooth Camera</span>
                    </label>
                </div>
            </div>
        </>
    );
}
