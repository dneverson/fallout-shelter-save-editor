// Typed contract for the JS Unity-YAML helper lib (unityYaml.mjs).
export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function readGuid(text: string): string | null;
export function refGuid(text: string, field: string): string | null;
export function readVec2(text: string, key: string): [number, number] | null;
export function walk(dir: string, out?: string[]): string[];
export function buildGuidToPath(dir: string, ext: string): Map<string, string>;
export function parseNguiAtlas(prefabText: string): Map<string, AtlasRect>;
export function pngSize(buf: Buffer): { w: number; h: number };
