export const MISSING_DEPENDENCY_MESSAGE =
	"{converter} recognized the input as a potential {extension} file, but the dependencies needed to read {extension} files have not been installed."

export class MarkItDownError extends Error {
	constructor(message: string) {
		super(message)
		this.name = new.target.name
	}
}

export class MissingDependencyError extends MarkItDownError {}

export class UnsupportedFormatError extends MarkItDownError {}

export class FailedConversionAttempt {
	constructor(
		public readonly converter: string,
		public readonly error?: unknown,
	) {}
}

export class FileConversionError extends MarkItDownError {
	constructor(
		message = "File conversion failed.",
		public readonly attempts: FailedConversionAttempt[] = [],
	) {
		super(message)
	}

	static fromAttempts(
		attempts: FailedConversionAttempt[],
	): FileConversionError {
		if (attempts.length === 0) {
			return new FileConversionError()
		}

		const details = attempts
			.map((attempt) => {
				if (attempt.error instanceof Error) {
					return ` - ${attempt.converter} threw ${attempt.error.name}: ${attempt.error.message}`
				}

				return ` - ${attempt.converter} failed without structured error details.`
			})
			.join("\n")

		return new FileConversionError(
			`File conversion failed after ${attempts.length} attempts:\n${details}`,
			attempts,
		)
	}
}
