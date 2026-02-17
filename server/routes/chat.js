const express = require("express");
const { generateReply } = require("../ai/llmClient");

const sessions = {};

const lessonSystemPrompt =
	'You are a Grade 6 math tutor. Respond ONLY in valid JSON. If mode is lesson, respond in this format: {"type": "lesson", "topic": string, "concepts": string[], "examples": [{"problem": string, "solution_steps": string[], "final_answer": string}]}. Explain the topic clearly, cover key concepts, and provide 2-3 worked examples. Keep explanations concise but complete. Do not include text outside JSON.';

const practiceSystemPrompt =
	'You are a Grade 6 math tutor. Respond ONLY in valid JSON. JSON format: {"final_answer": string, "steps": string[], "explanation": string}. Keep explanation under 60 words. Do not include text outside JSON.';

const router = express.Router();

router.post("/", async (req, res) => {
	try {
		const { sessionId, message, topic } = req.body;

		if (!sessionId || typeof sessionId !== "string") {
			return res.status(400).json({ error: "sessionId is required" });
		}

		if ((message && typeof message !== "string") || (!message && !topic)) {
			return res.status(400).json({ error: "message or topic is required" });
		}

		if (!sessions[sessionId]) {
			sessions[sessionId] = {
				mode: "lesson",
				topic: topic || "arithmetic",
				difficulty: "easy",
				lessonStarted: false,
				problemsSolved: 0,
				correctAnswers: 0,
			};
		}

		if (topic) {
			sessions[sessionId].topic = topic;
		}

		const studentState = sessions[sessionId];

		if (!studentState.lessonStarted) {
			studentState.topic = message;
			studentState.lessonStarted = true;
			studentState.mode = "lesson";

			const lessonMessages = [
				{ role: "system", content: lessonSystemPrompt },
				{
					role: "user",
					content: `Explain the topic: ${studentState.topic} for Grade 6 level with examples.`,
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
			});
		}

		const messages = [
			{ role: "system", content: practiceSystemPrompt },
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
		if (studentState.mode === "assessment") {
			studentState.problemsSolved += 1;
			if (parsedReply.is_correct === true) {
				studentState.correctAnswers += 1;
			}
		} else {
			studentState.problemsSolved += 1;
			if (studentState.problemsSolved >= 5) {
				studentState.mode = "assessment";
			}
		}

		return res.status(200).json({
			...parsedReply,
			topic: studentState.topic,
		});
	} catch (error) {
		console.error("Chat route error:", error);
		const status = error.statusCode || 500;
		const message = error.message || "internal server error";
		return res.status(status).json({ error: message });
	}
});

module.exports = router;
