const express = require("express");

const { generateReply } = require("../ai/llmClient");

const conversation = [
	{
		role: "system",
		content: `
		You are a strict Grade 6 math tutor.
		Rules:
		- Only solve mathematical problems.
		- If input is not a math problem, respond exactly:
			{"is_math_question": false}
		- Always respond in valid JSON format.
		- Never include extra text outside JSON.

		JSON format:
		{
			"is_math_question": boolean,
			"final_answer": string,
			"steps": string[],
			"explanation": string
		}

		Constraints:
		- Keep explanation under 30 words.
		- Steps must be concise.
		`,
	},
];

const router = express.Router();

router.post("/", async (req, res) => {
	try {
		const { message } = req.body;

		if (!message || typeof message !== "string") {
			return res.status(400).json({ error: "message is required" });
		}
		conversation.push({ role: "user", content: message });

		const reply = await generateReply(conversation);
		let parsedReply;
		try {
			parsedReply = JSON.parse(reply);
		} catch (parseError) {
			console.error("Failed to parse LLM JSON:", parseError);
			return res.status(502).json({ error: "Invalid JSON from LLM" });
		}

		if (!parsedReply.is_math_question) {
			return res.status(400).json({ error: "Not a math question" });
		}

		conversation.push({ role: "assistant", content: reply });

		console.log("After generating AI response", conversation);

		if (conversation.length > 3) {
			conversation.splice(1, conversation.length - 2);
		}

		return res.status(200).json(parsedReply);
	} catch (error) {
		console.error("Chat route error:", error);
		const status = error.statusCode || 500;
		const message = error.message || "internal server error";
		return res.status(status).json({ error: message });
	}
});

module.exports = router;
