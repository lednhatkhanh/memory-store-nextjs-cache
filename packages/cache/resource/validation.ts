import { isPlainObject } from "es-toolkit";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}
