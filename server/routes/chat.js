/**
 * Update session logic:
 *
 * If session does not exist:
 *   - Create new session with:
 *     {
 *       mode: "lesson",
 *       topic: null,
 *       difficulty: null,
 *       lessonStarted: false
 *     }
 *
 * If lessonStarted is false:
 *   - Run classifyUserIntent(message)
 *   - Save topic and difficulty in session
 *   - Generate lesson for that topic
 *   - Set lessonStarted = true
 */

/**
 * If classification.type === "lesson_request":
 *
 * Build LLM prompt to:
 * - Explain the detected topic clearly
 * - Match detected difficulty level
 * - Provide:
 *     - Key concepts (array)
 *     - 2–3 worked examples
 *
 * JSON format:
 * {
 *   "type": "lesson",
 *   "topic": string,
 *   "difficulty": string,
 *   "concepts": string[],
 *   "examples": [
 *     {
 *       "problem": string,
 *       "solution_steps": string[],
 *       "final_answer": string
 *     }
 *   ]
 * }
 *
 * Ensure JSON is complete.
 */

/**
 * If classification.type === "practice_question":
 *   - Solve problem normally (existing logic)
 *
 * If classification.type === "doubt":
 *   - Explain concept related to current session topic
 */

const express = require("express");
const { classifyUserIntent, generateReply } = require("../ai/llmClient");

const sessions = {};

const lessonSystemPrompt =
	'You are a Grade 6 tutor. Respond ONLY in valid JSON. If mode is lesson, respond in this format: {"type": "lesson", "topic": string, "difficulty": string, "concepts": string[], "examples": [{"problem": string, "solution_steps": string[], "final_answer": string}]}. Explain the topic clearly, cover key concepts, and provide 2-3 worked examples. Keep explanations concise but complete. Do not include text outside JSON.';

const practiceSystemPrompt =
	'You are a Grade 6 tutor. Respond ONLY in valid JSON. JSON format: {"final_answer": string, "steps": string[], "explanation": string}. Keep explanation under 60 words. Do not include text outside JSON.';

const doubtSystemPrompt =
	'You are a Grade 6 tutor. Respond ONLY in valid JSON. JSON format: {"final_answer": string, "steps": string[], "explanation": string}. Explain the concept clearly and concisely. Do not include text outside JSON.';

const router = express.Router();

router.post("/", async (req, res) => {
	try {
		const { sessionId, message } = req.body;

		if (!sessionId || typeof sessionId !== "string") {
			return res.status(400).json({ error: "sessionId is required" });
		}

		if (!message || typeof message !== "string") {
			return res.status(400).json({ error: "message is required" });
		}

		if (!sessions[sessionId]) {
			sessions[sessionId] = {
				mode: "lesson",
				topic: null,
				difficulty: null,
				lessonStarted: false,
			};
		}

		const studentState = sessions[sessionId];

		let classification;
		if (!studentState.lessonStarted) {
			classification = await classifyUserIntent(message);
			studentState.topic = classification.topic || studentState.topic;
			studentState.difficulty = classification.difficulty || "beginner";
			studentState.lessonStarted = true;

			if (classification.type === "lesson_request") {
				studentState.mode = "lesson";

				const lessonMessages = [
					{ role: "system", content: lessonSystemPrompt },
					{
						role: "user",
						content: `Explain the topic: ${studentState.topic} for Grade 6 level with examples. Difficulty: ${studentState.difficulty}.`,
					},
				];

				let reply;
				let parsedReply;
				let lastParseError;
				for (let attempt = 1; attempt <= 3; attempt += 1) {
					reply = await generateReply(lessonMessages);
					try {
						parsedReply = JSON.parse(reply);
						lastParseError = null;
						break;
					} catch (parseError) {
						lastParseError = parseError;
						console.error(
							`Failed to parse LLM JSON (attempt ${attempt}):`,
							parseError,
						);
					}
				}

				if (!parsedReply) {
					console.error("All JSON parse attempts failed:", lastParseError);
					return res
						.status(502)
						.json({ error: "Server issue. Please try again in some time" });
				}

				return res.status(200).json({
					...parsedReply,
					topic: studentState.topic,
					difficulty: studentState.difficulty,
				});
			}

			studentState.mode =
				classification.type === "practice_question" ? "practice" : "lesson";
		}

		classification = classification || (await classifyUserIntent(message));
		if (classification.topic) {
			studentState.topic = classification.topic;
		}
		if (classification.difficulty) {
			studentState.difficulty = classification.difficulty;
		}

		const systemPrompt =
			classification.type === "doubt"
				? doubtSystemPrompt
				: practiceSystemPrompt;

		const messages = [
			{ role: "system", content: systemPrompt },
			{
				role: "user",
				content: `
Mode: ${studentState.mode}
Topic: ${studentState.topic}
Difficulty: ${studentState.difficulty}

User input:
${message}
`,
			},
		];

		let reply;
		let parsedReply;
		let lastParseError;
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			reply = await generateReply(messages);
			try {
				parsedReply = JSON.parse(reply);
				lastParseError = null;
				break;
			} catch (parseError) {
				lastParseError = parseError;
				console.error(
					`Failed to parse LLM JSON (attempt ${attempt}):`,
					parseError,
				);
			}
		}

		if (!parsedReply) {
			console.error("All JSON parse attempts failed:", lastParseError);
			return res
				.status(502)
				.json({ error: "Server issue. Please try again in some time" });
		}
		return res.status(200).json({
			...parsedReply,
			topic: studentState.topic,
			difficulty: studentState.difficulty,
		});
	} catch (error) {
		console.error("Chat route error:", error);
		const status = error.statusCode || 500;
		const message = error.message || "internal server error";
		return res.status(status).json({ error: message });
	}
});

module.exports = router;
