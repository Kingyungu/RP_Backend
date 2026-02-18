// middlewares/auth.js
import { User } from "../models/userSchema.js";
import { catchAsyncErrors } from "./catchAsyncError.js";
import ErrorHandler from "./error.js";
import jwt from "jsonwebtoken";

export const isAuthenticated = catchAsyncErrors(async (req, res, next) => {
  // X-Auth-Role header lets the frontend specify which session to use
  // when both employer and job seeker are logged in simultaneously
  const roleHint = req.headers['x-auth-role'];

  let authToken;
  if (roleHint === 'Employer') {
    authToken = req.cookies.employerToken;
  } else if (roleHint === 'Job Seeker') {
    authToken = req.cookies.seekerToken;
  } else {
    // No hint: try employer cookie, then seeker cookie, then Authorization header
    authToken = req.cookies.employerToken
      || req.cookies.seekerToken
      || req.headers.authorization?.split(' ')[1];
  }

  // Always fall back to Authorization header if cookie not found
  if (!authToken) {
    authToken = req.headers.authorization?.split(' ')[1];
  }

  if (!authToken) {
    return next(new ErrorHandler("Please login to access this resource", 401));
  }

  try {
    const decoded = jwt.verify(authToken, process.env.JWT_SECRET_KEY);
    req.user = await User.findById(decoded.id);

    if (!req.user) {
      return next(new ErrorHandler("User not found", 401));
    }

    next();
  } catch (error) {
    return next(new ErrorHandler("Invalid or expired token", 401));
  }
});