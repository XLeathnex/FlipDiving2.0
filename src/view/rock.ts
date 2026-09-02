import * as THREE from 'three';
import { buildRockMesh } from './surfacenets.ts';
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
  const m = buildRockMesh(level.rock, cell);

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

          // Bedding planes: limestone is laid down in near-horizontal strata.
          float strata = fbm3(vec3(vWPos.x * 0.09, vWPos.y * 0.62, vWPos.z * 0.09));
          float grain  = fbm3(vWPos * 0.85);
          float coarse = fbm3(vWPos * 0.20);

          vec3 pale  = vec3(0.760, 0.712, 0.618);
          vec3 warm  = vec3(0.640, 0.545, 0.432);
          vec3 shade = vec3(0.352, 0.318, 0.286);
          vec3 base = mix(warm, pale, smoothstep(0.35, 0.72, strata * 0.55 + coarse * 0.45));
          base = mix(base, shade, smoothstep(0.62, 0.95, grain) * 0.45);

          // Sun-bleached on top faces, dirtier on the undersides.
          base = mix(base * 0.74, base * 1.10, pow(up, 0.7));

          // Splash zone: dark, wet, then a band of algae right at the water.
          float wet   = 1.0 - smoothstep(0.4, 4.6, hgt);
          float algae = smoothstep(-0.4, 0.7, hgt) * (1.0 - smoothstep(0.9, 2.9, hgt));
          base = mix(base, base * vec3(0.34, 0.33, 0.32), wet * 0.85);
          base = mix(base, vec3(0.150, 0.205, 0.140), algae * 0.55 * (0.5 + 0.5 * grain));

          // Sparse dry scrub clinging to the flat tops, well above the spray.
          float veg = smoothstep(0.55, 0.86, up) * smoothstep(6.0, 11.0, hgt) * smoothstep(0.48, 0.78, coarse);
          base = mix(base, vec3(0.255, 0.268, 0.155), veg * 0.62);

          diffuseColor.rgb *= base;
          diffuseColor.rgb *= mix(0.30, 1.0, vAo);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float hgt = vWPos.y - uSeaY;
          float wet = 1.0 - smoothstep(0.4, 4.2, hgt);
          roughnessFactor = mix(0.94, 0.30, wet);
          roughnessFactor -= fbm3(vWPos * 2.7) * 0.12;
          roughnessFactor = clamp(roughnessFactor, 0.06, 1.0);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Triplanar detail bump, so close-ups still have surface texture.
          float e = 0.16;
          vec3 p = vWPos * 1.6;
          float c = fbm3(p);
          vec3 grad = vec3(fbm3(p + vec3(e,0,0)) - c, fbm3(p + vec3(0,e,0)) - c, fbm3(p + vec3(0,0,e)) - c) / e;
          normal = normalize(normal - (grad - dot(grad, normal) * normal) * 0.22);
        }`);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'rock';
  return { mesh, tris: m.triangles };
}
