import { useEffect, useRef, useState } from "react";
import { Model3DViewer, SEVERITY_COLORS } from "../lib/model3d-viewer";
import type { ShapeType, Severity, LabelPosition, RegionsExportData } from "../lib/model3d-viewer";
import * as THREE from "three";
import { fetchAllDictionaryPages, type DefectEntry } from "../lib/dictionary-parser";
import { LeftSideMenu } from "./LeftSideMenu";
import { SettingsDropdown } from "./SettingsDropdown";
import { DefectSummary } from "./DefectSummary";
import { Toast } from "./Toast";
import { DefectAutocomplete } from "./DefectAutocomplete";
import { SeverityDropdown } from "./SeverityDropdown";
import { TypeDropdown } from "./TypeDropdown";
import { DecalDropdown } from "./DecalDropdown";
import type { DecalTextureId } from "../lib/model3d-viewer";
import { EvidenceGallery } from "./EvidenceGallery";
import { ReadOnlyEvidenceGallery } from "./ReadOnlyEvidenceGallery";
import type { EvidenceItem } from "../lib/image-storage";
import { getImageById, getImageBlob, saveImageBlob } from "../lib/image-storage";
import JSZip from "jszip";
import "./Model3DPreview.css";

const DICTIONARY_STORAGE_KEY = "defects3d_dictionary";

interface DictionaryStorage {
    entries: DefectEntry[];
    timestamp: number;
}

function loadDictionaryFromStorage(): DefectEntry[] | null {
    const data = localStorage.getItem(DICTIONARY_STORAGE_KEY);
    if (!data) return null;
    try {
        const parsed: DictionaryStorage = JSON.parse(data);
        return parsed.entries;
    } catch {
        return null;
    }
}

function saveDictionaryToStorage(entries: DefectEntry[]): void {
    const data: DictionaryStorage = {
        entries,
        timestamp: Date.now(),
    };
    localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(data));
}

interface Model3DPreviewProps {
    width?: number;
    height?: number;
    environmentUrl?: string; // URL to EXR environment map file
}

export function Model3DPreview({ width, height, environmentUrl }: Model3DPreviewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewerRef = useRef<Model3DViewer | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasModel, setHasModel] = useState(false);
    const [viewMode, setViewMode] = useState<"edit" | "view">("edit");
    const [showSettings, setShowSettings] = useState(false);
    const [shapeType, setShapeType] = useState<ShapeType>("cube");
    const [shapeSizePercent, setShapeSizePercent] = useState(100);
    const [severity, setSeverity] = useState<Severity>("medium");
    const [decalTextureId, setDecalTextureId] = useState<DecalTextureId>("none");
    const [smoothCameraMode, setSmoothCameraModeState] = useState(false);
    const [labelPositions, setLabelPositions] = useState<LabelPosition[]>([]);
    const [selectedDefect, setSelectedDefect] = useState<DefectEntry | null>(null);
    const [newLabelError, setNewLabelError] = useState<string | null>(null);
    const [previewLabelPosition, setPreviewLabelPosition] = useState<{
        x: number;
        y: number;
        visible: boolean;
    } | null>(null);
    const [regions, setRegions] = useState<
        Array<{
            id: string;
            label: string;
            severity: Severity;
            type: ShapeType;
            size: number;
            defectData?: DefectEntry;
            notes?: string;
            evidence?: EvidenceItem[];
            decalTextureId?: DecalTextureId;
        }>
    >([]);
    const [evidenceUrls, setEvidenceUrls] = useState<Map<string, string>>(new Map());
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: "error" | "info" } | null>(null);
    const [hiddenRegionIds, setHiddenRegionIds] = useState<Set<string>>(new Set());
    const [labelsExpanded, setLabelsExpanded] = useState(true);
    const [highlightedRegionId, setHighlightedRegionId] = useState<string | null>(null);
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
    const [viewingRegionId, setViewingRegionId] = useState<string | null>(null);

    // Dictionary state
    const [dictionaryEntries, setDictionaryEntries] = useState<DefectEntry[]>([]);
    const [dictionaryLoading, setDictionaryLoading] = useState(false);
    const [dictionaryProgress, setDictionaryProgress] = useState<{
        currentPage: number;
        totalPages: number;
    } | null>(null);
    const [dictionaryError, setDictionaryError] = useState<string | null>(null);

    const hasDictionaryUrl = Boolean((import.meta.env.VITE_DICTIONARY_URL ?? "").trim());

    // Edit mode state
    const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{
        label: string;
        severity: Severity;
        type: ShapeType;
        size: number;
        defectData?: DefectEntry;
        decalTextureId: DecalTextureId;
        notes?: string;
        evidence?: EvidenceItem[];
    } | null>(null);
    const [editLabelError, setEditLabelError] = useState<string | null>(null);
    const [isMovingRegion, setIsMovingRegion] = useState(false);
    const originalRegionRef = useRef<{
        label: string;
        severity: Severity;
        type: ShapeType;
        size: number;
        position: { x: number; y: number; z: number };
        decalTextureId: DecalTextureId;
    } | null>(null);

    // Real-time preview: sync non-decal form changes to viewer (immediate)
    useEffect(() => {
        if (!editingRegionId || !editForm || !viewerRef.current) return;

        viewerRef.current.updateRegion(editingRegionId, {
            severity: editForm.severity,
            type: editForm.type,
            // Only update label if defectData is selected (not when cleared)
            ...(editForm.defectData && { label: editForm.defectData.defect }),
        });
    }, [editingRegionId, editForm?.severity, editForm?.type, editForm?.defectData]);

    // Real-time preview: sync decal-related form changes to viewer (throttled)
    useEffect(() => {
        if (!editingRegionId || !editForm || !viewerRef.current) return;

        // Clear any pending update
        if (decalUpdateTimeoutRef.current) {
            clearTimeout(decalUpdateTimeoutRef.current);
        }

        const shapeBaseSize = viewerRef.current.getShapeBaseSize();
        const absoluteSize = shapeBaseSize * (editForm.size / 100);

        // Throttle decal updates to avoid lag
        decalUpdateTimeoutRef.current = setTimeout(() => {
            if (!viewerRef.current) return;
            viewerRef.current.updateRegion(editingRegionId, {
                size: absoluteSize,
                decalTextureId: editForm.decalTextureId,
            });
        }, 150); // 150ms throttle

        return () => {
            if (decalUpdateTimeoutRef.current) {
                clearTimeout(decalUpdateTimeoutRef.current);
            }
        };
    }, [editingRegionId, editForm?.size, editForm?.decalTextureId]);

    // Track mouse down for click detection
    const mouseDownRef = useRef<{
        time: number;
        x: number;
        y: number;
        moved: boolean;
    } | null>(null);
    const lastRaycastResultRef = useRef<{
        normal: THREE.Vector3;
        object: THREE.Object3D;
    } | null>(null);
    const decalUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const importInputRef = useRef<HTMLInputElement>(null);

    // Refresh regions list from viewer
    const refreshRegions = () => {
        if (viewerRef.current) {
            setRegions(viewerRef.current.getRegions());
        }
    };

    // Show toast notification
    const showToast = (message: string, type: "error" | "info" = "info") => {
        setToast({ message, type });
    };

    // Initialize viewer
    useEffect(() => {
        if (!canvasRef.current) return;

        const viewer = new Model3DViewer(canvasRef.current, width, height, environmentUrl);
        viewerRef.current = viewer;

        // Set animation callback for label position updates
        viewer.setAnimationCallback(() => {
            const positions = viewer.getLabelPositions();
            if (positions !== null) {
                setLabelPositions(positions);
            }

            // Update preview label position
            const dynamicPos = viewer.getDynamicLabelPosition();
            setPreviewLabelPosition(dynamicPos);
        });

        // Handle window resize
        const handleResize = () => {
            viewer.onResize();
        };
        window.addEventListener("resize", handleResize);

        // Use ResizeObserver to track container size changes (e.g., when menu appears)
        const container = canvasRef.current.parentElement;
        let resizeObserver: ResizeObserver | null = null;

        if (container && window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                // Use requestAnimationFrame to ensure DOM has updated
                requestAnimationFrame(() => {
                    viewer.onResize();
                });
            });
            resizeObserver.observe(container);
        }

        return () => {
            window.removeEventListener("resize", handleResize);
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            viewer.setAnimationCallback(null); // Clear callback before dispose
            viewer.dispose();
            viewerRef.current = null;
        };
    }, [width, height, environmentUrl]);

    // Load dictionary from localStorage on mount, or from API / bundled JSON
    useEffect(() => {
        const cached = loadDictionaryFromStorage();
        if (cached && cached.length > 0) {
            setDictionaryEntries(cached);
            return;
        }
        if (hasDictionaryUrl) {
            handleReloadDictionary();
            return;
        }
        // No URL: load from bundled defects.json
        (async () => {
            try {
                const res = await fetch(`${import.meta.env.BASE_URL}defects.json`);
                if (!res.ok) throw new Error("Failed to fetch defects.json");
                const data = await res.json();
                const entries: DefectEntry[] = data.entries ?? [];
                setDictionaryEntries(entries);
                saveDictionaryToStorage(entries);
            } catch (err) {
                console.error("Failed to load dictionary from defects.json", err);
                setDictionaryError(
                    err instanceof Error ? err.message : "Failed to load dictionary"
                );
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Check if file is GLB/GLTF
    const isModelFile = (file: File): boolean => {
        const ext = file.name.toLowerCase().split(".").pop();
        return ext === "glb" || ext === "gltf";
    };

    // Handle file drop
    const handleFile = async (file: File) => {
        if (!viewerRef.current) return;

        setError(null);

        try {
            if (isModelFile(file)) {
                await viewerRef.current.loadModelFromFile(file);
                setHasModel(true);
                // Sync shape settings with viewer
                viewerRef.current.setShapeType(shapeType);
                viewerRef.current.setShapeSizePercent(shapeSizePercent);
                viewerRef.current.setSeverity(severity);
                // Resize after model is loaded to ensure correct dimensions
                requestAnimationFrame(() => {
                    viewerRef.current?.onResize();
                });
            } else {
                setError("Unsupported file type. Please use GLB/GLTF for models.");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load file");
            console.error("Error loading file:", err);
        }
    };

    // Drag and drop handlers
    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            handleFile(files[0]);
        }
    };

    // File input handler
    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFile(files[0]);
        }
    };

    // Handle mouse move for raycasting
    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        // Track movement for click detection
        if (mouseDownRef.current) {
            const dx = e.clientX - mouseDownRef.current.x;
            const dy = e.clientY - mouseDownRef.current.y;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                mouseDownRef.current.moved = true;
            }
        }

        if (!viewerRef.current || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Convert to normalized device coordinates (-1 to 1)
        const normalizedX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const normalizedY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const result = viewerRef.current.raycastFromMouse(normalizedX, normalizedY);
        const point = result?.point ?? null;

        // Store raycast result for decal creation
        if (result) {
            lastRaycastResultRef.current = {
                normal: result.normal,
                object: result.object,
            };
        } else {
            lastRaycastResultRef.current = null;
        }

        if (viewMode === "view") {
            // In view mode: detect hover over region areas
            if (result?.point) {
                const regionId = viewerRef.current.findRegionAtPoint(result.point);
                setHoveredRegionId(regionId);
            } else {
                setHoveredRegionId(null);
            }
        } else {
            // In edit mode: update shape preview position
            viewerRef.current.updateShapePosition(point);
        }
    };

    // Handle mouse leave to hide shape
    const handleMouseLeave = () => {
        if (!viewerRef.current) return;
        if (viewMode === "view") {
            // In view mode: reset hovered region
            setHoveredRegionId(null);
        } else {
            // In edit mode: hide shape preview
            viewerRef.current.updateShapePosition(null);
        }
    };

    // Handle mouse down - record time and position for click detection
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return; // Only left button
        mouseDownRef.current = {
            time: Date.now(),
            x: e.clientX,
            y: e.clientY,
            moved: false,
        };
    };

    // Handle mouse up - detect short click to save region
    const handleMouseUp = async (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !mouseDownRef.current) return;

        const elapsed = Date.now() - mouseDownRef.current.time;
        const moved = mouseDownRef.current.moved;

        // Reset tracking
        mouseDownRef.current = null;

        // Check if this was a short click (not drag): time < 350ms and no significant movement
        if (elapsed < 350 && !moved) {
            // Disable click-to-add in view mode
            if (viewMode === "view") return;

            if (viewerRef.current && canvasRef.current) {
                // If in move mode, save new position
                if (isMovingRegion && editingRegionId) {
                    const rect = canvasRef.current.getBoundingClientRect();
                    const normalizedX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    const normalizedY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                    const result = viewerRef.current.raycastFromMouse(normalizedX, normalizedY);
                    if (result?.point) {
                        viewerRef.current.updateRegionPosition(editingRegionId, result.point);
                        viewerRef.current.setRegionVisible(editingRegionId, true);
                        viewerRef.current.updateShapePosition(null);
                        setIsMovingRegion(false);
                        refreshRegions();
                    }
                    return;
                }

                // Normal mode - create new region (skip if editing, skip if no model)
                if (!editingRegionId && hasModel) {
                    if (!selectedDefect) {
                        setNewLabelError("Defect selection is required");
                        showToast("Select a defect from dictionary before clicking", "error");
                        return;
                    }

                    // Get camera state before saving
                    const cameraState = viewerRef.current.getCameraState();

                    const savedId = await viewerRef.current.saveCurrentRegion(
                        selectedDefect.defect,
                        selectedDefect,
                        cameraState?.position,
                        cameraState?.target,
                        lastRaycastResultRef.current?.normal,
                        decalTextureId,
                        lastRaycastResultRef.current?.object
                    );
                    if (savedId) {
                        refreshRegions();
                        setSelectedDefect(null); // Clear selection after save
                        setNewLabelError(null);
                    }
                }
            }
        }
    };

    // Handle shape size change
    const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(e.target.value, 10);
        setShapeSizePercent(value);
        if (viewerRef.current) {
            viewerRef.current.setShapeSizePercent(value);
        }
    };

    // Handle shape type change
    const handleShapeTypeChange = (type: ShapeType) => {
        setShapeType(type);
        if (viewerRef.current) {
            viewerRef.current.setShapeType(type);
        }
    };

    // Handle severity change
    const handleSeverityChange = (newSeverity: Severity) => {
        setSeverity(newSeverity);
        if (viewerRef.current) {
            viewerRef.current.setSeverity(newSeverity);
        }
    };

    const confirmDeleteRegion = () => {
        if (deleteConfirmId && viewerRef.current) {
            viewerRef.current.deleteRegion(deleteConfirmId);
            refreshRegions();
        }
        setDeleteConfirmId(null);
    };

    const cancelDeleteRegion = () => {
        setDeleteConfirmId(null);
    };

    // Start editing a region
    const handleEditRegion = (id: string) => {
        const region = regions.find((r) => r.id === id);
        if (!region || !viewerRef.current) return;

        const position = viewerRef.current.getRegionPosition(id);
        if (!position) return;

        // Convert absolute size to percentage
        const shapeBaseSize = viewerRef.current.getShapeBaseSize();
        const sizePercent = Math.round((region.size / shapeBaseSize) * 100);

        // Store original values for cancel
        originalRegionRef.current = {
            label: region.label,
            severity: region.severity,
            type: region.type,
            size: region.size,
            position: { x: position.x, y: position.y, z: position.z },
            decalTextureId: region.decalTextureId || "none",
        };

        setEditingRegionId(id);
        setEditForm({
            label: region.label,
            severity: region.severity,
            type: region.type,
            size: sizePercent,
            defectData: region.defectData,
            decalTextureId: region.decalTextureId || "none",
            notes: region.notes,
            evidence: region.evidence || [],
        });
        setEditLabelError(null);

        // Load evidence images
        if (region.evidence && region.evidence.length > 0) {
            const loadImages = async () => {
                const newUrls = new Map(evidenceUrls);
                for (const item of region.evidence!) {
                    if (!newUrls.has(item.storageId)) {
                        const url = await getImageById(item.storageId);
                        if (url) {
                            newUrls.set(item.storageId, url);
                        }
                    }
                }
                setEvidenceUrls(newUrls);
            };
            loadImages();
        }
    };

    // Cancel editing
    const handleCancelEdit = () => {
        // Clear any pending decal update
        if (decalUpdateTimeoutRef.current) {
            clearTimeout(decalUpdateTimeoutRef.current);
            decalUpdateTimeoutRef.current = null;
        }

        // Restore original values to viewer
        if (editingRegionId && originalRegionRef.current && viewerRef.current) {
            viewerRef.current.updateRegion(editingRegionId, {
                severity: originalRegionRef.current.severity,
                type: originalRegionRef.current.type,
                size: originalRegionRef.current.size,
                label: originalRegionRef.current.label,
                decalTextureId: originalRegionRef.current.decalTextureId,
            });

            // Restore visibility if was moving
            if (isMovingRegion) {
                viewerRef.current.setRegionVisible(editingRegionId, true);
            }
        }

        setEditingRegionId(null);
        setEditForm(null);
        setEditLabelError(null);
        setIsMovingRegion(false);
        originalRegionRef.current = null;
    };

    // Save edited region
    const handleSaveEdit = async () => {
        if (!editingRegionId || !editForm || !viewerRef.current) return;

        // Validate defect selection
        if (!editForm.defectData) {
            setEditLabelError("Defect selection is required");
            return;
        }

        // Get camera state before saving
        const cameraState = viewerRef.current.getCameraState();

        // Clear any pending decal update
        if (decalUpdateTimeoutRef.current) {
            clearTimeout(decalUpdateTimeoutRef.current);
            decalUpdateTimeoutRef.current = null;
        }

        // Convert size from percentage to absolute
        const shapeBaseSize = viewerRef.current.getShapeBaseSize();
        const absoluteSize = shapeBaseSize * (editForm.size / 100);

        await viewerRef.current.updateRegion(editingRegionId, {
            label: editForm.defectData.defect,
            severity: editForm.severity,
            type: editForm.type,
            size: absoluteSize,
            defectData: editForm.defectData,
            cameraPosition: cameraState?.position,
            cameraTarget: cameraState?.target,
            decalTextureId: editForm.decalTextureId,
            notes: editForm.notes,
            evidence: editForm.evidence,
        });

        refreshRegions();
        setEditingRegionId(null);
        setEditForm(null);
        setEditLabelError(null);
        setIsMovingRegion(false);
        originalRegionRef.current = null;
    };

    // Update edit form field
    const handleEditFormChange = (
        field: keyof NonNullable<typeof editForm>,
        value: string | number
    ) => {
        if (!editForm) return;
        setEditForm({ ...editForm, [field]: value });
        if (field === "label") {
            setEditLabelError(null);
        }
    };

    // Start moving region
    const handleStartMove = () => {
        if (!editingRegionId || !viewerRef.current) return;

        // Hide region from scene (will show preview shape instead)
        viewerRef.current.setRegionVisible(editingRegionId, false);

        // Set shape to match region being moved
        if (editForm) {
            viewerRef.current.setShapeType(editForm.type === "none" ? "sphere" : editForm.type);
            viewerRef.current.setShapeSizePercent(editForm.size);
            viewerRef.current.setSeverity(editForm.severity);
        }

        setIsMovingRegion(true);
    };

    // Cancel move (restore original position)
    const handleCancelMove = () => {
        if (!editingRegionId || !viewerRef.current) return;

        // Show region again
        viewerRef.current.setRegionVisible(editingRegionId, true);
        viewerRef.current.updateShapePosition(null); // Hide preview shape

        setIsMovingRegion(false);
    };

    // Helper to check if any region has evidence
    const hasAnyEvidence = (): boolean => {
        return regions.some((r) => r.evidence && r.evidence.length > 0);
    };

    // Export regions to JSON file or ZIP archive
    const handleExportRegions = async () => {
        if (!viewerRef.current || regions.length === 0) return;

        const data = viewerRef.current.exportRegions();
        const dateStr = new Date().toISOString().slice(0, 10);

        if (hasAnyEvidence()) {
            // Export as ZIP
            const zip = new JSZip();

            // Add regions.json
            const json = JSON.stringify(data, null, 2);
            zip.file("regions.json", json);

            // Add evidence folder with images
            const evidenceFolder = zip.folder("evidence");

            for (const region of data.regions) {
                if (region.evidence) {
                    for (const item of region.evidence) {
                        const blob = await getImageBlob(item.storageId);
                        if (blob) {
                            const ext = item.mimeType === "image/webp" ? "webp" : "jpg";
                            evidenceFolder?.file(`${item.storageId}.${ext}`, blob);
                        }
                    }
                }
            }

            // Generate and download ZIP
            const zipBlob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(zipBlob);

            const a = document.createElement("a");
            a.href = url;
            a.download = `regions-${dateStr}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else {
            // Export as JSON (no evidence)
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = `regions-${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    // Trigger file input for import
    const handleImportClick = () => {
        importInputRef.current?.click();
    };

    // Handle import file selection
    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !viewerRef.current) return;

        // Reset input so same file can be selected again
        e.target.value = "";

        try {
            let data: RegionsExportData;

            if (file.name.endsWith(".zip")) {
                // Handle ZIP import
                const zip = await JSZip.loadAsync(file);

                // Read regions.json
                const regionsFile = zip.file("regions.json");
                if (!regionsFile) {
                    throw new Error("ZIP does not contain regions.json");
                }
                const jsonText = await regionsFile.async("string");
                data = JSON.parse(jsonText);

                // Import evidence images
                const evidenceFolder = zip.folder("evidence");
                if (evidenceFolder) {
                    const newUrls = new Map(evidenceUrls);

                    for (const region of data.regions) {
                        if (region.evidence) {
                            for (const item of region.evidence) {
                                // Try webp first, then jpg
                                let imageFile = evidenceFolder.file(`${item.storageId}.webp`);
                                if (!imageFile) {
                                    imageFile = evidenceFolder.file(`${item.storageId}.jpg`);
                                }

                                if (imageFile) {
                                    const blob = await imageFile.async("blob");
                                    await saveImageBlob(item.storageId, blob);

                                    // Create data URL for display
                                    const dataUrl = await new Promise<string>((resolve) => {
                                        const reader = new FileReader();
                                        reader.onload = () => resolve(reader.result as string);
                                        reader.readAsDataURL(blob);
                                    });
                                    newUrls.set(item.storageId, dataUrl);
                                }
                            }
                        }
                    }

                    setEvidenceUrls(newUrls);
                }
            } else {
                // Handle JSON import
                const text = await file.text();
                data = JSON.parse(text);
            }

            await viewerRef.current.importRegions(data, true);
            refreshRegions();
            setImportError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to import file";
            setImportError(message);
            console.error("Import error:", err);
        }
    };

    // Handle dictionary reload
    const handleReloadDictionary = async () => {
        setDictionaryLoading(true);
        setDictionaryError(null);
        setDictionaryProgress(null);

        if (!hasDictionaryUrl) {
            setDictionaryLoading(false);
            showToast("URL is not set. Using data from repository.", "info");
            return;
        }

        try {
            const dictionaryUrl = import.meta.env.VITE_DICTIONARY_URL as string;
            const entries = await fetchAllDictionaryPages(
                dictionaryUrl,
                (currentPage, totalPages) => {
                    setDictionaryProgress({ currentPage, totalPages });
                }
            );

            setDictionaryEntries(entries);
            saveDictionaryToStorage(entries);
            setDictionaryProgress(null);
            showToast(`Found ${entries.length} entries`, "info");
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load dictionary";
            setDictionaryError(message);
            console.error("Dictionary load error:", err);
        } finally {
            setDictionaryLoading(false);
        }
    };

    // Handle ESC key to cancel edit/move
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (isMovingRegion) {
                    handleCancelMove();
                } else if (editingRegionId) {
                    handleCancelEdit();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMovingRegion, editingRegionId]);

    // Sync hovered and highlighted regions with viewer separately
    useEffect(() => {
        if (viewerRef.current) {
            viewerRef.current.setHoveredRegion(hoveredRegionId);
            viewerRef.current.setHighlightedRegion(highlightedRegionId);
        }
    }, [hoveredRegionId, highlightedRegionId]);

    // Auto-collapse edit forms when switching to view mode
    useEffect(() => {
        if (viewMode === "view") {
            if (isMovingRegion && editingRegionId && viewerRef.current) {
                viewerRef.current.setRegionVisible(editingRegionId, true);
                viewerRef.current.updateShapePosition(null);
            }
            setEditingRegionId(null);
            setEditForm(null);
            setIsMovingRegion(false);
            setViewingRegionId(null);
        } else {
            setViewingRegionId(null);
        }
    }, [viewMode, isMovingRegion, editingRegionId]);

    // Load evidence images when viewing region in view mode
    useEffect(() => {
        if (viewMode !== "view" || !viewingRegionId) return;

        const region = regions.find((r) => r.id === viewingRegionId);
        if (region?.evidence && region.evidence.length > 0) {
            const loadImages = async () => {
                const newUrls = new Map(evidenceUrls);
                for (const item of region.evidence!) {
                    if (!newUrls.has(item.storageId)) {
                        const url = await getImageById(item.storageId);
                        if (url) {
                            newUrls.set(item.storageId, url);
                        }
                    }
                }
                setEvidenceUrls(newUrls);
            };
            loadImages();
        }
    }, [viewingRegionId, viewMode, regions, evidenceUrls]);

    // Handle smooth camera mode toggle
    const handleSmoothCameraModeChange = (enabled: boolean) => {
        setSmoothCameraModeState(enabled);
        if (viewerRef.current) {
            viewerRef.current.setSmoothCameraMode(enabled);
        }
    };

    // Handle region visibility change
    const handleRegionVisibilityChange = (id: string, hidden: boolean) => {
        setHiddenRegionIds((prev) => {
            const next = new Set(prev);
            if (hidden) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
        if (viewerRef.current) {
            viewerRef.current.setRegionVisible(id, !hidden);
        }
    };

    // Handle focus on region (camera animation)
    const handleFocusOnRegion = (id: string) => {
        if (!viewerRef.current) return;
        const cameraState = viewerRef.current.getRegionCameraState(id);
        if (cameraState) {
            viewerRef.current.animateCameraTo(cameraState.position, cameraState.target);
        }
        setHighlightedRegionId(id);
    };

    return (
        <div className="model3d-preview-wrapper">
            <LeftSideMenu
                title={viewMode === "edit" ? "Defects" : "Defect Summary"}
                showModeToggle={true}
                mode={viewMode}
                onModeChange={setViewMode}
                settingsDropdown={
                    <SettingsDropdown
                        isOpen={showSettings}
                        onClose={() => setShowSettings(false)}
                        onReloadDictionary={handleReloadDictionary}
                        dictionaryLoading={dictionaryLoading}
                        dictionaryProgress={dictionaryProgress}
                        dictionaryEntryCount={dictionaryEntries.length}
                        dictionaryError={dictionaryError}
                        onDictionaryErrorClear={() => setDictionaryError(null)}
                        smoothCamera={smoothCameraMode}
                        onSmoothCameraChange={handleSmoothCameraModeChange}
                    />
                }
            >
                {viewMode === "view" && <DefectSummary regions={regions} />}
                {viewMode === "edit" && (
                    <div className="control-section">
                        <div className="control-row">
                            <div className="defect-label-row">
                                <label>Defect:</label>
                                <button
                                    className="settings-btn"
                                    onClick={() => setShowSettings(!showSettings)}
                                    title="Settings"
                                >
                                    ⚙
                                </button>
                            </div>
                            <DefectAutocomplete
                                entries={dictionaryEntries}
                                value={selectedDefect}
                                onChange={(entry) => {
                                    setSelectedDefect(entry);
                                    setNewLabelError(null);
                                }}
                                placeholder="Search defect..."
                                disabled={editingRegionId !== null}
                                error={!!newLabelError}
                            />
                            {newLabelError && <span className="error-text">{newLabelError}</span>}
                        </div>
                        <div className="control-row">
                            <TypeDropdown
                                value={shapeType}
                                onChange={handleShapeTypeChange}
                                disabled={editingRegionId !== null}
                            />
                        </div>
                        {shapeType !== "none" && (
                            <div className="control-row">
                                <label>Size: {shapeSizePercent}%</label>
                                <input
                                    type="range"
                                    min="1"
                                    max="300"
                                    value={shapeSizePercent}
                                    onChange={handleSizeChange}
                                    className="size-slider"
                                />
                            </div>
                        )}
                        <div className="control-row inline">
                            <label>Severity:</label>
                            <SeverityDropdown
                                value={severity}
                                onChange={handleSeverityChange}
                                disabled={editingRegionId !== null}
                            />
                        </div>
                        <div className="control-row inline">
                            <label>Decal:</label>
                            <DecalDropdown
                                value={decalTextureId}
                                onChange={setDecalTextureId}
                                disabled={editingRegionId !== null}
                            />
                        </div>
                        <div className="form-hint">
                            <span className="hint-icon">ⓘ</span>
                            <span>Click on the model to place a label.</span>
                        </div>
                        <div className="form-actions">
                            <button
                                className="action-btn export-btn"
                                onClick={handleExportRegions}
                                disabled={regions.length === 0 || editingRegionId !== null}
                            >
                                Export
                            </button>
                            <button
                                className="action-btn import-btn"
                                onClick={handleImportClick}
                                disabled={editingRegionId !== null}
                            >
                                Import
                            </button>
                        </div>
                    </div>
                )}
                <div className="control-section">
                    <div
                        className={`regions-header ${labelsExpanded ? "expanded" : "collapsed"}`}
                        onClick={() => setLabelsExpanded(!labelsExpanded)}
                        style={{ cursor: "pointer" }}
                    >
                        <h3>
                            Saved Labels ({regions.length})
                            <span className="collapse-chevron">{labelsExpanded ? "▼" : "▶"}</span>
                        </h3>
                    </div>
                    {importError && (
                        <div className="import-error">
                            <span>{importError}</span>
                            <button onClick={() => setImportError(null)}>×</button>
                        </div>
                    )}
                    {labelsExpanded && regions.length > 0 && (
                        <div className="regions-list">
                            {regions.map((region) => (
                                <div
                                    key={region.id}
                                    className={`region-item ${editingRegionId === region.id ? "editing" : ""} ${viewMode === "view" && viewingRegionId === region.id ? "viewing" : ""} ${hoveredRegionId === region.id ? "hovered" : ""} ${highlightedRegionId === region.id ? "highlighted" : ""}`}
                                    onClick={() => {
                                        if (viewMode === "edit") {
                                            if (editingRegionId === region.id) {
                                                handleCancelEdit(); // Close if open
                                            } else {
                                                handleEditRegion(region.id); // Open
                                            }
                                        } else {
                                            // View mode: toggle accordion
                                            setViewingRegionId(
                                                viewingRegionId === region.id ? null : region.id
                                            );
                                        }
                                        handleFocusOnRegion(region.id);
                                    }}
                                    onMouseEnter={() => setHoveredRegionId(region.id)}
                                    onMouseLeave={() => setHoveredRegionId(null)}
                                >
                                    {/* Label - always visible */}
                                    <div className="region-item-content">
                                        <input
                                            type="checkbox"
                                            className="region-visibility-checkbox"
                                            style={{
                                                accentColor: SEVERITY_COLORS[region.severity],
                                            }}
                                            checked={!hiddenRegionIds.has(region.id)}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                handleRegionVisibilityChange(
                                                    region.id,
                                                    !e.target.checked
                                                );
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            title="Toggle visibility"
                                        />
                                        <span className="region-item-label" title={region.label}>
                                            {region.label}
                                        </span>
                                        <span
                                            className="region-item-severity"
                                            style={{
                                                color: SEVERITY_COLORS[region.severity],
                                                opacity: 0.7,
                                            }}
                                        >
                                            ({region.severity})
                                        </span>
                                    </div>

                                    {/* View mode details - below label when viewing */}
                                    {viewMode === "view" && viewingRegionId === region.id && (
                                        <div className="region-view-details" onClick={(e) => e.stopPropagation()}>
                                            {region.notes && (
                                                <div className="view-notes">
                                                    <label>Notes:</label>
                                                    <p>{region.notes}</p>
                                                </div>
                                            )}
                                            {region.evidence && region.evidence.length > 0 && (
                                                <ReadOnlyEvidenceGallery
                                                    items={region.evidence}
                                                    imageUrls={evidenceUrls}
                                                />
                                            )}
                                            {!region.notes && (!region.evidence || region.evidence.length === 0) && (
                                                <p className="no-details">No notes or photos</p>
                                            )}
                                        </div>
                                    )}

                                    {/* Edit form - below label when editing */}
                                    {editingRegionId === region.id && editForm && (
                                        <div
                                            className="region-edit-form"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="edit-form-row">
                                                <label>Label:</label>
                                                <DefectAutocomplete
                                                    entries={dictionaryEntries}
                                                    value={editForm.defectData || null}
                                                    onChange={(entry) => {
                                                        if (!editForm) return;
                                                        setEditForm({
                                                            ...editForm,
                                                            defectData: entry || undefined,
                                                            label: entry?.defect || "",
                                                        });
                                                        setEditLabelError(null);
                                                    }}
                                                    placeholder="Search defect..."
                                                    error={!!editLabelError}
                                                />
                                                {editLabelError && (
                                                    <span className="error-text">
                                                        {editLabelError}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="edit-form-row">
                                                <TypeDropdown
                                                    value={editForm.type}
                                                    onChange={(type) =>
                                                        handleEditFormChange("type", type)
                                                    }
                                                />
                                            </div>
                                            {editForm.type !== "none" && (
                                                <div className="edit-form-row">
                                                    <label>Size: {editForm.size}%</label>
                                                    <input
                                                        type="range"
                                                        min="1"
                                                        max="300"
                                                        value={editForm.size}
                                                        onChange={(e) =>
                                                            handleEditFormChange(
                                                                "size",
                                                                parseInt(e.target.value, 10)
                                                            )
                                                        }
                                                        className="size-slider"
                                                    />
                                                </div>
                                            )}
                                            <div className="edit-form-row inline">
                                                <label>Severity:</label>
                                                <SeverityDropdown
                                                    value={editForm.severity}
                                                    onChange={(severity) =>
                                                        handleEditFormChange("severity", severity)
                                                    }
                                                />
                                            </div>
                                            <div className="edit-form-row inline">
                                                <label>Decal:</label>
                                                <DecalDropdown
                                                    value={editForm.decalTextureId}
                                                    onChange={(decalId) =>
                                                        setEditForm({ ...editForm, decalTextureId: decalId })
                                                    }
                                                />
                                            </div>
                                            <div className="edit-form-row">
                                                <label>Notes:</label>
                                                <textarea
                                                    className="notes-textarea"
                                                    value={editForm.notes || ""}
                                                    onChange={(e) =>
                                                        setEditForm({ ...editForm, notes: e.target.value })
                                                    }
                                                    placeholder="Add notes about this defect..."
                                                    rows={3}
                                                />
                                            </div>
                                            <div className="edit-form-row">
                                                <EvidenceGallery
                                                    items={editForm.evidence || []}
                                                    imageUrls={evidenceUrls}
                                                    onChange={(items, newImage) => {
                                                        setEditForm({ ...editForm, evidence: items });
                                                        if (newImage) {
                                                            setEvidenceUrls((prev) => {
                                                                const next = new Map(prev);
                                                                next.set(newImage.storageId, newImage.dataUrl);
                                                                return next;
                                                            });
                                                        }
                                                    }}
                                                    disabled={isMovingRegion}
                                                />
                                            </div>
                                            <div className="edit-form-actions">
                                                {!isMovingRegion ? (
                                                    <>
                                                        <button
                                                            className="edit-btn move-btn"
                                                            onClick={handleStartMove}
                                                        >
                                                            Move
                                                        </button>
                                                        <button
                                                            className="edit-btn cancel-btn"
                                                            onClick={handleCancelEdit}
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            className="edit-btn save-btn"
                                                            onClick={handleSaveEdit}
                                                        >
                                                            Save
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="move-hint">
                                                            Click on model to place
                                                        </span>
                                                        <button
                                                            className="edit-btn cancel-btn"
                                                            onClick={handleCancelMove}
                                                        >
                                                            Cancel Move
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </LeftSideMenu>
            <div
                className={`model3d-preview-container ${isDragging ? "dragging" : ""} ${hasModel ? "has-model" : ""}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
            >
                <canvas ref={canvasRef} className="model3d-canvas" />
                {/* Labels overlay */}
                <div className="labels-container">
                    {labelPositions.map((label) => (
                        <div
                            key={label.id}
                            className={`region-label ${label.visible ? "visible" : "hidden"} ${highlightedRegionId === label.id || hoveredRegionId === label.id ? "highlighted" : ""}`}
                            style={{
                                left: `${label.x}px`,
                                top: `${label.y}px`,
                                backgroundColor: label.color,
                            }}
                            onClick={() => handleFocusOnRegion(label.id)}
                            onMouseEnter={(e) => {
                                e.stopPropagation();
                                setHoveredRegionId(label.id);
                            }}
                            onMouseMove={(e) => e.stopPropagation()}
                            onMouseLeave={() => setHoveredRegionId(null)}
                        >
                            <span className="label-text">
                                <strong>{label.text}</strong>
                                <span className="label-severity"> ({label.severity})</span>
                            </span>
                            <div
                                className="label-pointer"
                                style={{ borderTopColor: label.color }}
                            />
                        </div>
                    ))}
                    {/* Preview label for new region */}
                    {viewMode === "edit" &&
                        previewLabelPosition &&
                        previewLabelPosition.visible &&
                        selectedDefect &&
                        !editingRegionId && (
                            <div
                                className="region-label preview-label visible"
                                style={{
                                    left: `${previewLabelPosition.x}px`,
                                    top: `${previewLabelPosition.y}px`,
                                    backgroundColor: SEVERITY_COLORS[severity],
                                }}
                            >
                                <span className="label-text">
                                    <strong>{selectedDefect.defect}</strong>
                                    <span className="label-severity"> ({severity})</span>
                                </span>
                                <div
                                    className="label-pointer"
                                    style={{ borderTopColor: SEVERITY_COLORS[severity] }}
                                />
                            </div>
                        )}
                    {/* Hint when hovering without label text */}
                    {viewMode === "edit" &&
                        previewLabelPosition &&
                        previewLabelPosition.visible &&
                        !selectedDefect &&
                        !editingRegionId && (
                            <div
                                className="region-label hint-label visible"
                                style={{
                                    left: `${previewLabelPosition.x}px`,
                                    top: `${previewLabelPosition.y}px`,
                                    backgroundColor: "#666",
                                }}
                            >
                                <span className="label-text">Enter label text in panel</span>
                                <div className="label-pointer" style={{ borderTopColor: "#666" }} />
                            </div>
                        )}
                </div>
                {/* Delete confirmation dialog */}
                {deleteConfirmId && (
                    <div className="delete-confirm-overlay">
                        <div className="delete-confirm-dialog">
                            <p>Are you sure you want to delete this region?</p>
                            <div className="delete-confirm-actions">
                                <button
                                    className="delete-confirm-btn delete-confirm-cancel"
                                    onClick={cancelDeleteRegion}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="delete-confirm-btn delete-confirm-delete"
                                    onClick={confirmDeleteRegion}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {error && (
                    <div className="model3d-error">
                        <span>{error}</span>
                        <button onClick={() => setError(null)}>×</button>
                    </div>
                )}
                {toast && (
                    <Toast
                        message={toast.message}
                        type={toast.type}
                        onClose={() => setToast(null)}
                    />
                )}
                {!hasModel && (
                    <div className="model3d-overlay">
                        <div className="model3d-instructions">
                            <p>Drag & drop GLB/GLTF model</p>
                            <label className="model3d-file-input-label">
                                or click to select file
                                <input
                                    type="file"
                                    accept=".glb,.gltf"
                                    onChange={handleFileInput}
                                    style={{ display: "none" }}
                                />
                            </label>
                        </div>
                    </div>
                )}
                {/* Hidden file input for import */}
                <input
                    ref={importInputRef}
                    type="file"
                    accept=".json,.zip"
                    onChange={handleImportFile}
                    style={{ display: "none" }}
                />
            </div>
        </div>
    );
}
