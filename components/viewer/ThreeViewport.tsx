"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { NAMED_VIEW_DEFS, type NamedView } from "@/lib/faceViews";

export type DisplayMode = "Rendered" | "Ghosted";
export type PieceName = "foam" | "void";

// See the ghostedMaterial comment below for why these two differ.
const GHOSTED_CONTEXT_OPACITY = 0.12; // foam — the mass you're seeing past
const GHOSTED_SUBJECT_OPACITY = 0.34; // void — the thing you're trying to see

interface Props {
  glbUrl: string;
  glbNodeNames: string[];
  displayMode: DisplayMode;
  namedView: NamedView;
  visibility: Record<PieceName, boolean>;
  colors: Record<PieceName, string>;
  onReady?: (info: { pieces: PieceName[] }) => void;
  onError?: (message: string) => void;
}

interface PieceRig {
  mesh: THREE.Mesh;
  renderedMaterial: THREE.MeshStandardMaterial;
  // Ghosted uses its own fully unlit material rather than just lowering the
  // rendered material's opacity: at grazing angles through curved, doubled
  // geometry, many stacked lit+transparent layers each contribute a bright
  // Fresnel/specular highlight, and alpha-compositing those over each other
  // washes the whole piece toward pale white. An unlit material can't do
  // that — its color is the same flat value from every angle.
  ghostedMaterial: THREE.MeshBasicMaterial;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  perspCamera: THREE.PerspectiveCamera;
  orthoCamera: THREE.OrthographicCamera;
  activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  composer: EffectComposer | null;
  renderPass: RenderPass | null;
  ssaoPass: SSAOPass | null;
  pieces: Partial<Record<PieceName, PieceRig>>;
  center: THREE.Vector3;
  radius: number;
  resizeObserver: ResizeObserver;
  disposed: boolean;
  currentIsOrtho: boolean;
}

function buildControls(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  dom: HTMLElement,
  target: THREE.Vector3,
  radius: number,
  enableRotate: boolean,
): OrbitControls {
  const controls = new OrbitControls(camera, dom);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.enableRotate = enableRotate;
  controls.minDistance = Math.max(radius * 0.05, 0.01);
  controls.maxDistance = radius * 12;
  controls.update();
  return controls;
}

function applyDisplayModeToPiece(rig: PieceRig, mode: DisplayMode, visible: boolean) {
  rig.mesh.material = mode === "Ghosted" ? rig.ghostedMaterial : rig.renderedMaterial;
  rig.mesh.visible = visible;
}

export default function ThreeViewport({
  glbUrl,
  glbNodeNames,
  displayMode,
  namedView,
  visibility,
  colors,
  onReady,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<SceneState | null>(null);
  // live-updated ref so the animation loop (created once, on mount) always
  // sees the latest displayMode without needing to be re-created every toggle
  const displayModeRef = useRef<DisplayMode>(displayMode);
  displayModeRef.current = displayMode;

  // ---- mount / tile change: build the whole scene from scratch ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // setSize(..., false) intentionally skips three.js's own style writes so
    // the ResizeObserver-driven handleResize() below is the single source of
    // truth for layout — but that means the canvas needs its CSS size pinned
    // to the container here, otherwise it falls back to its drawing-buffer
    // (attribute) pixel size, which is devicePixelRatio times too big.
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);

    const perspCamera = new THREE.PerspectiveCamera(50, width / height, 0.05, 1000);
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 1000);

    scene.add(new THREE.AmbientLight(0xffffff, 0.18));
    const hemi = new THREE.HemisphereLight(0xffffff, 0x1a1420, 0.55);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(1, 1.6, 1);
    scene.add(key);
    scene.add(key.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-1.2, 0.6, -1);
    scene.add(fill);
    scene.add(fill.target);

    // placeholder controls until the model loads and we know the bounds
    const controls = buildControls(perspCamera, renderer.domElement, new THREE.Vector3(), 10, true);

    const state: SceneState = {
      renderer,
      scene,
      perspCamera,
      orthoCamera,
      activeCamera: perspCamera,
      controls,
      composer: null,
      renderPass: null,
      ssaoPass: null,
      pieces: {},
      center: new THREE.Vector3(),
      radius: 10,
      resizeObserver: new ResizeObserver(() => handleResize()),
      disposed: false,
      currentIsOrtho: false,
    };
    stateRef.current = state;

    function handleResize() {
      const s = stateRef.current;
      if (!s || s.disposed || !container) return;
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      s.renderer.setSize(w, h, false);
      s.perspCamera.aspect = w / h;
      s.perspCamera.updateProjectionMatrix();
      const half = s.radius * 1.15;
      s.orthoCamera.left = -half * (w / h);
      s.orthoCamera.right = half * (w / h);
      s.orthoCamera.top = half;
      s.orthoCamera.bottom = -half;
      s.orthoCamera.updateProjectionMatrix();
      s.composer?.setSize(w, h);
    }

    state.resizeObserver.observe(container);

    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        if (cancelled) return;
        const s = stateRef.current;
        if (!s) return;

        scene.add(gltf.scene);
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        const size = box.isEmpty() ? new THREE.Vector3(20, 20, 20) : box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() / 2, 0.5);

        s.center.copy(center);
        s.radius = radius;

        // aim the directional lights at the model's actual center (the tile
        // sits with one corner at this GLB's local origin, not centered on it)
        key.position.set(center.x + radius, center.y + radius * 1.6, center.z + radius);
        key.target.position.copy(center);
        fill.position.set(center.x - radius * 1.2, center.y + radius * 0.6, center.z - radius);
        fill.target.position.copy(center);

        s.perspCamera.near = radius * 0.01;
        s.perspCamera.far = radius * 40;
        s.perspCamera.updateProjectionMatrix();
        s.orthoCamera.near = radius * 0.01;
        s.orthoCamera.far = radius * 40;

        // default 3/4 architectural view
        const dist = radius * 2.6;
        s.perspCamera.position.set(
          center.x + dist * 0.62,
          center.y + dist * 0.52,
          center.z + dist * 0.62,
        );
        s.perspCamera.up.set(0, 1, 0);
        s.perspCamera.lookAt(center);

        s.controls.dispose();
        s.controls = buildControls(s.perspCamera, renderer.domElement, center, radius, true);
        s.activeCamera = s.perspCamera;
        s.currentIsOrtho = false;

        handleResize();

        // find foam / void meshes by name (per manifest's model.glb "nodes" list)
        const found: PieceName[] = [];
        (["foam", "void"] as PieceName[]).forEach((name) => {
          if (!glbNodeNames.includes(name)) return;
          let obj = gltf.scene.getObjectByName(name) as THREE.Object3D | undefined;
          if (obj && !(obj instanceof THREE.Mesh)) {
            obj = obj.children.find((c) => c instanceof THREE.Mesh) as THREE.Object3D | undefined;
          }
          if (!obj || !(obj instanceof THREE.Mesh)) return;
          const mesh = obj as THREE.Mesh;
          // NOTE: normals are left exactly as exported — the engine already
          // computes correct per-face-consistent normals server-side
          // (erosion_engine_5f.write_glb). Recomputing smooth vertex normals
          // here would blur the real hard edges (e.g. the tile's flat caps).
          const renderedMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(colors[name]),
            roughness: 0.86,
            metalness: 0.0,
            side: THREE.DoubleSide,
          });
          const ghostedMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(colors[name]),
            side: THREE.DoubleSide,
            transparent: true,
            // Foam and void are both visible by default, so a ghosted
            // view normally blends both — and foam's own default color is
            // nearly white, so at equal opacity it visibly pales/mudddies
            // whatever void color it sits behind. Ghosted mode's whole
            // point is seeing past the solid to read the void, so foam
            // (the thing you're seeing past) stays a faint context shell
            // and void (the thing you're trying to see) stays legible.
            opacity: name === "foam" ? GHOSTED_CONTEXT_OPACITY : GHOSTED_SUBJECT_OPACITY,
            depthWrite: false,
            // Without this, MeshBasicMaterial is still run through the
            // renderer's ACES tone-mapping curve per-fragment before GPU
            // alpha blending — a nonlinear, channel-mixing transform that
            // compounds across many stacked translucent layers (worst from
            // angles that look through the most geometry, like the
            // underside) instead of converging cleanly to the flat color.
            toneMapped: false,
          });
          s.pieces[name] = { mesh, renderedMaterial, ghostedMaterial };
          applyDisplayModeToPiece(s.pieces[name]!, displayMode, visibility[name]);
          found.push(name);
        });

        // ---- optional ambient-occlusion pass; falls back to plain render on any failure ----
        try {
          const composer = new EffectComposer(renderer);
          const renderPass = new RenderPass(scene, s.activeCamera);
          composer.addPass(renderPass);
          const ssaoPass = new SSAOPass(scene, s.activeCamera, width, height);
          ssaoPass.kernelRadius = radius * 0.12;
          ssaoPass.minDistance = 0.0005;
          ssaoPass.maxDistance = radius * 0.5;
          composer.addPass(ssaoPass);
          composer.addPass(new OutputPass());
          s.composer = composer;
          s.renderPass = renderPass;
          s.ssaoPass = ssaoPass;
          handleResize();
        } catch (err) {
          console.warn("[ThreeViewport] ambient occlusion pass unavailable, rendering without it:", err);
          s.composer = null;
        }

        onReady?.({ pieces: found });
      },
      undefined,
      (err) => {
        if (cancelled) return;
        console.error("[ThreeViewport] failed to load GLB:", err);
        onError?.("Could not load the 3D model from this bundle's model/*.glb file.");
      },
    );

    renderer.setAnimationLoop(() => {
      const s = stateRef.current;
      if (!s || s.disposed) return;
      s.controls.update();
      if (s.composer && displayModeRef.current === "Rendered") {
        s.composer.render();
      } else {
        s.renderer.render(s.scene, s.activeCamera);
      }
    });

    return () => {
      cancelled = true;
      state.disposed = true;
      state.resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      state.controls.dispose();
      state.composer?.dispose();
      state.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
      (Object.keys(state.pieces) as PieceName[]).forEach((name) => {
        const rig = state.pieces[name];
        rig?.renderedMaterial.dispose();
        rig?.ghostedMaterial.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbUrl]);

  // apply display-mode changes to already-loaded pieces
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    (Object.keys(s.pieces) as PieceName[]).forEach((name) => {
      const rig = s.pieces[name];
      if (rig) applyDisplayModeToPiece(rig, displayMode, visibility[name]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode]);

  // visibility (foam/void checkboxes) — re-applies with current display mode
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    (Object.keys(s.pieces) as PieceName[]).forEach((name) => {
      const rig = s.pieces[name];
      if (rig) applyDisplayModeToPiece(rig, displayMode, visibility[name]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibility.foam, visibility.void]);

  // colors
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    (Object.keys(s.pieces) as PieceName[]).forEach((name) => {
      const rig = s.pieces[name];
      if (!rig) return;
      rig.renderedMaterial.color.set(colors[name]);
      rig.ghostedMaterial.color.set(colors[name]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors.foam, colors.void]);

  // named view (Perspective or one of the 6 Rhino-style ortho views)
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const dom = s.renderer.domElement;

    if (namedView === "Perspective") {
      if (s.currentIsOrtho) {
        s.controls.dispose();
        s.controls = buildControls(s.perspCamera, dom, s.center, s.radius, true);
        s.activeCamera = s.perspCamera;
        s.currentIsOrtho = false;
        if (s.renderPass) s.renderPass.camera = s.activeCamera;
        if (s.ssaoPass) s.ssaoPass.camera = s.activeCamera;
      }
      return;
    }

    const def = NAMED_VIEW_DEFS[namedView];
    if (!def) return;
    const dist = s.radius * 3;
    s.orthoCamera.position.set(
      s.center.x + def.dir[0] * dist,
      s.center.y + def.dir[1] * dist,
      s.center.z + def.dir[2] * dist,
    );
    s.orthoCamera.up.set(def.up[0], def.up[1], def.up[2]);
    s.orthoCamera.lookAt(s.center);
    const half = s.radius * 1.15;
    const container = containerRef.current;
    const aspect = container ? (container.clientWidth || 1) / (container.clientHeight || 1) : 1;
    s.orthoCamera.left = -half * aspect;
    s.orthoCamera.right = half * aspect;
    s.orthoCamera.top = half;
    s.orthoCamera.bottom = -half;
    s.orthoCamera.updateProjectionMatrix();

    s.controls.dispose();
    s.controls = buildControls(s.orthoCamera, dom, s.center, s.radius, false);
    s.activeCamera = s.orthoCamera;
    s.currentIsOrtho = true;
    if (s.renderPass) s.renderPass.camera = s.activeCamera;
    if (s.ssaoPass) s.ssaoPass.camera = s.activeCamera;
  }, [namedView]);

  return <div ref={containerRef} className="h-full w-full" />;
}
