import { describe, expect, it } from 'vitest';
import { isWeakGpu } from '../src/client/render/gpu';

describe('weak GPU detection', () => {
  it('starts software renderers and low-end chips on Low', () => {
    for (const name of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'ANGLE (Intel, Mesa Intel(R) UHD Graphics 600 (GLK 2), OpenGL 4.6)',
      'ANGLE (Intel, Mesa Intel(R) UHD Graphics 605 (GLK 3), OpenGL 4.6)',
      'ANGLE (Intel, Intel(R) HD Graphics 500 Direct3D11 vs_5_0 ps_5_0)',
      'Mali-G52 MC2',
      'Mali-T860',
      'PowerVR Rogue GE8320',
      'Adreno (TM) 506',
      'Microsoft Basic Render Driver',
    ]) {
      expect(isWeakGpu(name), name).toBe(true);
    }
  });

  it('leaves capable GPUs on Medium', () => {
    for (const name of [
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
      'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)',
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
      'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)',
      'Mali-G710',
      'Adreno (TM) 740',
      'Apple GPU',
      '',
    ]) {
      expect(isWeakGpu(name), name).toBe(false);
    }
  });
});
