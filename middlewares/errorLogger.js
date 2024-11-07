// middlewares/errorLogger.js
export const logError = (error) => {
  const errorDetails = {
    message: error.message,
    stack: error.stack,
    status: error.status,
    type: error.type,
    code: error.code,
    timestamp: new Date().toISOString()
  };

  // If it's an OpenAI error, log additional details
  if (error.response) {
    errorDetails.openai = {
      status: error.response.status,
      headers: error.response.headers,
      data: error.response.data
    };
  }

  console.error('Detailed error log:', JSON.stringify(errorDetails, null, 2));
};