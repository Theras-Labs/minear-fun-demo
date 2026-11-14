// Port of play-inUT-NSi.js 51371-51510: cascaded sun shadow (eA) and SunLight (tA).
//
// Finding: eA and tA are not game code and need no patched renderer. They are the three r186 addons
// three/addons/lights/SunLightShadow.js and three/addons/lights/SunLight.js, inlined by the bundler.
// The bundle text matches node_modules/three@0.186.1/examples/jsm/lights/*.js statement for statement
// (scratch Wk/Gk/Kk/qk/Jk = _lightOrientationMatrix/_viewToLightMatrix/_lightDirection/_up/_center,
// Yk/Xk/Zk = _nearCorners/_farCorners/_cascadeCorners, Qk = _cascadeCount 2, $k = _cascadeFade 0.1).
// tA extends jc = Light (not DirectionalLight): it has no target, its direction is its position.
//
// The bundle's three core (lines 1-28000) is stock r186: WebGLShadowMap.render calls
// shadow.updateMatrices(light, camera) for every non-point light (bundle 23458), WebGLLights handles
// light.isSunLight and uploads shadow._cascadeData as sunShadowCascade (bundle 23027-23043), and the
// SUN_LIGHT shader chunks (lights_pars_begin, shadowmap_pars_fragment, ...) equal the node_modules
// chunks once GLSL comments are removed. So the stock WebGLRenderer in node_modules renders these
// classes as the original did; no subclass or per-cascade light is needed.
export { SunLightShadow } from 'three/addons/lights/SunLightShadow.js'; // eA (51381)
export { SunLight } from 'three/addons/lights/SunLight.js'; // tA (51491)
