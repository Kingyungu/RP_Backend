import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ 
  path: path.join(__dirname, `../config/${process.env.NODE_ENV}.env`)
});

function formatApiKey(key) {
  if (!key) {
    return null;
  }

  key = key.trim().replace(/["']/g, '');
  
  if (!key.startsWith('sk-')) {
    throw new Error('Invalid API key format - must start with sk-');
  }

  return key;
}

let openai = null;

try {
  const apiKey = formatApiKey(process.env.OPENAI_API_KEY);
  if (apiKey) {
    openai = new OpenAI({
      apiKey,
      organization: process.env.OPENAI_ORGANIZATION_ID?.trim(),
      defaultHeaders: {
        'OpenAI-Beta': 'assistants=v1'
      }
    });
  }
} catch (error) {
  console.warn('OpenAI client initialization failed:', error.message);
}

export const testOpenAIConnection = async () => {
  if (!openai) {
    console.log('OpenAI client not initialized - skipping connection test');
    return false;
  }

  try {
    const apiKey = openai.apiKey;
    const maskedKey = `${apiKey.slice(0, 5)}...${apiKey.slice(-4)}`;
    console.log(`Testing OpenAI connection in ${process.env.NODE_ENV} mode`);
    console.log('API key format:', maskedKey);
    console.log('Organization ID:', openai.organization);
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Test connection" }],
      max_tokens: 5
    });
    
    console.log('OpenAI connection test successful');
    return true;
  } catch (error) {
    console.error('OpenAI connection test failed:', {
      message: error.message,
      status: error.status,
      type: error.type,
      code: error.code
    });
    return false;
  }
};

export const getOpenAIClient = () => {
  if (!openai) {
    throw new Error('OpenAI client is not initialized');
  }
  return openai;
};

export default openai;