import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const PANEL_DIRS = [
	'devtools',
	'panel',
	'panel-touch-viz',
	'panel-color-audit',
	'panel-reading-order',
	'panel-states',
	'grant-access'
];

function copyExtensionFiles() {
	return {
		name: 'copy-extension-files',
		closeBundle() {
			const dist = resolve(__dirname, 'dist');

			cpSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'));
			cpSync(resolve(__dirname, 'src/icons'), resolve(dist, 'icons'), { recursive: true });

			const srcDir = resolve(dist, 'src');
			if (existsSync(srcDir)) {
				for (const dir of PANEL_DIRS) {
					const htmlSrc = join(srcDir, dir, `${dir}.html`);
					const htmlDest = join(dist, dir, `${dir}.html`);
					if (existsSync(htmlSrc)) {
						let html = readFileSync(htmlSrc, 'utf-8');
						html = html.replaceAll('../../', '../');
						writeFileSync(htmlDest, html);
					}
				}
				rmSync(srcDir, { recursive: true, force: true });
			}
		}
	};
}

export default defineConfig({
	plugins: [svelte(), tailwindcss(), copyExtensionFiles()],
	base: './',
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				devtools: resolve(__dirname, 'src/devtools/devtools.html'),
				panel: resolve(__dirname, 'src/panel/panel.html'),
				'panel-touch-viz': resolve(__dirname, 'src/panel-touch-viz/panel-touch-viz.html'),
				'panel-color-audit': resolve(__dirname, 'src/panel-color-audit/panel-color-audit.html'),
				'panel-reading-order': resolve(
					__dirname,
					'src/panel-reading-order/panel-reading-order.html'
				),
				'panel-states': resolve(__dirname, 'src/panel-states/panel-states.html'),
				'grant-access': resolve(__dirname, 'src/grant-access/grant-access.html'),
				'service-worker': resolve(__dirname, 'src/background/service-worker.ts')
			},
			output: {
				entryFileNames: (chunk) => {
					if (chunk.name === 'service-worker') return 'background/service-worker.js';
					return '[name]/[name].js';
				},
				chunkFileNames: 'shared/[name]-[hash].js',
				assetFileNames: 'assets/[name]-[hash][extname]'
			}
		},
		target: 'esnext',
		minify: false
	}
});
