import * as THREE from 'three';

let vs = THREE.ShaderLib.standard.vertexShader;
let fs = THREE.ShaderLib.standard.fragmentShader;

// Exact replacements from app.js:
vs = vs.replace('#include <common>', `
#include <common>
varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNormal;
varying vec2 vTerrainUv;
`);

vs = vs.replace('#include <worldpos_vertex>', `
#include <worldpos_vertex>
vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainWorldNormal = normalize(mat3(modelMatrix) * normal);
vTerrainUv = uv;
`);

fs = fs.replace('#include <common>', `
#include <common>
varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNormal;
varying vec2 vTerrainUv;

uniform sampler2D uGrassMap;
uniform sampler2D uGrassNormal;
uniform sampler2D uGrassRoughness;
uniform sampler2D uRockMap;
uniform sampler2D uRockNormal;
uniform sampler2D uRockRoughness;
uniform sampler2D uSandMap;
uniform sampler2D uSandNormal;
uniform sampler2D uSandRoughness;
`);

fs = fs.replace('#include <map_fragment>', `
if (dot(vTerrainWorldPos.xz, vTerrainWorldPos.xz) < 576.0) {
    discard;
}
vec2 tileUV = vTerrainUv * 64.0;

// Steigung (Slope): Steile Klippen > 25° werden zu Felsgestein
float slope = 1.0 - abs(vTerrainWorldNormal.y);
float rockFactor = smoothstep(0.18, 0.44, slope);

// Meeresspiegel & Strand (-50m bis -30m)
float beachFactor = 1.0 - smoothstep(-52.0, -32.0, vTerrainWorldPos.y);
beachFactor = clamp(beachFactor, 0.0, 1.0);

// Wiese / Gras fuer sanfte Haenge und Caldera-Boden
float grassFactor = max(0.0, 1.0 - rockFactor - beachFactor);
float totalWeight = max(0.001, grassFactor + rockFactor + beachFactor);
grassFactor /= totalWeight;
rockFactor  /= totalWeight;
beachFactor /= totalWeight;

vec3 cG = texture2D(uGrassMap, tileUV).rgb;
vec3 cR = texture2D(uRockMap,  tileUV).rgb;
vec3 cS = texture2D(uSandMap,  tileUV).rgb;

// Feine Grossraum-Farbvarianz ueber die 1000m Insel
float macro = sin(vTerrainUv.x * 24.0) * cos(vTerrainUv.y * 24.0) * 0.04;
vec3 finalAlbedo = (cG * grassFactor + cR * rockFactor + cS * beachFactor) + macro;
diffuseColor.rgb = finalAlbedo;
`);

fs = fs.replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness;
float rG = texture2D(uGrassRoughness, tileUV).r;
float rR = texture2D(uRockRoughness,  tileUV).r;
float rS = texture2D(uSandRoughness,  tileUV).r;
roughnessFactor = clamp(rG * grassFactor + rR * rockFactor + rS * beachFactor, 0.45, 0.95);
`);

console.log('Shader analysis:');
console.log('vs has vTerrainUv assignment:', vs.includes('vTerrainUv = uv;'));
console.log('fs has vTerrainUv declaration:', fs.includes('varying vec2 vTerrainUv;'));
console.log('fs has float roughnessFactor:', fs.includes('float roughnessFactor'));
console.log('fs has tileUV:', fs.includes('vec2 tileUV = vTerrainUv * 64.0;'));
