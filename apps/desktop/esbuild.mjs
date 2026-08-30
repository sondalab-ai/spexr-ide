/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import esbuild from 'esbuild';

// onnxruntime-node ships multiple platform-specific .node binaries with the same
// filename, which makes esbuild fail with "Two output files share the same path".
// sharp is an optional dependency of @huggingface/transformers, pulled in only by
// image pipelines we never use (we run feature-extraction + text-generation); its
// platform-specific @img/* sub-packages break the bundle the same way.
// Both are required at runtime from node_modules instead.
nodeOptions.external = [...(nodeOptions.external ?? []), 'onnxruntime-node', 'sharp'];

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptions);
const electronContext = await esbuild.context(electronOptions);

if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
        electronContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
        await electronContext.rebuild();
        await electronContext.dispose();
    } catch {
        process.exit(1);
    }
}
