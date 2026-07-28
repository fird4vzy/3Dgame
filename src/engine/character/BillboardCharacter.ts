import * as THREE from 'three';
import type { ClipName, SpritesheetSource } from './CharacterDefinition';

const _camPos = new THREE.Vector3();
const _selfPos = new THREE.Vector3();
const _up = new THREE.Vector3();
const _toCamera = new THREE.Vector3();
const _facing = new THREE.Vector3();
const _right = new THREE.Vector3();
const _basis = new THREE.Matrix4();

export interface BillboardOptions {
  source: SpritesheetSource;
  texture: THREE.Texture;
  /** Character height in metres, used when the source omits `worldHeight`. */
  height: number;
}

/**
 * Renders a 2D sprite character inside the 3D world.
 *
 * **Why `upright` is the default and `billboard` is not.** A classic billboard
 * rotates to face the camera on all axes. On a flat world that reads fine; on a
 * sphere the character visibly shears and tips as you walk over a hilltop,
 * because "toward the camera" and "away from the planet core" stop agreeing.
 * `upright` locks the sprite's vertical axis to the surface normal and yaws only
 * about that axis — the character stays planted on the ground while still facing
 * the viewer. That is the mode a spherical world needs.
 *
 * A sprite still cannot show a character *turning away* from the camera, so
 * this is the right tool for background NPCs and a workable one for a
 * side-on-styled player, but a rigged 3D mesh remains the better answer for a
 * hero who orbits a planet. See docs/06-asset-specification.md §6.2.
 */
export class BillboardCharacter {
  readonly object3D: THREE.Object3D;

  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly texture: THREE.Texture;
  private readonly source: SpritesheetSource;

  private currentClip: ClipName | null = null;
  private frameKeys: string[] = [];
  private frameIndex = 0;
  private frameTimer = 0;
  private fps = 12;
  private looping = true;
  private finished = false;
  private lastDirectionKey: string | null = null;
  private lastMirrored = false;

  constructor(options: BillboardOptions) {
    this.source = options.source;
    this.texture = options.texture;

    // Sprites must not be filtered into mush. The art brief calls for sharp
    // edges, so nearest filtering and no mipmaps.
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      // alphaTest rather than pure blending: it lets sprites write depth, so
      // they sort correctly against terrain and each other without the classic
      // transparent-sorting artefacts.
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const worldHeight = options.source.worldHeight ?? options.height;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    this.object3D = new THREE.Object3D();
    this.object3D.name = 'sprite_character';
    this.object3D.add(this.mesh);

    const first = Object.keys(options.source.frames)[0];
    if (first) this.applyFrame(first, worldHeight);
  }

  /**
   * Tint the sprite to match the light where it is standing.
   *
   * A sprite uses an unlit material, so without this the character stays fully
   * bright while the world around it is dusk — they read as pasted on top of
   * the scene rather than standing in it. Driving the tint from the district's
   * illumination also means the character visibly warms up as the planet
   * lights, which is the whole point of the core hook.
   */
  setTint(colour: THREE.Color): void {
    this.material.color.copy(colour);
  }

  /** Play a canonical clip. Restarts only if it is a different clip. */
  play(clip: ClipName, restart = false): void {
    if (this.currentClip === clip && !restart) return;

    const animation = this.source.animations?.[clip];
    if (!animation || animation.frames.length === 0) return;

    this.currentClip = clip;
    this.frameKeys = animation.frames;
    this.fps = animation.fps ?? 12;
    this.looping = animation.loop ?? true;
    this.frameIndex = 0;
    this.frameTimer = 0;
    this.finished = false;
    // Force the next faceCamera to re-pick a turnaround frame, and clear any
    // mirroring left over from the previous clip.
    this.lastDirectionKey = null;
    this.mesh.scale.x = Math.abs(this.mesh.scale.x);
    this.applyCurrentFrame();
  }

  /** True when a non-looping clip has reached its last frame. */
  get isFinished(): boolean {
    return this.finished;
  }

  get clip(): ClipName | null {
    return this.currentClip;
  }

  update(dt: number): void {
    if (this.frameKeys.length <= 1 || this.finished) return;

    this.frameTimer += dt;
    const frameDuration = 1 / this.fps;
    while (this.frameTimer >= frameDuration) {
      this.frameTimer -= frameDuration;
      this.frameIndex++;

      if (this.frameIndex >= this.frameKeys.length) {
        if (this.looping) {
          this.frameIndex = 0;
        } else {
          this.frameIndex = this.frameKeys.length - 1;
          this.finished = true;
          break;
        }
      }
    }
    this.applyCurrentFrame();
  }

  /**
   * Orient the sprite and, for directional poses, pick the frame that matches
   * where the viewer is standing.
   *
   * Runs in lateUpdate, after the character's transform and the camera have
   * both settled. `characterFacing` is the direction the character is *walking*
   * — pass it so the turnaround can be selected; omit it and the sprite simply
   * faces the camera.
   */
  faceCamera(
    camera: THREE.Camera,
    planetCentre = ORIGIN,
    characterFacing?: THREE.Vector3,
  ): void {
    camera.getWorldPosition(_camPos);
    this.object3D.getWorldPosition(_selfPos);

    if (this.source.facing === 'billboard') {
      this.object3D.lookAt(_camPos);
    } else {
      // Upright: local up is the surface normal, yaw follows the camera. A pure
      // billboard shears visibly as you cross a hilltop, because "toward the
      // camera" and "away from the core" stop agreeing.
      _up.copy(_selfPos).sub(planetCentre);
      if (_up.lengthSq() < 1e-8) _up.set(0, 1, 0);
      _up.normalize();

      _toCamera.copy(_camPos).sub(_selfPos).projectOnPlane(_up);
      if (_toCamera.lengthSq() < 1e-8) return;
      _toCamera.normalize();

      _right.copy(_up).cross(_toCamera).normalize();
      _basis.makeBasis(_right, _up, _toCamera);
      this.object3D.quaternion.setFromRotationMatrix(_basis);
    }

    if (characterFacing) this.updateDirectionalFrame(characterFacing);
  }

  /**
   * Choose one of the five turnaround frames from the angle between where the
   * character is facing and where the viewer is standing, mirroring for the
   * left half of the circle.
   */
  private updateDirectionalFrame(characterFacing: THREE.Vector3): void {
    const animation = this.currentClip ? this.source.animations?.[this.currentClip] : undefined;
    const directions = animation?.directions;
    if (!directions) return;

    _facing.copy(characterFacing).projectOnPlane(_up);
    if (_facing.lengthSq() < 1e-8) return;
    _facing.normalize();

    // 0 = viewer in front of the character, PI = viewer behind.
    const cos = THREE.MathUtils.clamp(_facing.dot(_toCamera), -1, 1);
    const angle = Math.acos(cos);
    const index = Math.min(4, Math.round((angle / Math.PI) * 4));

    // Which side is the viewer on? Mirror the sprite for the other half.
    const side = _right.copy(_up).cross(_facing).dot(_toCamera);
    const mirrored = side < 0;

    const key = directions[index];
    if (key && (key !== this.lastDirectionKey || mirrored !== this.lastMirrored)) {
      this.lastDirectionKey = key;
      this.lastMirrored = mirrored;
      this.applyFrame(key, this.source.worldHeight);
      // Mirroring is a scale flip, not a second set of art.
      this.mesh.scale.x = Math.abs(this.mesh.scale.x) * (mirrored ? -1 : 1);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  private applyCurrentFrame(): void {
    const key = this.frameKeys[this.frameIndex];
    if (key) this.applyFrame(key, this.source.worldHeight);
  }

  /**
   * Point the material's UV window at one atlas rectangle and resize the quad
   * to match that frame's aspect, so mixed-size frames all read at the correct
   * world scale.
   */
  private applyFrame(key: string, worldHeight?: number): void {
    const frame = this.source.frames[key];
    if (!frame) return;

    const image = this.texture.image as { width?: number; height?: number } | undefined;
    const atlasW = image?.width ?? 1;
    const atlasH = image?.height ?? 1;

    this.texture.repeat.set(frame.w / atlasW, frame.h / atlasH);
    // Texture space is bottom-up; frame rectangles are authored top-down.
    this.texture.offset.set(frame.x / atlasW, 1 - (frame.y + frame.h) / atlasH);
    this.texture.needsUpdate = true;

    const height = worldHeight ?? this.source.worldHeight ?? 1.6;
    const width = height * (frame.w / frame.h);
    this.mesh.scale.set(width, height, 1);

    // Pivot: default to the feet, which is what puts the sprite on the ground.
    const pivot = frame.pivot ?? { x: 0.5, y: 1 };
    this.mesh.position.set((0.5 - pivot.x) * width, (pivot.y - 0.5) * height, 0);
  }
}

const ORIGIN = new THREE.Vector3(0, 0, 0);
