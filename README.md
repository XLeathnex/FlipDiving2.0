# Cala Nera

A cliff-diving game. You are always a person standing somewhere. Walk to an
edge, load a jump, lean into a rotation, tuck to spin up, open out to find the
water, and try to make a small hole.

Play it in a browser: `npm install && npm run dev`.

---

## The one rule

**If you hit water, it counts.** There is no landing zone, no target ring, no
invisible rectangle that decides your dive was invalid because you drifted two
metres. The environment is the referee: water is a landing, rock is a crash, and
everything interesting happens in between. A bad landing in water is still a
landing — it just scores badly and sounds painful.

## Controls

Click into the window to lock the mouse. There is no menu between you and the
cliff — you walk there.

| | |
|---|---|
| **WASD** | Walk. Camera-relative, the way any third-person game moves. |
| **Mouse** | Look around. Also aims the direction you take off in. |
| **Shift** | Run. |
| **Space** *(on foot, at an edge)* | Hold to load a jump. Longer hold = more height and distance. |
| **W / S** *(while loading)* | Lean forward or back. This is the same motion as walking forward or back — it is not a separate meter, it is your centre of mass moving off your feet, which is what actually starts a body rotating. Hold it longer or push harder and you spin more. |
| **Z / X** | Cycle the selected trick. Works before you jump or mid-air. |
| **Space** *(in the air)* | Commit to your trick. A tuck drops your moment of inertia hard, so you spin roughly 3× faster than laid out. |
| **W** *(in the air)* | Straighten out. Rotation slows, and the airflow starts pulling you into line. |
| **A / D** *(in the air)* | A small pitch scoop. Enough to save a near miss, not enough to fly. |
| **Space / R** | Go again, immediately, from the ledge you just jumped off. |
| **1–6** or **[ / ]** | Quick-travel to a named spot, for getting back to the top of something tall without the walk. |
| **G** | Toggle the spot list. |
| **M** | Mute. |

Nothing is held back or unlocked. Every spot and every trick is available from
the first second, including the walk to reach them.

## Tricks

Nine of them, not a reskinned three. Z/X selects one before you jump (or
mid-air, to line up the next dive), and Space commits you to it — each is a
genuinely different body configuration with its own inertia tensor and drag
profile, not a different animation on the same physics.

| | | |
|---|---|---|
| **Tuck** | dive | Knees to chest. Smallest moment of inertia, so it spins fastest and opens quickest. |
| **Pike** | dive | Folded at the hips, legs dead straight. Rotates slower, so it pays more per somersault. |
| **Pencil** | dive | Dead straight, arms locked overhead. Committing to it barely changes your inertia at all — no assist, what you leave with is what you land with. |
| **Swan** | dive | Spread wide. Barely rotates, and the air really grabs you. |
| **Twister** | dive | Straight, arms pinned to your sides. Slow to somersault, fast to twist — pulling your arms to the long axis does almost nothing to one axis of inertia and roughly halves the other. |
| **Cannonball** | bomb | Hug your knees and land on it. A ball is never streamlined from any angle. |
| **Manu** | bomb | A folded V, in seat first. Moves more water than almost anything in the game. |
| **Candle** | bomb | Arms crossed, straight and narrow, straight down. The skill is entering almost as cleanly as a dive despite being judged as a bomb. |
| **Watermelon** | bomb | Arms and legs thrown wide, flat as you can stay. Moves the most water in the cove. |

There is no separate "Front Flip" / "Back Flip" trick slot, on purpose: those
are not shapes, they're what leaning forward or back at take-off does to
whichever shape above you're holding. The scoring layer names the result from
the rotation you actually flew — "Double Front Tuck", "2½ Back Pike" — which is
a more honest source of truth than a menu entry could be.

The **bomb** tricks invert the goal. A dive is scored on how *little* water you
move; a bomb on how much. Both families top out at roughly the same score, so
neither is the "real" way to play — and opening out of a manu on the way down
scores about a tenth of what committing to it does.

## The cove

One map, Cala Nera, walked in full rather than picked from a list — six named
spots along the same headland, from a beginner ledge to a tower over three
times the height of anything else here:

| | | |
|---|---|---|
| **The Shelf** | 7 m | Low and forgiving. Learn the timing here. |
| **Gull Ledge** | 14 m | Enough air for a double. Mind the face on the way out. |
| **The Arch** | 24 m | The far leg is right under you. Jump lazy and you find it. |
| **The Plank** | 28 m | Weathered timber, deep water, nothing in the way. |
| **The Mast** | 34 m | Four seconds of falling. Do something with them. |
| **The Watchtower** | 103 m | A hundred metres up, out along a cable-stayed gangway. You will have time to think about this on the way down. |

Any edge along the headland works, not just the six named ones — the ground
underfoot is what decides whether you can load a jump, not a marker in the
world. The named spots exist so getting back to the top of something tall
doesn't mean walking back up every time.

## Why it works the way it does

**Take-off is a lean, not a meter.** There is no separate dial for "how much
spin." Your legs push through your feet, and if your weight is forward or back
of them when you push, that push has a moment arm — angular momentum is
literally `lean × push speed`. Lean hard and push weak and you barely rotate;
lean the same amount and push hard and you rotate a lot more. It's the same
motion as leaning forward or back while walking, which is exactly why W/S do
both jobs: charging a jump is not a different action from walking, it's what
walking looks like when your feet are about to leave the ground.

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
free. Off the Shelf the air barely helps and you have about **250 ms** to get
it right. Off the Mast the air really does straighten you out, and the window
opens past **1000 ms** — but now you have four seconds of rotation to account
for. Nobody designed that curve; it fell out of the physics.

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

Measured across all nine tricks from the same platform, the water moved on a
held, committed entry runs 2.1 m³/s for a Pencil up to 12.9 for a Watermelon —
and every trick here can also be *opened out* of just before entry, which
collapses it back down to the same clean ~2.2 m³/s regardless of which one you
started in, since by then you're just a straight body again. Nobody authored
either ordering; both fall out of the areas. The sound is synthesised from the
same three numbers, so it is continuous too.

## Layout

```
src/
  core/       vector maths, input intent
  sim/        the game. imports nothing from three.js, runs in plain node
    body.ts     rigid body, inertia, aerodynamics, contacts
    walker.ts   on-foot movement, ground/edge probing -- no dive physics in it
    pose.ts     the shape scalar and what it does to the body
    sdf.ts      distance field primitives, blending, limestone detail
    level.ts    Cala Nera itself, and the collision world
    tricks.ts   the nine trick profiles: inertia, drag, intent
    scoring.ts  entry grading and dive scoring
    game.ts     state machine: walk -> charge -> air -> result
  view/       three.js: meshing, water, character, camera, HUD
    camera.ts   third-person free-roam orbit on foot, director camera in the air
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
node --experimental-strip-types tools/retrybug.ts    # a retry tap during the result cooldown is buffered, not dropped
npm run build && npm run preview
node tools/shot.mjs '[{"click":true},{"key":"KeyW"},{"wait":0.5},{"up":"KeyW"},{"shot":"walking"}]'
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
careless player: clean+ 39%  perfect 26%
skilled player:  clean+ 100% perfect 93%
open-window: 250 ms (Shelf) ... 1050 ms (Mast)
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
