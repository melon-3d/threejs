import { useState } from "react";
import type { EvidenceItem } from "../lib/image-storage";
import "./EvidenceGallery.css";

interface ReadOnlyEvidenceGalleryProps {
    items: EvidenceItem[];
    imageUrls: Map<string, string>;
}

export function ReadOnlyEvidenceGallery({ items, imageUrls }: ReadOnlyEvidenceGalleryProps) {
    const [modalImage, setModalImage] = useState<{ url: string; name: string } | null>(null);

    if (items.length === 0) return null;

    return (
        <div className="evidence-gallery readonly">
            <div className="evidence-header">
                <label>Photos / Evidence</label>
            </div>
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
                            </div>
                        </div>
                    );
                })}
            </div>
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
