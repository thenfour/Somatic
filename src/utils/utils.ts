export function assert(
    condition: boolean = true, message: string = 'Assertion failed') {
  if (!condition) {
    console.error('Assertion failed:', message);
    throw new Error(message);
  }
};

export const clamp = (v: number, min: number, max: number) =>
    Math.min(Math.max(v, min), max);


export function IsNullOrWhitespace(str: string|null|undefined): boolean {
  return str === null || str === undefined || str.trim().length === 0;
}
