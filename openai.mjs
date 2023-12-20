import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";

const secretKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: secretKey,
});

export default openai;
