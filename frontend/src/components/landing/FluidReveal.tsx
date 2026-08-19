"use client";

/**
 * FluidReveal — the hero's "un-redaction" effect (route "/" only).
 *
 * A latent government document (memo header, statute cites, redaction bars,
 * RELEASED stamp) is hidden in the hero background. Moving the cursor splats
 * ink into a small GPU fluid field (semi-Lagrangian advection over ping-pong
 * framebuffers); wherever the ink flows, the document shows through, then
 * dissipates back to hidden. FOIA, as an interaction.
 *
 * Deliberately WebGL2 rather than TypeGPU/WebGPU: a landing page must render
 * for everyone, and WebGPU still isn't universal. The shader logic ports to
 * TypeGPU nearly 1:1 if we ever want that. Hard gates — reduced motion,
 * touch-only devices, small screens, or missing float-buffer support — all
 * silently render nothing, leaving the page exactly as it was.
 */

import { useEffect, useRef } from "react";

const SIM_DOWNSCALE = 4;      // velocity field resolution divisor
const DYE_DOWNSCALE = 2;      // dye field resolution divisor
const DPR_CAP = 1.5;
const VELOCITY_DISSIPATION = 0.985;
const DYE_DISSIPATION = 0.968;
const SPLAT_FORCE = 6000;
const SPLAT_RADIUS = 0.0035;
const DT = 1 / 60;

const VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // Fullscreen triangle
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const SPLAT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uValue;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  vec3 splat = exp(-dot(p, p) / uRadius) * uValue;
  outColor = vec4(texture(uTarget, vUv).xyz + splat, 1.0);
}`;

const ADVECT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexel;
  outColor = uDissipation * texture(uSource, coord);
}`;

const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uDye;
uniform sampler2D uDoc;
uniform vec2 uCanvasSize;
uniform vec2 uDocSize;
void main() {
  float d = texture(uDye, vUv).r;
  float reveal = smoothstep(0.02, 0.55, d);
  // Sample the document at native pixel scale, tiled, y-down.
  vec2 docUv = vec2(vUv.x, 1.0 - vUv.y) * uCanvasSize / uDocSize;
  vec4 doc = texture(uDoc, docUv);
  float haze = smoothstep(0.015, 0.7, d) * 0.06;   // faint ink wash so the fluid itself reads
  vec3 ink = vec3(0.094, 0.388, 0.863);            // brand blue #1863dc
  // Premultiplied output over the (transparent) canvas.
  vec3 rgb = doc.rgb * doc.a * reveal + ink * haze * (1.0 - doc.a * reveal);
  float a = clamp(doc.a * reveal + haze, 0.0, 1.0);
  outColor = vec4(rgb, a);
}`;

/** Draw the latent FOIA document onto an offscreen canvas → GPU texture. */
function drawDocumentTexture(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d")!;
  const inkDark = "rgba(31, 41, 55, 0.85)";
  const inkBlue = "rgba(24, 99, 220, 0.9)";
  const barInk = "rgba(17, 17, 17, 0.92)";

  const bodyLine = (x: number, y: number, w: number) => {
    g.fillStyle = "rgba(55, 65, 81, 0.55)";
    g.beginPath();
    g.roundRect(x, y, w, 5, 2.5);
    g.fill();
  };
  const redaction = (x: number, y: number, w: number) => {
    g.fillStyle = barInk;
    g.fillRect(x, y, w, 13);
  };

  const block = (x: number, y: number, header: string, sub: string, cite: string) => {
    g.fillStyle = inkDark;
    g.font = "700 15px Georgia, serif";
    g.fillText(header, x, y);
    g.font = "400 11px Georgia, serif";
    g.fillStyle = "rgba(75, 85, 99, 0.8)";
    g.fillText(sub, x, y + 18);
    let ly = y + 38;
    for (let i = 0; i < 6; i++) {
      const w = 150 + ((i * 61) % 130);
      if (i === 2) redaction(x, ly - 9, 120);
      else if (i === 4) {
        bodyLine(x, ly, 60);
        redaction(x + 70, ly - 9, 140);
      } else bodyLine(x, ly, w);
      ly += 17;
    }
    g.fillStyle = inkBlue;
    g.font = "600 11px Courier, monospace";
    g.fillText(cite, x, ly + 6);
  };

  block(40, 60, "U.S. DEPARTMENT OF JUSTICE", "Office of Information Policy — MEMORANDUM", "5 U.S.C. § 552(a)(6)(A)(i)");
  block(560, 130, "FOIA/PA REQUEST NO. 2026-01847", "Determination — Partial Grant", "Exemption (b)(5) — WITHDRAWN");
  block(90, 420, "ENVIRONMENTAL PROTECTION AGENCY", "Office of Water — Responsive Records", "40 C.F.R. § 2.102(b)(1)");
  block(600, 500, "DEPT. OF HOMELAND SECURITY", "Privacy Office — Disclosure Log", "6 C.F.R. Part 5, Subpart A");
  block(320, 760, "GENERAL SERVICES ADMIN.", "Interagency Referral — Full Release", "5 U.S.C. § 552(a)(6)(B)(iii)");

  // "RELEASED IN FULL" stamp
  g.save();
  g.translate(760, 340);
  g.rotate(-0.16);
  g.strokeStyle = inkBlue;
  g.lineWidth = 3;
  g.strokeRect(-105, -26, 210, 52);
  g.fillStyle = inkBlue;
  g.font = "700 20px Courier, monospace";
  g.textAlign = "center";
  g.fillText("RELEASED IN FULL", 0, 7);
  g.restore();

  // A second, smaller stamp
  g.save();
  g.translate(220, 660);
  g.rotate(0.12);
  g.strokeStyle = "rgba(220, 38, 38, 0.75)";
  g.lineWidth = 2;
  g.strokeRect(-88, -20, 176, 40);
  g.fillStyle = "rgba(220, 38, 38, 0.75)";
  g.font = "700 14px Courier, monospace";
  g.textAlign = "center";
  g.fillText("DECLASSIFIED", 0, 5);
  g.restore();

  return c;
}

interface FBO {
  read: WebGLTexture;
  write: WebGLTexture;
  readFb: WebGLFramebuffer;
  writeFb: WebGLFramebuffer;
  w: number;
  h: number;
  swap(): void;
}

export function FluidReveal() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.innerWidth < 900) return;

    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl || gl.isContextLost()) return;
    if (!gl.getExtension("EXT_color_buffer_float")) return;

    // Registries so cleanup can delete resources WITHOUT losing the context —
    // React StrictMode remounts effects in dev, and a killed context is
    // permanently dead for this canvas (getContext returns the corpse).
    const allTex: WebGLTexture[] = [];
    const allFb: WebGLFramebuffer[] = [];
    const allProg: WebGLProgram[] = [];

    const parent = canvas.parentElement!;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = Math.floor(parent.clientWidth * dpr);
    canvas.height = Math.floor(parent.clientHeight * dpr);

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const program = (frag: string) => {
      const p = gl.createProgram()!;
      allProg.push(p);
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
      return p;
    };

    let splatP: WebGLProgram, advectP: WebGLProgram, displayP: WebGLProgram;
    try {
      splatP = program(SPLAT_FRAG);
      advectP = program(ADVECT_FRAG);
      displayP = program(DISPLAY_FRAG);
    } catch (err) {
      console.warn("FluidReveal disabled (shader):", err);
      return; // shader failure → no effect, page unaffected
    }

    const makeTex = (w: number, h: number, internal: number, format: number) => {
      const t = gl.createTexture()!;
      allTex.push(t);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.HALF_FLOAT, null);
      return t;
    };
    const makeFbo = (w: number, h: number, internal: number, format: number): FBO => {
      const mk = () => {
        const tex = makeTex(w, h, internal, format);
        const fb = gl.createFramebuffer()!;
        allFb.push(fb);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return { tex, fb };
      };
      const a = mk();
      const b = mk();
      const fbo: FBO = {
        read: a.tex, write: b.tex, readFb: a.fb, writeFb: b.fb, w, h,
        swap() {
          [this.read, this.write] = [this.write, this.read];
          [this.readFb, this.writeFb] = [this.writeFb, this.readFb];
        },
      };
      return fbo;
    };

    const simW = Math.max(64, Math.floor(canvas.width / SIM_DOWNSCALE));
    const simH = Math.max(64, Math.floor(canvas.height / SIM_DOWNSCALE));
    const dyeW = Math.max(128, Math.floor(canvas.width / DYE_DOWNSCALE));
    const dyeH = Math.max(128, Math.floor(canvas.height / DYE_DOWNSCALE));
    const velocity = makeFbo(simW, simH, gl.RG16F, gl.RG);
    const dye = makeFbo(dyeW, dyeH, gl.R16F, gl.RED);

    // Document texture
    const docCanvas = drawDocumentTexture();
    const docTex = gl.createTexture()!;
    allTex.push(docTex);
    gl.bindTexture(gl.TEXTURE_2D, docTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, docCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    const u = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
    const bindTex = (tex: WebGLTexture, unit: number) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      return unit;
    };
    const blit = (fb: WebGLFramebuffer | null, w: number, h: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const aspect = canvas.width / canvas.height;
    const pending: { x: number; y: number; dx: number; dy: number }[] = [];
    let last: { x: number; y: number } | null = null;

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        last = null;
        return;
      }
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      if (last) {
        const dx = x - last.x;
        const dy = y - last.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.0005) pending.push({ x, y, dx, dy });
      }
      last = { x, y };
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const splat = (fbo: FBO, x: number, y: number, vx: number, vy: number, vz: number, radius: number) => {
      gl.useProgram(splatP);
      gl.uniform1i(u(splatP, "uTarget"), bindTex(fbo.read, 0));
      gl.uniform2f(u(splatP, "uPoint"), x, y);
      gl.uniform3f(u(splatP, "uValue"), vx, vy, vz);
      gl.uniform1f(u(splatP, "uRadius"), radius);
      gl.uniform1f(u(splatP, "uAspect"), aspect);
      blit(fbo.writeFb, fbo.w, fbo.h);
      fbo.swap();
    };

    let raf = 0;
    let running = true;
    const frame = () => {
      if (!running) return;

      // Apply queued mouse splats
      for (const s of pending) {
        splat(velocity, s.x, s.y, s.dx * SPLAT_FORCE, s.dy * SPLAT_FORCE, 0, SPLAT_RADIUS);
        const speed = Math.min(1, Math.hypot(s.dx, s.dy) * 60);
        splat(dye, s.x, s.y, 0.25 + speed * 0.6, 0, 0, SPLAT_RADIUS * 1.6);
      }
      pending.length = 0;

      // Advect velocity through itself, then dye through velocity
      gl.useProgram(advectP);
      gl.uniform2f(u(advectP, "uTexel"), 1 / velocity.w, 1 / velocity.h);
      gl.uniform1f(u(advectP, "uDt"), DT);
      gl.uniform1f(u(advectP, "uDissipation"), VELOCITY_DISSIPATION);
      gl.uniform1i(u(advectP, "uVelocity"), bindTex(velocity.read, 0));
      gl.uniform1i(u(advectP, "uSource"), bindTex(velocity.read, 0));
      blit(velocity.writeFb, velocity.w, velocity.h);
      velocity.swap();

      gl.uniform1f(u(advectP, "uDissipation"), DYE_DISSIPATION);
      gl.uniform1i(u(advectP, "uVelocity"), bindTex(velocity.read, 0));
      gl.uniform1i(u(advectP, "uSource"), bindTex(dye.read, 1));
      blit(dye.writeFb, dye.w, dye.h);
      dye.swap();

      // Composite: document revealed through the dye
      gl.useProgram(displayP);
      gl.uniform1i(u(displayP, "uDye"), bindTex(dye.read, 0));
      gl.uniform1i(u(displayP, "uDoc"), bindTex(docTex, 1));
      gl.uniform2f(u(displayP, "uCanvasSize"), canvas.width, canvas.height);
      gl.uniform2f(u(displayP, "uDocSize"), docCanvas.width, docCanvas.height);
      blit(null, canvas.width, canvas.height);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Pause when the hero is off-screen
    const io = new IntersectionObserver((entries) => {
      const visible = entries[0].isIntersecting;
      if (visible && !running) {
        running = true;
        raf = requestAnimationFrame(frame);
      } else if (!visible) {
        running = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(canvas);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      // Delete resources but keep the context alive — see StrictMode note above.
      for (const t of allTex) gl.deleteTexture(t);
      for (const f of allFb) gl.deleteFramebuffer(f);
      for (const p of allProg) gl.deleteProgram(p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
  }, []);

  return <canvas ref={canvasRef} className="lp-fluid" aria-hidden="true" />;
}
