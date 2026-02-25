/**
 * Create a new async function classifyUserIntent(message)
 *
 * This function should:
 * - Call the LLM
 * - Ask it to classify the user message into:
 *    "lesson_request" | "practice_question" | "doubt"
 * - Extract:
 *    topic (string)
 *    difficulty (beginner | intermediate | advanced)
 *
 * - Return JSON:
 *   {
 *     type: string,
 *     topic: string,
 *     difficulty: string
 *   }
 *
 * - Use low max_output_tokens (150)
 * - Respond only in JSON
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function classifyUserIntent(message) {
	if (!OPENAI_API_KEY) {
		const error = new Error("OPENAI_API_KEY is not set");
		error.statusCode = 500;
		throw error;
	}

	const input = [
		{
			role: "system",
			content:
				'Classify the user message into one of: lesson_request, practice_question, doubt. Extract topic and difficulty (beginner|intermediate|advanced). Respond ONLY in JSON: {"type": string, "topic": string, "difficulty": string}.',
		},
		{
			role: "user",
			content: message,
		},
	];

	const response = await fetch("https://api.openai.com/v1/responses", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${OPENAI_API_KEY}`,
		},
		body: JSON.stringify({
			model: "gpt-5-mini",
			input,
			reasoning: {
				effort: "low",
			},
			text: {
				verbosity: "low",
				format: {
					type: "text",
				},
			},
			max_output_tokens: 150,
		}),
	});

	if (!response.ok) {
		let errorDetail = "LLM API request failed";
		try {
			const errorBody = await response.json();
			errorDetail = errorBody?.error?.message || errorDetail;
		} catch (parseError) {
			// ignore parsing errors
		}

		const error = new Error(errorDetail);
		error.statusCode = response.status;
		throw error;
	}

	const data = await response.json();
	const content =
		data?.output_text ||
		data?.output
			?.flatMap((item) => item?.content || [])
			?.filter((contentItem) =>
				["output_text", "text", "refusal"].includes(contentItem?.type),
			)
			?.map(
				(contentItem) =>
					contentItem?.text ||
					contentItem?.refusal ||
					contentItem?.output_text ||
					contentItem?.content,
			)
			?.filter((text) => typeof text === "string" && text.trim().length > 0)
			?.join("\n");

	if (!content) {
		const error = new Error("LLM API returned empty response");
		error.statusCode = 502;
		throw error;
	}

	let parsed;
	try {
		parsed = JSON.parse(content);
	} catch (parseError) {
		const error = new Error("Invalid JSON from LLM classification");
		error.statusCode = 502;
		throw error;
	}

	return parsed;
}

async function generateReply(messages, attempt = 1) {
	if (!OPENAI_API_KEY) {
		const error = new Error("OPENAI_API_KEY is not set");
		error.statusCode = 500;
		throw error;
	}

	const input = messages.map((message) => ({
		role: message.role,
		content: message.content,
	}));

	const response = await fetch("https://api.openai.com/v1/responses", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${OPENAI_API_KEY}`,
		},
		body: JSON.stringify({
			model: "gpt-5-mini",
			input,
			reasoning: {
				effort: "low",
			},
			text: {
				verbosity: "low",
				format: {
					type: "text",
				},
			},
			max_output_tokens: attempt === 1 ? 800 : 1500,
		}),
	});

	if (!response.ok) {
		let errorDetail = "LLM API request failed";
		try {
			const errorBody = await response.json();
			errorDetail = errorBody?.error?.message || errorDetail;
		} catch (parseError) {
			// ignore parsing errors
		}

		const error = new Error(errorDetail);
		error.statusCode = response.status;
		throw error;
	}

	const data = await response.json();
	if (data?.usage) {
		console.log("LLM token usage:", {
			prompt_tokens: data.usage.input_tokens,
			completion_tokens: data.usage.output_tokens,
			total_tokens: data.usage.total_tokens,
		});
	}

	const content =
		data?.output_text ||
		data?.output
			?.flatMap((item) => item?.content || [])
			?.filter((contentItem) =>
				["output_text", "text", "refusal"].includes(contentItem?.type),
			)
			?.map(
				(contentItem) =>
					contentItem?.text ||
					contentItem?.refusal ||
					contentItem?.output_text ||
					contentItem?.content,
			)
			?.filter((text) => typeof text === "string" && text.trim().length > 0)
			?.join("\n");

	if (!content) {
		return "Sorry, I couldn't generate a response just now. Please try again.";
	}

	return content;
}

module.exports = {
	classifyUserIntent,
	generateReply,
};
