import sharp from "sharp";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const svg = readFileSync(join(root, "public/icons/prowrite_logo.svg"), "utf-8");

const sizes = [16, 48, 128];

for (const size of sizes) {
  const png = svg.replace(
    '<svg width="128" height="128" viewBox="0 0 16 16"',
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16"`
  );

  await sharp(Buffer.from(png))
    .resize(size, size)
    .png()
    .toFile(join(root, `public/icons/icon-${size}.png`));

  console.log(`Generated icon-${size}.png`);
}
