import * as THREE from 'three';
import type { QualityTier } from '@engine/platform/Viewport';

/**
 * Mirror reflections for the sea.
 *
 * The environment map already puts the *sky* in the water. What it cannot put
 * there is anything standing in or beside it — the red legs of the sea gate,
 * the houses on the shore — and that doubled image is most of what makes still
 * water read as water rather than as glossy blue paint.
 *
 * This is a classic planar reflector (the construction three's `Reflector`
 * uses: a camera mirrored through the water plane, with an oblique near plane
 * so nothing under the water leaks in), with one change forced by the world:
 * **the sea is a sphere sixty metres across.** No single plane fits it — fifteen
 * metres out the surface has dropped two metres and tilted fourteen degrees —
 * so the plane is chosen each frame as the tangent plane at the stretch of
 * water the camera is looking at, and eased toward it so turning your head
 * does not make the reflection jump. Where you look, the mirror is right.
 *
 * It only renders when there is water in front of the camera and close enough
 * to matter, at a fraction of screen resolution, and not at all on the low
 * tier — the sky-only reflection from the environment map is the fallback,
 * and it is a perfectly good one.
 */

const _planePoint = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _wanted = new THREE.Vector3();
const _view = new THREE.Vector3();
const _target = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _rotation = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _forward = new THREE.Vector3();
const _toPoint = new THREE.Vector3();
const _size = new THREE.Vector2();

export interface ReflectionUniforms {
  uReflection: { value: THREE.Texture | null };
  uReflectionMatrix: { value: THREE.Matrix4 };
  uReflectionOn: { value: number };
}

export class WaterReflection {
  private readonly target: THREE.WebGLRenderTarget | null;
  private readonly mirror = new THREE.PerspectiveCamera();
  private readonly scale: number;
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private hasNormal = false;
  /** Points on the planet where there is open water, for the visibility test. */
  private wet: THREE.Vector3[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly uniforms: ReflectionUniforms,
    private readonly seaRadius: number,
    tier: QualityTier,
  ) {
    this.scale = tier === 'high' ? 0.5 : 0.35;
    this.target =
      tier === 'low'
        ? null
        : new THREE.WebGLRenderTarget(1, 1, {
            type: THREE.HalfFloatType,
            depthBuffer: true,
          });
    if (this.target) this.target.texture.name = 'water_reflection';
    this.uniforms.uReflection.value = this.target?.texture ?? null;
  }

  /** Where the sea is. Unit directions or surface points; only direction matters. */
  setWetPoints(points: THREE.Vector3[]): void {
    this.wet = points.map((p) => p.clone().normalize().multiplyScalar(this.seaRadius));
  }

  /**
   * Render the mirrored scene, if there is water worth mirroring in view.
   * Call before the main render.
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, water: THREE.Object3D, dt: number): void {
    const target = this.target;
    if (!target || !this.focus(camera)) {
      this.uniforms.uReflectionOn.value = 0;
      return;
    }

    // Ease toward the water being looked at, so the mirror does not snap.
    if (!this.hasNormal) {
      this.normal.copy(_wanted);
      this.hasNormal = true;
    } else {
      this.normal.lerp(_wanted, 1 - Math.exp(-4 * dt)).normalize();
    }
    _normal.copy(this.normal);
    _planePoint.copy(_normal).multiplyScalar(this.seaRadius);

    camera.updateMatrixWorld();
    const cameraPosition = camera.position;
    _view.subVectors(_planePoint, cameraPosition);
    // Under the water there is nothing to mirror.
    if (_view.dot(_normal) > 0) {
      this.uniforms.uReflectionOn.value = 0;
      return;
    }
    _view.reflect(_normal).negate().add(_planePoint);

    _rotation.extractRotation(camera.matrixWorld);
    _lookAt.set(0, 0, -1).applyMatrix4(_rotation).add(cameraPosition);
    _target.subVectors(_planePoint, _lookAt).reflect(_normal).negate().add(_planePoint);

    const mirror = this.mirror;
    mirror.position.copy(_view);
    mirror.up.set(0, 1, 0).applyMatrix4(_rotation).reflect(_normal);
    mirror.lookAt(_target);
    mirror.far = camera.far;
    mirror.near = camera.near;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);

    // World position → reflection texture coordinates.
    this.uniforms.uReflectionMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(mirror.projectionMatrix)
      .multiply(mirror.matrixWorldInverse);

    // Oblique near plane at the water, so the seabed and anything under the
    // surface is clipped out of the mirror image.
    _plane.setFromNormalAndCoplanarPoint(_normal, _planePoint).applyMatrix4(mirror.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const p = mirror.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + p[8]!) / p[0]!;
    _q.y = (Math.sign(_clip.y) + p[9]!) / p[5]!;
    _q.z = -1;
    _q.w = (1 + p[10]!) / p[14]!;
    _clip.multiplyScalar(2 / _clip.dot(_q));
    p[2] = _clip.x;
    p[6] = _clip.y;
    // A little bias below the surface, so the swell does not cut the mirror
    // image off at the waterline.
    p[10] = _clip.z + 1 - 0.003;
    p[14] = _clip.w;

    // Size to the drawing buffer.
    this.renderer.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.round(_size.x * this.scale));
    const h = Math.max(1, Math.round(_size.y * this.scale));
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousShadows = renderer.shadowMap.autoUpdate;
    water.visible = false;
    // The shadow map is the main pass's to update; the mirror reuses it.
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, mirror);
    renderer.setRenderTarget(previousTarget);
    renderer.shadowMap.autoUpdate = previousShadows;
    water.visible = true;

    this.uniforms.uReflectionOn.value = 1;
  }

  dispose(): void {
    this.target?.dispose();
  }

  /**
   * Find the water the camera is looking at: the wet point nearest the line
   * of sight, among those in front and within reach. Writes its normal to
   * `_wanted`; false when there is none.
   */
  private focus(camera: THREE.Camera): boolean {
    if (this.wet.length === 0) return false;
    camera.getWorldDirection(_forward);
    // A slightly lowered gaze: the water you see is below the horizon.
    _forward.addScaledVector(_toPoint.copy(camera.position).normalize(), -0.25).normalize();

    let best = -Infinity;
    let found = false;
    for (const point of this.wet) {
      _toPoint.subVectors(point, camera.position);
      const distance = _toPoint.length();
      if (distance > 34 || distance < 0.5) continue;
      const along = _toPoint.dot(_forward) / distance;
      if (along < 0.35) continue;
      // Prefer what is in the middle of the view, then what is near.
      const score = along - distance * 0.004;
      if (score > best) {
        best = score;
        _wanted.copy(point).normalize();
        found = true;
      }
    }
    return found;
  }
}
