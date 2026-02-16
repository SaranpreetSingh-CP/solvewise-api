/**
 * Minimal AI Chatbot Backend
 *
 * Requirements:
 * - Use in-memory conversation array
 * - Initialize with system prompt (math tutor)
 * - On each request:
 *   1. Push user message to conversation
 *   2. Call LLM API
 *   3. Push assistant response
 *   4. Return response
 * - Use low temperature (0.2)
 * - Limit max tokens
 * - Handle errors gracefully
 */

const path = require("path");
const dotenv = require("dotenv");

const rootEnvPath = path.resolve(process.cwd(), ".env");
const serverEnvPath = path.resolve(__dirname, ".env");

dotenv.config({ path: rootEnvPath });

if (!process.env.OPENAI_API_KEY) {
	dotenv.config({ path: serverEnvPath });
}

const express = require("express");
const cors = require("cors");

const chatRoutes = require("./routes/chat");

const app = express();

app.use(
	cors({
		origin: "http://localhost:5173",
	}),
);

app.use(express.json());

app.use("/chat", chatRoutes);

app.get("/health", (req, res) => {
	res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});
