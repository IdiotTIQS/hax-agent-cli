/** Docker image management. Ported from OpenHarness sandbox/docker_image.py */
import { execSync } from "child_process";

const DEFAULT_IMAGE = "node:18-alpine";
const IMAGE_TAG = "hax-sandbox:latest";

interface BuildOptions {
  image?: string;
}

interface BuildResult {
  ok: boolean;
  image: string;
  error?: string;
}

function buildSandboxImage(opts: BuildOptions = {}): BuildResult {
  const image = opts.image || DEFAULT_IMAGE;
  try {
    execSync(`docker pull ${image}`, { encoding: "utf-8", timeout: 120000, stdio: "pipe" });
    return { ok: true, image };
  } catch (err) {
    return { ok: false, error: (err as Error).message, image };
  }
}

function getImageName(): string { return process.env.HAX_SANDBOX_IMAGE || DEFAULT_IMAGE; }

export { DEFAULT_IMAGE, IMAGE_TAG, buildSandboxImage, getImageName };
