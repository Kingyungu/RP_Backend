// middlewares/error.js
class ErrorHandler extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Centralized error logging
const logError = (error, req = null) => {
  const errorDetails = {
    message: error.message,
    stack: error.stack,
    status: error.statusCode || 500,
    type: error.type,
    code: error.code,
    timestamp: new Date().toISOString(),
  };

  // Add request details if available
  if (req) {
    errorDetails.path = req.path;
    errorDetails.method = req.method;
    errorDetails.params = req.params;
    errorDetails.query = req.query;
    errorDetails.user = req.user?._id;

    // Log file upload details if present
    if (req.files) {
      errorDetails.files = Object.keys(req.files).reduce((acc, key) => {
        const file = req.files[key];
        acc[key] = {
          name: file.name,
          size: file.size,
          mimetype: file.mimetype
        };
        return acc;
      }, {});
    }
  }

  // Special handling for OpenAI errors
  if (error.response?.data) {
    errorDetails.openai = {
      status: error.response.status,
      headers: error.response.headers,
      data: error.response.data
    };
  }

  // Special handling for MongoDB/Mongoose errors
  if (error.name === 'MongoError' || error.name === 'ValidationError') {
    errorDetails.mongodb = {
      name: error.name,
      code: error.code,
      keyValue: error.keyValue
    };
  }

  console.error('Detailed error log:', JSON.stringify(errorDetails, null, 2));
  return errorDetails;
};

// Error logger middleware
export const errorLogger = (err, req, res, next) => {
  logError(err, req);
  next(err);
};

// Final error handler middleware
export const errorMiddleware = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.message = err.message || 'Internal Server Error';

  // Handle specific types of errors
  switch (true) {
    case err.name === 'CastError':
      err = new ErrorHandler(`Invalid ${err.path}: ${err.value}`, 400);
      break;

    case err.code === 11000:
      err = new ErrorHandler(
        `Duplicate value entered for ${Object.keys(err.keyValue)} field`,
        400
      );
      break;

    case err.name === 'ValidationError':
      const messages = Object.values(err.errors).map(val => val.message);
      err = new ErrorHandler(`Invalid input data. ${messages.join('. ')}`, 400);
      break;

    case err.name === 'JsonWebTokenError':
      err = new ErrorHandler('Invalid token. Please log in again.', 401);
      break;

    case err.name === 'TokenExpiredError':
      err = new ErrorHandler('Token has expired. Please log in again.', 401);
      break;

    // Handle file upload errors
    case err.code === 'LIMIT_FILE_SIZE':
      err = new ErrorHandler('File size is too large. Please upload a smaller file.', 400);
      break;

    case err.code === 'LIMIT_UNEXPECTED_FILE':
      err = new ErrorHandler('Unexpected file upload. Please check file requirements.', 400);
      break;

    // Handle GridFS errors
    case err.message.includes('GridFS'):
      err = new ErrorHandler('File storage error occurred. Please try again.', 500);
      break;

    // Handle OpenAI API errors
    case err.type === 'invalid_request_error':
      err = new ErrorHandler('Invalid AI request. Please check your inputs.', 400);
      break;

    case err.type === 'rate_limit_error':
      err = new ErrorHandler('AI service temporarily unavailable. Please try again later.', 429);
      break;
  }

  // Prepare response
  const response = {
    success: false,
    status: err.status,
    message: err.message,
    // Include stack trace and additional details in development
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      error: err,
      code: err.code
    })
  };

  // Log final error details
  logError(err, req);

  // Send response
  res.status(err.statusCode).json(response);
};

// Additional utility functions
const isOperationalError = (error) => {
  if (error instanceof ErrorHandler) {
    return error.isOperational;
  }
  return false;
};

// Handle unhandled promise rejections
const handleUnhandledRejection = (error) => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...');
  logError(error);
  // Gracefully shutdown the server
  setTimeout(() => {
    process.exit(1);
  }, 1000);
};

// Handle uncaught exceptions
const handleUncaughtException = (error) => {
  console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  logError(error);
  process.exit(1);
};

// Setup global error handlers
process.on('unhandledRejection', handleUnhandledRejection);
process.on('uncaughtException', handleUncaughtException);

// Export everything needed
export {
  ErrorHandler as default,
  logError,
  isOperationalError,
  handleUnhandledRejection,
  handleUncaughtException
};