import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadFixture(name: string): string {
  const fixturePath = resolve(process.cwd(), "test", "fixtures", name);
  return readFileSync(fixturePath, "utf8");
}
