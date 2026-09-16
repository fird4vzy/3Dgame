import * as THREE from 'three';
import { PLANET_RADIUS } from '@config/constants';
import { PlanetTerrain, type TerrainPad, type TerrainPath } from './PlanetTerrain';
import { scatterAround, surfacePoint } from './placement';
import { DISTRICTS, type DistrictId } from '../../data/content';

/**
 * Where everything in the world goes — decided before the ground is built.
 *
 * Placement used to happen while the districts were being assembled, which
 * was after the terrain mesh existed, which meant the terrain could not know
 * where the buildings would be. So it did not level the ground for them, and a
 * farmhouse on a hillside stood with one wall buried and the other in the air.
 *
 * Deciding the layout first, as plain data, lets the terrain cut a pad under
 * every footprint *before* it is displaced, and lets every later pass — the
 * scatter of trees, the lanterns, the cats — see the same list of what is
 * already taken. It is also the one place to look when something is in the
 * wrong place, rather than five.
 *
 * Everything here is deterministic: the same seeds, in the same order, every
 * time. A layout that differs between two runs is a bug report nobody can
 * reproduce.
 */
export interface DistrictLayout {
  lamps: THREE.Vector3[];
  /** Landmark props — houses in the Landing, trees in the wood, and so on. */
  props: THREE.Vector3[];
  /** Village fittings, scattered wider than the landmarks. */
  village: THREE.Vector3[];
  cover: THREE.Vector3[];
}

/** A placed object with a facing. */
export interface Placed {
  position: THREE.Vector3;
  /** Rotation about the surface normal, so the object faces `yaw`. */
  yaw: number;
}

/**
 * The shrine precinct in Bramblewood.
 *
 * One place, laid out as a real approach is: a straight sandō from the
 * outermost gate to the hall, the gates in a line and all facing the same way,
 * lanterns in pairs between them, maples flanking the path and blossom behind
 * the hall. It replaces a scatter of gates at random headings, which read as
 * exactly that.
 */
export interface ShrinePrecinct {
  /** Outermost first, so the largest gate is the one you enter through. */
  gates: Array<Placed & { height: number }>;
  lanterns: THREE.Vector3[];
  hall: Placed;
  momiji: THREE.Vector3[];
  sakura: THREE.Vector3[];
  /** The sandō, as a surface segment for the terrain to paint. */
  path: { from: THREE.Vector3; to: THREE.Vector3 };
}

export interface WorldLayout {
  districts: Map<DistrictId, DistrictLayout>;
  shrine: ShrinePrecinct;
  lighthouse: THREE.Vector3;
  /** Trees and rocks across the whole planet, outside the settlements. */
  wilderness: { trees: THREE.Vector3[][]; rocks: THREE.Vector3[]; cover: THREE.Vector3[] };
}

/** A unit direction, on the un-padded terrain. */
function onGround(direction: THREE.Vector3): THREE.Vector3 {
  const d = direction.clone().normalize();
  return d.multiplyScalar(PlanetTerrain.heightAt(d));
}

/** Tangent frame at a direction: `along` is what `yaw = 0` faces. */
function frameAt(direction: THREE.Vector3): { up: THREE.Vector3; along: THREE.Vector3; side: THREE.Vector3 } {
  const up = direction.clone().normalize();
  const along = new THREE.Vector3(0, 1, 0).projectOnPlane(up);
  if (along.lengthSq() < 1e-6) along.set(1, 0, 0).projectOnPlane(up);
  along.normalize();
  const side = up.clone().cross(along).normalize();
  return { up, along, side };
}

function districtCentre(id: DistrictId): THREE.Vector3 {
  const def = DISTRICTS.find((d) => d.id === id)!;
  return surfacePoint(def.centre, 0);
}

function planShrine(taken: THREE.Vector3[]): ShrinePrecinct {
  const centre = districtCentre('bramblewood');
  const { along, side } = frameAt(centre);

  // Metres along the path from the district centre. The hall sits near the
  // heart of the wood and the gates run outward, so you pass through the
  // largest one first and the hall is what you arrive at.
  const at = (distance: number, offset = 0): THREE.Vector3 =>
    onGround(centre.clone().addScaledVector(along, distance).addScaledVector(side, offset));

  const gates = [18, 13, 8].map((distance, i) => ({
    position: at(distance),
    // The gate model spans X and you walk through it along Z, and `yaw = 0`
    // points local Z along `along` — so no rotation at all lines the passage
    // up with the path.
    yaw: 0,
    height: 4.4 - i * 0.3,
  }));

  const lanterns: THREE.Vector3[] = [];
  for (const distance of [15.5, 10.5, 5.5]) {
    lanterns.push(at(distance, 2.3), at(distance, -2.3));
  }

  // The hall's front is its local +Z, and yaw 0 points that along the path
  // — towards the gates, which is where you arrive from.
  const hall = { position: at(1.5), yaw: 0 };

  const momiji = [7, 12, 17].flatMap((d) => [at(d, 4.8), at(d, -4.8)]);
  const sakura = [at(-3.5, 3.2), at(-3.5, -3.2), at(-1, 6), at(-1, -6)];

  taken.push(
    ...gates.map((g) => g.position),
    ...lanterns,
    hall.position,
    ...momiji,
    ...sakura,
    // The path itself, so nothing is scattered across it.
    ...[3.5, 6, 9.5, 11.5, 14.5, 16.5].map((d) => at(d)),
  );

  return { gates, lanterns, hall, momiji, sakura, path: { from: at(20), to: at(0) } };
}

/**
 * Trees and rocks everywhere the settlements are not.
 *
 * Half the planet was bare — the districts scatter within their own radius,
 * and the ground between them had nothing on it at all. A Fibonacci lattice
 * gives an even spread over the whole sphere; the rejection keeps it out of
 * the water, off the steepest faces, and clear of anything already placed.
 */
function planWilderness(taken: THREE.Vector3[]): WorldLayout['wilderness'] {
  const trees: THREE.Vector3[][] = [[], [], []];
  const rocks: THREE.Vector3[] = [];
  const cover: THREE.Vector3[] = [];

  // Deterministic, and independent of the district seeds.
  let state = 0x9e3779b9;
  const rng = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const golden = Math.PI * (3 - Math.sqrt(5));
  const clearOf = (point: THREE.Vector3, metres: number): boolean =>
    !taken.some((other) => other.distanceToSquared(point) < metres * metres);

  const place = (count: number, jitter: number, minAltitude: number, into: (p: THREE.Vector3) => void, spacing: number) => {
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      const direction = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
      // Break the lattice, or the trees stand in visible spirals.
      direction.x += (rng() - 0.5) * jitter;
      direction.y += (rng() - 0.5) * jitter;
      direction.z += (rng() - 0.5) * jitter;
      direction.normalize();

      const height = PlanetTerrain.heightAt(direction);
      if (height < minAltitude) continue;
      const point = direction.multiplyScalar(height);
      if (!clearOf(point, spacing)) continue;
      into(point);
      taken.push(point);
    }
  };

  const seaLevel = PLANET_RADIUS - 1.5;
  // Trees: three species round-robin, so no stand is one shape.
  let species = 0;
  place(640, 0.09, seaLevel + 0.7, (p) => trees[species++ % 3]!.push(p), 4.2);
  place(220, 0.11, seaLevel + 0.3, (p) => rocks.push(p), 2.5);
  // Ground cover does not need clearance from anything.
  const coverCount = 2600;
  for (let i = 0; i < coverCount; i++) {
    const y = 1 - (i / (coverCount - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i + rng() * 0.4;
    const direction = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize();
    const height = PlanetTerrain.heightAt(direction);
    if (height < seaLevel + 0.5) continue;
    cover.push(direction.multiplyScalar(height));
  }

  return { trees, rocks, cover };
}

/**
 * Lay the whole world out, and level the ground under it.
 *
 * Registers the pads and paths with {@link PlanetTerrain} as a side effect —
 * the caller must rebuild the terrain mesh afterwards — and re-projects every
 * placed point onto the levelled ground, so that a lamp beside a house sits on
 * the same pad as the house.
 */
export function planWorld(): WorldLayout {
  // Everything below measures the *un*-levelled ground; stale pads from a
  // previous run would make the pads stack.
  PlanetTerrain.setPads([]);
  PlanetTerrain.setPaths([]);

  const pads: TerrainPad[] = [];
  const paths: TerrainPath[] = [];
  const districts = new Map<DistrictId, DistrictLayout>();
  const everything: THREE.Vector3[] = [];

  // The shrine first: it is authored, and the wood's trees have to keep out of
  // its way rather than the other way round.
  const shrineTaken: THREE.Vector3[] = [];
  const shrine = planShrine(shrineTaken);
  for (const gate of shrine.gates) pads.push(PlanetTerrain.padAt(gate.position, 2.6, 5.5));
  pads.push(PlanetTerrain.padAt(shrine.hall.position, 2.8, 6));
  paths.push({ from: shrine.path.from, to: shrine.path.to, width: 1.3 });

  for (const def of DISTRICTS) {
    const centre = districtCentre(def.id);
    const taken: THREE.Vector3[] = def.id === 'bramblewood' ? [...shrineTaken] : [];

    const lamps = scatterAround(
      centre,
      def.lampCount,
      def.radius * 0.55,
      def.id.length * 977,
      undefined,
      3,
      taken,
    );
    taken.push(...lamps);

    // 4 m apart: a cottage is about 4 m across, so this states "do not
    // overlap" as a distance rather than as a hope.
    const props = scatterAround(
      centre,
      def.id === 'spire' ? 18 : 30,
      def.radius * 0.85,
      def.id.length * 613 + 7,
      undefined,
      4,
      taken,
    );
    taken.push(...props);

    const village = scatterAround(
      centre,
      def.id === 'spire' ? 8 : 14,
      def.radius * 1.15,
      def.id.length * 877 + 31,
      undefined,
      4.5,
      taken,
    );
    taken.push(...village);

    const cover = scatterAround(centre, 1000, def.radius * 0.8, def.id.length * 1231 + 3);

    districts.set(def.id, { lamps, props, village, cover });
    everything.push(...taken);

    // Level ground under anything with a footprint. The Landing's houses are
    // up to seven metres across; a stall is two.
    // The flat covers the walls, not the eaves: the largest house is seven
    // metres across at the roof and about five at the ground.
    if (def.id === 'landing') for (const p of props) pads.push(PlanetTerrain.padAt(p, 3.4, 7.5));
    for (const [i, p] of village.entries()) {
      if (i % 3 === 0) pads.push(PlanetTerrain.padAt(p, 1.5, 4));
    }
  }

  const lighthouse = districtCentre('spire');
  pads.push(PlanetTerrain.padAt(lighthouse, 3.5, 9));
  everything.push(lighthouse);

  const wilderness = planWilderness(everything);

  PlanetTerrain.setPads(pads);
  PlanetTerrain.setPaths(paths);

  // Now that the ground has moved, put everything back on it.
  const settle = (p: THREE.Vector3): void => {
    const height = PlanetTerrain.heightAt(p);
    p.normalize().multiplyScalar(height);
  };
  for (const layout of districts.values()) {
    for (const list of [layout.lamps, layout.props, layout.village, layout.cover]) list.forEach(settle);
  }
  for (const gate of shrine.gates) settle(gate.position);
  shrine.lanterns.forEach(settle);
  settle(shrine.hall.position);
  shrine.momiji.forEach(settle);
  shrine.sakura.forEach(settle);
  settle(lighthouse);
  wilderness.trees.forEach((list) => list.forEach(settle));
  wilderness.rocks.forEach(settle);
  wilderness.cover.forEach(settle);

  return { districts, shrine, lighthouse, wilderness };
}
