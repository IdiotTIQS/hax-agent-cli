/**
 * Image Tools — multimodal image processing for the agent.
 * Ported from OpenHarness tools/image_to_text_tool.py + image_generation_tool.py
 *
 * Tools:
 *   - image_to_text — extract text/description from images (vision)
 *   - image_generation — generate images from text descriptions
 */

import fs from "fs";
import path from "path";

// === Image to Text (Vision) ===

const imageToTextTool = {
  name: "image_to_text",
  description:
    "Analyze and describe the content of an image file. " +
    "Extracts text via OCR and provides a detailed description of visual content. " +
    "Supports PNG, JPEG, GIF, WebP, and BMP formats.",
  inputSchema: {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "Path to the image file to analyze",
      },
      prompt: {
        type: "string",
        description: "Specific question or task for the image analysis (e.g., 'What text is in this image?' or 'Describe the chart')",
      },
      max_tokens: {
        type: "number",
        default: 1000,
        description: "Maximum tokens for the response",
      },
    },
  },

  isReadOnly: () => true,

  async execute(args, ctx) {
    const imagePath = args.path;
    if (!imagePath) {
      return { ok: false, error: { code: "MISSING_PATH", message: "Image path is required" } };
    }

    const cwd = ctx.root || process.cwd();
    const fp = path.resolve(cwd, imagePath);

    // Validate file exists
    if (!fs.existsSync(fp)) {
      return { ok: false, error: { code: "FILE_NOT_FOUND", message: `Image not found: ${imagePath}` } };
    }

    // Validate format
    const ext = path.extname(fp).toLowerCase();
    const validExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
    if (!validExts.includes(ext)) {
      return { ok: false, error: { code: "INVALID_FORMAT", message: `Unsupported format: ${ext}. Supported: ${validExts.join(", ")}` } };
    }

    // Validate size
    const stat = fs.statSync(fp);
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (stat.size > maxSize) {
      return { ok: false, error: { code: "FILE_TOO_LARGE", message: `Image too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max 20MB)` } };
    }

    try {
      // Read and encode image
      const imageData = fs.readFileSync(fp);
      const base64 = imageData.toString("base64");
      const mediaType = _getMediaType(ext);

      // Build vision request
      const provider = ctx.provider || ctx.session?.provider;
      if (!provider) {
        return {
          ok: true,
          data: {
            path: imagePath,
            format: ext,
            size_bytes: stat.size,
            description: `[Vision unavailable] Image at "${imagePath}" - ${stat.size} bytes, format: ${ext}. Install a vision-capable provider to analyze images.`,
            text: null,
            mode: "stub",
          },
        };
      }

      // Try vision-capable API
      const prompt = args.prompt || "Describe this image in detail. Include any visible text, objects, people, colors, and layout.";
      const maxTokens = args.max_tokens || 1000;

      const visionResult = await _callVisionAPI(provider, base64, mediaType, prompt, maxTokens);

      return {
        ok: true,
        data: {
          path: imagePath,
          format: ext,
          size_bytes: stat.size,
          description: visionResult.text,
          raw: visionResult,
          mode: "vision",
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: { code: "VISION_ERROR", message: `Image analysis failed: ${err.message}` },
      };
    }
  },
};

// === Image Generation ===

const imageGenerationTool = {
  name: "image_generation",
  description:
    "Generate an image from a text description using AI. " +
    "The generated image is saved to the specified output path.",
  inputSchema: {
    type: "object",
    required: ["prompt", "output"],
    properties: {
      prompt: {
        type: "string",
        description: "Detailed text description of the image to generate",
      },
      output: {
        type: "string",
        description: "Output file path for the generated image (e.g., 'output.png')",
      },
      size: {
        type: "string",
        enum: ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"],
        default: "1024x1024",
        description: "Image size",
      },
      quality: {
        type: "string",
        enum: ["standard", "hd"],
        default: "standard",
        description: "Image quality (hd = better detail)",
      },
      style: {
        type: "string",
        enum: ["vivid", "natural"],
        default: "vivid",
        description: "Image style (vivid = hyper-real, natural = more realistic)",
      },
    },
  },

  isReadOnly: () => false,

  async execute(args, ctx) {
    const cwd = ctx.root || process.cwd();

    if (!args.prompt) {
      return { ok: false, error: { code: "MISSING_PROMPT", message: "Image generation prompt is required" } };
    }

    if (!args.output) {
      return { ok: false, error: { code: "MISSING_OUTPUT", message: "Output file path is required" } };
    }

    const outputPath = path.resolve(cwd, args.output);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
      const result = await _generateImage(args.prompt, {
        size: args.size || "1024x1024",
        quality: args.quality || "standard",
        style: args.style || "vivid",
      });

      if (result.ok) {
        // Save to file
        const imageBuffer = result.data;
        fs.writeFileSync(outputPath, imageBuffer);

        return {
          ok: true,
          data: {
            output: args.output,
            output_path: outputPath,
            prompt: args.prompt,
            size: args.size || "1024x1024",
            bytes: imageBuffer.length,
            message: `Image saved to ${args.output} (${(imageBuffer.length / 1024).toFixed(1)} KB)`,
          },
        };
      }

      return result;
    } catch (err) {
      return {
        ok: false,
        error: { code: "GENERATION_ERROR", message: `Image generation failed: ${err.message}` },
      };
    }
  },
};

// === Internal Helpers ===

function _getMediaType(ext) {
  const types = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return types[ext] || "image/png";
}

/**
 * Try to dynamically import an optional dependency.
 * Returns the module namespace or null if not installed.
 * @param {string} name - package name
 * @returns {Promise<any|null>}
 */
async function _tryRequire(name) {
  try {
    return await import(name);
  } catch (_) {
    return null;
  }
}

/**
 * Call the vision API through the provider.
 * Tries Anthropic first (native image support), falls back to OpenAI.
 */
async function _callVisionAPI(provider, base64Image, mediaType, prompt, maxTokens) {
  const Anthropic = await _tryRequire("@anthropic-ai/sdk");
  const OpenAI = await _tryRequire("openai");

  // Try Anthropic (native multimodal)
  if (Anthropic && provider.apiKey) {
    try {
      const client = new Anthropic.default
        ? new Anthropic.default({ apiKey: provider.apiKey, baseURL: provider.apiUrl || "https://api.anthropic.com" })
        : new Anthropic({ apiKey: provider.apiKey, baseURL: provider.apiUrl || "https://api.anthropic.com" });

      const response = await client.messages.create({
        model: provider.model || "claude-sonnet-4-6",
        max_tokens: maxTokens,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Image },
            },
            { type: "text", text: prompt },
          ],
        }],
      });

      const text = response.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      return { text, model: provider.model, provider: "anthropic" };
    } catch (err) {
      // Fall through to OpenAI
    }
  }

  // Try OpenAI (GPT-4 Vision)
  if (OpenAI) {
    try {
      const openaiApiKey = provider.apiKey || process.env.OPENAI_API_KEY;
      const openaiUrl = provider.apiUrl || "https://api.openai.com/v1";

      if (!openaiApiKey) {
        throw new Error("No OpenAI API key available");
      }

      const client = new OpenAI.default
        ? new OpenAI.default({ apiKey: openaiApiKey, baseURL: openaiUrl })
        : new OpenAI({ apiKey: openaiApiKey, baseURL: openaiUrl });

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: maxTokens,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64Image}` } },
          ],
        }],
      });

      const text = response.choices?.[0]?.message?.content || "";
      return { text, model: "gpt-4o", provider: "openai" };
    } catch (err) {
      throw new Error(`Vision API failed: ${err.message}`);
    }
  }

  throw new Error("No vision-capable provider available. Install @anthropic-ai/sdk or openai.");
}

/**
 * Generate an image using DALL-E (via OpenAI) or fallback.
 */
async function _generateImage(prompt, options = {}) {
  const OpenAI = await _tryRequire("openai");

  if (OpenAI) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not set. Set it to use DALL-E image generation.");
    }

    const client = new OpenAI.default
      ? new OpenAI.default({ apiKey })
      : new OpenAI({ apiKey });

    const response = await client.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: options.size || "1024x1024",
      quality: options.quality || "standard",
      style: options.style || "vivid",
      response_format: "b64_json",
    });

    const b64Data = response.data?.[0]?.b64_json;
    if (!b64Data) {
      throw new Error("No image data in response");
    }

    const imageBuffer = Buffer.from(b64Data, "base64");
    return { ok: true, data: imageBuffer };
  }

  // Fallback: generate a simple SVG placeholder
  const svg = _generatePlaceholderSVG(prompt, options);
  const buffer = Buffer.from(svg, "utf-8");
  return { ok: true, data: buffer, format: "svg" };
}

/**
 * Generate a placeholder SVG when no image generation API is available.
 */
function _generatePlaceholderSVG(prompt, options = {}) {
  const [w, h] = (options.size || "1024x1024").split("x").map(Number);
  const width = w || 1024;
  const height = h || 1024;
  const truncated = prompt.slice(0, 200);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea"/>
      <stop offset="100%" style="stop-color:#764ba2"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <text x="${width/2}" y="${height/2 - 20}" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="24" font-weight="bold">
    AI Generated Image
  </text>
  <text x="${width/2}" y="${height/2 + 20}" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-family="Arial,sans-serif" font-size="14">
    ${_escapeXml(truncated)}
  </text>
  <text x="${width/2}" y="${height/2 + 50}" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-family="Arial,sans-serif" font-size="12">
    (Set OPENAI_API_KEY for DALL-E generation)
  </text>
</svg>`;
}

function _escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export {
  imageToTextTool,
  imageGenerationTool,
};
