export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: new URL('../src/vendor/three/three.module.min.js', import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith('three/addons/')) {
    return { url: new URL('../src/vendor/three/addons/' + specifier.slice('three/addons/'.length), import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
