"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion } from "motion/react"

interface ServiceCheck {
	ok: boolean
	message?: string
}

interface SetupStatus {
	initialized: boolean
	userCount: number
	ready: boolean
	services: Record<string, ServiceCheck>
	version: string
}

const BACKEND_URL =
	process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"

export default function SetupPage() {
	const router = useRouter()
	const [status, setStatus] = useState<SetupStatus | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	// Form state
	const [name, setName] = useState("")
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [confirmPassword, setConfirmPassword] = useState("")
	const [creating, setCreating] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)

	const fetchStatus = useCallback(async () => {
		try {
			setLoading(true)
			const resp = await fetch(`${BACKEND_URL}/setup/status`, {
				credentials: "include",
			})
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
			const data = (await resp.json()) as SetupStatus
			setStatus(data)
			setError(null)

			// If already initialized, redirect to login
			if (data.initialized) {
				router.replace("/login")
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Cannot connect to backend",
			)
		} finally {
			setLoading(false)
		}
	}, [router])

	useEffect(() => {
		fetchStatus()
	}, [fetchStatus])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setFormError(null)

		if (password !== confirmPassword) {
			setFormError("Passwords do not match")
			return
		}

		if (password.length < 8) {
			setFormError("Password must be at least 8 characters")
			return
		}

		setCreating(true)
		try {
			const resp = await fetch(`${BACKEND_URL}/setup/init`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ name, email, password }),
			})

			const data = await resp.json()

			if (!resp.ok) {
				setFormError(data.error || "Setup failed")
				return
			}

			// Success — redirect to onboarding
			router.push("/onboarding/welcome?step=input")
		} catch (err) {
			setFormError(
				err instanceof Error ? err.message : "Cannot connect to backend",
			)
		} finally {
			setCreating(false)
		}
	}

	return (
		<main className="min-h-screen bg-[#030912] text-white flex items-center justify-center p-4">
			<motion.div
				className="w-full max-w-lg"
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5 }}
			>
				{/* Header */}
				<div className="text-center mb-8">
					<h1 className="text-4xl font-bold mb-2">
						Funes Setup
					</h1>
					<p className="text-gray-400">
						Welcome! Let&apos;s get your self-hosted memory system ready.
					</p>
				</div>

				{/* System Status Card */}
				<div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 mb-6">
					<h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
						<span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
						System Status
					</h2>

					{loading && !status && (
						<div className="text-gray-400 text-sm animate-pulse">
							Checking services...
						</div>
					)}

					{error && !status && (
						<div className="text-red-400 text-sm">
							<p className="font-medium">Cannot reach backend</p>
							<p className="text-gray-500 mt-1">
								Make sure <code className="text-gray-400">docker compose up</code> is running
								and the API is accessible at{" "}
								<code className="text-gray-400">{BACKEND_URL}</code>
							</p>
							<button
								type="button"
								onClick={fetchStatus}
								className="mt-3 text-blue-400 hover:text-blue-300 text-sm underline"
							>
								Retry
							</button>
						</div>
					)}

					{status && (
						<div className="space-y-3">
							{Object.entries(status.services).map(([name, check]) => (
								<ServiceRow key={name} name={name} check={check} />
							))}
						</div>
					)}
				</div>

				{/* Create Admin Account */}
				{status && !status.initialized && status.services.database?.ok && (
					<motion.div
						className="rounded-xl border border-gray-800 bg-gray-900/50 p-6"
						initial={{ opacity: 0, y: 10 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.2 }}
					>
						<h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
							<span className="inline-block w-2 h-2 rounded-full bg-green-500" />
							Create Admin Account
						</h2>

						<form onSubmit={handleSubmit} className="space-y-4">
							<div>
								<label
									htmlFor="name"
									className="block text-sm text-gray-400 mb-1"
								>
									Name
								</label>
								<input
									id="name"
									type="text"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="Your name"
									className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
								/>
							</div>

							<div>
								<label
									htmlFor="email"
									className="block text-sm text-gray-400 mb-1"
								>
									Email <span className="text-red-400">*</span>
								</label>
								<input
									id="email"
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="admin@example.com"
									required
									className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
								/>
							</div>

							<div>
								<label
									htmlFor="password"
									className="block text-sm text-gray-400 mb-1"
								>
									Password <span className="text-red-400">*</span>
								</label>
								<input
									id="password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="Min. 8 characters"
									required
									minLength={8}
									className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
								/>
							</div>

							<div>
								<label
									htmlFor="confirmPassword"
									className="block text-sm text-gray-400 mb-1"
								>
									Confirm Password <span className="text-red-400">*</span>
								</label>
								<input
									id="confirmPassword"
									type="password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									placeholder="Repeat password"
									required
									minLength={8}
									className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
								/>
							</div>

							{formError && (
								<div className="text-red-400 text-sm bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
									{formError}
								</div>
							)}

							<button
								type="submit"
								disabled={creating || !email || !password}
								className="w-full py-2.5 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
								style={{
									background:
										"linear-gradient(182deg, #0ff0d2 -91%, #5bd3fb -67%, #1e0ff0 95%)",
									boxShadow:
										"1px 1px 2px 0px #1A88FF inset, 0 2px 10px 0 rgba(5, 1, 0, 0.20)",
								}}
							>
								{creating ? "Creating account..." : "Create Admin & Start"}
							</button>
						</form>

						{!status.services.redis?.ok && (
							<p className="text-yellow-500/80 text-xs mt-4">
								Note: Redis is not available. You can still use Funes, but the
								document processing pipeline will be disabled until Redis is
								running.
							</p>
						)}

						{!status.services.ollama?.ok && (
							<p className="text-gray-500 text-xs mt-2">
								Tip: To enable AI chat, set up Ollama with{" "}
								<code className="text-gray-400">
									docker compose --profile with-ollama up
								</code>
							</p>
						)}
					</motion.div>
				)}

				{/* Already initialized */}
				{status?.initialized && (
					<div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 text-center">
						<p className="text-gray-400 mb-3">
							Funes is already set up with {status.userCount} user(s).
						</p>
						<a
							href="/login"
							className="text-blue-400 hover:text-blue-300 underline"
						>
							Go to login
						</a>
					</div>
				)}

				{/* Version footer */}
				{status && (
					<p className="text-center text-gray-600 text-xs mt-6">
						Funes v{status.version} — Self-Hosted AI Memory
					</p>
				)}
			</motion.div>
		</main>
	)
}

function ServiceRow({ name, check }: { name: string; check: ServiceCheck }) {
	const labels: Record<string, string> = {
		database: "PostgreSQL",
		redis: "Redis",
		ollama: "Ollama (LLM)",
		firecrawl: "Firecrawl (Scraping)",
		ocr: "OCR (Image/PDF)",
	}

	const isOptional = name === "ollama" || name === "firecrawl" || name === "ocr"

	return (
		<div className="flex items-center justify-between text-sm">
			<div className="flex items-center gap-2">
				<span
					className={`inline-block w-2 h-2 rounded-full ${
						check.ok
							? "bg-green-500"
							: isOptional
								? "bg-gray-600"
								: "bg-red-500"
					}`}
				/>
				<span className="text-gray-300">
					{labels[name] || name}
					{isOptional && (
						<span className="text-gray-600 ml-1">(optional)</span>
					)}
				</span>
			</div>
			<span
				className={`text-xs ${check.ok ? "text-green-400" : isOptional ? "text-gray-600" : "text-red-400"}`}
			>
				{check.ok ? "Connected" : check.message || "Not available"}
			</span>
		</div>
	)
}
