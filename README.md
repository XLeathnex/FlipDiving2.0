# Cala Nera

A cliff-diving game. Walk to the edge, load a jump, throw a rotation, tuck to
spin up, open out to find the water, and try to make a small hole.

Play it in a browser: `npm install && npm run dev`.

---

## The one rule

**If you hit water, it counts.** There is no landing zone, no target ring, no
invisible rectangle that decides your dive was invalid because you drifted two
metres. The environment is the referee: water is a landing, rock is a crash, and
everything interesting happens in between. A bad landing in water is still a
landing — it just scores badly and sounds painful.

## Controls

| | |
|---|---|
| **Hold Space** | Load the jump. Longer hold = more height and distance. |
| **A / D** *(while loading)* | Set the direction and amount of rotation. Hold longer for more. |
| **Space** *(in the air)* | Commit to your air trick. In a tuck your moment of inertia drops, so you spin roughly 3× faster. |
| **W** *(in the air)* | Straighten out. Rotation slows, and the airflow starts pulling you into line. |
| **Z / X** | Change air trick. Works mid-air too. |
| **A / D** *(in the air)* | A small pitch correction. Enough to save a near miss, not enough to fly. |
| **Space / R** | Go again, immediately. |
| **Q / E** or **1–5** | Change spot. |
| **M** | Mute. |

Nothing is held back or unlocked. All five spots and all five tricks are
available from the first second.

## Tricks

Space commits you to whichever trick is selected, and each one is a different
set of physics rather than a different animation.

| | | |
|---|---|---|
| **Tuck** | dive | Smallest moment of inertia, so it spins fastest and opens quickest. |
| **Pike** | dive | Folded at the hips, legs straight. Rotates slower, so it pays more per somersault. |
| **Star** | dive | Spread wide. Rotates slower than a *layout* does, and the air grabs you hard. |
| **Cannonball** | bomb | A ball is never streamlined from any angle. Judged on the splash. |
| **Manu** | bomb | A folded V, in seat first. Moves more water than anything else in the game. |

The two **bomb** tricks invert the goal. A dive is scored on how *little* water
you move; a bomb on how much. Both top out at roughly the same score, so
neither is the "real" way to play — and opening out of a manu on the way down
scores about a tenth of what committing to it does.

## Why it works the way it does

**Rotation is angular momentum, not an animation.** The diver is a rigid body
integrating world-space angular momentum, with a body-frame inertia tensor taken
from published human segment data. Tucking does not multiply your spin rate by a
tuning constant — it drops your moment of inertia from 0.193 to 0.053 m², and
because `L = Iω` is conserved, ω goes up by 3.6×. Open out and it comes back
down. That is the whole mechanic, and it is real.

**The air helps you, but only if you commit.** A body that is stretched out and
moving fast gets pushed into line with the airflow, and rotational drag settles
it there. So opening out late genuinely saves a dive — and costs you every bit
of your rotation. Choosing that instant *is* the game.

Both aero terms scale with speed, which hands the level a difficulty curve for
free. Off the Shelf at 12 m/s the air barely helps and you have about **125 ms**
to get it right. Off the Mast at 24 m/s the air really does straighten you out,
and the window opens to **325 ms** — but now you have four seconds of rotation to
account for. Nobody designed that curve; it fell out of the physics.

**The cliff you can see is the cliff you can hit.** The rock is one signed
distance field. Collision queries sample it directly; the visible mesh is
generated from the same function with surface nets. Limestone bedding and
fracture joints are folded into the field itself rather than added as a texture,
so the ledge you land on has the bumps you can see. "Invisible wall" and "clipped
through the rock" are not bugs that can happen here — they are excluded by
construction.

**Entry is graded on one thing above all others:** whether the body is
travelling along its own long axis. That is what a rip entry physically *is* —
the body following the hole it makes. Speed, verticality, residual spin and how
straight you are all modulate it.

**The splash is computed, not chosen.** There is no "belly flop splash" asset
anywhere. At the moment of contact the simulation already knows the area the
body presents to the flow, so the splash is built from three numbers:

```
area      m^2 presented to the flow
displace  area x speed   -- cubic metres of water shoved aside per second
align     1 if travelling along your own long axis, 0 if broadside
```

Three things then happen, in the order real water does them. The **crown** —
the sheet thrown radially outward — follows `displace` for its size and `align`
for its angle, so a flat body shoves a low wide skirt and a streamlined one
pushes a narrow collar almost straight up. Behind a fast body an air **cavity**
opens. A fifth of a second later that cavity collapses and fires a
**Worthington jet** back up: a thin spike after a clean entry, a fat column
after a cannonball, and nothing at all after a belly flop, because a belly flop
never makes a cavity to collapse.

Measured across the five tricks from the same platform, the water moved runs
2.4 m³/s for a clean entry up to 13.2 for a committed manu. Nobody authored
that ordering; it falls out of the areas. The sound is synthesised from the
same three numbers, so it is continuous too.

## Layout

```
src/
  core/       vector maths, input intent
  sim/        the game. imports nothing from three.js, runs in plain node
    body.ts     rigid body, inertia, aerodynamics, contacts
    pose.ts     the shape scalar and what it does to the body
    sdf.ts      distance field primitives, blending, limestone detail
    level.ts    Cala Nera itself, and the collision world
    scoring.ts  entry grading and dive scoring
    game.ts     state machine: ready -> charge -> air -> result
  view/       three.js: meshing, water, character, camera, HUD
    spray.ts    instanced billboards stretched along their own velocity
    splash.ts   crown, cavity and jet, all derived from the entry physics
  audio/      everything synthesised at runtime; no samples
tools/        headless test harnesses (see below)
```

The split matters: `sim/` has no rendering dependency, so the entire game
simulation runs under `node`. That is what makes the feel measurable.

## Testing

```
npm run simtest    # clearance, rotation, skill curve, 400 randomised dives
node --experimental-strip-types tools/tune.ts        # careless vs skilled play
node --experimental-strip-types tools/balance.ts     # score balance per spot
node --experimental-strip-types tools/spotcheck.ts   # every spot still stands on rock
node --experimental-strip-types tools/scooptest.ts   # the air scoop cannot become a rotation engine
node --experimental-strip-types tools/splashtest.ts  # every trick's entry physics, ordered by water moved
node --experimental-strip-types tools/loopbug.ts     # holding or mashing jump cannot start a loop
npm run build && npm run preview
node tools/shot.mjs '[{"press":"Digit4"},{"wait":0.5},{"shot":"plank"}]'
```

`tools/shot.mjs` drives the real game in headless Chromium, presses real keys and
saves frames. Several genuine bugs in this project were only visible that way —
inverted mesh winding that made the sun light nothing, particle sizes in the
wrong units that turned the result screen white, a camera that framed a horizon
instead of a cliff.

`tools/tune.ts` is the important one. It plays hundreds of dives and reports the
gap between careless and skilled play, which is the number that actually decides
whether the game is worth repeating:

```
careless player: clean+ 46%  perfect 22%
skilled player:  clean+ 100% perfect 93%
open-window: 125 ms (Shelf) ... 325 ms (Mast)
```

## Deliberately not here

No accounts, currencies, shops, daily rewards, unlock trees, battle passes,
achievements, or cosmetics. Nothing in this list would make the act of jumping,
flipping and landing any better, and every one of them would compete with it for
attention.

## Credits

Built with [three.js](https://threejs.org). Every asset — geometry, materials,
sounds — is generated procedurally at load or at runtime; nothing is sampled or
copied from anywhere.
