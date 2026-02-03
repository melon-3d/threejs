import { useState, useRef } from "react";
import type { EvidenceItem, UploadProgress } from "../lib/image-storage";
import { uploadImage, deleteImage } from "../lib/image-storage";
import "./EvidenceGallery.css";

interface EvidenceGalleryProps {
    items: EvidenceItem[];
    imageUrls: Map<string, string>; // storageId -> dataUrl
    onChange: (items: EvidenceItem[], newImageUrl?: { storageId: string; dataUrl: string }) => void;
    disabled?: boolean;
}

export function EvidenceGallery({ items, imageUrls, onChange, disabled }: EvidenceGalleryProps) {
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [modalImage, setModalImage] = useState<{ url: string; name: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset input
        e.target.value = "";

        // Validate file type
        if (!file.type.startsWith("image/")) {
            setError("Please select an image file");
            return;
        }

        setError(null);

        try {
            const result = await uploadImage(file, setUploadProgress);

            const newItem: EvidenceItem = {
                id: result.id,
                storageId: result.storageId,
                name: result.name,
                mimeType: result.mimeType,
                addedAt: new Date().toISOString(),
            };

            onChange(
                [...items, newItem],
                { storageId: result.storageId, dataUrl: result.dataUrl }
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploadProgress(null);
        }
    };

    const handleDelete = async (item: EvidenceItem) => {
        try {
            await deleteImage(item.storageId);
            onChange(items.filter((i) => i.id !== item.id));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Delete failed");
        }
    };

    return (
        <div className="evidence-gallery">
            <div className="evidence-header">
                <label>Photos / Evidence</label>
                <button
                    type="button"
                    className="add-photo-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled || uploadProgress !== null}
                >
                    + Add Photo
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    style={{ display: "none" }}
                />
            </div>

            {uploadProgress && (
                <div className="upload-progress">
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${uploadProgress.progress}%` }}
                        />
                    </div>
                    <span className="progress-text">
                        {uploadProgress.status === "processing" ? "Processing..." : `${uploadProgress.progress}%`}
                    </span>
                </div>
            )}

            {error && (
                <div className="evidence-error">
                    <span>{error}</span>
                    <button onClick={() => setError(null)}>×</button>
                </div>
            )}

            {items.length > 0 && (
                <div className="evidence-grid">
                    {items.map((item) => {
                        const url = imageUrls.get(item.storageId);
                        return (
                            <div key={item.id} className="evidence-item">
                                {url ? (
                                    <img
                                        src={url}
                                        alt={item.name}
                                        onClick={() => setModalImage({ url, name: item.name })}
                                        style={{ cursor: "pointer" }}
                                    />
                                ) : (
                                    <div className="evidence-placeholder">
                                        <span>Missing</span>
                                    </div>
                                )}
                                <div className="evidence-item-overlay">
                                    <span className="evidence-item-name" title={item.name}>
                                        {item.name}
                                    </span>
                                    <button
                                        className="evidence-delete-btn"
                                        onClick={() => handleDelete(item)}
                                        disabled={disabled}
                                        title="Delete"
                                    >
                                        ×
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {modalImage && (
                <div className="image-modal-overlay" onClick={() => setModalImage(null)}>
                    <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
                        <img src={modalImage.url} alt={modalImage.name} />
                        <div className="image-modal-caption">{modalImage.name}</div>
                        <button
                            className="image-modal-close"
                            onClick={() => setModalImage(null)}
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
