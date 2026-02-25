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
const { classifyUserIntent, streamReply } = require("../ai/llmClient");

const sessions = {};

const lessonSystemPrompt =
	'You are a Grade 6 tutor. Respond ONLY in HTML (no markdown, no JSON). Return a single <div class="sw-response"> root. Use this structure: <section class="sw-block"><h4 class="sw-label">Topic</h4><div class="sw-value">...</div></section> and <section class="sw-block"><h4 class="sw-label">Difficulty</h4><div class="sw-value">...</div></section>. Include Concepts as <ul class="sw-list"><li>...</li></ul>. Include Examples as one or more <div class="sw-example"> blocks, each with <div class="sw-problem">, <ol class="sw-steps"><li>...</li></ol>, and <div class="sw-answer">Final answer: <strong>...</strong></div>. Keep explanations concise but complete. Do not include text outside the root div.';

const practiceSystemPrompt =
	'You are a Grade 6 tutor. Respond ONLY in HTML (no markdown, no JSON). Return a single <div class="sw-response"> root. Include Topic and Difficulty sections as in the lesson format. Then include Answer as <section class="sw-block"><h4 class="sw-label">Answer</h4><div class="sw-answer"><strong>...</strong></div></section> and Steps as <section class="sw-block"><h4 class="sw-label">Steps</h4><ol class="sw-steps"><li>...</li></ol></section>. Keep the answer clear and steps concise. Do not include text outside the root div.';

const doubtSystemPrompt =
	'You are a Grade 6 tutor. Respond ONLY in HTML (no markdown, no JSON). Return a single <div class="sw-response"> root. Include Topic and Difficulty sections as in the lesson format. Then include Answer and Steps sections like the practice format. Explain clearly and concisely. Do not include text outside the root div.';

const router = express.Router();

function writeSseEvent(res, eventName, data) {
	res.write(`event: ${eventName}\n`);
	const payload = typeof data === "string" ? data : JSON.stringify(data ?? "");
	const lines = payload.split(/\r?\n/);
	for (const line of lines) {
		res.write(`data: ${line}\n`);
	}
	res.write("\n");
}

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

		const abortController = new AbortController();
		const abortStream = () => {
			if (!abortController.signal.aborted) {
				abortController.abort();
			}
		};
		req.on("aborted", abortStream);
		res.on("close", () => {
			if (!res.writableEnded) {
				abortStream();
			}
		});

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

				res.status(200);
				res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
				res.setHeader("Cache-Control", "no-cache, no-transform");
				res.setHeader("Connection", "keep-alive");
				if (typeof res.flushHeaders === "function") {
					res.flushHeaders();
				}

				writeSseEvent(res, "meta", {
					mode: studentState.mode,
					topic: studentState.topic,
					difficulty: studentState.difficulty,
				});

				let fullText = "";
				try {
					fullText = await streamReply(lessonMessages, {
						signal: abortController.signal,
						onChunk: (chunk) => {
							writeSseEvent(res, "chunk", chunk);
						},
					});
				} catch (streamError) {
					if (
						abortController.signal.aborted ||
						streamError?.name === "AbortError"
					) {
						return res.end();
					}
					console.error("Streaming error:", streamError);
					if (!res.headersSent) {
						return res
							.status(streamError.statusCode || 500)
							.json({ error: streamError.message || "internal server error" });
					}
					writeSseEvent(res, "error", {
						message: streamError.message || "internal server error",
					});
					return res.end();
				}

				writeSseEvent(res, "done", {
					ok: Boolean(fullText.trim()),
					topic: studentState.topic,
					difficulty: studentState.difficulty,
				});
				return res.end();
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

		res.status(200);
		res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
		res.setHeader("Cache-Control", "no-cache, no-transform");
		res.setHeader("Connection", "keep-alive");
		if (typeof res.flushHeaders === "function") {
			res.flushHeaders();
		}

		writeSseEvent(res, "meta", {
			mode: studentState.mode,
			topic: studentState.topic,
			difficulty: studentState.difficulty,
		});

		let fullText = "";
		try {
			fullText = await streamReply(messages, {
				signal: abortController.signal,
				onChunk: (chunk) => {
					writeSseEvent(res, "chunk", chunk);
				},
			});
		} catch (streamError) {
			if (
				abortController.signal.aborted ||
				streamError?.name === "AbortError"
			) {
				return res.end();
			}
			console.error("Streaming error:", streamError);
			if (!res.headersSent) {
				return res
					.status(streamError.statusCode || 500)
					.json({ error: streamError.message || "internal server error" });
			}
			writeSseEvent(res, "error", {
				message: streamError.message || "internal server error",
			});
			return res.end();
		}

		writeSseEvent(res, "done", {
			ok: Boolean(fullText.trim()),
			topic: studentState.topic,
			difficulty: studentState.difficulty,
		});
		return res.end();
	} catch (error) {
		console.error("Chat route error:", error);
		const status = error.statusCode || 500;
		const message = error.message || "internal server error";
		return res.status(status).json({ error: message });
	}
});

module.exports = router;
