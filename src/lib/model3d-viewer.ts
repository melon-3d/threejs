import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import type { DefectEntry } from "./dictionary-parser";
import type { EvidenceItem } from "./image-storage";

export type ShapeType = "cube" | "sphere" | "none";

export type Severity = "high" | "medium" | "low";

export type DecalTextureId = "none" | "heavy" | "moderate" | "light";

export const SEVERITY_COLORS: Record<Severity, string> = {
    high: "#e53935",
    medium: "#ff9800",
    low: "#43a047",
};

export const DECAL_TEXTURES: Record<Exclude<DecalTextureId, "none">, string> = {
    heavy: "/decals/heavy.webp",
    moderate: "/decals/moderate.webp",
    light: "/decals/light.webp",
};

export const DECAL_OPTIONS: Array<{ value: DecalTextureId; label: string }> = [
    { value: "none", label: "No Decal" },
    { value: "heavy", label: "Heavy" },
    { value: "moderate", label: "Moderate" },
    { value: "light", label: "Light" },
];

export interface LabelPosition {
    id: string;
    text: string;
    x: number;
    y: number;
    visible: boolean;
    color: string; // hex color for CSS
    severity: Severity;
}

export interface RaycastResult {
    point: THREE.Vector3;
    normal: THREE.Vector3;
    object: THREE.Object3D;
}

interface SavedHighlightRegion {
    id: string;
    position: THREE.Vector3;
    size: number;
    type: ShapeType;
    severity: Severity;
    label: string;
    defectData?: DefectEntry;
    cameraPosition?: THREE.Vector3;
    cameraTarget?: THREE.Vector3;
    normal?: THREE.Vector3;
    decalTextureId?: DecalTextureId;
    decalMesh?: THREE.Mesh;
    notes?: string;
    evidence?: EvidenceItem[];
}

export interface ExportedRegion {
    id: string;
    label: string;
    severity: Severity;
    type: ShapeType;
    size: number;
    position: { x: number; y: number; z: number };
    defectData?: DefectEntry;
    cameraPosition?: { x: number; y: number; z: number };
    cameraTarget?: { x: number; y: number; z: number };
    normal?: { x: number; y: number; z: number };
    decalTextureId?: DecalTextureId;
    notes?: string;
    evidence?: EvidenceItem[];
}

export interface RegionsExportData {
    version: number;
    exportedAt: string;
    regions: ExportedRegion[];
}

const MAX_REGIONS = 100;

function generateId(): string {
    return crypto.randomUUID();
}

function severityToThreeColor(severity: Severity): THREE.Color {
    return new THREE.Color(SEVERITY_COLORS[severity]);
}

interface RegionUniforms {
    // Dynamic highlight (cursor position)
    uDynamicPosition: { value: THREE.Vector3 };
    uDynamicSize: { value: number };
    uDynamicVisible: { value: boolean };
    uDynamicType: { value: number };
    uDynamicColor: { value: THREE.Color };
    // Saved regions
    uRegionPositions: { value: THREE.Vector3[] };
    uRegionSizes: { value: number[] };
    uRegionTypes: { value: number[] };
    uRegionColors: { value: THREE.Color[] };
    uRegionCount: { value: number };
    // Highlighted region for glow effect (selected/clicked)
    uHighlightedRegionIndex: { value: number };
    // Hovered region for hover effect
    uHoveredRegionIndex: { value: number };
}

/**
 * Plain TypeScript class for 3D model viewing with Three.js
 * No React dependencies - can be used independently
 */
export class Model3DViewer {
    private canvasEl: HTMLCanvasElement;
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private controls: OrbitControls | null = null;
    private currentModel: THREE.Group | null = null;
    private animationFrameId: number | null = null;
    private isInitialized = false;
    private isDisposed = false;

    // Loaders
    private ktx2Loader: KTX2Loader | null = null;
    private gltfLoader: GLTFLoader | null = null;

    // Environment map
    private environmentUrl: string | null = null;
    private loadedEnvMapTexture: THREE.Texture | null = null;
    private pmremGenerator: THREE.PMREMGenerator | null = null;
    private stubEnvRenderTarget: THREE.WebGLRenderTarget | null = null;

    // Raycaster for mouse interaction
    private raycaster: THREE.Raycaster = new THREE.Raycaster();

    // Pre-allocated vectors for visibility calculations (avoid GC pressure)
    private readonly _tempProjection: THREE.Vector3 = new THREE.Vector3();

    // Shape for highlighting
    private highlightShape: THREE.Mesh | null = null;
    private shapeType: ShapeType = "cube";
    private shapeVisible = false;

    // Scene sizing
    private sceneBaseSize = 1;
    private shapeBaseSize = 0.05; // 5% of scene size
    private shapeSizePercent = 100; // Current size as percentage (1-300)

    // Saved highlight regions (for shader)
    private savedRegions: SavedHighlightRegion[] = [];
    private hiddenRegionIds: Set<string> = new Set();
    private regionUniforms: RegionUniforms | null = null;
    private showRegionsDefault = true;
    private highlightedRegionId: string | null = null;
    private hoveredRegionId: string | null = null;

    // Current highlight color from UI
    private highlightColor: THREE.Color = new THREE.Color(1.0, 0.5, 0.0); // Orange default
    private currentSeverity: Severity = "medium";

    // Decal texture cache
    private decalTextureCache: Map<string, THREE.Texture> = new Map();
    private textureLoader: THREE.TextureLoader = new THREE.TextureLoader();

    // Animation frame callback for external updates (e.g., label positions)
    private animationCallback: (() => void) | null = null;

    // Occlusion query optimization - cached uniform locations
    private occlusionVpLoc: WebGLUniformLocation | null = null;
    private occlusionPosLoc: WebGLUniformLocation | null = null;
    private readonly _occlusionVpMatrix: THREE.Matrix4 = new THREE.Matrix4();

    // Camera movement tracking
    private isCameraMoving = false;
    private cameraStopTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly CAMERA_STOP_DELAY = 150;

    // Smooth camera mode
    private smoothCameraMode = false;

    // Throttle for real-time mode
    private occlusionFrameCounter = 0;
    private readonly OCCLUSION_THROTTLE_FRAMES = 3;

    // Flag to track when label positions need recalculation
    private needsLabelUpdate = true;

    private cachedVisibility: Map<number, boolean> = new Map();

    // Cached label positions for change detection
    private cachedLabelPositions: LabelPosition[] = [];

    // GPU Occlusion Query for visibility
    private gl: WebGL2RenderingContext | null = null;
    private occlusionQueries: Map<number, WebGLQuery> = new Map();
    private occlusionResults: Map<number, boolean> = new Map();
    private occlusionProgram: WebGLProgram | null = null;
    private occlusionVAO: WebGLVertexArrayObject | null = null;
    private occlusionPositionBuffer: WebGLBuffer | null = null;

    // Dimensions
    public dims: { width: number; height: number };

    constructor(
        canvas: HTMLCanvasElement,
        initialWidth?: number,
        initialHeight?: number,
        environmentUrl?: string
    ) {
        this.canvasEl = canvas;
        this.environmentUrl = environmentUrl || null;

        // Initialize dimensions
        const container = canvas.parentElement;
        const containerWidth = container ? container.clientWidth : 0;
        const containerHeight = container ? container.clientHeight : 0;

        this.dims = {
            width: Math.max(initialWidth || containerWidth || canvas.clientWidth || 500, 300),
            height: Math.max(initialHeight || containerHeight || canvas.clientHeight || 500, 300),
        };

        this.setupRenderer();
        this.initOcclusionQuery();
        this.initLoaders();
        // Initialize scene asynchronously (using IIFE to handle async)
        (async () => {
            await this.initScene();
        })();
    }

    /**
     * Setup WebGL renderer
     */
    private setupRenderer(): void {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvasEl,
            antialias: true,
            alpha: true,
        });
        this.renderer.setSize(this.dims.width, this.dims.height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    }

    /**
     * Initialize WebGL 2 occlusion query resources
     */
    private initOcclusionQuery(): void {
        const context = this.renderer.getContext();
        // Robust WebGL2 detection - check for WebGL2-specific method
        if (!context || typeof (context as WebGL2RenderingContext).createQuery !== "function") {
            console.warn("WebGL 2 not available, occlusion queries disabled");
            return;
        }
        this.gl = context as WebGL2RenderingContext;

        // Vertex shader - transforms world position to clip space
        const vsSource = `#version 300 es
            uniform mat4 uViewProjection;
            uniform vec3 uWorldPosition;
            void main() {
                gl_Position = uViewProjection * vec4(uWorldPosition, 1.0);
                gl_PointSize = 1.0;
            }
        `;

        // Fragment shader - just outputs a pixel
        const fsSource = `#version 300 es
            precision lowp float;
            out vec4 fragColor;
            void main() {
                fragColor = vec4(1.0);
            }
        `;

        // Compile shaders
        const vs = this.gl.createShader(this.gl.VERTEX_SHADER)!;
        this.gl.shaderSource(vs, vsSource);
        this.gl.compileShader(vs);

        const fs = this.gl.createShader(this.gl.FRAGMENT_SHADER)!;
        this.gl.shaderSource(fs, fsSource);
        this.gl.compileShader(fs);

        // Check compilation status
        const vsCompiled = this.gl.getShaderParameter(vs, this.gl.COMPILE_STATUS);
        const fsCompiled = this.gl.getShaderParameter(fs, this.gl.COMPILE_STATUS);

        if (!vsCompiled) {
            console.error("Vertex shader compilation failed:", this.gl.getShaderInfoLog(vs));
            this.gl.deleteShader(vs);
            this.gl.deleteShader(fs);
            return;
        }

        if (!fsCompiled) {
            console.error("Fragment shader compilation failed:", this.gl.getShaderInfoLog(fs));
            this.gl.deleteShader(vs);
            this.gl.deleteShader(fs);
            return;
        }

        // Link program
        this.occlusionProgram = this.gl.createProgram()!;
        this.gl.attachShader(this.occlusionProgram, vs);
        this.gl.attachShader(this.occlusionProgram, fs);
        this.gl.linkProgram(this.occlusionProgram);

        // Check link status
        const linked = this.gl.getProgramParameter(this.occlusionProgram, this.gl.LINK_STATUS);
        if (!linked) {
            console.error(
                "Program linking failed:",
                this.gl.getProgramInfoLog(this.occlusionProgram)
            );
            this.gl.deleteProgram(this.occlusionProgram);
            this.occlusionProgram = null;
            this.gl.deleteShader(vs);
            this.gl.deleteShader(fs);
            return;
        }

        // Cleanup shaders (attached to program, no longer needed)
        this.gl.deleteShader(vs);
        this.gl.deleteShader(fs);

        // Create VAO and position buffer
        this.occlusionVAO = this.gl.createVertexArray();
        this.occlusionPositionBuffer = this.gl.createBuffer();

        // Set up minimal vertex buffer (single dummy vertex - position comes from uniform)
        this.gl.bindVertexArray(this.occlusionVAO);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.occlusionPositionBuffer);
        // Upload a single dummy vertex (we use uniform for actual position)
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([0, 0, 0]), this.gl.STATIC_DRAW);
        this.gl.bindVertexArray(null);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);

        // Cache uniform locations for performance
        this.occlusionVpLoc = this.gl.getUniformLocation(this.occlusionProgram, "uViewProjection");
        this.occlusionPosLoc = this.gl.getUniformLocation(this.occlusionProgram, "uWorldPosition");
    }

    /**
     * Run occlusion queries for all saved regions
     * Called after main scene render, before label position update
     */
    private runOcclusionQueries(): void {
        if (!this.gl || !this.occlusionProgram || !this.camera || this.savedRegions.length === 0) {
            return;
        }

        // Optimization: Skip occlusion queries based on mode and camera state
        if (this.smoothCameraMode) {
            // Smooth mode: Skip entirely during camera movement
            if (this.isCameraMoving) {
                return;
            }
        } else {
            // Real-time mode: Throttle queries during movement, skip when stationary
            if (!this.isCameraMoving) {
                // Camera not moving - no need to re-check visibility
                return;
            }
            // Throttle: only run every N frames during movement
            this.occlusionFrameCounter++;
            if (this.occlusionFrameCounter < this.OCCLUSION_THROTTLE_FRAMES) {
                return;
            }
            this.occlusionFrameCounter = 0;
        }

        const gl = this.gl;

        // Get view-projection matrix from camera
        const viewMatrix = this.camera.matrixWorldInverse;
        const projMatrix = this.camera.projectionMatrix;
        this._occlusionVpMatrix.multiplyMatrices(projMatrix, viewMatrix);

        // Use occlusion program
        gl.useProgram(this.occlusionProgram);
        gl.bindVertexArray(this.occlusionVAO);

        // Set view-projection matrix uniform (using cached location)
        gl.uniformMatrix4fv(this.occlusionVpLoc, false, this._occlusionVpMatrix.elements);

        // Ensure depth test is enabled and configured
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);

        // Disable color write (we only care about depth test)
        gl.colorMask(false, false, false, false);
        gl.depthMask(false);

        // Run query for each region
        for (let i = 0; i < this.savedRegions.length; i++) {
            const region = this.savedRegions[i];

            // Check if query was already running from previous frame
            const queryWasRunning = this.occlusionQueries.has(i);

            // Create query if not exists
            if (!queryWasRunning) {
                const query = gl.createQuery();
                if (query) {
                    this.occlusionQueries.set(i, query);
                } else {
                    console.error(`runOcclusionQueries: Failed to create query for region ${i}`);
                }
            }

            const query = this.occlusionQueries.get(i);
            if (!query) {
                continue;
            }

            // If query was running from previous frame, check if result is available before restarting
            const hasResult = this.occlusionResults.has(i);

            if (queryWasRunning) {
                const resultAvailable = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
                if (!resultAvailable) {
                    // Query still pending, skip this region (use cached visibility or default)
                    continue;
                }
                // Result available - read it
                const passed = gl.getQueryParameter(query, gl.QUERY_RESULT);
                const newVisible = passed > 0;

                if (hasResult) {
                    // Compare with previous result
                    const oldVisible = this.occlusionResults.get(i);
                    if (oldVisible !== newVisible) {
                        this.needsLabelUpdate = true;
                    }
                } else {
                    // First result for this query
                    this.needsLabelUpdate = true;
                }
                this.occlusionResults.set(i, newVisible);
            }

            // Set world position uniform (using cached location)
            gl.uniform3f(
                this.occlusionPosLoc,
                region.position.x,
                region.position.y,
                region.position.z
            );

            // Begin query and draw point
            gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, query);
            gl.drawArrays(gl.POINTS, 0, 1);
            gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
        }

        // Restore state
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.bindVertexArray(null);
        gl.useProgram(null);

        // Reset Three.js state tracking so it knows GL state has changed
        this.renderer.resetState();
    }

    /**
     * Collect results from occlusion queries (async - results from previous frame)
     * Sets needsLabelUpdate if any visibility changed
     */
    private collectOcclusionResults(): void {
        // Results are now collected inline in runOcclusionQueries
        // This method kept for potential future diagnostics
    }

    /**
     * Initialize KTX2Loader and GLTFLoader with KTX2 and MeshoptDecoder support
     */
    private initLoaders(): void {
        if (!this.renderer) {
            console.warn("Renderer not available for loader initialization");
            return;
        }

        // Initialize KTX2Loader
        this.ktx2Loader = new KTX2Loader();
        // Set transcoder path (using CDN from Angular version)
        this.ktx2Loader.setTranscoderPath(
            "https://cdn.jsdelivr.net/npm/three@0.153.0/examples/jsm/libs/basis/"
        );
        this.ktx2Loader.detectSupport(this.renderer);

        // Initialize GLTFLoader with KTX2 and MeshoptDecoder support
        this.gltfLoader = new GLTFLoader();
        this.gltfLoader.setKTX2Loader(this.ktx2Loader);
        this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    }

    /**
     * Ensure loaders are initialized (safety check)
     */
    private ensureLoaders(): void {
        if (!this.ktx2Loader || !this.gltfLoader) {
            this.initLoaders();
        }
    }

    /**
     * Initialize basic scene with lighting and environment map
     */
    private async initScene(): Promise<void> {
        this.scene = new THREE.Scene();

        if (this.environmentUrl) {
            const success = await this.loadEnvironment();
            if (success) {
                this.setupEnvironmentMap();
            } else {
                console.warn("Failed to load environment map, using stub");
                this.setupStubEnvironmentMap();
            }
        } else {
            this.setupStubEnvironmentMap();
        }

        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            50,
            this.dims.width / this.dims.height,
            0.1,
            2000
        );

        this.isInitialized = true;
        this.startAnimation();
    }

    /**
     * Load environment map from EXR file
     */
    private async loadEnvironment(): Promise<boolean> {
        if (!this.environmentUrl) {
            return false;
        }

        const exrLoader = new EXRLoader();
        exrLoader.setCrossOrigin("anonymous");

        try {
            const envMapTexture = await exrLoader.loadAsync(this.environmentUrl);
            this.loadedEnvMapTexture = envMapTexture;
            return true;
        } catch (error) {
            console.error("Error loading environment:", error);
            this.loadedEnvMapTexture = null;
            return false;
        }
    }

    /**
     * Create stub environment map via PMREMGenerator.fromScene (solid color)
     */
    private setupStubEnvironmentMap(): void {
        if (!this.renderer || !this.scene) return;

        if (this.pmremGenerator) {
            this.pmremGenerator.dispose();
            this.pmremGenerator = null;
        }

        const stubScene = new THREE.Scene();
        stubScene.background = new THREE.Color(1.5, 1.5, 1.5);

        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.stubEnvRenderTarget = this.pmremGenerator.fromScene(stubScene, 0, 0.1, 100, {
            size: 256,
        });
        this.scene.environment = this.stubEnvRenderTarget.texture;
        this.scene.background = null;
    }

    /**
     * Setup environment map using PMREMGenerator
     */
    private setupEnvironmentMap(): void {
        if (!this.renderer) {
            console.error("Renderer not available for PMREMGenerator");
            return;
        }
        if (!this.loadedEnvMapTexture) {
            console.error("Environment map texture not loaded for PMREMGenerator");
            return;
        }
        if (!this.scene) {
            console.error("Scene not available for environment map setup");
            return;
        }

        // Dispose previous PMREMGenerator if exists
        if (this.pmremGenerator) {
            this.pmremGenerator.dispose();
        }

        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.pmremGenerator.compileEquirectangularShader();

        const envMap = this.pmremGenerator.fromEquirectangular(this.loadedEnvMapTexture).texture;
        this.scene.environment = envMap;
        this.scene.background = null; // Transparent background
    }

    /**
     * Setup OrbitControls for camera manipulation
     */
    private setupControls(): void {
        if (!this.camera || !this.renderer) return;

        if (this.controls) {
            this.controls.dispose();
        }

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.rotateSpeed = 1.0;
        this.controls.zoomSpeed = 1.2;
        this.controls.panSpeed = 0.8;
        this.controls.minDistance = 0.5;
        this.controls.maxDistance = 100;
        this.controls.maxPolarAngle = Math.PI;

        // Mark labels for update when camera changes
        this.controls.addEventListener("change", () => {
            this.needsLabelUpdate = true;
            this.isCameraMoving = true;

            if (this.cameraStopTimeout) {
                clearTimeout(this.cameraStopTimeout);
            }

            this.cameraStopTimeout = setTimeout(() => {
                this.isCameraMoving = false;
                this.cameraStopTimeout = null;
                if (this.smoothCameraMode) {
                    this.needsLabelUpdate = true;
                }
            }, this.CAMERA_STOP_DELAY);
        });

        // Set initial target
        if (this.currentModel) {
            const box = new THREE.Box3().setFromObject(this.currentModel);
            const center = box.getCenter(new THREE.Vector3());
            this.controls.target.copy(center);
            this.controls.update();
        }
    }

    /**
     * Load GLB/GLTF model and replace current model
     */
    public async loadModel(url: string): Promise<void> {
        this.ensureLoaders();

        if (!this.gltfLoader) {
            throw new Error("GLTFLoader not initialized");
        }

        this.gltfLoader.setCrossOrigin("anonymous");

        try {
            const gltf: GLTF = await this.gltfLoader.loadAsync(url);
            const modelGroup = gltf.scene;

            // Remove previous model
            if (this.currentModel) {
                this.scene.remove(this.currentModel);
                this.disposeModel(this.currentModel);
            }

            // Clear label caches
            this.cachedVisibility.clear();
            this.cachedLabelPositions = [];
            this.needsLabelUpdate = true;

            // Clear occlusion query state
            if (this.gl) {
                for (const query of this.occlusionQueries.values()) {
                    this.gl.deleteQuery(query);
                }
                this.occlusionQueries.clear();
                this.occlusionResults.clear();
            }

            // Add new model to scene
            this.scene.add(modelGroup);
            this.currentModel = modelGroup;

            // Setup camera and controls
            this.setupCameraForModel(modelGroup);
            this.setupControls();

            // Calculate scene size and create highlight shape
            this.calculateSceneSize(modelGroup);
            this.createHighlightShape();

            // Setup region shader on model materials
            this.createRegionUniforms();
            this.applyRegionShaderToModel();

            // Recreate decals for any existing regions (e.g., imported before model load)
            await this.recreateAllDecalMeshes();

            this.renderFrame();
        } catch (error) {
            console.error("Error loading model:", error);
            throw error;
        }
    }

    /**
     * Load model from File object
     */
    public async loadModelFromFile(file: File): Promise<void> {
        this.ensureLoaders();

        if (!this.gltfLoader) {
            throw new Error("GLTFLoader not initialized");
        }

        try {
            // Load file as ArrayBuffer for better compatibility with KTX2 and MeshoptDecoder
            const data = await file.arrayBuffer();
            const gltf: GLTF = await this.gltfLoader.parseAsync(data, "");

            const modelGroup = gltf.scene;

            // Remove previous model
            if (this.currentModel) {
                this.scene.remove(this.currentModel);
                this.disposeModel(this.currentModel);
            }

            // Clear label caches
            this.cachedVisibility.clear();
            this.cachedLabelPositions = [];
            this.needsLabelUpdate = true;

            // Clear occlusion query state
            if (this.gl) {
                for (const query of this.occlusionQueries.values()) {
                    this.gl.deleteQuery(query);
                }
                this.occlusionQueries.clear();
                this.occlusionResults.clear();
            }

            // Add new model to scene
            this.scene.add(modelGroup);
            this.currentModel = modelGroup;

            // Setup camera and controls
            this.setupCameraForModel(modelGroup);
            this.setupControls();

            // Calculate scene size and create highlight shape
            this.calculateSceneSize(modelGroup);
            this.createHighlightShape();

            // Setup region shader on model materials
            this.createRegionUniforms();
            this.applyRegionShaderToModel();

            // Recreate decals for any existing regions (e.g., imported before model load)
            await this.recreateAllDecalMeshes();

            this.renderFrame();
        } catch (error) {
            console.error("Error loading model from file:", error);
            throw error;
        }
    }

    /**
     * Setup camera position based on model bounds
     */
    private setupCameraForModel(modelGroup: THREE.Group): void {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();

        // Use actual dimensions from this.dims (updated by onResize) instead of clientHeight
        // This ensures we use the correct size even when container size changes (e.g., menu appears)
        const canvasHeight = this.dims.height > 0 ? this.dims.height : this.canvasEl.clientHeight;
        const marginFactor = canvasHeight > 0 ? (canvasHeight - 40) / canvasHeight : 0.9;
        const distance = (size * 1.5) / marginFactor;

        this.camera.position.copy(center);
        this.camera.position.x += distance * 0.5;
        this.camera.position.y += distance * 0.25;
        this.camera.position.z += distance;
        this.camera.lookAt(center);
        this.camera.updateProjectionMatrix();
    }

    /**
     * Calculate and store the base size of the scene from the model
     */
    private calculateSceneSize(modelGroup: THREE.Group): void {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const size = box.getSize(new THREE.Vector3());

        // Use the largest dimension as the base size
        this.sceneBaseSize = Math.max(size.x, size.y, size.z);

        // Base shape size is 5% of scene size
        this.shapeBaseSize = this.sceneBaseSize * 0.05;

        // Update shape if it exists
        this.updateShapeSize();
    }

    /**
     * Get the current shape size based on base size and percentage
     */
    private getCurrentShapeSize(): number {
        return this.shapeBaseSize * (this.shapeSizePercent / 100);
    }

    /**
     * Create or update the highlight shape
     */
    private createHighlightShape(): void {
        // Remove existing shape if any
        if (this.highlightShape) {
            this.scene.remove(this.highlightShape);
            this.highlightShape.geometry.dispose();
            if (this.highlightShape.material instanceof THREE.Material) {
                this.highlightShape.material.dispose();
            }
        }

        const currentSize = this.getCurrentShapeSize();
        let geometry: THREE.BufferGeometry;

        if (this.shapeType === "cube") {
            geometry = new THREE.BoxGeometry(currentSize, currentSize, currentSize);
        } else {
            geometry = new THREE.SphereGeometry(currentSize / 2, 32, 32);
        }

        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.3,
            wireframe: false,
            depthTest: true,
            depthWrite: false,
        });

        this.highlightShape = new THREE.Mesh(geometry, material);
        this.highlightShape.visible = false;
        this.scene.add(this.highlightShape);
    }

    /**
     * Update the shape size (recreates geometry)
     */
    private updateShapeSize(): void {
        if (!this.highlightShape) return;

        const currentSize = this.getCurrentShapeSize();

        // Dispose old geometry
        this.highlightShape.geometry.dispose();

        // Create new geometry with updated size
        if (this.shapeType === "cube") {
            this.highlightShape.geometry = new THREE.BoxGeometry(
                currentSize,
                currentSize,
                currentSize
            );
        } else {
            this.highlightShape.geometry = new THREE.SphereGeometry(currentSize / 2, 32, 32);
        }
    }

    /**
     * Perform raycasting from normalized device coordinates
     * @param normalizedX - X coordinate (-1 to 1)
     * @param normalizedY - Y coordinate (-1 to 1)
     * @returns The intersection result with point, normal, and object or null if no intersection
     */
    public raycastFromMouse(normalizedX: number, normalizedY: number): RaycastResult | null {
        if (!this.currentModel || !this.camera) return null;

        this.raycaster.setFromCamera(new THREE.Vector2(normalizedX, normalizedY), this.camera);

        const intersects = this.raycaster.intersectObject(this.currentModel, true);

        if (intersects.length > 0) {
            const intersection = intersects[0];
            // Transform face normal from object space to world space
            const normal = intersection.face
                ? intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld)
                : new THREE.Vector3(0, 1, 0);
            return {
                point: intersection.point.clone(),
                normal: normal.normalize(),
                object: intersection.object,
            };
        }

        return null;
    }

    /**
     * Update shape position based on raycast result
     * @param point - The point to move the shape to, or null to hide
     */
    public updateShapePosition(point: THREE.Vector3 | null): void {
        if (!this.highlightShape) return;

        if (point) {
            this.highlightShape.position.copy(point);
            this.highlightShape.visible = true;
            this.shapeVisible = true;
        } else {
            this.highlightShape.visible = false;
            this.shapeVisible = false;
        }

        // Update dynamic shader uniforms
        this.updateDynamicUniforms();
    }

    /**
     * Set the shape size as a percentage (1-300)
     */
    public setShapeSizePercent(percent: number): void {
        this.shapeSizePercent = Math.max(1, Math.min(300, percent));
        this.updateShapeSize();
        this.updateDynamicUniforms();
    }

    /**
     * Get the current shape size percentage
     */
    public getShapeSizePercent(): number {
        return this.shapeSizePercent;
    }

    /**
     * Set the shape type (cube or sphere)
     */
    public setShapeType(type: ShapeType): void {
        if (this.shapeType === type) return;

        this.shapeType = type;
        this.createHighlightShape();
        this.updateDynamicUniforms();
    }

    /**
     * Get the current shape type
     */
    public getShapeType(): ShapeType {
        return this.shapeType;
    }

    /**
     * Set the highlight color for new regions
     * @param color - Hex color string (e.g., '#ff5500') or THREE.Color
     */
    public setHighlightColor(color: string | THREE.Color): void {
        if (typeof color === "string") {
            this.highlightColor = new THREE.Color(color);
        } else {
            this.highlightColor = color.clone();
        }
        this.updateDynamicUniforms();
    }

    /**
     * Set the severity level for new regions
     */
    public setSeverity(severity: Severity): void {
        this.currentSeverity = severity;
        // Update highlight color to match severity
        this.highlightColor = severityToThreeColor(severity);
        this.updateDynamicUniforms();
    }

    /**
     * Get the current severity level
     */
    public getSeverity(): Severity {
        return this.currentSeverity;
    }

    /**
     * Enable or disable smooth camera mode.
     * When enabled, occlusion checks are deferred until camera stops moving.
     * This provides smoother camera movement at the cost of delayed visibility updates.
     */
    public setSmoothCameraMode(enabled: boolean): void {
        this.smoothCameraMode = enabled;
        this.occlusionFrameCounter = 0;
        if (enabled && !this.isCameraMoving) {
            // Trigger immediate check when enabling smooth mode while camera is stationary
            this.needsLabelUpdate = true;
        }
    }

    /**
     * Save current shape position as a highlight region
     * @param label - Required label text for the region
     * @param defectData - Optional full dictionary entry data
     * @param cameraPosition - Optional camera position at creation time
     * @param cameraTarget - Optional camera target at creation time
     * @param normal - Optional surface normal for decal projection
     * @param decalTextureId - Optional decal texture ID
     * @param targetObject - Optional target object for decal projection
     * @returns The saved region ID, or null if save failed
     */
    public async saveCurrentRegion(
        label: string,
        defectData?: DefectEntry,
        cameraPosition?: THREE.Vector3,
        cameraTarget?: THREE.Vector3,
        normal?: THREE.Vector3,
        decalTextureId?: DecalTextureId,
        targetObject?: THREE.Object3D
    ): Promise<string | null> {
        if (!this.highlightShape || !this.shapeVisible) {
            return null;
        }

        if (!label || label.trim() === "") {
            return null;
        }

        const region: SavedHighlightRegion = {
            id: generateId(),
            position: this.highlightShape.position.clone(),
            size: this.getCurrentShapeSize(),
            type: this.shapeType,
            severity: this.currentSeverity,
            label: label.trim(),
            defectData,
            cameraPosition: cameraPosition?.clone(),
            cameraTarget: cameraTarget?.clone(),
            normal: normal?.clone(),
            decalTextureId,
        };

        // Create decal if texture selected
        if (decalTextureId && decalTextureId !== "none" && normal && targetObject) {
            const decalMesh = await this.createDecalMesh(
                region.position,
                normal,
                region.size,
                decalTextureId,
                targetObject
            );
            if (decalMesh) {
                region.decalMesh = decalMesh;
                this.scene.add(decalMesh);
            }
        }

        this.savedRegions.push(region);
        this.updateRegionUniforms();
        this.invalidateLabelPositions();
        return region.id;
    }

    /**
     * Get the number of saved highlight regions
     */
    public getSavedRegionsCount(): number {
        return this.savedRegions.length;
    }

    /**
     * Get all saved regions as plain objects (for UI display)
     */
    public getRegions(): Array<{
        id: string;
        label: string;
        severity: Severity;
        type: ShapeType;
        size: number;
        defectData?: DefectEntry;
        decalTextureId?: DecalTextureId;
        notes?: string;
        evidence?: EvidenceItem[];
    }> {
        return this.savedRegions.map((r) => ({
            id: r.id,
            label: r.label,
            severity: r.severity,
            type: r.type,
            size: r.size,
            defectData: r.defectData,
            decalTextureId: r.decalTextureId,
            notes: r.notes,
            evidence: r.evidence,
        }));
    }

    /**
     * Export all regions as JSON-serializable data
     */
    public exportRegions(): RegionsExportData {
        return {
            version: 1,
            exportedAt: new Date().toISOString(),
            regions: this.savedRegions.map((r) => {
                const exported: ExportedRegion = {
                    id: r.id,
                    label: r.label,
                    severity: r.severity,
                    type: r.type,
                    size: r.size,
                    position: {
                        x: r.position.x,
                        y: r.position.y,
                        z: r.position.z,
                    },
                };

                // Include optional fields if present
                if (r.defectData) {
                    exported.defectData = r.defectData;
                }
                if (r.cameraPosition) {
                    exported.cameraPosition = {
                        x: r.cameraPosition.x,
                        y: r.cameraPosition.y,
                        z: r.cameraPosition.z,
                    };
                }
                if (r.cameraTarget) {
                    exported.cameraTarget = {
                        x: r.cameraTarget.x,
                        y: r.cameraTarget.y,
                        z: r.cameraTarget.z,
                    };
                }
                if (r.normal) {
                    exported.normal = {
                        x: r.normal.x,
                        y: r.normal.y,
                        z: r.normal.z,
                    };
                }
                if (r.decalTextureId) {
                    exported.decalTextureId = r.decalTextureId;
                }
                if (r.notes !== undefined) {
                    exported.notes = r.notes;
                }
                if (r.evidence !== undefined) {
                    exported.evidence = r.evidence;
                }

                return exported;
            }),
        };
    }

    /**
     * Import regions from JSON data
     * @param data - The exported regions data
     * @param replace - If true, replaces all existing regions. If false, adds to existing.
     * @returns Number of regions imported, or throws error if invalid
     */
    public async importRegions(data: RegionsExportData, replace: boolean = true): Promise<number> {
        // Validate version
        if (data.version !== 1) {
            throw new Error(`Unsupported export version: ${data.version}`);
        }

        // Validate regions array
        if (!Array.isArray(data.regions)) {
            throw new Error("Invalid data: regions must be an array");
        }

        // Validate each region
        const validSeverities: Severity[] = ["high", "medium", "low"];
        const validTypes: ShapeType[] = ["cube", "sphere", "none"];

        for (const region of data.regions) {
            if (!region.label || typeof region.label !== "string") {
                throw new Error("Invalid region: label is required");
            }
            if (!validSeverities.includes(region.severity)) {
                throw new Error(`Invalid region severity: ${region.severity}`);
            }
            if (!validTypes.includes(region.type)) {
                throw new Error(`Invalid region type: ${region.type}`);
            }
            if (typeof region.size !== "number" || region.size <= 0) {
                throw new Error("Invalid region: size must be a positive number");
            }
            if (
                !region.position ||
                typeof region.position.x !== "number" ||
                typeof region.position.y !== "number" ||
                typeof region.position.z !== "number"
            ) {
                throw new Error("Invalid region: position must have x, y, z coordinates");
            }
        }

        // Clear existing regions if replace mode
        if (replace) {
            this.savedRegions = [];
            if (this.gl) {
                for (const query of this.occlusionQueries.values()) {
                    this.gl.deleteQuery(query);
                }
                this.occlusionQueries.clear();
                this.occlusionResults.clear();
            }
        }

        // Import regions
        for (const region of data.regions) {
            const newRegion: SavedHighlightRegion = {
                id: generateId(), // Generate new ID to avoid conflicts
                label: region.label,
                severity: region.severity,
                type: region.type,
                size: region.size,
                position: new THREE.Vector3(
                    region.position.x,
                    region.position.y,
                    region.position.z
                ),
            };

            // Include optional fields if present
            if (region.defectData) {
                newRegion.defectData = region.defectData;
            }
            if (region.cameraPosition) {
                newRegion.cameraPosition = new THREE.Vector3(
                    region.cameraPosition.x,
                    region.cameraPosition.y,
                    region.cameraPosition.z
                );
            }
            if (region.cameraTarget) {
                newRegion.cameraTarget = new THREE.Vector3(
                    region.cameraTarget.x,
                    region.cameraTarget.y,
                    region.cameraTarget.z
                );
            }
            if (region.normal) {
                newRegion.normal = new THREE.Vector3(
                    region.normal.x,
                    region.normal.y,
                    region.normal.z
                );
            }
            if (region.decalTextureId) {
                newRegion.decalTextureId = region.decalTextureId;
            }
            if (region.notes !== undefined) {
                newRegion.notes = region.notes;
            }
            if (region.evidence !== undefined) {
                newRegion.evidence = region.evidence;
            }

            this.savedRegions.push(newRegion);
        }

        // Recreate decals for imported regions
        for (const region of this.savedRegions) {
            if (region.decalTextureId && region.decalTextureId !== "none" && region.normal) {
                await this.updateDecalMesh(region);
            }
        }

        this.updateRegionUniforms();
        this.invalidateLabelPositions();

        return data.regions.length;
    }

    /**
     * Update an existing region's properties
     * @returns true if region was found and updated
     */
    public async updateRegion(
        id: string,
        updates: Partial<{
            label: string;
            severity: Severity;
            type: ShapeType;
            size: number;
            defectData?: DefectEntry;
            cameraPosition?: THREE.Vector3;
            cameraTarget?: THREE.Vector3;
            decalTextureId?: DecalTextureId;
            notes?: string;
            evidence?: EvidenceItem[];
        }>
    ): Promise<boolean> {
        const index = this.savedRegions.findIndex((r) => r.id === id);
        if (index === -1) return false;

        const region = this.savedRegions[index];

        if (updates.label !== undefined) {
            region.label = updates.label;
        }
        if (updates.severity !== undefined) {
            region.severity = updates.severity;
        }
        if (updates.type !== undefined) {
            region.type = updates.type;
        }
        if (updates.size !== undefined) {
            region.size = updates.size;
            // Update decal if region has one
            if (region.decalMesh || (region.decalTextureId && region.decalTextureId !== "none")) {
                await this.updateDecalMesh(region);
            }
        }
        if (updates.decalTextureId !== undefined) {
            region.decalTextureId = updates.decalTextureId;
            // Update decal mesh when texture changes
            await this.updateDecalMesh(region);
        }
        if (updates.defectData !== undefined) {
            region.defectData = updates.defectData;
        }
        if (updates.cameraPosition !== undefined) {
            region.cameraPosition = updates.cameraPosition?.clone();
        }
        if (updates.cameraTarget !== undefined) {
            region.cameraTarget = updates.cameraTarget?.clone();
        }
        if (updates.notes !== undefined) {
            region.notes = updates.notes;
        }
        if (updates.evidence !== undefined) {
            region.evidence = updates.evidence;
        }

        this.updateRegionUniforms();
        this.invalidateLabelPositions();
        return true;
    }

    /**
     * Update an existing region's position
     * @returns true if region was found and updated
     */
    public updateRegionPosition(id: string, position: THREE.Vector3): boolean {
        const index = this.savedRegions.findIndex((r) => r.id === id);
        if (index === -1) return false;

        this.savedRegions[index].position.copy(position);
        this.updateRegionUniforms();
        this.invalidateLabelPositions();
        return true;
    }

    /**
     * Delete a region by ID
     * @returns true if region was found and deleted
     */
    public deleteRegion(id: string): boolean {
        const index = this.savedRegions.findIndex((r) => r.id === id);
        if (index === -1) return false;

        const region = this.savedRegions[index];

        // Dispose decal if exists
        if (region.decalMesh) {
            this.scene.remove(region.decalMesh);
            region.decalMesh.geometry.dispose();
            if (region.decalMesh.material instanceof THREE.Material) {
                region.decalMesh.material.dispose();
            }
        }

        this.savedRegions.splice(index, 1);

        // Clear and rebuild occlusion queries
        if (this.gl) {
            for (const query of this.occlusionQueries.values()) {
                this.gl.deleteQuery(query);
            }
            this.occlusionQueries.clear();
            this.occlusionResults.clear();
        }

        this.updateRegionUniforms();
        this.invalidateLabelPositions();
        return true;
    }

    /**
     * Set visibility of a region (for temporarily hiding during move/edit)
     */
    public setRegionVisible(id: string, visible: boolean): void {
        if (visible) {
            this.hiddenRegionIds.delete(id);
        } else {
            this.hiddenRegionIds.add(id);
        }

        // Toggle decal visibility
        const region = this.savedRegions.find((r) => r.id === id);
        if (region?.decalMesh) {
            region.decalMesh.visible = visible;
        }

        this.updateRegionUniforms();
        this.invalidateLabelPositions();
    }

    /**
     * Set a region as hidden for visibility toggle purposes
     */
    public setRegionHidden(id: string, hidden: boolean): void {
        if (hidden) {
            this.hiddenRegionIds.add(id);
        } else {
            this.hiddenRegionIds.delete(id);
        }

        // Toggle decal visibility
        const region = this.savedRegions.find((r) => r.id === id);
        if (region?.decalMesh) {
            region.decalMesh.visible = !hidden;
        }

        this.updateRegionUniforms();
        this.invalidateLabelPositions();
    }

    /**
     * Set whether regions are shown by default or only on hover/select
     */
    public setShowRegionsDefault(show: boolean): void {
        this.showRegionsDefault = show;
        this.updateRegionUniforms();
    }

    /**
     * Set the currently highlighted region (for selection/click effects)
     */
    public setHighlightedRegion(id: string | null): void {
        this.highlightedRegionId = id;
        this.updateRegionUniforms();
    }

    /**
     * Set the currently hovered region (for hover effects)
     */
    public setHoveredRegion(id: string | null): void {
        this.hoveredRegionId = id;
        this.updateRegionUniforms();
    }

    /**
     * Get a region's position by ID
     * @returns Vector3 position or null if not found
     */
    public getRegionPosition(id: string): THREE.Vector3 | null {
        const region = this.savedRegions.find((r) => r.id === id);
        return region ? region.position.clone() : null;
    }

    /**
     * Find the region ID that contains the given point
     * @param point - The 3D point to check
     * @returns Region ID if point is inside a region, null otherwise
     */
    public findRegionAtPoint(point: THREE.Vector3): string | null {
        for (const region of this.savedRegions) {
            if (this.hiddenRegionIds.has(region.id)) continue;
            if (region.type === "none") continue;

            const diff = point.clone().sub(region.position);
            const halfSize = region.size * 0.5;

            if (region.type === "cube") {
                if (
                    Math.abs(diff.x) < halfSize &&
                    Math.abs(diff.y) < halfSize &&
                    Math.abs(diff.z) < halfSize
                ) {
                    return region.id;
                }
            } else {
                // sphere
                if (diff.length() < halfSize) {
                    return region.id;
                }
            }
        }
        return null;
    }

    /**
     * Get current camera state (position and target)
     * @returns Camera state or null if camera/controls not initialized
     */
    public getCameraState(): { position: THREE.Vector3; target: THREE.Vector3 } | null {
        if (!this.camera || !this.controls) {
            return null;
        }

        return {
            position: this.camera.position.clone(),
            target: this.controls.target.clone(),
        };
    }

    /**
     * Animate camera to a new position and target
     * @param position - Target camera position
     * @param target - Target look-at point
     * @param duration - Animation duration in milliseconds (default 500)
     */
    public animateCameraTo(
        position: THREE.Vector3,
        target: THREE.Vector3,
        duration: number = 500
    ): void {
        if (!this.camera || !this.controls) return;

        const startPos = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        const startTime = performance.now();

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            // Ease-in-out quadratic
            const easeT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

            this.camera.position.lerpVectors(startPos, position, easeT);
            this.controls!.target.lerpVectors(startTarget, target, easeT);
            this.controls!.update();
            this.needsLabelUpdate = true;

            if (t < 1) {
                requestAnimationFrame(animate);
            }
        };
        animate();
    }

    /**
     * Get saved camera state for a region
     * @param id - Region ID
     * @returns Camera position and target or null if not found/saved
     */
    public getRegionCameraState(
        id: string
    ): { position: THREE.Vector3; target: THREE.Vector3 } | null {
        const region = this.savedRegions.find((r) => r.id === id);
        if (!region || !region.cameraPosition || !region.cameraTarget) return null;
        return {
            position: region.cameraPosition.clone(),
            target: region.cameraTarget.clone(),
        };
    }

    /**
     * Get screen position for dynamic (preview) label
     * Returns position and visibility for the current shape being placed
     */
    public getDynamicLabelPosition(): { x: number; y: number; visible: boolean } | null {
        if (!this.highlightShape || !this.shapeVisible) {
            return null;
        }

        const screenPos = this.project3DToScreen(this.highlightShape.position);
        if (!screenPos) {
            return null;
        }

        return {
            x: screenPos.x,
            y: screenPos.y,
            visible: true,
        };
    }

    /**
     * Set callback to be called on each animation frame
     * Used for updating label positions in React
     */
    public setAnimationCallback(callback: (() => void) | null): void {
        this.animationCallback = callback;
    }

    /**
     * Get the calculated scene base size
     */
    public getSceneBaseSize(): number {
        return this.sceneBaseSize;
    }

    /**
     * Get the current absolute shape size
     */
    public getCurrentAbsoluteShapeSize(): number {
        return this.getCurrentShapeSize();
    }

    /**
     * Get the base shape size (5% of scene size)
     */
    public getShapeBaseSize(): number {
        return this.shapeBaseSize;
    }

    /**
     * Load and cache a decal texture
     */
    private async loadDecalTexture(textureId: DecalTextureId): Promise<THREE.Texture | null> {
        if (textureId === "none") return null;

        const path = DECAL_TEXTURES[textureId];
        if (!path) return null;

        // Check cache first
        if (this.decalTextureCache.has(path)) {
            return this.decalTextureCache.get(path)!;
        }

        // Load texture
        return new Promise((resolve) => {
            this.textureLoader.load(
                path,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    this.decalTextureCache.set(path, texture);
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error("Failed to load decal texture:", error);
                    resolve(null);
                }
            );
        });
    }

    /**
     * Create a decal mesh at the specified position
     */
    private async createDecalMesh(
        position: THREE.Vector3,
        normal: THREE.Vector3,
        size: number,
        textureId: DecalTextureId,
        targetObject: THREE.Object3D
    ): Promise<THREE.Mesh | null> {
        if (textureId === "none") return null;

        const texture = await this.loadDecalTexture(textureId);
        if (!texture) return null;

        // Find the mesh to project onto
        let targetMesh: THREE.Mesh | null = null;
        if (targetObject instanceof THREE.Mesh) {
            targetMesh = targetObject;
        } else {
            // Try to find a mesh in the object hierarchy
            targetObject.traverse((child) => {
                if (!targetMesh && child instanceof THREE.Mesh) {
                    targetMesh = child;
                }
            });
        }

        if (!targetMesh) {
            console.warn("No mesh found for decal projection");
            return null;
        }

        // Calculate orientation from normal
        const orientation = new THREE.Euler();
        const quaternion = new THREE.Quaternion();

        // Create rotation that aligns Z-axis with the inverted normal
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().negate());
        orientation.setFromQuaternion(quaternion);

        // Decal size - use region size, with depth for curved surfaces
        const decalSize = new THREE.Vector3(size, size, size * 0.6);

        try {
            const decalGeometry = new DecalGeometry(targetMesh, position, orientation, decalSize);

            const decalMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthTest: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -4,
            });

            const decalMesh = new THREE.Mesh(decalGeometry, decalMaterial);
            return decalMesh;
        } catch (error) {
            console.error("Failed to create decal geometry:", error);
            return null;
        }
    }

    /**
     * Find the mesh at a given world position for decal projection
     * Uses raycasting from camera through the position to find the target mesh
     */
    private findMeshAtPosition(position: THREE.Vector3): THREE.Mesh | null {
        if (!this.currentModel || !this.camera) return null;

        // Create ray from camera through position
        const direction = position.clone().sub(this.camera.position).normalize();
        this.raycaster.set(this.camera.position, direction);

        const intersects = this.raycaster.intersectObject(this.currentModel, true);

        for (const intersection of intersects) {
            if (intersection.object instanceof THREE.Mesh) {
                return intersection.object;
            }
        }

        return null;
    }

    /**
     * Update or recreate decal mesh for a region
     * Removes old decal and creates new one if texture and normal are available
     */
    private async updateDecalMesh(region: SavedHighlightRegion): Promise<void> {
        // Remove old decal if exists
        if (region.decalMesh) {
            this.scene.remove(region.decalMesh);
            region.decalMesh.geometry.dispose();
            if (region.decalMesh.material instanceof THREE.Material) {
                region.decalMesh.material.dispose();
            }
            region.decalMesh = undefined;
        }

        // Create new decal if texture and normal are available
        if (region.decalTextureId && region.decalTextureId !== "none" && region.normal) {
            const targetMesh = this.findMeshAtPosition(region.position);
            if (targetMesh) {
                const decalMesh = await this.createDecalMesh(
                    region.position,
                    region.normal,
                    region.size,
                    region.decalTextureId,
                    targetMesh
                );
                if (decalMesh) {
                    region.decalMesh = decalMesh;
                    this.scene.add(decalMesh);
                }
            }
        }
    }

    /**
     * Recreate decal meshes for all regions that have decal data but no mesh
     * Used when model is loaded after regions are imported
     */
    private async recreateAllDecalMeshes(): Promise<void> {
        for (const region of this.savedRegions) {
            if (region.decalTextureId && region.decalTextureId !== "none" && region.normal && !region.decalMesh) {
                await this.updateDecalMesh(region);
            }
        }
    }

    /**
     * Create shared region uniforms for shader injection
     */
    private createRegionUniforms(): void {
        // Initialize arrays with MAX_REGIONS capacity
        const positions: THREE.Vector3[] = [];
        const sizes: number[] = [];
        const types: number[] = [];
        const colors: THREE.Color[] = [];

        for (let i = 0; i < MAX_REGIONS; i++) {
            positions.push(new THREE.Vector3(0, 0, 0));
            sizes.push(0);
            types.push(0);
            colors.push(new THREE.Color(0, 0, 0));
        }

        this.regionUniforms = {
            // Dynamic highlight (cursor position)
            uDynamicPosition: { value: new THREE.Vector3(0, 0, 0) },
            uDynamicSize: { value: this.getCurrentShapeSize() },
            uDynamicVisible: { value: false },
            uDynamicType: { value: this.shapeType === "cube" ? 0 : 1 },
            uDynamicColor: { value: new THREE.Color(1.0, 0.5, 0.0) }, // Orange highlight
            // Saved regions
            uRegionPositions: { value: positions },
            uRegionSizes: { value: sizes },
            uRegionTypes: { value: types },
            uRegionColors: { value: colors },
            uRegionCount: { value: 0 },
            // Highlighted region for glow effect (-1 = none)
            uHighlightedRegionIndex: { value: -1 },
            // Hovered region for hover effect (-1 = none)
            uHoveredRegionIndex: { value: -1 },
        };
    }

    /**
     * GLSL code to check if a point is inside any saved region
     */
    private getRegionShaderChunk(): string {
        return `
        uniform vec3 uDynamicPosition;
        uniform float uDynamicSize;
        uniform bool uDynamicVisible;
        uniform int uDynamicType;
        uniform vec3 uDynamicColor;
        uniform vec3 uRegionPositions[${MAX_REGIONS}];
        uniform float uRegionSizes[${MAX_REGIONS}];
        uniform int uRegionTypes[${MAX_REGIONS}];
        uniform vec3 uRegionColors[${MAX_REGIONS}];
        uniform int uRegionCount;
        uniform int uHighlightedRegionIndex;
        uniform int uHoveredRegionIndex;

        bool isInsideDynamic(vec3 worldPos) {
            if (!uDynamicVisible) return false;
            // Type 2 = none, skip highlighting
            if (uDynamicType == 2) return false;

            vec3 diff = worldPos - uDynamicPosition;
            float halfSize = uDynamicSize * 0.5;

            if (uDynamicType == 0) {
                // Cube check
                return abs(diff.x) < halfSize && abs(diff.y) < halfSize && abs(diff.z) < halfSize;
            } else {
                // Sphere check
                return length(diff) < halfSize;
            }
        }

        bool isInsideRegion(vec3 worldPos, int idx, out vec3 regionColor, out bool isHighlighted, out bool isHovered) {
            // Type 2 = none, skip highlighting
            if (uRegionTypes[idx] == 2) {
                return false;
            }

            vec3 diff = worldPos - uRegionPositions[idx];
            float halfSize = uRegionSizes[idx] * 0.5;
            regionColor = uRegionColors[idx];
            isHighlighted = (idx == uHighlightedRegionIndex);
            isHovered = (idx == uHoveredRegionIndex);

            if (uRegionTypes[idx] == 0) {
                // Cube check
                return abs(diff.x) < halfSize && abs(diff.y) < halfSize && abs(diff.z) < halfSize;
            } else {
                // Sphere check
                return length(diff) < halfSize;
            }
        }
    `;
    }

    /**
     * Apply region shader modification to a material
     */
    private applyRegionShaderToMaterial(material: THREE.Material): void {
        if (!this.regionUniforms) return;

        const uniforms = this.regionUniforms;
        const shaderChunk = this.getRegionShaderChunk();

        material.onBeforeCompile = (shader) => {
            // Add uniforms - dynamic first
            shader.uniforms.uDynamicPosition = uniforms.uDynamicPosition;
            shader.uniforms.uDynamicSize = uniforms.uDynamicSize;
            shader.uniforms.uDynamicVisible = uniforms.uDynamicVisible;
            shader.uniforms.uDynamicType = uniforms.uDynamicType;
            shader.uniforms.uDynamicColor = uniforms.uDynamicColor;
            // Then saved regions
            shader.uniforms.uRegionPositions = uniforms.uRegionPositions;
            shader.uniforms.uRegionSizes = uniforms.uRegionSizes;
            shader.uniforms.uRegionTypes = uniforms.uRegionTypes;
            shader.uniforms.uRegionColors = uniforms.uRegionColors;
            shader.uniforms.uRegionCount = uniforms.uRegionCount;
            shader.uniforms.uHighlightedRegionIndex = uniforms.uHighlightedRegionIndex;
            shader.uniforms.uHoveredRegionIndex = uniforms.uHoveredRegionIndex;

            // Inject uniform declarations and helper function
            shader.fragmentShader = shaderChunk + shader.fragmentShader;

            // Inject highlight logic before final output - check dynamic first, then loop saved regions
            // Highlighted regions (selected) get strongest glow effect (0.6 mix + emissive)
            // Hovered regions get medium glow effect (0.5 mix)
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <dithering_fragment>",
                `
                #include <dithering_fragment>
                if (isInsideDynamic(vWorldPosition)) {
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, uDynamicColor, 0.4);
                }
                for (int i = 0; i < ${MAX_REGIONS}; i++) {
                    if (i >= uRegionCount) break;
                    vec3 regionColor;
                    bool isHighlighted;
                    bool isHovered;
                    if (isInsideRegion(vWorldPosition, i, regionColor, isHighlighted, isHovered)) {
                        float mixFactor = 0.25;
                        if (isHighlighted) {
                            mixFactor = 0.6;
                            // Add emissive-like glow for highlighted (selected) region
                            gl_FragColor.rgb += regionColor * 0.3;
                        } else if (isHovered) {
                            mixFactor = 0.5;
                        }
                        gl_FragColor.rgb = mix(gl_FragColor.rgb, regionColor, mixFactor);
                    }
                }
                `
            );

            // Ensure world position is available in fragment shader
            shader.vertexShader = shader.vertexShader.replace(
                "#include <worldpos_vertex>",
                `
                #include <worldpos_vertex>
                vWorldPosition = worldPosition.xyz;
                `
            );

            // Declare varying for world position
            shader.vertexShader = "varying vec3 vWorldPosition;\n" + shader.vertexShader;
            shader.fragmentShader = "varying vec3 vWorldPosition;\n" + shader.fragmentShader;
        };

        // Mark material for recompilation
        material.needsUpdate = true;
    }

    /**
     * Apply region shader to all materials in the model
     */
    private applyRegionShaderToModel(): void {
        if (!this.currentModel || !this.regionUniforms) return;

        this.currentModel.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                const materials = Array.isArray(object.material)
                    ? object.material
                    : [object.material];

                materials.forEach((material) => {
                    if (material instanceof THREE.Material) {
                        this.applyRegionShaderToMaterial(material);
                    }
                });
            }
        });
    }

    /**
     * Update region uniforms with saved regions data
     */
    private updateRegionUniforms(): void {
        if (!this.regionUniforms) return;

        let visibleIndex = 0;
        let highlightedIndex = -1;
        let hoveredIndex = -1;

        for (let i = 0; i < this.savedRegions.length && visibleIndex < MAX_REGIONS; i++) {
            const region = this.savedRegions[i];

            // Check if region should be visible:
            // - If explicitly hidden by checkbox, skip
            // - If showRegionsDefault is false, only show highlighted or hovered region
            if (this.hiddenRegionIds.has(region.id)) continue;
            if (
                !this.showRegionsDefault &&
                region.id !== this.highlightedRegionId &&
                region.id !== this.hoveredRegionId
            )
                continue;

            // Track which visible index corresponds to highlighted and hovered regions
            if (region.id === this.highlightedRegionId) {
                highlightedIndex = visibleIndex;
            }
            if (region.id === this.hoveredRegionId) {
                hoveredIndex = visibleIndex;
            }

            this.regionUniforms.uRegionPositions.value[visibleIndex].copy(region.position);
            this.regionUniforms.uRegionSizes.value[visibleIndex] = region.size;
            // Type mapping: cube=0, sphere=1, none=2
            const typeValue = region.type === "cube" ? 0 : region.type === "sphere" ? 1 : 2;
            this.regionUniforms.uRegionTypes.value[visibleIndex] = typeValue;
            // Color from severity
            this.regionUniforms.uRegionColors.value[visibleIndex].copy(
                severityToThreeColor(region.severity)
            );
            visibleIndex++;
        }

        this.regionUniforms.uRegionCount.value = visibleIndex;
        this.regionUniforms.uHighlightedRegionIndex.value = highlightedIndex;
        this.regionUniforms.uHoveredRegionIndex.value = hoveredIndex;
    }

    /**
     * Update dynamic uniforms with current shape state (cursor position)
     */
    private updateDynamicUniforms(): void {
        if (!this.regionUniforms) return;

        this.regionUniforms.uDynamicVisible.value = this.shapeVisible;
        this.regionUniforms.uDynamicSize.value = this.getCurrentShapeSize();
        // Type mapping: cube=0, sphere=1, none=2
        const typeValue = this.shapeType === "cube" ? 0 : this.shapeType === "sphere" ? 1 : 2;
        this.regionUniforms.uDynamicType.value = typeValue;
        this.regionUniforms.uDynamicColor.value.copy(this.highlightColor);

        if (this.highlightShape) {
            this.regionUniforms.uDynamicPosition.value.copy(this.highlightShape.position);
        }
    }

    /**
     * Project a 3D world point to 2D screen coordinates
     * @returns {x, y} in pixels or null if point is outside viewport/behind camera
     */
    private project3DToScreen(worldPoint: THREE.Vector3): { x: number; y: number } | null {
        if (!this.camera) return null;

        // Use pre-allocated vector to avoid GC pressure
        this._tempProjection.copy(worldPoint);
        this._tempProjection.project(this.camera);

        // Check if point is behind camera or outside normalized viewport
        if (
            this._tempProjection.z > 1 ||
            this._tempProjection.x < -1 ||
            this._tempProjection.x > 1 ||
            this._tempProjection.y < -1 ||
            this._tempProjection.y > 1
        ) {
            return null;
        }

        // Convert to pixel coordinates
        const x = ((this._tempProjection.x + 1) / 2) * this.dims.width;
        const y = ((-this._tempProjection.y + 1) / 2) * this.dims.height;

        return { x, y };
    }

    /**
     * Check if a 3D point is visible using GPU occlusion query results
     * @param regionIndex - Index of the region in savedRegions
     */
    private checkPointVisibility(regionIndex: number): boolean {
        // Use GPU occlusion result if available
        if (this.occlusionResults.has(regionIndex)) {
            return this.occlusionResults.get(regionIndex)!;
        }
        // Default to visible if no result yet (first frame)
        return true;
    }

    /**
     * Get current screen positions for all saved region labels.
     * Returns null if no update is needed (camera hasn't changed).
     * Uses throttled visibility checks to reduce raycasting overhead.
     */
    public getLabelPositions(): LabelPosition[] | null {
        // Skip if no update needed
        if (
            !this.needsLabelUpdate &&
            this.savedRegions.length === this.cachedLabelPositions.length
        ) {
            return null;
        }

        const positions: LabelPosition[] = [];
        let hasChanges = false;

        for (let i = 0; i < this.savedRegions.length; i++) {
            const region = this.savedRegions[i];

            // Skip hidden regions (filtered by checkbox)
            if (this.hiddenRegionIds.has(region.id)) {
                continue;
            }

            const screenPos = this.project3DToScreen(region.position);

            // Use GPU occlusion query result for visibility
            const isVisible = screenPos !== null && this.checkPointVisibility(i);

            const newPos: LabelPosition = {
                id: region.id,
                text: region.label,
                x: screenPos?.x ?? 0,
                y: screenPos?.y ?? 0,
                visible: isVisible,
                color: SEVERITY_COLORS[region.severity],
                severity: region.severity,
            };

            // Check if this position changed from cached (find by id)
            const cached = this.cachedLabelPositions.find((p) => p.id === region.id);
            if (
                !cached ||
                cached.x !== newPos.x ||
                cached.y !== newPos.y ||
                cached.visible !== newPos.visible ||
                cached.text !== newPos.text ||
                cached.color !== newPos.color ||
                cached.severity !== newPos.severity
            ) {
                hasChanges = true;
            }

            positions.push(newPos);
        }

        // Reset flag after processing
        this.needsLabelUpdate = false;

        // Only return new positions if something changed
        if (hasChanges || positions.length !== this.cachedLabelPositions.length) {
            this.cachedLabelPositions = positions;
            return positions;
        }

        return null;
    }

    /**
     * Force label positions to be recalculated on next frame.
     * Call this after adding/removing regions.
     */
    public invalidateLabelPositions(): void {
        this.needsLabelUpdate = true;
        this.cachedVisibility.clear();
    }

    /**
     * Handle window resize
     */
    public onResize(): void {
        if (!this.isInitialized || !this.renderer) return;

        const container = this.canvasEl.parentElement;
        if (!container) return;

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        if (containerWidth > 0 && containerHeight > 0) {
            this.dims.width = containerWidth;
            this.dims.height = containerHeight;

            this.canvasEl.width = this.dims.width;
            this.canvasEl.height = this.dims.height;

            this.camera.aspect = this.dims.width / this.dims.height;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(this.dims.width, this.dims.height);
            this.renderFrame();
        }
    }

    /**
     * Render a single frame
     */
    public renderFrame(): void {
        if (!this.renderer || !this.scene || !this.camera) return;
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Start animation loop
     */
    private startAnimation(): void {
        // Prevent starting animation on disposed viewer (race with async initScene)
        if (this.isDisposed) {
            return;
        }
        const animate = () => {
            // Stop animation loop if viewer was disposed
            if (this.isDisposed) {
                return;
            }
            if (!this.isInitialized) {
                this.animationFrameId = requestAnimationFrame(animate);
                return;
            }

            // Update controls
            if (this.controls) {
                this.controls.update();
            }

            // Render
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }

            // Run occlusion queries after main render (uses depth buffer)
            this.runOcclusionQueries();
            // Collect results from previous frame's queries
            this.collectOcclusionResults();

            // Call external callback (for label updates)
            if (this.animationCallback) {
                this.animationCallback();
            }

            this.animationFrameId = requestAnimationFrame(animate);
        };

        animate();
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.isDisposed = true;
        // Stop animation
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Clear camera stop timeout
        if (this.cameraStopTimeout) {
            clearTimeout(this.cameraStopTimeout);
            this.cameraStopTimeout = null;
        }

        // Dispose controls
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }

        // Dispose model
        if (this.currentModel) {
            this.disposeModel(this.currentModel);
            this.scene.remove(this.currentModel);
            this.currentModel = null;
        }

        // Dispose highlight shape
        if (this.highlightShape) {
            this.scene.remove(this.highlightShape);
            this.highlightShape.geometry.dispose();
            if (this.highlightShape.material instanceof THREE.Material) {
                this.highlightShape.material.dispose();
            }
            this.highlightShape = null;
        }

        // Clear region uniforms and saved regions (including decals)
        for (const region of this.savedRegions) {
            if (region.decalMesh) {
                this.scene.remove(region.decalMesh);
                region.decalMesh.geometry.dispose();
                if (region.decalMesh.material instanceof THREE.Material) {
                    region.decalMesh.material.dispose();
                }
            }
        }
        this.regionUniforms = null;
        this.savedRegions = [];
        this.hiddenRegionIds.clear();
        this.cachedVisibility.clear();
        this.cachedLabelPositions = [];

        // Dispose decal texture cache
        for (const texture of this.decalTextureCache.values()) {
            texture.dispose();
        }
        this.decalTextureCache.clear();

        // Dispose occlusion query resources
        if (this.gl) {
            for (const query of this.occlusionQueries.values()) {
                this.gl.deleteQuery(query);
            }
            this.occlusionQueries.clear();
            this.occlusionResults.clear();

            if (this.occlusionProgram) {
                this.gl.deleteProgram(this.occlusionProgram);
                this.occlusionProgram = null;
            }
            if (this.occlusionVAO) {
                this.gl.deleteVertexArray(this.occlusionVAO);
                this.occlusionVAO = null;
            }
            if (this.occlusionPositionBuffer) {
                this.gl.deleteBuffer(this.occlusionPositionBuffer);
                this.occlusionPositionBuffer = null;
            }
        }

        // Dispose scene
        if (this.scene) {
            this.scene.traverse((object) => {
                if (object instanceof THREE.Mesh) {
                    object.geometry?.dispose();
                    const materials = Array.isArray(object.material)
                        ? object.material
                        : [object.material];
                    materials.forEach((material) => material?.dispose());
                }
            });
            if (this.stubEnvRenderTarget) {
                if (this.scene.environment === this.stubEnvRenderTarget.texture) {
                    this.scene.environment = null;
                }
                this.stubEnvRenderTarget.dispose();
                this.stubEnvRenderTarget = null;
            }
            if (this.scene.environment && this.scene.environment instanceof THREE.Texture) {
                this.scene.environment.dispose();
            }
            if (this.scene.background) {
                if (this.scene.background instanceof THREE.Texture) {
                    this.scene.background.dispose();
                }
            }
            this.scene.clear();
        }

        // Dispose environment map resources
        if (this.loadedEnvMapTexture) {
            this.loadedEnvMapTexture.dispose();
            this.loadedEnvMapTexture = null;
        }

        if (this.pmremGenerator) {
            this.pmremGenerator.dispose();
            this.pmremGenerator = null;
        }

        // Clear loaders (they don't need explicit disposal, but reset references)
        this.ktx2Loader = null;
        this.gltfLoader = null;

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
        }

        this.isInitialized = false;
    }

    /**
     * Dispose model resources
     */
    private disposeModel(model: THREE.Group): void {
        model.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                object.geometry?.dispose();
                const materials = Array.isArray(object.material)
                    ? object.material
                    : [object.material];
                materials.forEach((material) => {
                    if (material.map) material.map.dispose();
                    material.dispose();
                });
            }
        });
    }
}
