import path from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.browser.test.{ts,tsx}"],
		browser: {
			enabled: true,
			provider: playwright({
				launch: {
					// Software WebGL so Pixi.js works in headless CI without a GPU.
					args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
				},
			}),
			headless: true,
			instances: [{ browser: "chromium" }],
		},
		testTimeout: 120_000,
		hookTimeout: 30_000,
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	assetsInclude: ["**/*.webm"],
	// Pre-bundle these so a cold cache doesn't trigger a mid-run Vite
	// dependency-optimization reload (Vite's own warning: "may cause tests to
	// fail, lead to flaky behaviour or duplicated test runs"). Needed once
	// AnnotationOverlay.tsx (react-rnd, clsx, tailwind-merge) was mounted via
	// @testing-library/react in a *.browser.test.tsx file.
	optimizeDeps: {
		include: [
			"react",
			"react/jsx-dev-runtime",
			"react-dom",
			"react-dom/client",
			"@testing-library/react",
			"react-rnd",
			"clsx",
			"tailwind-merge",
		],
	},
});
