import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import { User } from "../models/userSchema.js";
import ErrorHandler from "../middlewares/error.js";
import { sendToken } from "../utils/jwtToken.js";
import jwt from "jsonwebtoken";

export const register = catchAsyncErrors(async (req, res, next) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !phone || !password || !role) {
    return next(new ErrorHandler("Please fill full form!"));
  }
  const isEmail = await User.findOne({ email });
  if (isEmail) {
    return next(new ErrorHandler("Email already registered!"));
  }
  const user = await User.create({
    name,
    email,
    phone,
    password,
    role,
  });
  sendToken(user, 201, res, "User Registered!");
});

export const login = catchAsyncErrors(async (req, res, next) => {
  const { email, password, role } = req.body;
  if (!email || !password || !role) {
    return next(new ErrorHandler("Please provide email ,password and role."));
  }
  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    return next(new ErrorHandler("Invalid Email Or Password.", 400));
  }
  const isPasswordMatched = await user.comparePassword(password);
  if (!isPasswordMatched) {
    return next(new ErrorHandler("Invalid Email Or Password.", 400));
  }
  if (user.role !== role) {
    return next(
      new ErrorHandler(`User with provided email and ${role} not found!`, 404)
    );
  }
  sendToken(user, 201, res, "User Logged In!");
});

export const logout = catchAsyncErrors(async (req, res, next) => {
  // Clear only the cookie for the role being logged out
  const role = req.query.role || req.user?.role;
  const cookieName = role === 'Employer' ? 'employerToken' : 'seekerToken';

  const cookieOptions = {
    httpOnly: true,
    expires: new Date(Date.now()),
    secure: true,
    sameSite: "None",
  };

  res
    .status(200)
    .cookie(cookieName, "", cookieOptions)
    .json({
      success: true,
      message: "Logged Out Successfully.",
    });
});


export const getUser = catchAsyncErrors(async (req, res, next) => {
  // req.user is set by isAuthenticated (whichever cookie it found first)
  const currentUser = req.user;
  const isEmployer = currentUser.role === 'Employer';

  // Also resolve the other role's session if present
  let otherUser = null;
  const otherToken = isEmployer ? req.cookies.seekerToken : req.cookies.employerToken;
  if (otherToken) {
    try {
      const decoded = jwt.verify(otherToken, process.env.JWT_SECRET_KEY);
      otherUser = await User.findById(decoded.id);
    } catch (e) {
      // Invalid or expired token — ignore it
    }
  }

  const employer = isEmployer ? currentUser : otherUser;
  const jobSeeker = isEmployer ? otherUser : currentUser;

  res.status(200).json({
    success: true,
    user: currentUser,
    employer: employer || null,
    jobSeeker: jobSeeker || null,
  });
});