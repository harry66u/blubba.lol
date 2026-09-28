/**
 * GPUs that can't hold Medium: software renderers, older integrated Intel chips (common in
 * school Chromebooks), and low-end phone/tablet GPUs.
 */
const WEAK_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|mali-(t\d+|g[35]\d\b|4\d\d)|powervr|videocore|adreno \(tm\) [3-5]\d\d|intel.*(hd graphics ([2-5]\d\d|[2-5]\d{3})|uhd graphics 6[01]\d|gma)/i;

/** The GPU's name as the browser reports it ('' if hidden). */
export function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

export function isWeakGpu(name = gpuName()): boolean {
  return WEAK_GPU.test(name);
}
