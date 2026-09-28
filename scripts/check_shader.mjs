import * as THREE from 'three';

const grassColor = new THREE.Texture();
const mat = new THREE.MeshStandardMaterial({
    map: grassColor,
    roughness: 0.88,
    metalness: 0.05
});

const shader = {
    uniforms: { ...THREE.ShaderLib.standard.uniforms },
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader
};

shader.uniforms.uGrassMap = { value: grassColor };
shader.uniforms.uGrassNormal = { value: grassColor };
shader.uniforms.uGrassRoughness = { value: grassColor };
shader.uniforms.uRockMap = { value: grassColor };
shader.uniforms.uRockNormal = { value: grassColor };
shader.uniforms.uRockRoughness = { value: grassColor };
shader.uniforms.uSandMap = { value: grassColor };
shader.uniforms.uSandNormal = { value: grassColor };
shader.uniforms.uSandRoughness = { value: grassColor };

shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    `
    #include <common>
    varying vec3 vTerrainWorldPos;
    varying vec3 vTerrainWorldNormal;
    `
);

shader.vertexShader = shader.vertexShader.replace(
    '#include <worldpos_vertex>',
    `
    #include <worldpos_vertex>
    vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vTerrainWorldNormal = normalize(mat3(modelMatrix) * normal);
    `
);

shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `
    #include <common>
    varying vec3 vTerrainWorldPos;
    varying vec3 vTerrainWorldNormal;

    uniform sampler2D uGrassMap;
    uniform sampler2D uGrassNormal;
    uniform sampler2D uGrassRoughness;
    uniform sampler2D uRockMap;
    uniform sampler2D uRockNormal;
    uniform sampler2D uRockRoughness;
    uniform sampler2D uSandMap;
    uniform sampler2D uSandNormal;
    uniform sampler2D uSandRoughness;
    `
);

shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `
    vec2 tileUV = vUv * 64.0;
    
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
    float macro = sin(vUv.x * 24.0) * cos(vUv.y * 24.0) * 0.04;
    vec3 finalAlbedo = (cG * grassFactor + cR * rockFactor + cS * beachFactor) + macro;
    diffuseColor.rgb = finalAlbedo;
    `
);

shader.fragmentShader = shader.fragmentShader.replace(
    '#include <roughnessmap_fragment>',
    `
    float rG = texture2D(uGrassRoughness, tileUV).r;
    float rR = texture2D(uRockRoughness,  tileUV).r;
    float rS = texture2D(uSandRoughness,  tileUV).r;
    roughnessFactor = clamp(rG * grassFactor + rR * rockFactor + rS * beachFactor, 0.45, 0.95);
    `
);

console.log("=== CHECKING VERTEX SHADER ===");
console.log(shader.vertexShader.slice(0, 500));

console.log("=== CHECKING FRAGMENT SHADER ===");
// Check if map_fragment replacement exists
console.log("Contains finalAlbedo:", shader.fragmentShader.includes("finalAlbedo"));
console.log("Contains roughnessFactor clamp:", shader.fragmentShader.includes("roughnessFactor = clamp"));
