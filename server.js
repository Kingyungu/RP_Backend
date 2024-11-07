import app from "./app.js";
import { testOpenAIConnection } from "./utils/openaiConfig.js";
import assistantService from "./utils/assistantService.js";
import ErrorHandler from "./middlewares/error.js";

const validateConfig = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const orgId = process.env.OPENAI_ORGANIZATION_ID;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is missing');
  }
  
  if (!orgId) {
    throw new Error('OPENAI_ORGANIZATION_ID environment variable is missing');
  }
  
  if (!apiKey.startsWith('sk-') && !apiKey.startsWith('proj-')) {
    throw new Error('Invalid API key format - should start with sk- or proj-');
  }
  
  if (!orgId.startsWith('org-')) {
    throw new Error('Invalid organization ID format - should start with org-');
  }
  
  return true;
};

const validateAssistantService = async () => {
  try {
    console.log('Validating Assistant Service configuration...');
    assistantService.validateConfig();
    console.log('Assistant Service configuration is valid');
    return true;
  } catch (error) {
    console.error('Assistant Service validation failed:', error.message);
    return false;
  }
};

const startServer = async () => {
  try {
    // Simple environment variable validation
    console.log('Validating configuration...');
    validateConfig();
    console.log('Configuration is valid');

    // Validate Assistant Service
    const assistantValid = await validateAssistantService();
    if (!assistantValid) {
      console.error('Assistant Service validation failed. Please check your configuration.');
      process.exit(1);
    }

    // Test OpenAI connection
    console.log('Testing OpenAI connection...');
    const connectionTest = await testOpenAIConnection();
    if (!connectionTest) {
      throw new ErrorHandler('OpenAI connection test failed', 500);
    }
    console.log('OpenAI connection test successful');

    // Test Assistant Service connection
    console.log('Testing Assistant Service connection...');
    await assistantService.testConnection();
    console.log('Assistant Service connection test successful');

    // Start server
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
      console.log(`Server running at port ${PORT}`);
    });

  } catch (error) {
    console.error('Error starting server:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    process.exit(1);
  }
};

const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  try {
    await assistantService.cleanup();
    console.log('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle graceful shutdowns
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...');
  console.error(error);
  process.exit(1);
});

// Start the server
startServer();