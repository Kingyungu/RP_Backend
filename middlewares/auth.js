// middlewares/auth.js
import { User } from "../models/userSchema.js";
import { catchAsyncErrors } from "./catchAsyncError.js";
import ErrorHandler from "./error.js";
import jwt from "jsonwebtoken";

export const isAuthenticated = catchAsyncErrors(async (req, res, next) => {
  const { token } = req.cookies;

  // Check for token in cookies and headers
  const authToken = token || req.headers.authorization?.split(' ')[1];

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