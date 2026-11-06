'use client'

import React, { useEffect, useRef } from 'react'

// ────────────────────────────────────────────────────────────
// Fragment shader — fbm noise tinted by u_color uniform
// ────────────────────────────────────────────────────────────
const fragmentShaderSource = `#version 300 es
precision highp float;
out vec4 O;
uniform float time;
uniform vec2 resolution;
uniform vec3 u_color;

#define FC gl_FragCoord.xy
#define R resolution
#define T (time+660.)

float rnd(vec2 p){p=fract(p*vec2(12.9898,78.233));p+=dot(p,p+34.56);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(rnd(i),rnd(i+vec2(1,0)),u.x),mix(rnd(i+vec2(0,1)),rnd(i+1.),u.x),u.y);}
float fbm(vec2 p){float t=.0,a=1.;for(int i=0;i<5;i++){t+=a*noise(p);p*=mat2(1,-1.2,.2,1.2)*2.;a*=.5;}return t;}

void main(){
  vec2 uv=(FC-.5*R)/R.y;
  vec3 col=vec3(1);
  uv.x+=.25;
  uv*=vec2(2,1);

  float n=fbm(uv*.28-vec2(T*.01,0));
  n=noise(uv*3.+n*2.);

  col.r-=fbm(uv+vec2(0,T*.015)+n);
  col.g-=fbm(uv*1.003+vec2(0,T*.015)+n+.003);
  col.b-=fbm(uv*1.006+vec2(0,T*.015)+n+.006);

  col=mix(col, u_color, dot(col,vec3(.21,.71,.07)));

  col=mix(vec3(.08),col,min(time*.1,1.));
  col=clamp(col,.08,1.);
  O=vec4(col,1);
}`

const vertexShaderSource = `#version 300 es
precision highp float;
in vec4 position;
void main(){gl_Position=position;}`

type RGB = [number, number, number]

// ────────────────────────────────────────────────────────────
// Renderer — WebGL2 driver with smooth color interpolation
// ────────────────────────────────────────────────────────────
class Renderer {
  private gl: WebGL2RenderingContext
  private canvas: HTMLCanvasElement
  private program: WebGLProgram | null = null
  private vs: WebGLShader | null = null
  private fs: WebGLShader | null = null
  private buffer: WebGLBuffer | null = null
  private currentColor: RGB = [0.5, 0.5, 0.5]
  private targetColor: RGB = [0.5, 0.5, 0.5]

  // Uniform locations
  private uResolution: WebGLUniformLocation | null = null
  private uTime: WebGLUniformLocation | null = null
  private uColor: WebGLUniformLocation | null = null

  private static readonly VERTICES = [-1, 1, -1, -1, 1, 1, 1, -1]

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 is not supported in this browser')
    this.gl = gl
    this.setup()
    this.init()
  }

  setColor(rgb: RGB): void {
    this.targetColor = rgb
  }

  setColorImmediate(rgb: RGB): void {
    this.targetColor = rgb
    this.currentColor = [...rgb] as RGB
  }

  updateScale(): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const { innerWidth: width, innerHeight: height } = window
    this.canvas.width = Math.floor(width * dpr)
    this.canvas.height = Math.floor(height * dpr)
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }

  private compile(shader: WebGLShader, source: string): void {
    const gl = this.gl
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader)
      throw new Error(`Shader compile error: ${log}`)
    }
  }

  private setup(): void {
    const gl = this.gl
    const vs = gl.createShader(gl.VERTEX_SHADER)
    const fs = gl.createShader(gl.FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!vs || !fs || !program) throw new Error('Failed to create shader/program')

    this.vs = vs
    this.fs = fs
    this.program = program

    this.compile(vs, vertexShaderSource)
    this.compile(fs, fragmentShaderSource)

    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      throw new Error(`Program link error: ${log}`)
    }
  }

  private init(): void {
    const { gl, program } = this
    if (!program) return

    this.buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Renderer.VERTICES), gl.STATIC_DRAW)

    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    this.uResolution = gl.getUniformLocation(program, 'resolution')
    this.uTime = gl.getUniformLocation(program, 'time')
    this.uColor = gl.getUniformLocation(program, 'u_color')
  }

  render(now: number): void {
    const { gl, program, buffer, canvas } = this
    if (!program || !gl.isProgram(program)) return

    // Smoothly interpolate current color toward target (frame-rate independent enough)
    const k = 0.06
    this.currentColor[0] += (this.targetColor[0] - this.currentColor[0]) * k
    this.currentColor[1] += (this.targetColor[1] - this.currentColor[1]) * k
    this.currentColor[2] += (this.targetColor[2] - this.currentColor[2]) * k

    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)

    if (this.uResolution) gl.uniform2f(this.uResolution, canvas.width, canvas.height)
    if (this.uTime) gl.uniform1f(this.uTime, now * 1e-3)
    if (this.uColor) gl.uniform3fv(this.uColor, this.currentColor)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  destroy(): void {
    const { gl, program, vs, fs, buffer } = this
    if (program) {
      if (vs) { gl.detachShader(program, vs); gl.deleteShader(vs) }
      if (fs) { gl.detachShader(program, fs); gl.deleteShader(fs) }
      gl.deleteProgram(program)
    }
    if (buffer) gl.deleteBuffer(buffer)
    this.program = null
    this.vs = null
    this.fs = null
    this.buffer = null
  }
}

// ────────────────────────────────────────────────────────────
// Util — convert "#RRGGBB" → [r, g, b] floats 0..1
// ────────────────────────────────────────────────────────────
function hexToRgb(hex: string): RGB | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  return result
    ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
      ]
    : null
}

// ────────────────────────────────────────────────────────────
// React component
// ────────────────────────────────────────────────────────────
interface SmokeBackgroundProps {
  /** Hex color tint, e.g. "#FF5733". Smooth-interpolates on change. */
  smokeColor?: string
  /** Optional className passthrough for sizing/positioning the canvas. */
  className?: string
}

export const SmokeBackground: React.FC<SmokeBackgroundProps> = ({
  smokeColor = '#808080',
  className = 'w-full h-full block',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)

  // Init + render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: Renderer
    try {
      renderer = new Renderer(canvas)
    } catch {
      // WebGL2 unsupported — silently no-op
      return
    }
    rendererRef.current = renderer

    // Seed initial color before first frame
    const initialRgb = hexToRgb(smokeColor)
    if (initialRgb) renderer.setColorImmediate(initialRgb)

    const handleResize = () => renderer.updateScale()
    handleResize()
    window.addEventListener('resize', handleResize)

    let raf = 0
    const loop = (now: number) => {
      renderer.render(now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(raf)
      renderer.destroy()
      rendererRef.current = null
    }
  }, [])

  // Smooth recolor on prop change
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    const rgb = hexToRgb(smokeColor)
    if (rgb) renderer.setColor(rgb)
  }, [smokeColor])

  return <canvas ref={canvasRef} className={className} />
}
