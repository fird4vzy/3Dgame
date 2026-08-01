# Locomotion rebuild

The walk and the jump looked awkward through four passes. This records what was
actually wrong, because three of the four causes were the same mistake wearing
different clothes: **the animation could not see how fast the body was moving.**

## 1. The legs ran backwards

`VrmCharacter` posed the hip and the knee with the same sign (`S = -1`).

A thigh hangs *down* from the hip; a shin folds *back* from the knee. The
rotation that swings one forward is the rotation that folds the other, so they
cannot share a sign. Positive hip pitch was putting the leg **behind** the body,
which meant the stance phase ran in reverse — the planted foot travelling
forwards under a body moving forwards. A moonwalk.

A symmetric sine wave hides this completely. Mirror a sine walk and you get a
sine walk, which is why it survived every previous pass; it only became visible
once the cycle had a real stance and a real swing. `HIP = -S` is the fix, and
`tools/shoot-gait.mjs` is what found it: foot travel measured **+1.85 m/s** where
it should have been −2.30.

## 2. Cadence was a constant, not a consequence

```
this.phase += c.stride * dt * Math.PI * 2;   // ← stride is a pose-table number
```

Phase advanced at a fixed frequency regardless of ground speed, so the feet
slid. Now it advances by **distance travelled**:

```
phase += (speed * dt) / cycleLength(speed)
```

One stride covers exactly one stride's worth of ground, at any speed, including
through acceleration. `SphericalCharacterController.emitFootsteps` calls the same
`stepLength()`, so footfall audio cannot drift from footfall animation.

## 3. A sine gives stance and swing equal time

Real walking is roughly 60/40 — the planted leg sweeps back slowly and almost
linearly while the body rides over it, then the free leg whips through in a
little over a third of the time with the knee folded. Equal halves read as
wading.

`stanceFraction(speed)` also drops below 0.5 as speed rises, which opens a
**flight phase** — a moment with neither foot down. That is the actual difference
between a run and a walk played fast.

## 4. Reach and pelvis height were decorative

- Leg amplitude was a number in a table. It is now solved from the ground the
  foot must cover: `hipAmplitude(stanceTravel(speed), legLength)`. Cadence can be
  perfectly locked and the feet still scrape if the legs are not reaching far
  enough.
- Pelvis height was a sine. It is now placed where the legs put it
  (`hipDrop`) — swing a hip 45° forward while holding the pelvis at standing
  height and the foot simply cannot reach the floor.
- `ankleDrop` measures to the **sole**, not the ankle bone. Heel at contact, ball
  at push-off. Measuring to the ankle put the body at its lowest exactly at
  toe-off, which is backwards.
- Segment lengths are measured off the rig at load, so a character of a different
  height still walks correctly with no per-model constant.

## 5. The jump was a clip timer

A hop off a kerb played the same canned arc as a fall off a cliff. `airPose`
reads **vertical velocity** instead: extend on take-off, tuck where the velocity
passes through zero, reach for the ground on the way down. Correct at any height,
automatically. The landing absorb stays on a clock — it genuinely is a timed
event — but scales with the drop that caused it.

The airborne arms were driven forward to "lift" them, which put them straight out
in front like a sleepwalker. Pitch only swings an arm fore and aft; the `z` term
is what raises one.

## Verification

Unit tests cover the curves (`tests/unit/gait.test.ts`, 38 assertions) but cannot
see a skeleton. `tools/shoot-gait.mjs` drives the real VRM through a full cycle
and measures foot travel per frame:

```
npm run dev
node tools/shoot-gait.mjs

walk @ 2.3 m/s   (standing ankle 0.107m)
  ✓ the planted foot tracks the ground — mean -2.27 vs expected -2.30 (1% off)
  ✓ a foot reaches the ground each cycle
  ✓ the other foot lifts clear
  ✓ no foot goes through the floor
```

It also writes a three-row contact sheet — walk, run, jump — because a generated
cycle can only be reviewed by freezing it at even intervals side by side.

## Known limitations

- **The run is not ground-locked to the same tolerance as the walk.** Its planted
  foot still drifts. The cause is understood: at a long stride the leg must be
  nearly straight at contact, which a 2-link chain posed from joint angles cannot
  reconcile with a level pelvis. The proper fix is to define the gait as a **foot
  target trajectory** and solve 2-link IK to it, which also gets stance-phase
  absorption for free. The walk is the state the player spends their time in, so
  it was fixed first.
- Springbone physics is still disabled — see the note in `VrmCharacter.update`.
  Hair sits in its authored rest pose.

## Art references

Generated via the Higgsfield MCP (2 credits each, `get_cost: true` preflights
without submitting). Not committed — this container's network policy blocks the
CDN host.

- Aria turnaround, four views — `hf_20260801_161318_cc02011c`
- Lumenpost key art — `hf_20260801_161337_685746e5`

Higgsfield's `generate_3d` bakes **one** animation clip onto a **newly
auto-rigged mesh** per generation. It cannot animate `aria.vrm`, and several
clips would mean several meshes with skeletons that need not match — so it is the
wrong tool for locomotion, and the right one for concept art, references,
textures and props.
