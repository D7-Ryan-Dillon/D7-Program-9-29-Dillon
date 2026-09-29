"use client";

// A small, non-interactive reference view for the Analysis tab: the same
// GLB the Viewer tab shows, always in Ghosted style, slowly spinning on its
// own so it's a quick visual anchor while reading scores — not a working
// viewport, so no controls, display modes, or ambient-occlusion pass.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Props {
  glbUrl: string;
}

const FOAM_COLOR = "#f5f5f2";
const VOID_COLOR = "#ff2f92";
const ROTATION_SPEED = 0.15; // radians / second

// Both pieces show at once here with no visibility toggle, so — same as
// ThreeViewport's ghostedMaterial — foam (nearly white) needs a much lower
// opacity than void, or it pales/muddies whatever void color sits behind it.
const GHOSTED_CONTEXT_OPACITY = 0.12; // foam
const GHOSTED_SUBJECT_OPACITY = 0.34; // void

export default function RotatingPreview({ glbUrl }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.05, 1000);
    // no lights — the ghosted material below is unlit

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    let pivot: THREE.Group | null = null;
    let disposed = false;
    let lastTime = performance.now();

    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        if (cancelled) return;
        gltf.scene.updateMatrixWorld(true);

        (["foam", "void"] as const).forEach((name) => {
          let obj = gltf.scene.getObjectByName(name) as THREE.Object3D | undefined;
          if (obj && !(obj instanceof THREE.Mesh)) {
            obj = obj.children.find((c) => c instanceof THREE.Mesh) as THREE.Object3D | undefined;
          }
          if (!obj || !(obj instanceof THREE.Mesh)) return;
          // Unlit and untonemapped so the flat color is exact and stable
          // across every stacked layer regardless of view angle (a lit
          // material stacks Fresnel/specular highlights, and even an unlit
          // one still runs through the renderer's per-fragment tone-mapping
          // curve unless toneMapped is turned off) — and foam gets a much
          // lower opacity than void, since foam's own colour is nearly
          // white and at equal opacity it visibly pales/muddies whatever
          // void colour sits behind it.
          obj.material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(name === "void" ? VOID_COLOR : FOAM_COLOR),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: name === "void" ? GHOSTED_SUBJECT_OPACITY : GHOSTED_CONTEXT_OPACITY,
            depthWrite: false,
            toneMapped: false,
          });
        });

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        const size = box.isEmpty() ? new THREE.Vector3(20, 20, 20) : box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() / 2, 0.5);

        camera.near = radius * 0.01;
        camera.far = radius * 40;
        const dist = radius * 2.6;
        camera.position.set(center.x + dist * 0.62, center.y + dist * 0.52, center.z + dist * 0.62);
        camera.up.set(0, 1, 0);
        camera.lookAt(center);
        camera.updateProjectionMatrix();

        // spin the model in place around its own centre: a pivot group sits at
        // `center` and the model is offset by -center inside it, so rotating
        // the pivot doesn't swing the model off-camera.
        const group = new THREE.Group();
        group.position.copy(center);
        scene.add(group);
        gltf.scene.position.sub(center);
        group.add(gltf.scene);
        pivot = group;
      },
      undefined,
      () => {
        // non-fatal here — this is a reference view, the Viewer tab already
        // surfaces load errors for the same GLB
      },
    );

    renderer.setAnimationLoop(() => {
      if (disposed) return;
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      if (pivot) pivot.rotation.y += ROTATION_SPEED * dt;
      renderer.render(scene, camera);
    });

    return () => {
      cancelled = true;
      disposed = true;
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => m.dispose());
          }
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [glbUrl]);

  return <div ref={containerRef} className="h-full w-full" />;
}
