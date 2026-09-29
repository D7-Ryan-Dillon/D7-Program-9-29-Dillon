"use client";

// Live view of the current composition: one mesh per placed instance,
// positioned/rotated/scaled per lib/arrange/geometry.ts, re-fit and
// re-camera'd whenever the instance list changes. Orbit controls, plus
// click-to-select (raycast against the placed meshes, report the hit
// instance's id up so the side panel can show its editor).
//
// Display mode (Rendered/Ghosted) and the 6 named views + Perspective mirror
// the Viewer tab's ThreeViewport, including its ghosted-material fix — a
// composition here is at least as likely to be viewed from a grazing angle
// through overlapping curved pieces, so it needs the same unlit ghosted
// material to avoid the same Fresnel/specular pale-washout.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { PieceKind, PlacedInstance } from "@/lib/arrange/types";
import { instanceMatrix, loadInstanceGeometry } from "@/lib/arrange/geometry";
import type { DisplayMode } from "@/components/viewer/ThreeViewport";
import { NAMED_VIEW_DEFS, type NamedView } from "@/lib/faceViews";

// The app's own accent color, used everywhere else for "this is selected/
// active" (button borders, tabs, etc.) — kept fixed here rather than
// derived from the model's own (now user-chosen) color so a selected piece
// stays visually distinct even when the model color is close to white.
const SELECTED_EMISSIVE = new THREE.Color("#ff2f92").multiplyScalar(0.35);
// A joint-panel row highlights BOTH pieces on either side of a join
// (`highlightIds`) — visually distinct from the single-piece selection
// glow above, so which piece you clicked vs. which is just "the other
// side of this joint" still reads as two different things.
const JOINT_EMISSIVE = new THREE.Color("#2fd9ff").multiplyScalar(0.35);
const ZERO_EMISSIVE = new THREE.Color(0, 0, 0);

interface PieceRig {
  mesh: THREE.Mesh;
  renderedMaterial: THREE.MeshStandardMaterial;
  ghostedMaterial: THREE.MeshBasicMaterial;
}

interface Props {
  instances: PlacedInstance[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The two instance ids on either side of a joint-panel row the user
   * clicked (see ArrangeTab.tsx) — null outside that flow. */
  highlightIds?: string[] | null;
  displayMode: DisplayMode;
  namedView: NamedView;
  pieceMode: PieceKind;
  /** Single color for the whole composition — Arrange shows one piece kind
   * at a time (see lib/arrange/types.ts), so there's no separate
   * foam/void color split here the way the Viewer tab has. */
  color: string;
  /** When set, shows this one fused/smoothed geometry (see ArrangeTab's
   * "Smooth" toggle and lib/arrange/smoothMerge.ts) instead of the normal
   * one-mesh-per-instance composition. Camera framing, display mode and
   * color all still apply the same way on top of it. */
  smoothedGeometry: THREE.BufferGeometry | null;
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

function applyDisplayMode(rig: PieceRig, mode: DisplayMode) {
  rig.mesh.material = mode === "Ghosted" ? rig.ghostedMaterial : rig.renderedMaterial;
}

// Ghosted has no emissive channel to glow (its material is intentionally
// unlit) — bumping its opacity so the selected piece reads as more solid
// among its translucent neighbours works regardless of the model's own
// chosen color.
function applyHighlight(rig: PieceRig, selected: boolean, jointHighlighted: boolean) {
  rig.renderedMaterial.emissive.copy(selected ? SELECTED_EMISSIVE : jointHighlighted ? JOINT_EMISSIVE : ZERO_EMISSIVE);
  rig.ghostedMaterial.opacity = selected ? 0.75 : jointHighlighted ? 0.6 : 0.32;
}

function applyColor(rig: PieceRig, color: string) {
  rig.renderedMaterial.color.set(color);
  rig.ghostedMaterial.color.set(color);
}

function makeRig(geometry: THREE.BufferGeometry, color: string): PieceRig {
  const renderedMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.86,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const ghostedMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    // See ThreeViewport.tsx's ghostedMaterial comment: without this, tone
    // mapping compounds across stacked translucent layers and washes the
    // color pale from angles that look through a lot of overlapping
    // geometry.
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, renderedMaterial);
  return { mesh, renderedMaterial, ghostedMaterial };
}

export default function ArrangeViewport({
  instances,
  selectedId,
  onSelect,
  highlightIds,
  displayMode,
  namedView,
  pieceMode,
  color,
  smoothedGeometry,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const perspCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const activeCameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const renderPassRef = useRef<RenderPass | null>(null);
  const ssaoPassRef = useRef<SSAOPass | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rigsRef = useRef<Map<string, PieceRig>>(new Map());
  const centerRef = useRef(new THREE.Vector3());
  const radiusRef = useRef(10);
  const isOrthoRef = useRef(false);

  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;
  const highlightIdsRef = useRef<string[] | null | undefined>(highlightIds);
  highlightIdsRef.current = highlightIds;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const displayModeRef = useRef<DisplayMode>(displayMode);
  displayModeRef.current = displayMode;
  const namedViewRef = useRef<NamedView>(namedView);
  namedViewRef.current = namedView;
  const colorRef = useRef<string>(color);
  colorRef.current = color;

  // Re-frames whichever camera the current namedView calls for, using the
  // latest known composition bounds — shared by "instances changed" (new
  // content, same view) and "namedView changed" (same content, new view).
  function frameCamera() {
    const perspCamera = perspCameraRef.current;
    const orthoCamera = orthoCameraRef.current;
    const renderer = rendererRef.current;
    const container = containerRef.current;
    if (!perspCamera || !orthoCamera || !renderer || !container) return;
    const center = centerRef.current;
    const radius = radiusRef.current;
    const view = namedViewRef.current;
    const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);

    controlsRef.current?.dispose();

    if (view === "Perspective") {
      const dist = radius * 2.6;
      perspCamera.position.set(center.x + dist * 0.62, center.y + dist * 0.52, center.z + dist * 0.62);
      perspCamera.up.set(0, 1, 0);
      perspCamera.lookAt(center);
      perspCamera.aspect = aspect;
      perspCamera.updateProjectionMatrix();
      controlsRef.current = buildControls(perspCamera, renderer.domElement, center, radius, true);
      activeCameraRef.current = perspCamera;
      isOrthoRef.current = false;
    } else {
      const def = NAMED_VIEW_DEFS[view];
      if (def) {
        const dist = radius * 3;
        orthoCamera.position.set(center.x + def.dir[0] * dist, center.y + def.dir[1] * dist, center.z + def.dir[2] * dist);
        orthoCamera.up.set(def.up[0], def.up[1], def.up[2]);
        orthoCamera.lookAt(center);
      }
      const half = radius * 1.15;
      orthoCamera.left = -half * aspect;
      orthoCamera.right = half * aspect;
      orthoCamera.top = half;
      orthoCamera.bottom = -half;
      orthoCamera.updateProjectionMatrix();
      controlsRef.current = buildControls(orthoCamera, renderer.domElement, center, radius, false);
      activeCameraRef.current = orthoCamera;
      isOrthoRef.current = true;
    }

    if (renderPassRef.current) renderPassRef.current.camera = activeCameraRef.current!;
    if (ssaoPassRef.current) ssaoPassRef.current.camera = activeCameraRef.current!;
  }

  // ---- mount: renderer/scene/cameras/controls, once ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);

    const perspCamera = new THREE.PerspectiveCamera(50, width / height, 0.05, 2000);
    perspCamera.position.set(12, 10, 12);
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 2000);
    perspCameraRef.current = perspCamera;
    orthoCameraRef.current = orthoCamera;
    activeCameraRef.current = perspCamera;

    // Flatter than ThreeViewport's rig on purpose: a composition here
    // sprawls across many orientations (branches reaching every which
    // way), unlike a single boxy 20 ft tile, so far more surface area ends
    // up catching a strong directional light at some point across the
    // whole shape. A saturated base color (like the default void pink) is
    // already near-clipped in its brightest channel, so a strong key light
    // has nowhere to push that channel but its other, lower channels grow
    // instead — the result reads as a pale, off-hue wash exactly where the
    // light is strongest, easy to mistake for transparency. Lower key
    // intensity, more ambient/hemisphere fill keeps the same pieces
    // visible without that hot, saturation-crushing highlight.
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1420, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(1, 1.6, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-1.2, 0.6, -1);
    scene.add(fill);

    controlsRef.current = buildControls(perspCamera, renderer.domElement, new THREE.Vector3(), 10, true);

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    // ---- optional ambient-occlusion pass; falls back to plain render on any failure ----
    try {
      const composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, perspCamera);
      composer.addPass(renderPass);
      const ssaoPass = new SSAOPass(scene, perspCamera, width, height);
      ssaoPass.kernelRadius = radiusRef.current * 0.12;
      ssaoPass.minDistance = 0.0005;
      ssaoPass.maxDistance = radiusRef.current * 0.5;
      composer.addPass(ssaoPass);
      composer.addPass(new OutputPass());
      composerRef.current = composer;
      renderPassRef.current = renderPass;
      ssaoPassRef.current = ssaoPass;
    } catch (err) {
      console.warn("[ArrangeViewport] ambient occlusion pass unavailable, rendering without it:", err);
      composerRef.current = null;
    }

    const handleResize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      const cam = activeCameraRef.current;
      if (cam instanceof THREE.PerspectiveCamera) {
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
      } else if (cam instanceof THREE.OrthographicCamera) {
        const half = radiusRef.current * 1.15;
        cam.left = -half * (w / h);
        cam.right = half * (w / h);
        cam.top = half;
        cam.bottom = -half;
        cam.updateProjectionMatrix();
      }
      composerRef.current?.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // click-to-select: a real drag (orbit) shouldn't count as a click
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!downPos || Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) {
        downPos = null;
        return;
      }
      downPos = null;
      const cam = activeCameraRef.current;
      if (!cam) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, cam);
      const hits = raycaster.intersectObjects(group.children, false);
      const hit = hits.find((h) => h.object instanceof THREE.Mesh);
      onSelectRef.current((hit?.object.userData.instanceId as string | undefined) ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    let disposed = false;
    renderer.setAnimationLoop(() => {
      if (disposed) return;
      controlsRef.current?.update();
      const cam = activeCameraRef.current;
      if (!cam) return;
      if (composerRef.current && displayModeRef.current === "Rendered") {
        composerRef.current.render();
      } else {
        renderer.render(scene, cam);
      }
    });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.setAnimationLoop(null);
      controlsRef.current?.dispose();
      composerRef.current?.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
      rigsRef.current.forEach((rig) => {
        rig.renderedMaterial.dispose();
        rig.ghostedMaterial.dispose();
      });
      rigsRef.current.clear();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
      rendererRef.current = null;
      perspCameraRef.current = null;
      orthoCameraRef.current = null;
      activeCameraRef.current = null;
      controlsRef.current = null;
      groupRef.current = null;
      composerRef.current = null;
      renderPassRef.current = null;
      ssaoPassRef.current = null;
    };
  }, []);

  // ---- composition changed: rebuild meshes, refit + reframe ----
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    let cancelled = false;

    (async () => {
      const newRigs = new Map<string, PieceRig>();
      if (smoothedGeometry) {
        const rig = makeRig(smoothedGeometry, colorRef.current);
        applyDisplayMode(rig, displayModeRef.current);
        newRigs.set("smoothed", rig);
      } else {
        for (const inst of instances) {
          const geom = await loadInstanceGeometry(inst, pieceMode);
          if (!geom || cancelled) continue;
          geom.applyMatrix4(instanceMatrix(inst));
          const rig = makeRig(geom, colorRef.current);
          rig.mesh.userData.instanceId = inst.id;
          applyDisplayMode(rig, displayModeRef.current);
          applyHighlight(rig, inst.id === selectedIdRef.current, highlightIdsRef.current?.includes(inst.id) ?? false);
          newRigs.set(inst.id, rig);
        }
      }
      if (cancelled) {
        newRigs.forEach((rig) => {
          rig.mesh.geometry.dispose();
          rig.renderedMaterial.dispose();
          rig.ghostedMaterial.dispose();
        });
        return;
      }

      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
      rigsRef.current.forEach((rig) => {
        rig.renderedMaterial.dispose();
        rig.ghostedMaterial.dispose();
      });
      group.clear();
      rigsRef.current = newRigs;
      newRigs.forEach((rig) => group.add(rig.mesh));
      if (newRigs.size === 0) return;

      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.5);
      centerRef.current.copy(center);
      radiusRef.current = radius;

      const perspCamera = perspCameraRef.current;
      const orthoCamera = orthoCameraRef.current;
      if (perspCamera) {
        perspCamera.near = radius * 0.01;
        perspCamera.far = radius * 40;
      }
      if (orthoCamera) {
        orthoCamera.near = radius * 0.01;
        orthoCamera.far = radius * 40;
      }
      if (ssaoPassRef.current) {
        ssaoPassRef.current.kernelRadius = radius * 0.12;
        ssaoPassRef.current.minDistance = 0.0005;
        ssaoPassRef.current.maxDistance = radius * 0.5;
      }

      frameCamera();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, pieceMode, smoothedGeometry]);

  // named view (Perspective or one of the 6 ortho views) changed
  useEffect(() => {
    frameCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namedView]);

  // display mode: swap each piece's active material, no rebuild needed
  useEffect(() => {
    rigsRef.current.forEach((rig) => applyDisplayMode(rig, displayMode));
  }, [displayMode]);

  // color: update materials in place, no rebuild needed (unlike pieceMode,
  // which swaps to a different mesh entirely and goes through the
  // composition-rebuild effect above)
  useEffect(() => {
    rigsRef.current.forEach((rig) => applyColor(rig, color));
  }, [color]);

  // highlight the selected mesh (and any joint-highlighted ones) without
  // rebuilding the whole composition
  useEffect(() => {
    rigsRef.current.forEach((rig, id) => applyHighlight(rig, id === selectedId, highlightIds?.includes(id) ?? false));
  }, [selectedId, highlightIds]);

  return <div ref={containerRef} className="h-full w-full" />;
}
