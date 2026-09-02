import * as THREE from 'three';
import { buildRockMesh, type RockMesh } from './surfacenets.ts';
import type { Level } from '../sim/level.ts';

/**
 * Limestone. The mesh comes straight out of the collision field, so the shape
 * is already right; the job here is to make the surface read as weathered
 * seaside rock rather than grey clay.
 *
 * Three cheap tricks do most of the work:
 *  - baked SDF ambient occlusion darkening the crevices,
 *  - a wet band that tracks the waterline and gets darker and shinier low down,
 *  - triplanar detail normals so it still holds up when the camera is close.
 */
export function buildRock(level: Level, cell = 0.5): { mesh: THREE.Mesh; tris: number } {
  return rockFromMesh(level, buildRockMesh(level.rock, cell));
}

/** Meshing happens in a worker; this turns the raw arrays into a lit surface. */
export function rockFromMesh(level: Level, m: Pick<RockMesh, 'positions' | 'normals' | 'ao' | 'indices' | 'triangles'>): { mesh: THREE.Mesh; tris: number } {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute('aAo', new THREE.BufferAttribute(m.ao, 1));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    dithering: true,
    envMapIntensity: 0.26,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSeaY = { value: level.seaY };
    shader.uniforms.uTime = { value: 0 };
    (mat as any).userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aAo;
        varying float vAo;
        varying vec3 vWPos;
        varying vec3 vWNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vAo = aAo;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * normal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vAo;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform float uSeaY;
        uniform float uTime;

        float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float n3(vec3 p){
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
                        mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z);
          return a;
        }
        float fbm3(vec3 p){
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * n3(p); p *= 2.07; a *= 0.5; }
          return v;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float up = clamp(vWNormal.y, 0.0, 1.0);
          float hgt = vWPos.y - uSeaY;

          // Three scales of mottling. The mid one does most of the work: it is
          // what stops a big face reading as one flat plane of paint.
          float m0 = fbm3(vWPos * 0.085);
          float m1 = fbm3(vWPos * 0.42);
          float m2 = fbm3(vWPos * 1.9);
          float grain = fbm3(vWPos * 6.5);

          vec3 pale  = vec3(0.545, 0.500, 0.418);
          vec3 warm  = vec3(0.352, 0.285, 0.212);
          vec3 grey  = vec3(0.300, 0.302, 0.288);
          vec3 shade = vec3(0.128, 0.114, 0.100);

          vec3 base = mix(warm, pale, smoothstep(0.28, 0.74, m0 * 0.6 + m1 * 0.4));
          base = mix(base, grey, smoothstep(0.46, 0.86, m1) * 0.42);
          base = mix(base, shade, smoothstep(0.58, 0.95, m2) * 0.50);
          base *= 0.80 + 0.40 * grain;

          // Bedding: recessed lines across the face, broken up so they never
          // read as contour lines drawn on the rock.
          float bedPhase = vWPos.y * 0.44 + (fbm3(vWPos * 0.031) - 0.5) * 6.2;
          float bed = abs(sin(bedPhase));
          float bedMask = smoothstep(0.02, 0.40, bed) * 0.72 + 0.28;
          base *= mix(0.80 + 0.16 * m2, 1.05, bedMask);

          // Sun-bleached tops, dirty undersides.
          base = mix(base * 0.52, base * 1.14, pow(up, 0.65));

          // Vertical staining: rainwater runs down a sea cliff and leaves dark
          // streaks. Cheap, and unmistakably 'outdoor rock' rather than 'stone'.
          float streakN = fbm3(vec3(vWPos.x * 1.25, vWPos.y * 0.035, vWPos.z * 1.25));
          float streak = smoothstep(0.50, 0.90, streakN) * (1.0 - up) * smoothstep(1.0, 7.0, hgt);
          base = mix(base, base * vec3(0.52, 0.50, 0.46), streak * 0.72);

          // Splash zone: dark and wet, with a band of algae right at the water.
          float wet   = 1.0 - smoothstep(0.3, 4.2, hgt);
          float algae = smoothstep(-0.5, 0.8, hgt) * (1.0 - smoothstep(1.0, 3.2, hgt));
          base = mix(base, base * vec3(0.24, 0.26, 0.27), wet * 0.90);
          base = mix(base, vec3(0.118, 0.170, 0.108), algae * 0.60 * (0.45 + 0.55 * m2));

          // Dry scrub clinging to flat tops, well above the spray.
          float veg = smoothstep(0.62, 0.90, up) * smoothstep(7.0, 13.0, hgt) * smoothstep(0.50, 0.80, m1);
          base = mix(base, vec3(0.212, 0.228, 0.128), veg * 0.66);

          diffuseColor.rgb *= base;
          diffuseColor.rgb *= mix(0.06, 1.0, pow(vAo, 0.85));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float hgt = vWPos.y - uSeaY;
          float wet = 1.0 - smoothstep(0.3, 4.0, hgt);
          roughnessFactor = mix(0.96, 0.26, wet);
          roughnessFactor -= fbm3(vWPos * 3.1) * 0.16;
          roughnessFactor = clamp(roughnessFactor, 0.06, 1.0);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Triplanar-ish detail bump at three scales. Geometry from the mesher
          // stops at about a metre, so everything finer than that lives here.
          vec3 bump = vec3(0.0);
          float e = 0.09;
          vec3 pa = vWPos * 0.62;
          float ca = fbm3(pa);
          bump += vec3(fbm3(pa + vec3(e,0,0)) - ca, fbm3(pa + vec3(0,e,0)) - ca, fbm3(pa + vec3(0,0,e)) - ca) / e * 0.55;
          vec3 pb = vWPos * 2.6;
          float cb = fbm3(pb);
          bump += vec3(fbm3(pb + vec3(e,0,0)) - cb, fbm3(pb + vec3(0,e,0)) - cb, fbm3(pb + vec3(0,0,e)) - cb) / e * 0.16;
          vec3 pc = vWPos * 9.5;
          float e2 = 0.035, cc = fbm3(pc);
          bump += vec3(fbm3(pc + vec3(e2,0,0)) - cc, fbm3(pc + vec3(0,e2,0)) - cc, fbm3(pc + vec3(0,0,e2)) - cc) / e2 * 0.030;
          // NOTE: 'normal' here is in VIEW space, but the bump was computed
          // from world-space positions. Perturbing one with the other without
          // converting produces detail that swims as the camera turns.
          vec3 bumpView = (viewMatrix * vec4(bump, 0.0)).xyz;
          normal = normalize(normal - (bumpView - dot(bumpView, normal) * normal) * 0.85);
        }`);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'rock';
  return { mesh, tris: m.triangles };
}
