// Types
export interface EvidenceItem {
    id: string;
    storageId: string;
    name: string;
    mimeType: string;
    addedAt: string;
}

export interface UploadProgress {
    progress: number; // 0-100
    status: "processing" | "uploading" | "done" | "error";
}

export type UploadProgressCallback = (progress: UploadProgress) => void;

export interface UploadResult {
    id: string;
    storageId: string;
    dataUrl: string;
    name: string;
    mimeType: string;
}

// IndexedDB constants
const DB_NAME = "defects3d_evidence";
const DB_VERSION = 1;
const STORE_NAME = "images";

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
    });
}

// WebP support detection
let webpSupported: boolean | null = null;

async function checkWebPSupport(): Promise<boolean> {
    if (webpSupported !== null) return webpSupported;

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;

    webpSupported = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    return webpSupported;
}

// Image processing constants
const MAX_SIZE = 512;
const QUALITY = 0.85;

async function processImage(file: File): Promise<{ blob: Blob; mimeType: string }> {
    // Load image
    const bitmap = await createImageBitmap(file);

    // Calculate new dimensions (fit in 512x512)
    let width = bitmap.width;
    let height = bitmap.height;

    if (width > MAX_SIZE || height > MAX_SIZE) {
        if (width > height) {
            height = Math.round((height / width) * MAX_SIZE);
            width = MAX_SIZE;
        } else {
            width = Math.round((width / height) * MAX_SIZE);
            height = MAX_SIZE;
        }
    }

    // Create canvas and draw with white background (removes alpha)
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    bitmap.close();

    // Convert to WebP or JPEG
    const useWebP = await checkWebPSupport();
    const mimeType = useWebP ? "image/webp" : "image/jpeg";

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve({ blob, mimeType });
                } else {
                    reject(new Error("Failed to create blob"));
                }
            },
            mimeType,
            QUALITY
        );
    });
}

// Upload simulation
const UPLOAD_DURATION = 2000; // 2 seconds
const PROGRESS_INTERVAL = 50; // Update every 50ms

function simulateUpload(onProgress: UploadProgressCallback): Promise<void> {
    return new Promise((resolve) => {
        const steps = UPLOAD_DURATION / PROGRESS_INTERVAL;
        let currentStep = 0;

        const interval = setInterval(() => {
            currentStep++;
            const progress = Math.min(Math.round((currentStep / steps) * 100), 100);

            onProgress({
                progress,
                status: progress < 100 ? "uploading" : "done",
            });

            if (currentStep >= steps) {
                clearInterval(interval);
                resolve();
            }
        }, PROGRESS_INTERVAL);
    });
}

// IndexedDB operations
async function saveToIndexedDB(id: string, blob: Blob): Promise<void> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        const request = store.put({ id, blob });

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();

        transaction.oncomplete = () => db.close();
    });
}

async function loadFromIndexedDB(id: string): Promise<Blob | null> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);

        const request = store.get(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const result = request.result;
            resolve(result ? result.blob : null);
        };

        transaction.oncomplete = () => db.close();
    });
}

// Blob to data URL converter
function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// Public API
export async function uploadImage(
    file: File,
    onProgress?: UploadProgressCallback
): Promise<UploadResult> {
    const id = crypto.randomUUID();
    const storageId = crypto.randomUUID();

    // Report processing start
    onProgress?.({ progress: 0, status: "processing" });

    // Process image (resize, remove alpha, convert format)
    const { blob, mimeType } = await processImage(file);

    // Simulate upload with progress
    await simulateUpload(onProgress ?? (() => {}));

    // Save to IndexedDB
    await saveToIndexedDB(storageId, blob);

    // Convert to data URL for immediate display
    const dataUrl = await blobToDataUrl(blob);

    return {
        id,
        storageId,
        dataUrl,
        name: file.name,
        mimeType,
    };
}

export async function getImageById(storageId: string): Promise<string | null> {
    const blob = await loadFromIndexedDB(storageId);
    if (!blob) return null;
    return blobToDataUrl(blob);
}

export async function deleteImage(storageId: string): Promise<void> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        const request = store.delete(storageId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();

        transaction.oncomplete = () => db.close();
    });
}

export async function imageExists(storageId: string): Promise<boolean> {
    const blob = await loadFromIndexedDB(storageId);
    return blob !== null;
}

export async function getImageBlob(storageId: string): Promise<Blob | null> {
    return loadFromIndexedDB(storageId);
}

export async function saveImageBlob(storageId: string, blob: Blob): Promise<void> {
    await saveToIndexedDB(storageId, blob);
}
