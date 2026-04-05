import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	typescript: {
		ignoreBuildErrors: true,
	},
	transpilePackages: [
		"@supermemory/memory-graph",
		"@tiptap/core",
		"@tiptap/react",
		"@tiptap/pm",
		"@tiptap/starter-kit",
		"@tiptap/extension-placeholder",
		"@tiptap/extension-link",
		"@tiptap/extension-image",
		"@tiptap/extension-task-list",
		"@tiptap/extension-task-item",
		"@tiptap/suggestion",
		"@tiptap/markdown",
	],
	experimental: {
		viewTransition: true,
	},
	poweredByHeader: false,
	skipTrailingSlashRedirect: true,
	async redirects() {
		return [
			{
				source: "/new",
				destination: "/",
				permanent: true,
			},
			{
				source: "/new/:path*",
				destination: "/:path*",
				permanent: true,
			},
		]
	},
}

export default nextConfig
