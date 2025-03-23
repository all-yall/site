/**
 * Copyright (c) 2018 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { IRenderDimensions } from 'browser/renderer/shared/Types';
import { IThemeService } from 'browser/services/Services';
import { ReadonlyColorSet } from 'browser/Types';
import { Attributes, FgFlags } from 'common/buffer/Constants';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IColor } from 'common/Types';
import { Terminal } from '@xterm/xterm';
import { RENDER_MODEL_BG_OFFSET, RENDER_MODEL_FG_OFFSET, RENDER_MODEL_INDICIES_PER_CELL } from './RenderModel';
import { IRenderModel, IWebGL2RenderingContext, IWebGLVertexArrayObject } from './Types';
import { createProgram, expandFloat32Array, PROJECTION_MATRIX } from './WebglUtils';
import { throwIfFalsy } from 'browser/renderer/shared/RendererUtils';
import * as AmethystModel from './AmethystModel'
import * as Mat from './Matrix'

const enum VertexAttribLocations {
  POSITION = 0,
  SIZE = 1,
  COLOR = 2,
  UNIT_QUAD = 3
}

// this allows syntax highlighting with
// my vim setup for glsl
function glsl(s:string): string {return s;}

const vertexShaderSource = `#version 300 es
layout (location = ${VertexAttribLocations.POSITION}) in vec2 a_position;
layout (location = ${VertexAttribLocations.SIZE}) in vec2 a_size;
layout (location = ${VertexAttribLocations.COLOR}) in vec4 a_color;
layout (location = ${VertexAttribLocations.UNIT_QUAD}) in vec2 a_unitquad;

uniform mat4 u_projection;

out vec4 v_color;

void main() {
  vec2 zeroToOne = a_position + (a_unitquad * a_size);
  gl_Position = u_projection * vec4(zeroToOne, 0.0, 1.0);
  v_color = a_color;
}`;

const fragmentShaderSource = `#version 300 es
precision lowp float;

in vec4 v_color;

out vec4 outColor;

void main() {
  outColor = v_color;
}`;

const logoVertexShaderSource = glsl(`#version 300 es
layout (location = ${VertexAttribLocations.POSITION}) in vec4 a_position;

uniform mat4 u_projection;

out float depth;

void main() {
  gl_Position = u_projection * a_position;
  depth = gl_Position.z;
}`);

const logoFragmentShaderSource = glsl(`#version 300 es
precision lowp float;

in float depth;
out vec4 outColor;

void main() {
  outColor = vec4(1.0, 1.0, 1.0, 1.0);
}`);


const customVertexShaderSource = glsl(`#version 300 es
layout (location = ${VertexAttribLocations.POSITION}) in vec2 a_position;
layout (location = ${VertexAttribLocations.SIZE}) in vec2 a_size;
layout (location = ${VertexAttribLocations.UNIT_QUAD}) in vec2 a_unitquad;

uniform mat4 u_projection;
out vec2 v_position;

void main() {
  v_position = a_position + (a_unitquad * a_size);
  gl_Position =  vec4(1, -1, 1, 1) * (u_projection * vec4(v_position, 0.0, 1.0));
}`);

const customFragmentShaderSource = glsl(`#version 300 es
precision lowp float;

uniform sampler2D u_image;
uniform sampler2D u_glow;
in vec2 v_position;

out vec4 outColor;

void main() {
  vec3 base = texture(u_image, v_position).rgb;
  vec3 glow = texture(u_glow, v_position).rgb;
  outColor = vec4(base + glow * 1.5, 1.0);
}`);

const kawaseFragmentShaderSource = glsl(`#version 300 es
precision lowp float;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_blursize;

in vec2 v_position;

out vec4 outColor;

void main() {
  vec3 col = (
    texture(u_image, v_position + (u_blursize * vec2( 1,  1))/u_resolution).rgb +
    texture(u_image, v_position + (u_blursize * vec2(-1, -1))/u_resolution).rgb +
    texture(u_image, v_position + (u_blursize * vec2(-1,  1))/u_resolution).rgb +
    texture(u_image, v_position + (u_blursize * vec2( 1, -1))/u_resolution).rgb
  ) / 4.0;

  outColor = vec4(col, 1.0);
}`);

const thresholdShaderSource = glsl(`#version 300 es
precision lowp float;

uniform sampler2D u_image;

in vec2 v_position;

out vec4 outColor;

void main() {
  vec3 col = texture(u_image, v_position).rgb;
  float brightness = dot(col, vec3(0.2126, 0.7152, 0.0722));

  if (brightness < 0.5) {
    col = vec3(0);
  }

  outColor = vec4(col, 1.0);
}`);

const scanlineShaderSource = glsl(`#version 300 es
precision lowp float;

uniform sampler2D u_image;
uniform vec2 u_unit;
uniform vec2 u_resolution;
uniform float u_time;

in vec2 v_position;

out vec4 outColor;

vec3 scanline(vec3 original, vec3 color, float offset, float multiplier) {
  float intensity = dot(original, color) * (1.0 + sin((v_position.y * multiplier) * 25000.0 + offset));
  return intensity * color;
}

void main() {
  vec3 col = texture(u_image, v_position).rgb;

  float mult = (u_resolution.y/u_unit.y) / 800.0;

  outColor = vec4(
    scanline(col, vec3(1,0.01,0.01), u_time + 4.188, mult) +
    scanline(col, vec3(0.01,1,0.01), u_time + 2.094, mult) +
    scanline(col, vec3(0.01,0.01,1), u_time, mult)
    ,
    1.0
  );
}`);


const INDICES_PER_RECTANGLE = 8;
const BYTES_PER_RECTANGLE = INDICES_PER_RECTANGLE * Float32Array.BYTES_PER_ELEMENT;

const INITIAL_BUFFER_RECTANGLE_CAPACITY = 20 * INDICES_PER_RECTANGLE;

class Vertices {
  public attributes: Float32Array;
  public count: number;

  constructor() {
    this.attributes = new Float32Array(INITIAL_BUFFER_RECTANGLE_CAPACITY);
    this.count = 0;
  }
}

// Work variables to avoid garbage collection
let $rgba = 0;
let $x1 = 0;
let $y1 = 0;
let $r = 0;
let $g = 0;
let $b = 0;
let $a = 0;

export class RectangleRenderer extends Disposable {

  private _program: WebGLProgram;
  private _vertexArrayObject: IWebGLVertexArrayObject;
  private _attributesBuffer: WebGLBuffer;
  private _projectionLocation: WebGLUniformLocation;

  private _logoVertexArrayObject: IWebGLVertexArrayObject;
  private _logoAttributesBuffer: WebGLBuffer;
  private _logoProjectionLocation: WebGLUniformLocation;
  private _logoProgram: WebGLProgram;

  private _customProgram: WebGLProgram;
  private _customProjectionLocation: WebGLUniformLocation;
  private _customBaseImageLocation: WebGLUniformLocation;
  private _customGlowImageLocation: WebGLUniformLocation;

  private _kawaseProgram: WebGLProgram;
  private _kawaseProjectionLocation: WebGLUniformLocation;
  private _kawaseImageLocation: WebGLUniformLocation;
  private _kawaseResolutionLocation: WebGLUniformLocation;
  private _kawaseBlursizeLocation: WebGLUniformLocation;

  private _thresholdProgram: WebGLProgram;
  private _thresholdProjectionLocation: WebGLProgram;
  private _thresholdImageLocation: WebGLProgram;

  private _scanlineProgram: WebGLProgram;
  private _scanlineProjectionLocation: WebGLProgram;
  private _scanlineImageLocation: WebGLProgram;
  private _scanlineUnitLocation: WebGLProgram;
  private _scanlineResolutionLocation: WebGLProgram;
  private _scanlineTimeLocation: WebGLProgram;

  private _bgFloat!: Float32Array;
  private _cursorFloat!: Float32Array;

  private _vertices: Vertices = new Vertices();
  private _verticesCursor: Vertices = new Vertices();

  private _start: Date;

  constructor(
    private _terminal: Terminal,
    private _gl: IWebGL2RenderingContext,
    private _dimensions: IRenderDimensions,
    private readonly _themeService: IThemeService
  ) {
    super();

    const gl = this._gl;

    this._program = throwIfFalsy(createProgram(gl, vertexShaderSource, fragmentShaderSource));
    this._register(toDisposable(() => gl.deleteProgram(this._program)));

    const t = createProgram(gl, logoVertexShaderSource, logoFragmentShaderSource);
    this._logoProgram = throwIfFalsy(t);
    this._register(toDisposable(() => gl.deleteProgram(this._logoProgram)));

    this._customProgram = throwIfFalsy(createProgram(gl, customVertexShaderSource, customFragmentShaderSource));
    this._register(toDisposable(() => gl.deleteProgram(this._customProgram)));

    this._kawaseProgram = throwIfFalsy(createProgram(gl, customVertexShaderSource, kawaseFragmentShaderSource));
    this._register(toDisposable(() => gl.deleteProgram(this._kawaseProgram)));

    this._thresholdProgram = throwIfFalsy(createProgram(gl, customVertexShaderSource, thresholdShaderSource));
    this._register(toDisposable(() => gl.deleteProgram(this._thresholdProgram)));

    this._scanlineProgram = throwIfFalsy(createProgram(gl, customVertexShaderSource, scanlineShaderSource));
    this._register(toDisposable(() => gl.deleteProgram(this._scanlineProgram)));

    // Uniform locations
    this._projectionLocation = throwIfFalsy(gl.getUniformLocation(this._program, 'u_projection'));

    this._logoProjectionLocation = throwIfFalsy(gl.getUniformLocation(this._logoProgram, 'u_projection'));

    this._customProjectionLocation = throwIfFalsy(gl.getUniformLocation(this._customProgram, 'u_projection'));
    this._customBaseImageLocation =  throwIfFalsy(gl.getUniformLocation(this._customProgram, "u_image"));
    this._customGlowImageLocation =  throwIfFalsy(gl.getUniformLocation(this._customProgram, "u_glow"));

    this._kawaseProjectionLocation = throwIfFalsy(gl.getUniformLocation(this._kawaseProgram, 'u_projection'));
    this._kawaseImageLocation      = throwIfFalsy(gl.getUniformLocation(this._kawaseProgram, "u_image"));
    this._kawaseResolutionLocation = throwIfFalsy(gl.getUniformLocation(this._kawaseProgram, 'u_resolution'));
    this._kawaseBlursizeLocation   = throwIfFalsy(gl.getUniformLocation(this._kawaseProgram, 'u_blursize'));

    this._thresholdProjectionLocation = throwIfFalsy(gl.getUniformLocation(this._thresholdProgram, 'u_projection'));
    this._thresholdImageLocation      = throwIfFalsy(gl.getUniformLocation(this._thresholdProgram, "u_image"));

    this._scanlineProjectionLocation = throwIfFalsy(gl.getUniformLocation(this._scanlineProgram, 'u_projection'));
    this._scanlineImageLocation      = throwIfFalsy(gl.getUniformLocation(this._scanlineProgram, "u_image"));
    this._scanlineUnitLocation       = throwIfFalsy(gl.getUniformLocation(this._scanlineProgram, 'u_unit'));
    this._scanlineResolutionLocation = throwIfFalsy(gl.getUniformLocation(this._scanlineProgram, 'u_resolution'));
    this._scanlineTimeLocation       = throwIfFalsy(gl.getUniformLocation(this._scanlineProgram, "u_time"));

    this._start = new Date();

    // Setup Amethyst Logo attributes
    this._logoAttributesBuffer = throwIfFalsy(gl.createBuffer());
    this._register(toDisposable(() => gl.deleteBuffer(this._logoAttributesBuffer)));
    gl.bindBuffer(gl.ARRAY_BUFFER, this._logoAttributesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(AmethystModel.points), gl.STATIC_DRAW)
    this._logoVertexArrayObject = gl.createVertexArray()
    gl.bindVertexArray(this._logoVertexArrayObject)
    var size = 3;          // 3 components per iteration
    var type = gl.FLOAT;   // the data is 32bit floats
    var normalize = true; // don't normalize the data
    var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
    var offset = 0;        // start at the beginning of the buffer
    gl.enableVertexAttribArray(VertexAttribLocations.POSITION);
    gl.vertexAttribPointer(VertexAttribLocations.POSITION, size, type, normalize, stride, offset)

    // Create and set the vertex array object
    this._vertexArrayObject = gl.createVertexArray();
    gl.bindVertexArray(this._vertexArrayObject);

    // Setup a_unitquad, this defines the 4 vertices of a rectangle
    const unitQuadVertices = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const unitQuadVerticesBuffer = gl.createBuffer();
    this._register(toDisposable(() => gl.deleteBuffer(unitQuadVerticesBuffer)));
    gl.bindBuffer(gl.ARRAY_BUFFER, unitQuadVerticesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unitQuadVertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(VertexAttribLocations.UNIT_QUAD);
    gl.vertexAttribPointer(VertexAttribLocations.UNIT_QUAD, 2, this._gl.FLOAT, false, 0, 0);

    // Setup the unit quad element array buffer, this points to indices in
    // unitQuadVertices to allow is to draw 2 triangles from the vertices via a
    // triangle strip
    const unitQuadElementIndices = new Uint8Array([0, 1, 2, 3]);
    const elementIndicesBuffer = gl.createBuffer();
    this._register(toDisposable(() => gl.deleteBuffer(elementIndicesBuffer)));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementIndicesBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, unitQuadElementIndices, gl.STATIC_DRAW);

    // Setup attributes
    this._attributesBuffer = throwIfFalsy(gl.createBuffer());
    this._register(toDisposable(() => gl.deleteBuffer(this._attributesBuffer)));
    gl.bindBuffer(gl.ARRAY_BUFFER, this._attributesBuffer);
    gl.enableVertexAttribArray(VertexAttribLocations.POSITION);
    gl.vertexAttribPointer(VertexAttribLocations.POSITION, 2, gl.FLOAT, false, BYTES_PER_RECTANGLE, 0);
    gl.vertexAttribDivisor(VertexAttribLocations.POSITION, 1);
    gl.enableVertexAttribArray(VertexAttribLocations.SIZE);
    gl.vertexAttribPointer(VertexAttribLocations.SIZE, 2, gl.FLOAT, false, BYTES_PER_RECTANGLE, 2 * Float32Array.BYTES_PER_ELEMENT);
    gl.vertexAttribDivisor(VertexAttribLocations.SIZE, 1);
    gl.enableVertexAttribArray(VertexAttribLocations.COLOR);
    gl.vertexAttribPointer(VertexAttribLocations.COLOR, 4, gl.FLOAT, false, BYTES_PER_RECTANGLE, 4 * Float32Array.BYTES_PER_ELEMENT);
    gl.vertexAttribDivisor(VertexAttribLocations.COLOR, 1);

    this._updateCachedColors(_themeService.colors);
    this._register(this._themeService.onChangeColors(e => {
      this._updateCachedColors(e);
      this._updateViewportRectangle();
    }));
  }

  public renderLogo(): void {

  }

  public renderTerminalWithCustomShaders(frameBuffers: Array<WebGLFramebuffer>, textureNums: Array<number>): void {
    const gl = this._gl;
    const verteces = this._vertices;
    const vao = this._vertexArrayObject;
    const attributesBuffer = this._attributesBuffer;

    const width = this._dimensions.device.canvas.width;
    const height = this._dimensions.device.canvas.height;
    const width_height = new Float32Array([width, height]);
    const unit_width = width / this._terminal.cols;
    const unit_height = height / this._terminal.rows;
    const unit = new Float32Array([unit_width, unit_height]);
    const scanline_time_speed = 5000;
    const scanline_time_period = 3.1415 * 2.0;
    const scanline_time = ((new Date().getTime() % scanline_time_speed) / scanline_time_speed) * scanline_time_period;

    function drawFrom(from: number, to: number | null, location: WebGLUniformLocation) {
      gl.uniform1i(location, textureNums[from]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, to != null ? frameBuffers[to]: null);
    }

    function draw() {
      gl.drawElementsInstanced(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_BYTE, 0, verteces.count);
    }

    const time_passed = ((new Date()).getTime() - this._start.getTime()) / 1000.0;
    if (time_passed < 2.5) {
      let rotation = (time_passed - 0.7) * 1.2;
      if (rotation < 0.0) {
        rotation = 0.0;
      } else if (rotation > Math.PI/2.0) {
        rotation = Math.PI/2.0;
      }
      rotation += Math.PI/2.0;
      const logo_size = 300.0;
      let matrix = Mat.yRotate(Mat.scaling(logo_size/width, logo_size/height, 0.5), rotation);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffers[0]);
      this.renderBackgrounds()
      gl.useProgram(this._logoProgram);
      gl.bindVertexArray(this._logoVertexArrayObject);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._logoAttributesBuffer);
      gl.uniformMatrix4fv(this._logoProjectionLocation, false, matrix);

      gl.drawArrays(gl.TRIANGLES, 0, AmethystModel.points.length/3)
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, attributesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verteces.attributes, gl.DYNAMIC_DRAW);



    ///////////////
    // Apply scanlines
    ///////////////
    gl.useProgram(this._scanlineProgram);
    drawFrom(0, 2, this._scanlineImageLocation);
    gl.uniformMatrix4fv(this._scanlineProjectionLocation, false, PROJECTION_MATRIX);
    gl.uniform2fv(this._scanlineUnitLocation, unit);
    gl.uniform2fv(this._scanlineResolutionLocation, width_height);
    gl.uniform1f(this._scanlineTimeLocation, scanline_time*2.0);
    draw();

    ///////////////
    // Put the bright spots in  another place
    ///////////////
    gl.useProgram(this._thresholdProgram);
    drawFrom(2, 1, this._thresholdImageLocation);
    gl.uniformMatrix4fv(this._thresholdProjectionLocation, false, PROJECTION_MATRIX);
    draw();

    ///////////////
    // Blur the bright bits
    ///////////////

    // TODO; Blur is resolution dependent. Might try to fix
    // Rendered terminal starts in 'A'
    gl.useProgram(this._kawaseProgram);
    drawFrom(1, 3, this._kawaseImageLocation);
    gl.uniformMatrix4fv(this._kawaseProjectionLocation, false, PROJECTION_MATRIX);
    gl.uniform2fv(this._kawaseResolutionLocation, width_height);
    gl.uniform1f(this._kawaseBlursizeLocation, 1.0);
    draw();

    drawFrom(3, 1, this._kawaseImageLocation);
    gl.uniform1f(this._kawaseBlursizeLocation, 3.0);
    draw();

    drawFrom(1, 3, this._kawaseImageLocation);
    gl.uniform1f(this._kawaseBlursizeLocation, 5.0);
    draw();

    drawFrom(3, 1, this._kawaseImageLocation);
    gl.uniform1f(this._kawaseBlursizeLocation, 5.0);
    draw();

    drawFrom(1, 3, this._kawaseImageLocation);
    gl.uniform1f(this._kawaseBlursizeLocation, 7.0);
    draw();


    ///////////////////
    // Recombine
    ///////////////////
    gl.useProgram(this._customProgram);
    drawFrom(2, null, this._customBaseImageLocation);
    gl.uniform1i(this._customGlowImageLocation, textureNums[3]);

    gl.uniformMatrix4fv(this._customProjectionLocation, false, PROJECTION_MATRIX);

    draw();
  }

  public renderBackgrounds(): void {
    this._renderVertices(this._vertices);
  }

  public renderCursor(): void {
    this._renderVertices(this._verticesCursor);
  }

  private _renderVertices(vertices: Vertices): void {
    const gl = this._gl;

    gl.useProgram(this._program);

    gl.bindVertexArray(this._vertexArrayObject);

    gl.uniformMatrix4fv(this._projectionLocation, false, PROJECTION_MATRIX);

    // Bind attributes buffer and draw
    gl.bindBuffer(gl.ARRAY_BUFFER, this._attributesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices.attributes, gl.DYNAMIC_DRAW);
    gl.drawElementsInstanced(this._gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_BYTE, 0, vertices.count);
  }

  public handleResize(): void {
    this._updateViewportRectangle();
  }

  public setDimensions(dimensions: IRenderDimensions): void {
    this._dimensions = dimensions;
  }

  private _updateCachedColors(colors: ReadonlyColorSet): void {
    this._bgFloat = this._colorToFloat32Array(colors.background);
    this._cursorFloat = this._colorToFloat32Array(colors.cursor);
  }

  private _updateViewportRectangle(): void {
    // Set first rectangle that clears the screen
    this._addRectangleFloat(
      this._vertices.attributes,
      0,
      0,
      0,
      this._terminal.cols * this._dimensions.device.cell.width,
      this._terminal.rows * this._dimensions.device.cell.height,
      this._bgFloat
    );
  }

  public updateBackgrounds(model: IRenderModel): void {
    const terminal = this._terminal;
    const vertices = this._vertices;

    // Declare variable ahead of time to avoid garbage collection
    let rectangleCount = 1;
    let y: number;
    let x: number;
    let currentStartX: number;
    let currentBg: number;
    let currentFg: number;
    let currentInverse: boolean;
    let modelIndex: number;
    let bg: number;
    let fg: number;
    let inverse: boolean;
    let offset: number;

    for (y = 0; y < terminal.rows; y++) {
      currentStartX = -1;
      currentBg = 0;
      currentFg = 0;
      currentInverse = false;
      for (x = 0; x < terminal.cols; x++) {
        modelIndex = ((y * terminal.cols) + x) * RENDER_MODEL_INDICIES_PER_CELL;
        bg = model.cells[modelIndex + RENDER_MODEL_BG_OFFSET];
        fg = model.cells[modelIndex + RENDER_MODEL_FG_OFFSET];
        inverse = !!(fg & FgFlags.INVERSE);
        if (bg !== currentBg || (fg !== currentFg && (currentInverse || inverse))) {
          // A rectangle needs to be drawn if going from non-default to another color
          if (currentBg !== 0 || (currentInverse && currentFg !== 0)) {
            offset = rectangleCount++ * INDICES_PER_RECTANGLE;
            this._updateRectangle(vertices, offset, currentFg, currentBg, currentStartX, x, y);
          }
          currentStartX = x;
          currentBg = bg;
          currentFg = fg;
          currentInverse = inverse;
        }
      }
      // Finish rectangle if it's still going
      if (currentBg !== 0 || (currentInverse && currentFg !== 0)) {
        offset = rectangleCount++ * INDICES_PER_RECTANGLE;
        this._updateRectangle(vertices, offset, currentFg, currentBg, currentStartX, terminal.cols, y);
      }
    }
    vertices.count = rectangleCount;
  }

  public updateCursor(model: IRenderModel): void {
    const vertices = this._verticesCursor;
    const cursor = model.cursor;
    if (!cursor || cursor.style === 'block') {
      vertices.count = 0;
      return;
    }

    let offset: number;
    let rectangleCount = 0;

    if (cursor.style === 'bar' || cursor.style === 'outline') {
      // Left edge
      offset = rectangleCount++ * INDICES_PER_RECTANGLE;
      this._addRectangleFloat(
        vertices.attributes,
        offset,
        cursor.x * this._dimensions.device.cell.width,
        cursor.y * this._dimensions.device.cell.height,
        cursor.style === 'bar' ? cursor.dpr * cursor.cursorWidth : cursor.dpr,
        this._dimensions.device.cell.height,
        this._cursorFloat
      );
    }
    if (cursor.style === 'underline' || cursor.style === 'outline') {
      // Bottom edge
      offset = rectangleCount++ * INDICES_PER_RECTANGLE;
      this._addRectangleFloat(
        vertices.attributes,
        offset,
        cursor.x * this._dimensions.device.cell.width,
        (cursor.y + 1) * this._dimensions.device.cell.height - cursor.dpr,
        cursor.width * this._dimensions.device.cell.width,
        cursor.dpr,
        this._cursorFloat
      );
    }
    if (cursor.style === 'outline') {
      // Top edge
      offset = rectangleCount++ * INDICES_PER_RECTANGLE;
      this._addRectangleFloat(
        vertices.attributes,
        offset,
        cursor.x * this._dimensions.device.cell.width,
        cursor.y * this._dimensions.device.cell.height,
        cursor.width * this._dimensions.device.cell.width,
        cursor.dpr,
        this._cursorFloat
      );
      // Right edge
      offset = rectangleCount++ * INDICES_PER_RECTANGLE;
      this._addRectangleFloat(
        vertices.attributes,
        offset,
        (cursor.x + cursor.width) * this._dimensions.device.cell.width - cursor.dpr,
        cursor.y * this._dimensions.device.cell.height,
        cursor.dpr,
        this._dimensions.device.cell.height,
        this._cursorFloat
      );
    }

    vertices.count = rectangleCount;
  }

  private _updateRectangle(vertices: Vertices, offset: number, fg: number, bg: number, startX: number, endX: number, y: number): void {
    if (fg & FgFlags.INVERSE) {
      switch (fg & Attributes.CM_MASK) {
        case Attributes.CM_P16:
        case Attributes.CM_P256:
          $rgba = this._themeService.colors.ansi[fg & Attributes.PCOLOR_MASK].rgba;
          break;
        case Attributes.CM_RGB:
          $rgba = (fg & Attributes.RGB_MASK) << 8;
          break;
        case Attributes.CM_DEFAULT:
        default:
          $rgba = this._themeService.colors.foreground.rgba;
      }
    } else {
      switch (bg & Attributes.CM_MASK) {
        case Attributes.CM_P16:
        case Attributes.CM_P256:
          $rgba = this._themeService.colors.ansi[bg & Attributes.PCOLOR_MASK].rgba;
          break;
        case Attributes.CM_RGB:
          $rgba = (bg & Attributes.RGB_MASK) << 8;
          break;
        case Attributes.CM_DEFAULT:
        default:
          $rgba = this._themeService.colors.background.rgba;
      }
    }

    if (vertices.attributes.length < offset + 4) {
      vertices.attributes = expandFloat32Array(vertices.attributes, this._terminal.rows * this._terminal.cols * INDICES_PER_RECTANGLE);
    }
    $x1 = startX * this._dimensions.device.cell.width;
    $y1 = y * this._dimensions.device.cell.height;
    $r = (($rgba >> 24) & 0xFF) / 255;
    $g = (($rgba >> 16) & 0xFF) / 255;
    $b = (($rgba >> 8 ) & 0xFF) / 255;
    $a = 1;

    this._addRectangle(vertices.attributes, offset, $x1, $y1, (endX - startX) * this._dimensions.device.cell.width, this._dimensions.device.cell.height, $r, $g, $b, $a);
  }

  private _addRectangle(array: Float32Array, offset: number, x1: number, y1: number, width: number, height: number, r: number, g: number, b: number, a: number): void {
    array[offset    ] = x1 / this._dimensions.device.canvas.width;
    array[offset + 1] = y1 / this._dimensions.device.canvas.height;
    array[offset + 2] = width / this._dimensions.device.canvas.width;
    array[offset + 3] = height / this._dimensions.device.canvas.height;
    array[offset + 4] = r;
    array[offset + 5] = g;
    array[offset + 6] = b;
    array[offset + 7] = a;
  }

  private _addRectangleFloat(array: Float32Array, offset: number, x1: number, y1: number, width: number, height: number, color: Float32Array): void {
    array[offset    ] = x1 / this._dimensions.device.canvas.width;
    array[offset + 1] = y1 / this._dimensions.device.canvas.height;
    array[offset + 2] = width / this._dimensions.device.canvas.width;
    array[offset + 3] = height / this._dimensions.device.canvas.height;
    array[offset + 4] = color[0];
    array[offset + 5] = color[1];
    array[offset + 6] = color[2];
    array[offset + 7] = color[3];
  }

  private _colorToFloat32Array(color: IColor): Float32Array {
    return new Float32Array([
      ((color.rgba >> 24) & 0xFF) / 255,
      ((color.rgba >> 16) & 0xFF) / 255,
      ((color.rgba >> 8 ) & 0xFF) / 255,
      ((color.rgba      ) & 0xFF) / 255
    ]);
  }
}
